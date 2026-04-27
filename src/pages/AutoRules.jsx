import React, { useEffect, useState } from "react";
import { api } from "../api.js";

/**
 * Auto-recon rules configuration page (PRD §3).
 *
 * Admin sees all three PRD rules, toggles each on/off, and can run the
 * enabled set against any period via the "Run now" action (which calls the
 * same /api/auto-certify endpoint the Summary page uses).
 */
export default function AutoRules({ user, period }) {
  const [rules, setRules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState(null);
  const [runResult, setRunResult] = useState(null);

  const load = () => {
    setLoading(true);
    api.autoRules()
      .then(setRules)
      .catch((e) => setBanner({ kind: "error", text: e.message || "Failed to load rules" }))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const toggle = async (id, enabled) => {
    setBanner(null);
    try {
      await api.setAutoRule(id, enabled);
      load();
    } catch (e) {
      setBanner({ kind: "error", text: e.message });
    }
  };

  const runNow = async () => {
    if (!period) return;
    setBusy(true); setBanner(null); setRunResult(null);
    try {
      const res = await api.autoCertify(period);
      setRunResult(res);
      if (res.warning) {
        setBanner({ kind: "warn", text: res.warning });
      } else {
        const parts = [];
        if (res.by_rule.rule1) parts.push(`${res.by_rule.rule1} via zero-balance`);
        if (res.by_rule.rule2) parts.push(`${res.by_rule.rule2} via schedule-match`);
        if (res.by_rule.rule3) parts.push(`${res.by_rule.rule3} via unchanged-balance`);
        setBanner({
          kind: res.certified_count > 0 ? "success" : "warn",
          text: res.certified_count > 0
            ? `Auto-certified ${res.certified_count} recon${res.certified_count === 1 ? "" : "s"} for ${period} (${parts.join(", ")}).`
            : `No reconciliations matched any enabled rule for ${period}.`,
        });
      }
    } catch (e) {
      setBanner({ kind: "error", text: e.message });
    } finally { setBusy(false); }
  };

  if (user.role !== "Admin") {
    return (
      <div className="page-padding">
        <div className="alert error">Only Admin users can configure auto-recon rules.</div>
      </div>
    );
  }

  if (loading) return <div className="page-padding"><div className="muted">Loading…</div></div>;

  const enabledCount = rules.filter((r) => r.enabled).length;

  return (
    <div className="page-padding">
      <div className="card">
        <h2>Auto-reconciliation rules</h2>
        <p className="muted">
          When you click <strong>Run now</strong>, the system evaluates the enabled rules against
          every reconciliation in the current period and automatically moves matching rows to
          <span className="status-pill status-system-certified" style={{ marginLeft: 6 }}>System Certified</span>.
          A system-authored comment is added to each auto-certified recon explaining which rule fired.
        </p>

        {banner ? <div className={`alert ${banner.kind}`}>{banner.text}</div> : null}

        <div className="toolbar" style={{ marginTop: 8 }}>
          <div className="muted small">
            {enabledCount} of {rules.length} rule{rules.length === 1 ? "" : "s"} enabled.
          </div>
          <button
            className="btn primary"
            onClick={runNow}
            disabled={busy || enabledCount === 0 || !period}
            title={!period ? "Select a period first" : undefined}
          >
            {busy ? "Running…" : `⚡ Run now on ${period || "—"}`}
          </button>
        </div>

        <div className="rules-list">
          {rules.map((r) => (
            <div key={r.id} className={`rule-card ${r.enabled ? "enabled" : "disabled"}`}>
              <label className="rule-toggle">
                <input
                  type="checkbox"
                  checked={!!r.enabled}
                  onChange={(e) => toggle(r.id, e.target.checked)}
                />
                <div className="rule-body">
                  <div className="rule-head">
                    <strong>{r.name}</strong>
                    <span className={`tag ${r.enabled ? "tag-ok" : "tag-muted"}`}>
                      {r.enabled ? "Enabled" : "Disabled"}
                    </span>
                  </div>
                  <div className="muted small">{r.description}</div>
                </div>
              </label>
            </div>
          ))}
        </div>
      </div>

      {runResult && !runResult.warning && (
        <div className="card">
          <h3>Last run · {runResult.period}</h3>
          <div className="muted small">
            Certified <strong>{runResult.certified_count}</strong> reconciliations.
            Skipped <strong>{runResult.skipped_count}</strong> that didn't match any enabled rule.
          </div>
          {runResult.certified.length > 0 && (
            <table className="plain-table" style={{ marginTop: 10 }}>
              <thead>
                <tr><th>Account</th><th>Rule</th><th>Recon ID</th></tr>
              </thead>
              <tbody>
                {runResult.certified.map((c) => (
                  <tr key={c.id}>
                    <td>{c.account}</td>
                    <td><code>{c.rule}</code></td>
                    <td className="muted small">{c.id}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
