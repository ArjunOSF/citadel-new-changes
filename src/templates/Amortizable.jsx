import React, { useMemo, useState } from "react";
import DateInput from "../components/DateInput.jsx";
import Modal from "../components/Modal.jsx";
import {
  fmtMoney, parseNumber, extra,
  AMORT_METHODS, AMORT_METHOD_LABEL,
  amortSchedule, amortAmountForPeriod, amortRemainingAtPeriod,
} from "./common.js";

/**
 * Amortizable template.
 *
 * Per PRD §2.2.4. Each item carries:
 *   - original_amount
 *   - start_date / end_date (real calendar dates — can start mid-month)
 *   - method: straight_line | partial | catchup | partial_catchup | manual
 *   - manual: { "YYYY-MM": amount }   (only used when method === "manual")
 *
 * The current period's remaining balance is what counts toward the GL match.
 */
export default function Amortizable({ recon, canEdit, onAdd, onUpdate, onDelete }) {
  const items = recon.items || [];
  const period = recon.period;

  const rows = items.map((it) => {
    try {
      const ex = extra(it) || {};
      const orig  = Number(ex.original) || Number(it.amount) || 0;
      const start = ex.start_date || ex.start || "";
      const end   = ex.end_date   || "";
      const method = ex.method || "straight_line";
      const manual = (ex.manual && typeof ex.manual === "object") ? ex.manual : {};

      const schedOpts = {
        startIso: start, endIso: end, originalAmount: orig,
        method, currentPeriod: period, manualByKey: manual,
      };
      // If the window is missing/invalid, these helpers degrade gracefully:
      // amortSchedule returns {rows:[], totals:{total}} and the *AtPeriod
      // helpers fall back to the original amount or zero.
      const thisMonth = amortAmountForPeriod(schedOpts, period);
      const remaining = amortRemainingAtPeriod(schedOpts, period);
      const amortized = Math.max(0, orig - remaining);
      return { it, ex, orig, start, end, method, manual,
               thisMonth, remaining, amortized, schedOpts, error: null };
    } catch (e) {
      // One bad item shouldn't blank the whole grid — log and render a
      // placeholder row so the user can edit or delete it.
      // eslint-disable-next-line no-console
      console.error("[Amortizable] failed to compute schedule for item", it, e);
      return {
        it,
        ex: extra(it) || {},
        orig: Number(it.amount) || 0,
        start: "", end: "", method: "straight_line", manual: {},
        thisMonth: 0,
        remaining: Number(it.amount) || 0,
        amortized: 0,
        schedOpts: null,
        error: e?.message || String(e),
      };
    }
  });

  const totalRemaining = rows.reduce((t, r) => t + r.remaining, 0);
  const diff = (recon.gl_balance || 0) - totalRemaining;

  const [editing, setEditing] = useState(null);  // { mode, row? } for the modal
  const [showSchedFor, setShowSchedFor] = useState(null);

  return (
    <div className="tmpl">
      <div className="totals-bar">
        <div>
          <div className="muted small">GL Balance</div>
          <div className="totals-val">{fmtMoney(recon.gl_balance)}</div>
        </div>
        <div>
          <div className="muted small">Sum of Remaining Balances</div>
          <div className="totals-val">{fmtMoney(totalRemaining)}</div>
        </div>
        <div>
          <div className="muted small">Unidentified Difference</div>
          <div className={`totals-val ${Math.abs(diff) > 0.005 ? "diff" : "ok"}`}>{fmtMoney(diff)}</div>
        </div>
      </div>

      <div className="data-grid items-grid amort-grid">
        <div className="data-head">
          <div>Description</div>
          <div>Start</div>
          <div>End</div>
          <div>Method</div>
          <div className="num">Original</div>
          <div className="num">This Month</div>
          <div className="num">Amortized</div>
          <div className="num">Remaining</div>
          <div></div>
        </div>
        {rows.length === 0 ? (
          <div className="data-empty muted">No amortizable items yet.</div>
        ) : rows.map((r) => (
          <div className="data-row static" key={r.it.id}>
            <div className="truncate">{r.it.description || "—"}</div>
            <div>{isoDisplay(r.start)}</div>
            <div>{isoDisplay(r.end)}</div>
            <div>
              <span className={`tmpl-pill method-${r.method}`}>
                {AMORT_METHOD_LABEL[r.method] || r.method}
              </span>
            </div>
            <div className="num">{fmtMoney(r.orig)}</div>
            <div className="num">{fmtMoney(r.thisMonth)}</div>
            <div className="num">{fmtMoney(r.amortized)}</div>
            <div className="num">{fmtMoney(r.remaining)}</div>
            <div className="row-actions">
              <button className="link-btn" onClick={() => setShowSchedFor(r)}>Schedule</button>
              {canEdit && (
                <>
                  <button className="link-btn" onClick={() => setEditing({ mode: "edit", row: r })}>Edit</button>
                  <button className="link-btn danger" onClick={() => onDelete(r.it.id)}>Delete</button>
                </>
              )}
            </div>
          </div>
        ))}
      </div>

      {canEdit ? (
        <div className="amort-add-btn">
          <button className="btn primary" onClick={() => setEditing({ mode: "add" })}>
            + Add Amortizable Item
          </button>
        </div>
      ) : null}

      {editing && (
        <ItemModal
          mode={editing.mode}
          row={editing.row}
          period={period}
          onClose={() => setEditing(null)}
          onSave={async (payload) => {
            if (editing.mode === "add") await onAdd(payload);
            else await onUpdate(editing.row.it.id, payload);
            setEditing(null);
          }}
        />
      )}

      {showSchedFor && (
        <ScheduleModal
          row={showSchedFor}
          period={period}
          onClose={() => setShowSchedFor(null)}
        />
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Add / Edit modal
// ────────────────────────────────────────────────────────────────────────────

function ItemModal({ mode, row, period, onClose, onSave }) {
  const isEdit = mode === "edit";
  const [draft, setDraft] = useState({
    description: isEdit ? (row.it.description || "") : "",
    original:    isEdit ? row.orig  : "",
    start:       isEdit ? row.start : defaultStart(period),
    end:         isEdit ? row.end   : "",
    method:      isEdit ? row.method : "straight_line",
    manual:      isEdit ? { ...row.manual } : {},
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // Live-preview schedule so the user can see their choice play out.
  const preview = useMemo(() => {
    const orig = parseNumber(draft.original);
    if (!orig || !draft.start || !draft.end) return null;
    return amortSchedule({
      startIso: draft.start, endIso: draft.end, originalAmount: orig,
      method: draft.method, currentPeriod: period, manualByKey: draft.manual,
    });
  }, [draft.original, draft.start, draft.end, draft.method, draft.manual, period]);

  const save = async () => {
    const original = parseNumber(draft.original);
    if (original <= 0)   { setError("Original amount must be greater than zero."); return; }
    if (!draft.start)    { setError("Start date is required."); return; }
    if (!draft.end)      { setError("End date is required.");   return; }
    if (draft.end < draft.start) { setError("End date must be on or after start date."); return; }

    setBusy(true); setError("");
    try {
      const opts = {
        startIso: draft.start, endIso: draft.end, originalAmount: original,
        method: draft.method, currentPeriod: period, manualByKey: draft.manual,
      };
      const remaining = amortRemainingAtPeriod(opts, period);
      await onSave({
        description: draft.description || "Amortizable item",
        item_class: "List Component",
        origination: draft.start,
        amount: remaining,
        extra: {
          original,
          start_date: draft.start,
          end_date:   draft.end,
          method: draft.method,
          manual: draft.method === "manual" ? draft.manual : {},
        },
      });
    } catch (err) {
      setError(err?.message || "Failed to save.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={isEdit ? "Edit Amortizable Item" : "Add Amortizable Item"}
      onClose={onClose}
      wide
      footer={
        <>
          <button className="btn ghost" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn primary" onClick={save} disabled={busy}>{isEdit ? "Update" : "Add Item"}</button>
        </>
      }
    >
      <div className="form-grid">
        <div className="form-field full">
          <div className="form-label">Description</div>
          <input className="form-input" value={draft.description}
                 onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                 placeholder="e.g. Annual insurance premium Jan–Dec 2026" />
        </div>

        <div className="form-field">
          <div className="form-label">Original Amount</div>
          <input className="form-input" value={draft.original}
                 onChange={(e) => setDraft({ ...draft, original: e.target.value })}
                 placeholder="12000.00" />
        </div>

        <div className="form-field">
          <div className="form-label">Calculation Method</div>
          <select className="form-input" value={draft.method}
                  onChange={(e) => setDraft({ ...draft, method: e.target.value })}>
            {AMORT_METHODS.map((m) => (
              <option key={m.value} value={m.value}>{m.label}</option>
            ))}
          </select>
          <div className="muted small" style={{ marginTop: 4 }}>{methodHint(draft.method)}</div>
        </div>

        <div className="form-field">
          <div className="form-label">Amortization Begin</div>
          <DateInput value={draft.start} onChange={(v) => setDraft({ ...draft, start: v })} />
        </div>

        <div className="form-field">
          <div className="form-label">Amortization End</div>
          <DateInput value={draft.end} onChange={(v) => setDraft({ ...draft, end: v })} />
        </div>

        {error ? <div className="alert error full">{error}</div> : null}

        {preview && preview.rows.length > 0 && (
          <div className="full">
            <div className="form-label" style={{ marginBottom: 6 }}>
              Schedule preview ({preview.rows.length} periods · daily rate {fmtMoney(preview.totals.dailyRate)})
            </div>
            <div className="sched-table-wrap">
              <table className="plain-table sched-table">
                <thead>
                  <tr>
                    <th>Period</th>
                    <th className="num">Days</th>
                    <th className="num">Amount</th>
                    <th className="num">Cumulative</th>
                    <th className="num">Remaining</th>
                    {draft.method === "manual" ? <th>Override</th> : null}
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.map((r) => (
                    <tr key={r.key} className={r.key === period ? "current" : ""}>
                      <td>{r.label}{r.key === period ? <span className="muted small"> · current</span> : null}</td>
                      <td className="num">{r.days}</td>
                      <td className="num">{fmtMoney(r.amount)}</td>
                      <td className="num">{fmtMoney(r.cumulative)}</td>
                      <td className="num">{fmtMoney(r.remaining)}</td>
                      {draft.method === "manual" ? (
                        <td>
                          <input
                            className="form-input num-input small"
                            value={draft.manual[r.key] ?? ""}
                            placeholder={fmtMoney(r.amount)}
                            onChange={(e) => setDraft({
                              ...draft,
                              manual: { ...draft.manual, [r.key]: e.target.value },
                            })}
                          />
                        </td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

function ScheduleModal({ row, period, onClose }) {
  const { rows, totals } = row.schedOpts
    ? amortSchedule(row.schedOpts)
    : { rows: [], totals: { total: row.orig || 0, scheduled: 0, unscheduled: 0, dailyRate: 0, totalDays: 0 } };
  return (
    <Modal
      title="Amortization Schedule"
      onClose={onClose}
      wide
      footer={<button className="btn primary" onClick={onClose}>Close</button>}
    >
      <div className="muted small" style={{ marginBottom: 10 }}>
        {row.it.description || "—"} · {AMORT_METHOD_LABEL[row.method] || row.method}
        {" · "}{isoDisplay(row.start)} – {isoDisplay(row.end)}
        {" · "}Total {fmtMoney(totals.total)}
        {" · "}Daily rate {fmtMoney(totals.dailyRate)}
      </div>
      <div className="sched-table-wrap">
        <table className="plain-table sched-table">
          <thead>
            <tr>
              <th>Period</th>
              <th className="num">Days</th>
              <th className="num">Amount</th>
              <th className="num">Cumulative</th>
              <th className="num">Remaining</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} className={r.key === period ? "current" : ""}>
                <td>{r.label}{r.key === period ? <span className="muted small"> · current</span> : null}</td>
                <td className="num">{r.days}</td>
                <td className="num">{fmtMoney(r.amount)}</td>
                <td className="num">{fmtMoney(r.cumulative)}</td>
                <td className="num">{fmtMoney(r.remaining)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Modal>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

function methodHint(m) {
  switch (m) {
    case "straight_line":   return "Divides the total evenly across every month in the window.";
    case "partial":         return "Pro-rates first and last months by actual days (mid-month starts supported).";
    case "catchup":         return "Collapses any months prior to the current period into the current period.";
    case "partial_catchup": return "Partial-day proration plus catchup for months before the current period.";
    case "manual":          return "You enter each month's amount by hand in the schedule table.";
    default: return "";
  }
}

function defaultStart(period) {
  if (!period) return "";
  const [y, m] = period.split("-").map(Number);
  return `${y}-${String(m).padStart(2, "0")}-01`;
}

function isoDisplay(iso) {
  if (!iso) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  return `${m[2]}/${m[3]}/${m[1]}`;
}
