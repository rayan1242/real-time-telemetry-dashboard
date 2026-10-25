import { useCallback, useEffect, useState, type FormEvent } from "react";
import { API } from "../telemetry";

type Device = {
  deviceId: string; serialNumber: string; hardwareRevision: string;
  firmwareVersion: string; customer: string;
  status: "registered" | "provisioned" | "active" | "retired";
  createdAt: string; updatedAt: string;
};
type Audit = {
  id: string; deviceId: string; action: string; actor: string;
  beforeState: Device | null; afterState: Device; occurredAt: string;
};
const statuses: Device["status"][] = ["registered", "provisioned", "active", "retired"];
const empty = { deviceId: "", serialNumber: "", hardwareRevision: "", firmwareVersion: "", customer: "", status: "registered" as const };

export default function DeviceManagement({ token }: { token: string }) {
  const [devices, setDevices] = useState<Device[]>([]);
  const [draft, setDraft] = useState(empty);
  const [selected, setSelected] = useState("");
  const [audit, setAudit] = useState<Audit[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const request = useCallback(async (path: string, init: RequestInit = {}) => {
    const response = await fetch(`${API}${path}`, {
      ...init, headers: { "content-type": "application/json", authorization: `Bearer ${token}`, ...init.headers }
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`);
    return data;
  }, [token]);

  const refresh = useCallback(async () => {
    const data: { items: Device[] } = await request("/api/devices");
    setDevices(data.items);
  }, [request]);

  useEffect(() => {
    let active = true;
    void request("/api/devices").then(data => { if (active) setDevices(data.items); })
      .catch(error => { if (active) setMessage(String(error)); });
    return () => { active = false; };
  }, [request]);

  const showAudit = async (deviceId: string) => {
    setSelected(deviceId); setAudit([]);
    try {
      const data: { items: Audit[] } = await request(`/api/devices/${encodeURIComponent(deviceId)}/audit`);
      setAudit(data.items);
    } catch (error) { setMessage(String(error)); }
  };

  const register = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setMessage("");
    try {
      await request("/api/devices", { method: "POST", body: JSON.stringify(draft) });
      setDraft(empty);
      await refresh();
      setMessage("Device registered and audit event recorded.");
    } catch (error) { setMessage(String(error)); }
    finally { setBusy(false); }
  };

  const changeStatus = async (device: Device, status: Device["status"]) => {
    setBusy(true); setMessage("");
    try {
      await request(`/api/devices/${encodeURIComponent(device.deviceId)}`, {
        method: "PATCH", body: JSON.stringify({ status })
      });
      await refresh();
      if (selected === device.deviceId) await showAudit(device.deviceId);
      setMessage(`${device.deviceId} updated; audit event recorded.`);
    } catch (error) { setMessage(String(error)); }
    finally { setBusy(false); }
  };

  return <section className="device-management" aria-label="Device provisioning">
    <div className="section-heading"><div><p className="eyebrow">OPERATIONS / PROVISIONING</p><h2>Device registry</h2></div><span className="count">{devices.length} registered</span></div>
    <p className="device-note">Register hardware identities and track provisioning status. Telemetry can arrive independently of registration.</p>
    <form className="device-form" onSubmit={event => void register(event)}>
      {([
        ["deviceId", "Device ID"], ["serialNumber", "Serial number"], ["hardwareRevision", "Hardware revision"],
        ["firmwareVersion", "Firmware version"], ["customer", "Customer"]
      ] as const).map(([field, label]) =>
        <label key={field}>{label}
          <input value={draft[field]} required={field === "deviceId" || field === "serialNumber" || field === "hardwareRevision"}
            maxLength={field === "deviceId" ? 100 : 120} onChange={event => setDraft(current => ({ ...current, [field]: event.target.value }))} />
        </label>)}
      <button type="submit" disabled={busy}>Register device</button>
    </form>
    {message && <p className="device-message" role="status">{message}</p>}
    <div className="device-table-wrap"><table className="device-table">
      <thead><tr><th>Device</th><th>Serial</th><th>Hardware</th><th>Firmware</th><th>Customer</th><th>Status</th><th>History</th></tr></thead>
      <tbody>{devices.map(device => <tr key={device.deviceId}>
        <td>{device.deviceId}</td><td>{device.serialNumber}</td><td>{device.hardwareRevision}</td>
        <td>{device.firmwareVersion || "—"}</td><td>{device.customer || "—"}</td>
        <td><select aria-label={`Status for ${device.deviceId}`} value={device.status} disabled={busy}
          onChange={event => void changeStatus(device, event.target.value as Device["status"])}>
          {statuses.map(status => <option key={status} value={status}>{status}</option>)}
        </select></td>
        <td><button type="button" className="close-button" onClick={() => void showAudit(device.deviceId)}>Audit</button></td>
      </tr>)}</tbody>
    </table></div>
    {selected && <div className="device-audit">
      <div className="section-heading"><h3>Audit history: {selected}</h3><button type="button" className="close-button" onClick={() => setSelected("")}>Close</button></div>
      {!audit.length && <p>No audit entries found.</p>}
      {audit.map(entry => <div className="audit-entry" key={entry.id}>
        <strong>{entry.action}</strong> · {new Date(entry.occurredAt).toLocaleString()} · {entry.actor}
        <p>{entry.beforeState ? `Status: ${entry.beforeState.status} → ${entry.afterState.status}` : `Registered serial ${entry.afterState.serialNumber}`}</p>
        <details><summary>Full record</summary><pre>{JSON.stringify({ before: entry.beforeState, after: entry.afterState }, null, 2)}</pre></details>
      </div>)}
    </div>}
  </section>;
}
