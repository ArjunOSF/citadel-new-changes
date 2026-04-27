import React, { useEffect, useMemo, useState } from "react";
import { api } from "../api.js";
import Modal from "../components/Modal.jsx";

/**
 * Data sources page — list + setup wizard + run history.
 *
 * Sources pull trial-balance files from Local folder / SFTP / S3 on a
 * configurable interval. This page is Admin-only (the nav gate enforces
 * it; we also double-check here for safety).
 */
export default function DataSources({ user }) {
  const [sources, setSources] = useState([]);
  const [firstLoad, setFirstLoad] = useState(true);
  const [banner, setBanner] = useState(null);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [openDetail, setOpenDetail] = useState(null);
  const [runningIds, setRunningIds] = useState(new Set());

  // Refresh silently after the first fetch — never return a bare "Loading…"
  // placeholder again, otherwise the rest of the tree (incl. the setup wizard)
  // unmounts every 15 seconds and loses whatever the user had typed.
  const load = () => {
    api.dataSources()
      .then(setSources)
      .catch((e) => setBanner({ kind: "error", text: e.message || "Failed to load data sources" }))
      .finally(() => setFirstLoad(false));
  };

  useEffect(load, []);

  // Background refresh every 15s so status chips update while the scheduler
  // fires. We pause while the wizard or run-history modal is open so form
  // inputs don't fight with re-renders behind the modal backdrop.
  useEffect(() => {
    if (wizardOpen || openDetail) return;
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, [wizardOpen, openDetail]);

  const runNow = async (id) => {
    setRunningIds((s) => new Set(s).add(id));
    setBanner(null);
    try {
      const res = await api.runDataSource(id);
      setBanner({
        kind: res.status === "error" ? "error" : "success",
        text: res.status === "no-new-files"
          ? "No new files since the last run."
          : res.status === "error"
            ? `Run failed: ${res.error}`
            : `Processed ${res.files_processed} file${res.files_processed === 1 ? "" : "s"} — ` +
              `${res.accounts_created} accounts created, ${res.accounts_updated} updated.`,
      });
      load();
    } catch (e) {
      setBanner({ kind: "error", text: e.message });
    } finally {
      setRunningIds((s) => { const n = new Set(s); n.delete(id); return n; });
    }
  };

  const toggleEnabled = async (src) => {
    try {
      await api.updateDataSource(src.id, { ...asReq(src), enabled: !src.enabled });
      load();
    } catch (e) { setBanner({ kind: "error", text: e.message }); }
  };

  const remove = async (src) => {
    if (!confirm(`Delete data source "${src.name}"? Run history will also be deleted.`)) return;
    try {
      await api.deleteDataSource(src.id);
      load();
    } catch (e) { setBanner({ kind: "error", text: e.message }); }
  };

  if (user.role !== "Admin") {
    return (
      <div className="page-padding">
        <div className="alert error">Only Admin users can manage data sources.</div>
      </div>
    );
  }

  if (firstLoad) return <div className="page-padding"><div className="muted">Loading…</div></div>;

  return (
    <div className="page-padding">
      <div className="toolbar">
        <div className="muted">
          Pull trial-balance files from a Local folder, SFTP server, or S3 bucket on a
          schedule. The backend scheduler wakes every 30 seconds and runs any source whose
          interval has elapsed. Pre-existing reconciliation work is preserved on re-ingest.
        </div>
        <button className="btn primary" onClick={() => { setEditing(null); setWizardOpen(true); }}>
          + Set up a data source
        </button>
      </div>

      {banner ? <div className={`alert ${banner.kind}`}>{banner.text}</div> : null}

      {sources.length === 0 ? (
        <div className="empty-state">
          <div className="empty-illustration">🔌</div>
          <h2>No data sources yet</h2>
          <p className="muted">Connect a Local folder, SFTP server, or S3 bucket, and files dropped there will
            be ingested on a schedule.</p>
          <button className="btn primary" onClick={() => { setEditing(null); setWizardOpen(true); }}>
            Set up your first source
          </button>
        </div>
      ) : (
        <div className="data-grid ds-grid">
          <div className="data-head">
            <div>Name</div>
            <div>Type</div>
            <div>Schedule</div>
            <div>Last run</div>
            <div>Status</div>
            <div></div>
          </div>
          {sources.map((s) => (
            <div className={`data-row static ${s.enabled ? "" : "ds-disabled"}`} key={s.id}>
              <div>
                <div className="cell-primary">
                  {sourceEmoji(s.type)} {s.name}
                </div>
                <div className="cell-sub muted">{configSummary(s)}</div>
              </div>
              <div><span className={`tag tag-muted`}>{sourceLabel(s.type)}</span></div>
              <div>
                {s.schedule_minutes
                  ? <div>Every {humanInterval(s.schedule_minutes)}</div>
                  : <div className="muted">Manual only</div>}
                {s.next_run_at
                  ? <div className="muted small">next: {s.next_run_at}</div>
                  : null}
              </div>
              <div>
                {s.last_run_at
                  ? <div>{s.last_run_at}</div>
                  : <div className="muted small">never</div>}
              </div>
              <div>
                {s.enabled
                  ? <span className={`tag tag-${statusTag(s.last_status)}`}>{s.last_status || "pending"}</span>
                  : <span className="tag tag-muted">paused</span>}
                {s.last_error ? <div className="muted small truncate" title={s.last_error}>⚠ {s.last_error}</div> : null}
              </div>
              <div className="row-actions">
                <button className="link-btn" disabled={runningIds.has(s.id)} onClick={() => runNow(s.id)}>
                  {runningIds.has(s.id) ? "Running…" : "Run now"}
                </button>
                <button className="link-btn" onClick={() => setOpenDetail(s.id)}>History</button>
                <button className="link-btn" onClick={() => { setEditing(s); setWizardOpen(true); }}>Edit</button>
                <button className="link-btn" onClick={() => toggleEnabled(s)}>
                  {s.enabled ? "Pause" : "Resume"}
                </button>
                <button className="link-btn danger" onClick={() => remove(s)}>Delete</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {wizardOpen && (
        <SetupWizard
          initial={editing}
          onClose={() => { setWizardOpen(false); setEditing(null); }}
          onSaved={() => { setWizardOpen(false); setEditing(null); load(); }}
        />
      )}

      {openDetail && (
        <RunHistoryModal sid={openDetail} onClose={() => setOpenDetail(null)} />
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Setup wizard — 4 steps
// ────────────────────────────────────────────────────────────────────────────

const INTERVAL_PRESETS = [
  { label: "Manual only",   value: 0 },
  { label: "Every 5 min",   value: 5 },
  { label: "Every 15 min",  value: 15 },
  { label: "Every hour",    value: 60 },
  { label: "Every 6 hours", value: 360 },
  { label: "Daily",         value: 1440 },
  { label: "Weekly",        value: 10080 },
];

function SetupWizard({ initial, onClose, onSaved }) {
  const editMode = !!initial;
  const [step, setStep] = useState(1);
  const [form, setForm] = useState(() => initial ? formFromSource(initial) : emptyForm());
  const [tempId, setTempId] = useState(null);  // id for in-progress source so test-connection works
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [testResult, setTestResult] = useState(null);

  const save = async () => {
    setBusy(true); setError("");
    try {
      const payload = toPayload(form);
      if (editMode) {
        await api.updateDataSource(initial.id, payload);
      } else if (tempId) {
        await api.updateDataSource(tempId, payload);
      } else {
        const res = await api.createDataSource(payload);
        setTempId(res.id);
      }
      onSaved();
    } catch (e) {
      setError(e.message || "Failed to save");
    } finally { setBusy(false); }
  };

  const testConnection = async () => {
    setBusy(true); setError(""); setTestResult(null);
    try {
      // Persist (create or update) so backend can test against the saved config.
      const payload = toPayload(form);
      let id = editMode ? initial.id : tempId;
      if (!id) {
        const res = await api.createDataSource({ ...payload, enabled: false });
        id = res.id;
        setTempId(id);
      } else {
        await api.updateDataSource(id, { ...payload, enabled: form.enabled });
      }
      const res = await api.testDataSource(id);
      setTestResult(res);
    } catch (e) {
      setError(e.message || "Test failed");
    } finally { setBusy(false); }
  };

  const canAdvance = () => {
    if (step === 1) return !!form.name && !!form.type;
    if (step === 2) return hasValidConnection(form);
    if (step === 3) return !!form.file_pattern;
    return true;
  };

  const next = () => step < 4 && setStep(step + 1);
  const back = () => step > 1 && setStep(step - 1);

  return (
    <Modal
      title={editMode ? `Edit data source — ${initial.name}` : "Set up a data source"}
      onClose={onClose}
      xwide
      footer={
        <>
          <div className="wizard-steps">
            {["Source", "Connection", "Files & period", "Schedule & review"].map((label, i) => (
              <div key={label} className={`wizard-step ${step === i + 1 ? "active" : ""} ${step > i + 1 ? "done" : ""}`}>
                <span className="wizard-step-num">{i + 1}</span>
                <span>{label}</span>
              </div>
            ))}
          </div>
          <div className="wizard-actions">
            {step > 1 && <button className="btn ghost" onClick={back} disabled={busy}>Back</button>}
            {step < 4 ? (
              <button className="btn primary" onClick={next} disabled={busy || !canAdvance()}>Next</button>
            ) : (
              <button className="btn primary" onClick={save} disabled={busy}>{editMode ? "Save changes" : "Create source"}</button>
            )}
          </div>
        </>
      }
    >
      {error ? <div className="alert error">{error}</div> : null}

      {step === 1 && (
        <div>
          <div className="wizard-title">Pick a source type</div>
          <div className="wizard-type-grid">
            {TYPES.map((t) => (
              <label key={t.id} className={`type-card ${form.type === t.id ? "sel" : ""}`}>
                <input type="radio" name="type" value={t.id}
                       checked={form.type === t.id}
                       onChange={() => setForm({ ...form, type: t.id, config: typeDefault(t.id, form.config) })} />
                <div className="type-icon">{t.emoji}</div>
                <div>
                  <div className="type-name">{t.label}</div>
                  <div className="muted small">{t.description}</div>
                </div>
              </label>
            ))}
          </div>

          <div className="form-field full" style={{ marginTop: 14 }}>
            <div className="form-label">Display name</div>
            <input className="form-input" placeholder="e.g. Citadel SFTP — monthly trial balance"
                   value={form.name}
                   onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
        </div>
      )}

      {step === 2 && (
        <div>
          <div className="wizard-title">Connection details</div>
          {form.type === "local" && (
            <div className="form-grid">
              <div className="form-field full">
                <div className="form-label">Local folder path</div>
                <input className="form-input" placeholder="/Users/me/recon-drop"
                       value={form.config.folder_path || ""}
                       onChange={(e) => setCfg(setForm, form, { folder_path: e.target.value })} />
                <div className="muted small" style={{ marginTop: 4 }}>
                  Any <code>.csv</code> / <code>.xlsx</code> file dropped into this folder is ingested on the next run.
                </div>
              </div>
            </div>
          )}
          {form.type === "sftp" && (
            <div className="form-grid">
              <div className="form-field">
                <div className="form-label">Host</div>
                <input className="form-input" placeholder="sftp.example.com"
                       value={form.config.host || ""}
                       onChange={(e) => setCfg(setForm, form, { host: e.target.value })} />
              </div>
              <div className="form-field">
                <div className="form-label">Port</div>
                <input className="form-input" type="number" placeholder="22"
                       value={form.config.port || 22}
                       onChange={(e) => setCfg(setForm, form, { port: parseInt(e.target.value, 10) || 22 })} />
              </div>
              <div className="form-field">
                <div className="form-label">Username</div>
                <input className="form-input"
                       value={form.config.username || ""}
                       onChange={(e) => setCfg(setForm, form, { username: e.target.value })} />
              </div>
              <div className="form-field">
                <div className="form-label">Password</div>
                <input className="form-input" type="password"
                       placeholder={form.config.password === "••••" ? "(unchanged)" : ""}
                       value={form.config.password || ""}
                       onChange={(e) => setCfg(setForm, form, { password: e.target.value })} />
              </div>
              <div className="form-field full">
                <div className="form-label">Remote folder</div>
                <input className="form-input" placeholder="/incoming/trial-balances"
                       value={form.config.remote_path || ""}
                       onChange={(e) => setCfg(setForm, form, { remote_path: e.target.value })} />
              </div>
            </div>
          )}
          {form.type === "s3" && (
            <div className="form-grid">
              <div className="form-field">
                <div className="form-label">Bucket</div>
                <input className="form-input"
                       value={form.config.bucket || ""}
                       onChange={(e) => setCfg(setForm, form, { bucket: e.target.value })} />
              </div>
              <div className="form-field">
                <div className="form-label">Region</div>
                <input className="form-input" placeholder="us-east-1"
                       value={form.config.region || "us-east-1"}
                       onChange={(e) => setCfg(setForm, form, { region: e.target.value })} />
              </div>
              <div className="form-field full">
                <div className="form-label">Key prefix (optional)</div>
                <input className="form-input" placeholder="trial-balances/"
                       value={form.config.prefix || ""}
                       onChange={(e) => setCfg(setForm, form, { prefix: e.target.value })} />
              </div>
              <div className="form-field">
                <div className="form-label">Access key ID</div>
                <input className="form-input"
                       value={form.config.access_key_id || ""}
                       onChange={(e) => setCfg(setForm, form, { access_key_id: e.target.value })} />
              </div>
              <div className="form-field">
                <div className="form-label">Secret access key</div>
                <input className="form-input" type="password"
                       placeholder={form.config.secret_access_key === "••••" ? "(unchanged)" : ""}
                       value={form.config.secret_access_key || ""}
                       onChange={(e) => setCfg(setForm, form, { secret_access_key: e.target.value })} />
              </div>
            </div>
          )}

          <div style={{ marginTop: 14 }}>
            <button className="btn ghost small" onClick={testConnection} disabled={busy}>
              {busy ? "Testing…" : "Test connection"}
            </button>
            {testResult && (
              <div className={`alert ${testResult.ok ? "success" : "error"}`} style={{ marginTop: 10 }}>
                {testResult.ok
                  ? (<>
                      Connected ✓ — found <strong>{testResult.files_found}</strong> file{testResult.files_found === 1 ? "" : "s"} matching the pattern.
                      {testResult.sample?.length > 0 && (
                        <ul style={{ margin: "4px 0 0 20px", padding: 0 }}>
                          {testResult.sample.map((n, i) => <li key={i}><code>{n}</code></li>)}
                        </ul>
                      )}
                    </>)
                  : <>Connection failed: {testResult.error}</>}
              </div>
            )}
          </div>
        </div>
      )}

      {step === 3 && (
        <div>
          <div className="wizard-title">File selection & period derivation</div>
          <div className="form-grid">
            <div className="form-field full">
              <div className="form-label">File pattern (glob)</div>
              <input className="form-input" placeholder="*.xlsx"
                     value={form.file_pattern || ""}
                     onChange={(e) => setForm({ ...form, file_pattern: e.target.value })} />
              <div className="muted small" style={{ marginTop: 4 }}>
                Examples: <code>*.xlsx</code>, <code>TB-*.csv</code>, <code>*_trial_balance*.xlsx</code>
              </div>
            </div>

            <div className="form-field full">
              <div className="form-label">How should the period (YYYY-MM) be determined for each file?</div>
              <div className="radio-stack">
                <label className={`radio-card ${form.period_rule === "mtime" ? "sel" : ""}`}>
                  <input type="radio" checked={form.period_rule === "mtime"}
                         onChange={() => setForm({ ...form, period_rule: "mtime" })} />
                  <div>
                    <strong>From file modified date</strong>
                    <div className="muted small">Best when each file is uploaded in the month it represents.</div>
                  </div>
                </label>
                <label className={`radio-card ${form.period_rule === "filename" ? "sel" : ""}`}>
                  <input type="radio" checked={form.period_rule === "filename"}
                         onChange={() => setForm({ ...form, period_rule: "filename" })} />
                  <div>
                    <strong>Parse from filename (regex)</strong>
                    <div className="muted small">
                      Specify a regex with two capture groups: (year)(month). E.g. <code>(\d{`{4}`})-(\d{`{2}`})</code> matches <code>tb-2026-04.xlsx</code>.
                    </div>
                    {form.period_rule === "filename" && (
                      <input
                        className="form-input"
                        style={{ marginTop: 6 }}
                        placeholder={String.raw`(\d{4})-(\d{2})`}
                        value={form.period_regex || ""}
                        onChange={(e) => setForm({ ...form, period_regex: e.target.value })}
                      />
                    )}
                  </div>
                </label>
                <label className={`radio-card ${form.period_rule === "current-month" ? "sel" : ""}`}>
                  <input type="radio" checked={form.period_rule === "current-month"}
                         onChange={() => setForm({ ...form, period_rule: "current-month" })} />
                  <div>
                    <strong>Always use the current calendar month</strong>
                    <div className="muted small">Simplest — works for daily drops of a rolling month-end balance.</div>
                  </div>
                </label>
              </div>
            </div>

            <label className="classify-toggle full">
              <input type="checkbox"
                     checked={!!form.auto_classify}
                     onChange={(e) => setForm({ ...form, auto_classify: e.target.checked })} />
              <span>
                <strong>🤖 Auto-classify new accounts with Osfin AI</strong>
                <div className="muted small">
                  When each scheduled run creates new accounts, Osfin AI picks a reconciliation template for
                  each (General List / Amortizable / Accrual / Schedule List). Adds ~10–30s per run.
                </div>
              </span>
            </label>
          </div>
        </div>
      )}

      {step === 4 && (
        <div>
          <div className="wizard-title">Schedule</div>
          <div className="form-field">
            <div className="form-label">How often should the scheduler check for new files?</div>
            <div className="interval-grid">
              {INTERVAL_PRESETS.map((p) => (
                <label key={p.value} className={`interval-card ${(form.schedule_minutes || 0) === p.value ? "sel" : ""}`}>
                  <input type="radio" checked={(form.schedule_minutes || 0) === p.value}
                         onChange={() => setForm({ ...form, schedule_minutes: p.value || null })} />
                  <div>{p.label}</div>
                </label>
              ))}
            </div>
          </div>

          <label className="classify-toggle full" style={{ marginTop: 16 }}>
            <input type="checkbox"
                   checked={!!form.enabled}
                   onChange={(e) => setForm({ ...form, enabled: e.target.checked })} />
            <span>
              <strong>Enabled</strong>
              <div className="muted small">
                Scheduler will skip this source until re-enabled. You can still <em>Run now</em> manually.
              </div>
            </span>
          </label>

          <div className="card" style={{ marginTop: 16 }}>
            <div className="muted small" style={{ marginBottom: 6 }}>Review</div>
            <ReviewSummary form={form} />
          </div>
        </div>
      )}
    </Modal>
  );
}

function ReviewSummary({ form }) {
  const t = TYPES.find((x) => x.id === form.type);
  return (
    <table className="plain-table">
      <tbody>
        <tr><th>Name</th><td>{form.name || <em className="muted">—</em>}</td></tr>
        <tr><th>Type</th><td>{t ? `${t.emoji} ${t.label}` : form.type}</td></tr>
        <tr><th>Connection</th><td className="truncate">{shortConn(form) || <em className="muted">—</em>}</td></tr>
        <tr><th>File pattern</th><td><code>{form.file_pattern || "*.xlsx"}</code></td></tr>
        <tr>
          <th>Period rule</th>
          <td>
            {form.period_rule === "mtime" && "File modified date"}
            {form.period_rule === "filename" && <>Parse filename with <code>{form.period_regex || "(no regex)"}</code></>}
            {form.period_rule === "current-month" && "Current calendar month"}
          </td>
        </tr>
        <tr><th>Schedule</th>
          <td>{form.schedule_minutes ? `Every ${humanInterval(form.schedule_minutes)}` : "Manual only"}</td>
        </tr>
        <tr><th>Auto-classify</th><td>{form.auto_classify ? "Yes" : "No"}</td></tr>
        <tr><th>Enabled</th><td>{form.enabled ? "Yes" : "Paused"}</td></tr>
      </tbody>
    </table>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Run history modal
// ────────────────────────────────────────────────────────────────────────────

function RunHistoryModal({ sid, onClose }) {
  const [detail, setDetail] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api.dataSource(sid)
      .then(setDetail)
      .catch((e) => setError(e.message));
  }, [sid]);

  return (
    <Modal
      title={detail ? `Run history — ${detail.name}` : "Run history"}
      onClose={onClose}
      xwide
      footer={<button className="btn primary" onClick={onClose}>Close</button>}
    >
      {error ? <div className="alert error">{error}</div> : null}
      {!detail ? <div className="muted">Loading…</div> : (
        detail.recent_runs.length === 0
          ? <div className="muted">No runs yet. Click <strong>Run now</strong> on the source to trigger one.</div>
          : (
            <table className="plain-table">
              <thead>
                <tr>
                  <th>Started</th>
                  <th>Ended</th>
                  <th>Status</th>
                  <th className="num">Files</th>
                  <th className="num">New accts</th>
                  <th className="num">Updated</th>
                  <th>Triggered by</th>
                  <th>Notes</th>
                </tr>
              </thead>
              <tbody>
                {detail.recent_runs.map((r) => (
                  <tr key={r.id}>
                    <td>{r.started_at}</td>
                    <td>{r.ended_at || "—"}</td>
                    <td><span className={`tag tag-${statusTag(r.status)}`}>{r.status || "?"}</span></td>
                    <td className="num">{r.files_processed}</td>
                    <td className="num">{r.accounts_created}</td>
                    <td className="num">{r.accounts_updated}</td>
                    <td>{r.triggered_by || "—"}</td>
                    <td className="truncate">{r.error || r.details || ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
      )}
    </Modal>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

const TYPES = [
  {
    id: "local", emoji: "📁", label: "Local folder",
    description: "Point at a folder on the backend server. Great for prototyping or network-mounted shares.",
  },
  {
    id: "sftp", emoji: "🔐", label: "SFTP server",
    description: "Pull files from a remote SFTP. Requires paramiko on the backend.",
  },
  {
    id: "s3", emoji: "🪣", label: "Amazon S3 bucket",
    description: "Pull objects from an S3 bucket + prefix. Requires boto3 on the backend.",
  },
];

function emptyForm() {
  return {
    name: "",
    type: "local",
    config: { folder_path: "" },
    file_pattern: "*.xlsx",
    period_rule: "mtime",
    period_regex: "",
    auto_classify: false,
    schedule_minutes: 60,
    enabled: true,
  };
}

function formFromSource(s) {
  return {
    name: s.name || "",
    type: s.type,
    config: s.config || {},
    file_pattern: s.file_pattern || "*.xlsx",
    period_rule: s.period_rule || "mtime",
    period_regex: s.period_regex || "",
    auto_classify: !!s.auto_classify,
    schedule_minutes: s.schedule_minutes || 0,
    enabled: !!s.enabled,
  };
}

function typeDefault(type, prev) {
  if (type === "local") return { folder_path: prev?.folder_path || "" };
  if (type === "sftp")  return { host: "", port: 22, username: "", password: "", remote_path: "" };
  if (type === "s3")    return { bucket: "", region: "us-east-1", prefix: "", access_key_id: "", secret_access_key: "" };
  return {};
}

function setCfg(setForm, form, patch) {
  setForm({ ...form, config: { ...form.config, ...patch } });
}

function toPayload(form) {
  return {
    name: form.name.trim(),
    type: form.type,
    config: form.config,
    file_pattern: form.file_pattern || "*.xlsx",
    period_rule: form.period_rule || "mtime",
    period_regex: form.period_regex || "",
    auto_classify: !!form.auto_classify,
    schedule_minutes: form.schedule_minutes || null,
    enabled: !!form.enabled,
  };
}

function asReq(s) {
  // Convert an already-listed source back into the PUT payload shape.
  return {
    name: s.name,
    type: s.type,
    config: s.config,
    file_pattern: s.file_pattern,
    period_rule: s.period_rule,
    period_regex: s.period_regex,
    auto_classify: !!s.auto_classify,
    schedule_minutes: s.schedule_minutes,
    enabled: !!s.enabled,
  };
}

function hasValidConnection(form) {
  if (form.type === "local") return !!(form.config.folder_path || "").trim();
  if (form.type === "sftp")  return !!(form.config.host && form.config.username);
  if (form.type === "s3")    return !!(form.config.bucket);
  return false;
}

function sourceEmoji(t) { return (TYPES.find((x) => x.id === t) || {}).emoji || "🔌"; }
function sourceLabel(t) { return (TYPES.find((x) => x.id === t) || {}).label || t; }

function configSummary(s) {
  if (s.type === "local") return s.config.folder_path || "—";
  if (s.type === "sftp")  return `${s.config.username || ""}@${s.config.host || ""}:${s.config.remote_path || "/"}`;
  if (s.type === "s3")    return `s3://${s.config.bucket || ""}/${s.config.prefix || ""}`;
  return "";
}

function shortConn(form) {
  if (form.type === "local") return form.config.folder_path;
  if (form.type === "sftp")  return `${form.config.username || ""}@${form.config.host || ""}:${form.config.remote_path || "/"}`;
  if (form.type === "s3")    return `s3://${form.config.bucket || ""}/${form.config.prefix || ""}`;
  return "";
}

function humanInterval(min) {
  if (!min) return "never";
  if (min < 60) return `${min} min`;
  if (min < 1440) return `${Math.round(min / 60)} hour${min === 60 ? "" : "s"}`;
  if (min < 10080) return `${Math.round(min / 1440)} day${min === 1440 ? "" : "s"}`;
  return `${Math.round(min / 10080)} week${min === 10080 ? "" : "s"}`;
}

function statusTag(s) {
  if (s === "ok")            return "ok";
  if (s === "no-new-files")  return "info";
  if (s === "running")       return "info";
  if (s === "error")         return "bad";
  return "muted";
}
