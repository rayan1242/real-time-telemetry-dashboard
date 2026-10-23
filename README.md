# Real-Time Telemetry Dashboard

A runnable full-stack demo for ingesting robot sensor data, persisting it in PostgreSQL, distributing updates across Node.js instances with Redis-backed Socket.IO, and visualizing readings in React.

## Architecture

```text
Robot simulator --HTTP POST--> Express API --transaction--> PostgreSQL
                                |
                                +-- Socket.IO Redis adapter --> WebSocket --> React
```

- `telemetry_events` stores immutable event history, indexed by robot and time.
- `robot_latest` stores one row per robot. Timestamp-guarded upserts prevent older readings from overwriting newer readings.
- `event_id` is unique, so retries do not duplicate history or re-broadcast the same event.
- Redis Pub/Sub via `@socket.io/redis-adapter` distributes room broadcasts across Node.js instances.
- React loads a REST snapshot after connecting/reconnecting and ignores older WebSocket events.
- The dashboard marks robots offline when their most recent reading is more than 10 seconds old.

## Run locally

Requirements: Docker + Docker Compose, Node.js 22+, npm.

1. `docker compose up --build -d` — starts PostgreSQL, Redis, and the API on port 3000.
2. `cd web && npm install && npm run dev` — starts React at http://localhost:5173.
3. In another terminal at the repository root, run `npm install && npm run simulate`.
4. Open http://localhost:5173 and select a robot to inspect its recent history.

If you prefer running the API outside Docker: `docker compose up -d postgres redis`, copy `.env.example` to `.env`, then `npm install && npm run dev`.

## API

- `GET /health`: database health check.
- `GET /api/robots`: latest readings (up to 500 robots).
- `GET /api/robots/:deviceId/history?limit=100`: recent readings (max 500).
- `POST /api/telemetry`: ingest one event; requires `x-api-key` header.

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

**Why Redis?** The Socket.IO Redis adapter broadcasts across multiple API instances. Pub/Sub is not a durable message queue; database persistence occurs before live broadcasting.

**How does reconnect work?** The browser fetches a fresh REST snapshot after reconnecting, and compares event timestamps before applying incoming updates.

## Limitations and next steps

This is an interview-ready **local demo**, not a production multi-tenant service or a verified 10,000-robot benchmark. The dashboard and WebSocket watch events are **not authenticated**. Before production use: add user sessions, tenant-aware authorization for REST and socket rooms, rate limiting, TLS, migrations, durable outbox/queue for reliable notifications, observability, partitioning/retention, proper backpressure, and load tests. The Redis Pub/Sub adapter does not provide connection-state recovery; the REST snapshot handles current-state resynchronization, not historical replay.

The demo uses a shared development API key. Replace it and never expose it in a browser application.
