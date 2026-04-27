import React, { useEffect, useState, useRef } from "react";
import { api } from "../api.js";

export default function ImportPage({ user, globalPeriod, onImported }) {
  // Default the form's period to whatever the topbar is showing; fall back
  // to this calendar month if the topbar doesn't have one yet. If the
  // topbar's period changes while this page is open, track it.
  const [period, setPeriod] = useState(globalPeriod || defaultPeriod());
  const [file, setFile] = useState(null);
  const [classify, setClassify] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [imports, setImports] = useState([]);
  const inputRef = useRef();

  // Keep the form's period mirrored with the topbar period when it changes.
  // Only overwrite unsaved form state — if the user has just submitted and
  // the backend echoed a derived period back, that newer value wins until the
  // topbar moves again.
  useEffect(() => {
    if (globalPeriod && globalPeriod !== period) {
      setPeriod(globalPeriod);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [globalPeriod]);

  useEffect(() => { loadImports(); }, []);

  const loadImports = () => {
    api.imports().then(setImports).catch(() => setImports([]));
  };

  const onDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    const f = e.dataTransfer.files?.[0];
    if (f) setFile(f);
  };

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    setResult(null);
    if (!file) { setError("Please choose a CSV or Excel file."); return; }
    // period is optional - backend will try to derive it from Fiscal_Year/Fiscal_Period or Period_End_Date
    setBusy(true);
    try {
      const res = await api.upload(file, period, classify);
      setResult(res);
      loadImports();
      setFile(null);
      if (inputRef.current) inputRef.current.value = "";
      // If backend auto-derived a different period, reflect it in the UI
      if (res?.period) setPeriod(res.period);
    } catch (err) {
      setError(err.message || "Upload failed");
    } finally {
      setBusy(false);
    }
  };

  if (user.role !== "Admin") {
    return (
      <div className="page-padding">
        <div className="alert error">Only Admin users can import GL balances.</div>
      </div>
    );
  }

  return (
    <div className="page-padding import-page">
      <div className="card">
        <h2>Import GL Balances</h2>
        <p className="muted">
          Upload a CSV or Excel (.xlsx) file containing your month-end general ledger balances.
          Existing reconciliation work for the same account + period is preserved on re-import;
          if the balance changes, the reconciliation is reopened for review.
        </p>

        <form onSubmit={submit} className="upload-form">
          <div className="form-row">
            <label className="form-label">
              Period <span className="muted small">(optional — auto-derived from Fiscal_Year / Period_End_Date if blank)</span>
            </label>
            <input
              className="form-input"
              placeholder="YYYY-MM (e.g. 2023-06)"
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
              pattern="\d{4}-\d{2}"
            />
          </div>

          <div
            className={`dropzone ${file ? "has-file" : ""}`}
            onDrop={onDrop}
            onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
            onClick={() => inputRef.current?.click()}
          >
            <input
              ref={inputRef}
              type="file"
              accept=".csv,.xlsx,.xls"
              hidden
              onChange={(e) => setFile(e.target.files?.[0] || null)}
            />
            {file ? (
              <div>
                <div className="dz-file">📄 {file.name}</div>
                <div className="muted small">{(file.size / 1024).toFixed(1)} KB · click to replace</div>
              </div>
            ) : (
              <div>
                <div className="dz-big">Drop file here or click to browse</div>
                <div className="muted small">Supports .csv, .xlsx, .xls</div>
              </div>
            )}
          </div>

          <label
            className="classify-toggle"
            title="When on: after the upload, each newly-created account is handed to Claude to pick a reconciliation template. When off: every new account defaults to General List."
          >
            <input
              type="checkbox"
              checked={classify}
              onChange={(e) => setClassify(e.target.checked)}
              disabled={busy}
            />
            <span>
              <strong>🤖 Auto-classify templates with Osfin AI</strong>
              <div className="muted small">
                New accounts get an intelligent template guess (Amortizable / Accrual / Schedule List / General List)
                based on their descriptions. Takes ~{file && file.size > 50_000 ? "30" : "15"}s depending on the trial
                balance size. Unchecked → everything defaults to General List.
              </div>
            </span>
          </label>

          {error ? <div className="alert error">{error}</div> : null}
          {result ? (
            <>
              {(result.warnings || []).length > 0 && (
                <div className="alert warn">
                  {result.warnings.map((w, i) => <div key={i}>{w}</div>)}
                </div>
              )}
              <div className={`alert ${result.accounts_created + result.accounts_updated > 0 ? "success" : "warn"}`}>
                Processed <strong>{result.row_count}</strong> rows for period{" "}
                <strong>{result.period}</strong> ·{" "}
                {result.accounts_created} new, {result.accounts_updated} updated
                {result.skipped ? `, ${result.skipped} skipped` : ""}
                {result.reopened ? `, ${result.reopened} reopened` : ""}.
              </div>
              {result.classify && !result.classify.error ? (
                <div className="alert success">
                  🤖 Osfin AI classified <strong>{result.classify.classified}</strong> of{" "}
                  <strong>{result.classify.total}</strong> new accounts:
                  {Object.entries(result.classify.by_template || {}).map(([t, n]) => (
                    <span key={t} style={{ marginLeft: 10 }}>
                      <code>{t}</code>: {n}
                    </span>
                  ))}
                </div>
              ) : null}
              {(result.errors || []).length > 0 && (
                <div className="alert warn">
                  <strong>Issues:</strong>
                  <ul style={{ margin: "4px 0 0 20px", padding: 0 }}>
                    {result.errors.map((e, i) => <li key={i}>{e}</li>)}
                  </ul>
                </div>
              )}
            </>
          ) : null}

          <div className="form-row right">
            <button
              type="button"
              className="btn ghost"
              onClick={() => onImported(period)}
              disabled={!result}
            >
              View Summary →
            </button>
            <button className="btn primary" type="submit" disabled={busy}>
              {busy ? "Uploading…" : "Upload"}
            </button>
          </div>
        </form>

        <details className="template-hint">
          <summary>Expected column headers</summary>
          <p className="muted small">
            The importer recognises these headers (case-insensitive). Many trial-balance
            export formats work out of the box — the left column below is the canonical
            name, the right shows some alternatives that are also accepted.
          </p>
          <ul>
            <li><code>Entity</code> / <code>Company_Name</code></li>
            <li><code>Entity Code</code> / <code>Company_Code</code></li>
            <li><code>Account Number</code> / <code>Account</code> / <code>GL_Acct</code> / <code>Account_Segment</code></li>
            <li><code>Description</code> / <code>Account_Description</code></li>
            <li><code>GL Balance</code> / <code>Net_Balance</code> / <code>Closing_Balance</code>
              (or <code>Debit_Balance</code> − <code>Credit_Balance</code> if Net is absent)</li>
            <li><code>Account_Type</code> (optional) — Asset, Liability, etc. Used to pick a default template</li>
            <li><code>Template</code> (optional) — <em>General List</em>, <em>Amortizable</em>, <em>Accrual</em>, <em>Schedule List</em></li>
            <li><code>Preparer</code>, <code>Approver</code> — usernames (optional)</li>
            <li><code>Currency</code> / <code>Ccy</code> — e.g. USD (optional)</li>
            <li><code>Threshold %</code> / <code>Threshold Amount</code> — cert tolerance (optional)</li>
            <li><code>Fiscal_Year</code> + <code>Fiscal_Period</code> or <code>Period_End_Date</code> — used to auto-derive the period if not specified above</li>
          </ul>
        </details>
      </div>

      <div className="card">
        <h3>Recent imports</h3>
        {imports.length === 0 ? (
          <div className="muted">No imports yet.</div>
        ) : (
          <div className="data-grid import-grid">
            <div className="data-head">
              <div>When</div>
              <div>Period</div>
              <div>File</div>
              <div>By</div>
              <div className="num">Rows</div>
              <div className="num">New</div>
              <div className="num">Updated</div>
            </div>
            {imports.map((i) => (
              <div className="data-row" key={i.id}>
                <div>{fmtDate(i.created_at)}</div>
                <div>{i.period}</div>
                <div className="truncate">{i.filename}</div>
                <div>{i.uploaded_by}</div>
                <div className="num">{i.row_count}</div>
                <div className="num">{i.accounts_created}</div>
                <div className="num">{i.accounts_updated}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function defaultPeriod() {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${d.getFullYear()}-${m}`;
}

function fmtDate(s) {
  if (!s) return "—";
  try {
    const d = new Date(s.replace(" ", "T") + "Z");
    return d.toLocaleString();
  } catch { return s; }
}
