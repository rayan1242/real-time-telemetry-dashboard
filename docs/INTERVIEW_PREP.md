# Interview preparation: Real-Time Robot Telemetry Dashboard

## 30-second overview

"I built a full-stack robot telemetry dashboard with React, TypeScript, Express, PostgreSQL, Redis Streams, and Socket.IO. Robots send sensor readings to an authenticated API, which enqueues events. A background worker persists them to PostgreSQL and publishes live notifications. The React dashboard displays the current fleet, historical charts, and temperature/battery threshold alerts. I added basic operator access controls, tests, a load generator, and a single-host AWS deployment configuration."

## 90-second architecture walkthrough

1. **Ingest**: Robots POST JSON readings with a device API key. Zod validates the schema. The API replies HTTP 202 only after a successful Redis Streams XADD.
2. **Queue**: Redis Streams separates fast HTTP ingestion from slower PostgreSQL writes. Consumer groups and XAUTOCLAIM support retry after worker failure; a dead-letter stream holds repeatedly failing messages.
3. **Persist**: The worker writes event history and the latest robot snapshot in a PostgreSQL transaction. A unique event ID prevents duplicate inserts; timestamp guards prevent older readings overwriting newer state.
4. **Live updates**: The worker publishes processed events through Redis Pub/Sub. API instances send Socket.IO messages to subscribed browser clients.
5. **Frontend**: React uses a custom hook for real-time state and REST snapshots, reusable robot cards, and SVG historical charts. Reconnection triggers a REST refresh.
6. **Security and alerts**: Dashboard REST and WebSocket connections require an operator token; ingestion uses a separate credential. The UI shows live threshold warnings at >=35°C or <=20% battery.
7. **Operational concerns**: Health endpoints, graceful shutdown, queue lag monitoring, soft overload rejection, tests, and a concurrent HTTP load script are included.

## Diagram

```text
Robot simulator -> HTTP POST /api/telemetry -> Express API
                                                   |
                                             Redis Streams
                                                   |
                                          Background worker
                                                   |
                                            PostgreSQL
                                         /             \
                               event history       latest snapshot
                                                   |
                                          Redis Pub/Sub
                                                   |
                                       Socket.IO API server
                                                   |
                                          React dashboard
                                        /                 \
                                   Live cards         REST history
```

## Interview questions and concise answers

**1. Why Redis Streams instead of writing to Postgres directly?**
The stream buffers bursts and decouples HTTP request latency from database processing. The tradeoff is eventual consistency and more operational complexity.

**2. What does HTTP 202 guarantee?**
It means Redis accepted the queued event, not that Postgres committed it. The worker may process it later or fail and send it to the DLQ.

**3. Why Redis Pub/Sub and Streams together?**
Streams are for durable-ish queued processing with acknowledgments; Pub/Sub is for low-latency, ephemeral notifications. A reconnecting browser fetches a REST snapshot because Pub/Sub does not replay missed events.

**4. How do you handle duplicates?**
Each event has a UUID and Postgres uses a unique event_id primary key. A worker retry cannot insert the same event twice. The frontend compares timestamps to avoid stale latest-state updates.

**5. What if a worker crashes?**
Unacknowledged stream messages remain pending. Another worker can reclaim messages idle for at least 10 seconds using XAUTOCLAIM. After repeated failures, the event goes to the DLQ for manual investigation.

**6. Why two Postgres tables?**
One table stores immutable historical readings; another stores the latest reading per robot. This optimizes current fleet snapshots and chronological chart queries separately.

**7. How did you design the frontend?**
React component-based design: App coordinates selection/filtering, useTelemetry owns transport and live state, RobotCard renders one robot, MetricChart renders history. It is MVC-inspired separation of concerns, not traditional MVC.

**8. Why REST and WebSockets?**
REST is ideal for initial state, history and reconnect recovery. WebSockets deliver low-latency live updates without repeated polling.

**9. What happens during a network disconnect?**
Socket.IO attempts reconnect. On connect, the hook re-subscribes and fetches a REST snapshot. This restores current state but not every missed historical notification.

**10. How is the system secured?**
The local demo separates operator bearer token authentication from ingestion keys. Socket.IO authenticates the handshake before allowing subscriptions. Optional device-specific keys are bound to device IDs. It does NOT yet have per-user sessions, RBAC, tenant isolation or enterprise-grade credential rotation.

**11. How do alerts work?**
The browser evaluates the latest robot readings against simple thresholds: high temperature >=35°C and low battery <=20%. They are transient UI indicators, not durable server-side alerts or notification workflows.

**12. What happens under heavy load?**
The API checks Redis consumer-group lag and can respond with HTTP 429 and Retry-After when lag exceeds a configured threshold. A load generator measures HTTP acceptance latency and throughput. This is soft backpressure and is not a hard queue limit or a validated scalability benchmark.

**13. How do you test the system?**
Backend unit tests, frontend Vitest/React Testing Library tests, a Docker-backed integration test of the queue/DB/WebSocket path, and a GitHub Actions CI workflow. Tests must be run and their results checked; code in a PR is not proof of passing tests.

**14. What would you change for production?**
Use real operator identity and RBAC, tenant/device authorization, secrets management, TLS, database/Redis managed services, stream retention, alert persistence and acknowledgment, monitoring, structured logs, autoscaling, and tested backup/recovery.

**15. How would you deploy to AWS?**
The repository includes a single-EC2 Docker Compose starter with Caddy serving the React frontend and proxying API/WebSockets over HTTPS with a real domain. Postgres and Redis are internal containers. This is a demo blueprint; no live AWS deployment has been performed.

## What you can claim vs what you cannot claim

You **can** describe the code and design decisions, test cases, and deployment starter. You **cannot yet claim** verified test passes, actual throughput at a particular robot count, production-grade security, high availability, or a running AWS deployment without evidence. The phase PRs are stacked and still need validation and review.

## Five-minute demo outline

1. Open dashboard and enter the local operator token.
2. Start the simulator; watch the robot cards update.
3. Search for a robot, filter by online/offline, and select one.
4. Toggle temperature and battery history charts.
5. Send a valid hot or low-battery event to demonstrate alerts.
6. Restart the API and show reconnect snapshot recovery.
7. Show unauthorized REST access returning 401 and the worker/queue architecture.

## Follow-up practice

Practice these scenarios out loud: "Worker dies after DB commit but before XACK"; "Events arrive out of order"; "Socket disconnects for 30 seconds"; "10,000 robots send one event/sec"; "An operator tries to subscribe to another tenant's robot." Explain current behavior first, then a concrete improvement.
