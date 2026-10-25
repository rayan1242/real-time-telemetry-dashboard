# Real-Time Telemetry Dashboard

A runnable full-stack demo for ingesting robot sensor data, persisting it in PostgreSQL, distributing updates across Node.js instances with Redis-backed Socket.IO, and visualizing readings in React.

## Architecture

```text
Robot simulator --HTTP POST--> Express API --XADD--> Redis Stream
                                                         |
                                                         v
                                                 Consumer group worker
                                                         |
                                                   DB transaction
                                                         v
                                                     PostgreSQL
                                                         |
                                             Redis Pub/Sub notification
                                                         |
                                                  API Socket.IO
                                                         v
                                                       React
```

- `telemetry_events` stores immutable event history, indexed by robot and time.
- `robot_latest` stores one row per robot. Timestamp-guarded upserts prevent older readings from overwriting newer readings.
- `event_id` is unique, so retries do not duplicate database history. WebSocket notifications may be repeated during recovery; the browser should deduplicate by event ID.
- Redis Streams consumer groups buffer events, with pending-entry recovery and a dead-letter stream after five processing failures. Redis Pub/Sub is used only for live notifications, not durable event storage.
- Each API instance receives worker notifications and broadcasts only to its local sockets to avoid multiplying events via the Socket.IO Redis adapter.
- React loads a REST snapshot after connecting/reconnecting and ignores older WebSocket events.
- The dashboard marks robots offline when their most recent reading is more than 10 seconds old.

## Run locally

Requirements: Docker + Docker Compose, Node.js 22+, npm.

1. `docker compose up --build -d` — starts PostgreSQL, Redis, the API on port 3000, and a background worker.
2. `cd web && npm install && npm run dev` — starts React at http://localhost:5173.
3. In another terminal at the repository root, run `npm install && npm run simulate`.
4. Open http://localhost:5173 and select a robot to inspect its recent history.

If you prefer running the API outside Docker: `docker compose up -d postgres redis`, copy `.env.example` to `.env`, then `npm install && npm run dev`.

## API

- `GET /health`: database health check.
- `GET /api/robots`: latest readings (up to 500 robots).
- `GET /api/robots/:deviceId/history?limit=100`: recent readings (max 500).
- `POST /api/telemetry`: enqueue one event; requires `x-api-key` header. Returns `202` with a `queueId` once Redis accepts the event; database processing happens asynchronously.

Example:

```bash
curl -X POST http://localhost:3000/api/telemetry \
  -H 'Content-Type: application/json' \
  -H 'x-api-key: local-demo-key-change-me' \
  -d '{"eventId":"11111111-1111-4111-8111-111111111111","deviceId":"robot-001","temperature":24.5,"battery":88}'
```

## Checks

- `npm run typecheck`
- `npm test`
- `cd web && npm run build`

## Interview talking points

**Why two tables?** The dashboard needs a fast lookup of current state; historical charts need time-range scans. Separate access patterns avoid scanning history for the latest value.

**Why transactions?** Event insertion and latest-state updates commit together. Duplicate event IDs are ignored, and stale timestamps cannot overwrite newer readings.

**Why Redis Streams?** Unlike Redis Pub/Sub, a stream tracks pending work for a consumer group. Workers acknowledge events only after the database transaction and notification step succeed. A new worker can reclaim work left pending after a crash.

**How does reconnect work?** The browser fetches a fresh REST snapshot after reconnecting, and compares event timestamps before applying incoming updates.

## Limitations and next steps

This is an interview-ready **local demo**, not a production multi-tenant service or a verified 10,000-robot benchmark. The dashboard and WebSocket watch events are **not authenticated**. Before production use: add user sessions, tenant-aware authorization for REST and socket rooms, rate limiting, TLS, migrations, durable notification replay, observability, stream retention and backpressure, and load tests. The Redis Pub/Sub adapter does not provide connection-state recovery; the REST snapshot handles current-state resynchronization, not historical replay.

The demo uses a shared development API key. Replace it and never expose it in a browser application.

## Step 1: Reliability and integration testing

The API exposes `GET /live` (process liveness) and `GET /health` (readiness including a database check). SIGTERM/SIGINT mark the service unready, disconnect WebSockets, close the HTTP server, and release Redis and PostgreSQL connections. The graceful shutdown deadline is 10 seconds.

To verify the real stack locally:

```bash
docker compose up --build -d
npm install
npm run typecheck
npm test
npm run test:integration
```

The integration test calls the running API and checks authenticated ingestion, duplicate suppression, stale-event ordering, PostgreSQL history, and delivery over a real Socket.IO connection. It uses unique test robot IDs, so repeated runs do not collide.

`npm run test:integration` requires a running Docker Compose stack; it is not a mock test. A successful commit alone does not prove these tests have passed. For a manual crash test, run the simulator and dashboard, then execute `docker compose restart api` and observe reconnect/snapshot behavior.

Next steps: run tests on CI with service containers, add durable queuing and a worker, and run repeatable load tests. This project is still a local demo; there is no tenant authorization.

## Step 2: Redis Streams, worker and failure recovery

The API uses `XADD` to append validated events to `telemetry:events` and returns HTTP 202 after Redis accepts the append. The worker uses `XREADGROUP` to process events and `XACK` only after committing to PostgreSQL and publishing a live notification. An event can be processed more than once after a crash; PostgreSQL's unique `event_id` constraint makes the write idempotent.

