# Device provisioning and audit history

This portfolio feature adds a small operator-facing device registry and transactional audit history. It is intentionally limited to these two features.

## Registry

The dashboard includes a **Device registry** section below fleet monitoring. Operators can register a device with:
- Unique device ID and serial number
- Hardware revision and firmware version
- Customer label
- Lifecycle status: registered, provisioned, active, retired

The API provides authenticated routes:
- `GET /api/devices` — list registered devices (up to 500)
- `POST /api/devices` — register a device; returns 201 or 409 for duplicate ID/serial
- `PATCH /api/devices/:deviceId` — update device metadata or status
- `GET /api/devices/:deviceId/audit` — last 100 audit records

The API creates the `devices` and `device_audit` tables at startup, including on existing PostgreSQL volumes. No manual database reset is needed. Registration is independent of telemetry ingestion; telemetry from unregistered simulator devices still works.

## Audit

Every successful registration and metadata/status update writes an audit record **inside the same PostgreSQL transaction** as the device mutation. An audit record stores device ID, action, actor label, timestamp, and before/after JSON snapshots. The UI lets operators inspect a device's history. Failed operations and duplicate registration attempts do not create audit entries.

**Important limitation:** The demo uses one shared dashboard token, so the actor is labeled `dashboard-operator`, not a verified individual identity. This is an operation history, **not a person-attributed or tamper-proof compliance audit trail**. The database does not enforce append-only access controls. Production identity, permissions and stronger audit integrity are out of scope.

## Verify

```bash
git switch feature/device-provisioning-audit
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

Enter the configured dashboard token, scroll to **Device registry**, register a device, change its status, and open **Audit** to inspect the registration and update records. Tests and builds must be run to confirm behavior.
