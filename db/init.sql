CREATE TABLE IF NOT EXISTS telemetry_events (
  event_id UUID PRIMARY KEY,
  device_id VARCHAR(100) NOT NULL,
  temperature DOUBLE PRECISION NOT NULL,
  battery DOUBLE PRECISION NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS telemetry_device_time_idx
  ON telemetry_events (device_id, recorded_at DESC);

CREATE TABLE IF NOT EXISTS robot_latest (
  device_id VARCHAR(100) PRIMARY KEY,
  temperature DOUBLE PRECISION NOT NULL,
  battery DOUBLE PRECISION NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL
);
