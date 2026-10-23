# Real-Time Telemetry Dashboard

A full-stack telemetry monitoring application using TypeScript, Node.js, Socket.IO, Redis Pub/Sub, PostgreSQL, and React.

## Architecture

Telemetry producers → HTTP ingestion API → PostgreSQL persistence → Redis Pub/Sub → Socket.IO gateway → React dashboard.

## Development milestones

1. API with validated ingestion and health endpoints.
2. Persistent telemetry history and Redis-backed broadcasts.
3. Live React dashboard with reconnection handling.
4. Docker Compose, tests, load testing, and operational documentation.

This repository is under active development. The architecture above is the intended design, not a claim that every component is implemented yet.