If a worker dies with unacknowledged events, another worker uses `XAUTOCLAIM` to recover messages idle for at least 10 seconds. Processing failures are retried; after five failed attempts, the worker moves the event to `telemetry:dead-letter`. The DLQ is for investigation and replay, **not automatic data recovery**.

Run and test:

```bash
docker compose up --build -d
npm install
npm run typecheck
npm test
npm run test:integration
docker compose logs -f worker
```

To test recovery, start `npm run simulate`, run `docker compose stop worker` while events arrive, then `docker compose start worker`. Queued events should eventually appear in PostgreSQL. To simulate a hard crash during processing, use `docker compose kill worker` and restart it. Check the dead-letter stream with `docker compose exec redis redis-cli XRANGE telemetry:dead-letter - + COUNT 10`.

**Important guarantees and limitations:**
- HTTP 202 means queued, **not persisted in PostgreSQL**. Read-after-write is eventually consistent.
- Redis AOF with `appendfsync everysec` and a named volume improves local restart persistence, but an abrupt host failure can still lose approximately one second of writes; this is not a zero-data-loss guarantee.
- Redis Pub/Sub and WebSockets are ephemeral. If notification delivery fails after the DB commit, a reconnecting client must refresh its REST snapshot. The worker may republish an event on retry.
- The stream currently has no retention policy, memory limit, queue-depth admission control, or automated DLQ replay. Do not claim it is safe for unbounded production load.
- A long database outage may exhaust five attempts and move events to the DLQ. Those events require explicit replay.
- The integration tests require running Docker services; code has been committed but end-to-end execution must be verified locally.


## Phase 4: Operator access, device identity and threshold alerts

**Local demonstration, not a production authentication service.** The API now requires a separate `DASHBOARD_TOKEN` for fleet REST endpoints and Socket.IO connections. Operators enter this token in the dashboard; React keeps it in memory, not localStorage. The browser sends `Authorization: Bearer <token>` for REST and `auth.token` during the Socket.IO handshake. Invalid credentials receive HTTP 401 or a Socket.IO connection error. Restarting/reloading the page requires entering the token again.

Docker Compose defaults to `local-dashboard-token-change-me` for local development only. Override `DASHBOARD_TOKEN` and `INGEST_API_KEY` with strong, different secrets before any shared environment. Do not commit real secrets or expose an ingestion key in frontend code. Use TLS for traffic outside localhost.

Device ingestion continues to require `x-api-key`. By default the simulator uses the shared development `INGEST_API_KEY`. Optionally configure `DEVICE_API_KEYS` as a JSON object mapping device IDs to distinct keys. When configured, a device's key is valid **only for its own deviceId** and the shared fallback is disabled. The default simulator does not automatically select per-device keys; adapt it before enabling this option.

**Live alerts** currently run in the React client against each robot's latest known temperature and battery. They trigger at temperature >= 35°C or battery <= 20%. They are visual threshold indicators, **not durable alerts**: no alert table, acknowledgments, notification delivery, per-device rules or historical alert records are implemented. Offline readings may still appear as last-known threshold violations.

To run:
```bash
git switch feature/dashboard-auth-alerts
docker compose up --build -d
npm install
npm run typecheck
npm test
npm run test:integration
cd web
npm install
npm run build
npm test
npm run dev
```
Open http://localhost:5173 and enter the configured `DASHBOARD_TOKEN`. In another terminal at the repo root, run `npm run simulate`. To test the access boundary, `curl -i http://localhost:3000/api/robots` should return HTTP 401, while the same request with `-H 'Authorization: Bearer <token>'` should succeed.

**Limitations:** A shared operator token is not individual user authentication or authorization. There is no identity provider, user session expiration, refresh token, audit trail, rate limiting, tenant isolation, CSRF strategy for cookie sessions, or credential rotation. A static bearer token grants the same fleet access to every holder. Those are required before production use. Tests and build must be run locally; commits alone do not verify runtime behavior.


## Phase 5–7: load, CI, interview prep and AWS deployment starter

**Phase 5 — scalability starter:** `MAX_QUEUE_LAG` (default 5000) applies soft admission control when Redis consumer-group lag is high. Ingestion returns 429 with Retry-After when the threshold is exceeded. The operator-protected `GET /api/ops/queue` endpoint reports stream length, pending entries, and approximate consumer lag. Run `npm run load:test` against the running stack to generate 1,000 concurrent test events by default. Adjust `LOAD_EVENTS`, `LOAD_CONCURRENCY`, `LOAD_ROBOTS` to tune the test. The reported p50/p95/p99 latencies cover **HTTP acceptance only**, not end-to-end persistence. This is not a production throughput guarantee or a hard Redis storage limit.

**Phase 6 — quality:** `.github/workflows/ci.yml` defines backend typecheck/unit tests, frontend build/unit tests, and a Docker Compose integration test job. See `docs/INTERVIEW_PREP.md` for a 30-second pitch, architecture walkthrough, interview Q&A, and live demo script. Check actual CI results before claiming tests passed.

**Phase 7 — AWS starter:** `deploy/aws/` contains a single-host EC2 Compose configuration with Caddy, same-origin React/REST/WebSocket routing, and optional automatic HTTPS for a real domain. See `deploy/aws/README.md` for setup and security precautions. **No AWS resources were provisioned or deployed by this repository change.** This demo stack is not high availability and is not appropriate for public production use without additional security and operations work.

The PRs are intentionally stacked: Phase 2 -> Phase 3 -> Phase 4 -> completion. Merge and validate in order; the completion branch alone contains all work.
