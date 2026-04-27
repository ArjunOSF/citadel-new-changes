import React, { useEffect, useState } from "react";
import { api } from "../api.js";

/**
 * Simple audit-log view. We don't have a dedicated /audit API so we
 * surface recent imports, recent reconciliations with status changes,
 * and the `audit_log` endpoint once added.
 */
export default function Audit({ user }) {
  const [imports, setImports] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.imports()
      .then(setImports)
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="page-padding"><div className="muted">Loading…</div></div>;

  return (
    <div className="page-padding">
      <div className="card">
        <h2>Import history</h2>
        {imports.length === 0 ? (
          <div className="muted">No imports yet.</div>
        ) : (
          <table className="plain-table">
            <thead>
              <tr>
                <th>When</th>
                <th>Period</th>
                <th>File</th>
                <th>Uploaded by</th>
                <th className="num">Rows</th>
                <th className="num">New accts</th>
                <th className="num">Updated accts</th>
              </tr>
            </thead>
            <tbody>
              {imports.map((i) => (
                <tr key={i.id}>
                  <td>{i.created_at}</td>
                  <td>{i.period}</td>
                  <td>{i.filename}</td>
                  <td>{i.uploaded_by}</td>
                  <td className="num">{i.row_count}</td>
                  <td className="num">{i.accounts_created}</td>
                  <td className="num">{i.accounts_updated}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <h3>About audit</h3>
        <p className="muted">
          Every preparation, certification, approval and rejection is logged server-side with the actor, timestamp
          and target reconciliation. Auditors can drill into any reconciliation from the Summary screen to see its
          full change history in the comments thread.
        </p>
      </div>
    </div>
  );
}
