import React, { useEffect, useState } from "react";
import { api } from "../api.js";
import { setDateFormat, formatDate } from "../lib/format.js";

/**
 * Settings — Admin-only app-wide configuration page.
 *
 *   Date format  — changes how every date is rendered across the app.
 *                  Setting is stored server-side so every user sees the
 *                  chosen format consistently.
 */
export default function Settings({ user }) {
  const [settings, setSettings] = useState(null);
  const [busy, setBusy]         = useState(false);
  const [banner, setBanner]     = useState(null);
  const [loading, setLoading]   = useState(true);

  useEffect(() => {
    api.settings()
      .then(setSettings)
      .catch((e) => setBanner({ kind: "error", text: e.message }))
      .finally(() => setLoading(false));
  }, []);

  if (user.role !== "Admin") {
    return (
      <div className="page-padding">
        <div className="alert error">Only Admin users can change app settings.</div>
      </div>
    );
  }

  if (loading || !settings) {
    return <div className="page-padding"><div className="muted">Loading…</div></div>;
  }

  const change = async (key, value) => {
    setBusy(true); setBanner(null);
    try {
      await api.setSetting(key, value);
      setSettings({ ...settings, [key]: value });
      // Apply locally so the rest of the app picks it up without a reload.
      if (key === "date_format") setDateFormat(value);
      setBanner({ kind: "success", text: `Updated ${key.replace(/_/g, " ")} → ${value}.` });
    } catch (e) {
      setBanner({ kind: "error", text: e.message });
    } finally { setBusy(false); }
  };

  const dateFmt = settings.date_format || "MM-DD-YYYY";
  const dateFormats = [
    { value: "MM-DD-YYYY", label: "MM/DD/YYYY", hint: "US convention — e.g. 04/24/2026" },
    { value: "DD-MM-YYYY", label: "DD/MM/YYYY", hint: "European convention — e.g. 24/04/2026" },
    { value: "YYYY-MM-DD", label: "YYYY-MM-DD", hint: "ISO 8601 — e.g. 2026-04-24" },
  ];

  return (
    <div className="page-padding">
      <div className="card">
        <h2>Application settings</h2>
        <p className="muted">
          Changes here apply across the whole app for every user. Only Admins can edit.
        </p>

        {banner ? <div className={`alert ${banner.kind}`}>{banner.text}</div> : null}

        <section className="settings-section">
          <h3>Date format</h3>
          <p className="muted">
            Controls how dates are displayed everywhere — Summary grid, reconciliation
            detail pages, Flux analysis, date pickers, and exports.
          </p>
          <div className="date-format-options">
            {dateFormats.map((opt) => (
              <label key={opt.value}
                     className={`date-format-card ${dateFmt === opt.value ? "sel" : ""}`}>
                <input type="radio"
                       name="date_format"
                       checked={dateFmt === opt.value}
                       disabled={busy}
                       onChange={() => change("date_format", opt.value)} />
                <div>
                  <div className="date-format-label">{opt.label}</div>
                  <div className="muted small">{opt.hint}</div>
                </div>
              </label>
            ))}
          </div>
          <div className="muted small" style={{ marginTop: 8 }}>
            Today rendered as: <code>{formatDate(new Date())}</code>
          </div>
        </section>
      </div>
    </div>
  );
}
