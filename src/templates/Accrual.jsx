import React, { useMemo, useState } from "react";
import {
  fmtMoney, parseNumber, extra, ACCRUAL_SUBTYPES,
  periodEndDate, isFutureItem,
} from "./common.js";
import DateInput, { isoToMDY, parseIso } from "../components/DateInput.jsx";
import Modal from "../components/Modal.jsx";

/**
 * Accrual template — PRD §2.2.5.
 *
 * Each supporting item is a dated schedule entry with one of these sub-types
 * (stored in `item_class`):
 *
 *   Opening      — prior-year / opening balance carryover
 *   CY-Accrual   — current year accrual (usually positive, monthly)
 *   CY-Payment   — current year payment/payout (usually negative)
 *   PY-Accrual   — prior year accrual adjustment
 *   PY-Payment   — prior year payment adjustment
 *
 * The cumulative balance for any given month = SUM(all items with origination
 * ≤ that month-end). The "Expected Ending" shown on the summary is the
 * cumulative sum through the recon's period. Items dated AFTER the recon
 * period are "future schedule" — they show with a chip but don't contribute
 * to the current period's unidentified diff (the shared effectiveItemsTotal
 * helper and the server-side certify endpoint agree on this).
 */
export default function Accrual({ recon, canEdit, onAdd, onUpdate, onDelete }) {
  const items     = recon.items || [];
  const period    = recon.period;
  const pe        = periodEndDate(period);

  // Bucket items into past-or-current vs future-schedule.
  const actual   = items.filter((it) => !isFutureItem(it, period));
  const future   = items.filter((it) =>  isFutureItem(it, period));

  // Sums by sub-type (within the current period).
  const sumWhere = (pred) => actual.filter(pred).reduce((t, i) => t + (Number(i.amount) || 0), 0);
  const sumOpening = sumWhere((i) => i.item_class === "Opening");
  const sumAccrual = sumWhere((i) => i.item_class === "CY-Accrual" || i.item_class === "PY-Accrual");
  const sumPayment = sumWhere((i) => i.item_class === "CY-Payment" || i.item_class === "PY-Payment");
  const expected   = sumOpening + sumAccrual + sumPayment; // payments already carry their sign
  const diff       = (recon.gl_balance || 0) - expected;

  // Month-grouped schedule rows for the grid — every month that has at least
  // one item, plus the period-end month even if it's empty.
  const monthRows = useMemo(() => buildMonthRows(items, period), [items, period]);

  const [buildOpen, setBuildOpen]   = useState(false);
  const [paymentOpen, setPayOpen]   = useState(false);

  const commitBuild = async (opts) => {
    // Generate one CY-Accrual item per month in [startIso … endIso].
    // Serialised so each in-flight reload completes before the next POST —
    // avoids flickering and stale-state races when 12 requests run at once.
    const start = parseIso(opts.startIso);
    const end   = parseIso(opts.endIso);
    if (!start || !end || end < start) return;
    let y = start.getFullYear(), m = start.getMonth();
    const endY = end.getFullYear(), endM = end.getMonth();
    while (y < endY || (y === endY && m <= endM)) {
      // Use the last day of the month as the origination so "cumulative through
      // period X" includes the accrual booked for month X.
      const lastDay = new Date(y, m + 1, 0);
      const iso = `${y}-${String(m + 1).padStart(2, "0")}-${String(lastDay.getDate()).padStart(2, "0")}`;
      await onAdd({
        amount: parseNumber(opts.monthlyAmount),
        item_class: "CY-Accrual",
        origination: iso,
        description: opts.description || "Monthly accrual",
        extra: { reference: opts.reference || "" },
      });
      m += 1; if (m > 11) { m = 0; y += 1; }
    }
    setBuildOpen(false);
  };

  const commitPayment = async (p) => {
    // Payments are recorded as negative offsets.
    const amt = -Math.abs(parseNumber(p.amount));
    await onAdd({
      amount: amt,
      item_class: "CY-Payment",
      origination: p.dateIso,
      description: p.description || "Payment",
      extra: { reference: p.reference || "" },
    });
    setPayOpen(false);
  };

  return (
    <div className="tmpl">
      <div className="accrual-totals">
        <MiniStat label="Opening" value={sumOpening} />
        <MiniStat label="+ Accruals" value={sumAccrual} tone="pos" />
        <MiniStat label="− Payments" value={-Math.abs(sumPayment)} tone={sumPayment ? "neg" : ""} />
        <MiniStat label={`Expected Ending (thru ${period})`} value={expected} emph />
        <MiniStat label="GL Balance" value={recon.gl_balance} emph />
        <MiniStat
          label="Unidentified Diff"
          value={diff}
          tone={Math.abs(diff) > 0.005 ? "bad" : "ok"}
        />
      </div>

      {canEdit && (
        <div className="accrual-quick-actions">
          <button className="btn ghost small" onClick={() => setBuildOpen(true)}>
            📅 Build Monthly Schedule
          </button>
          <button className="btn ghost small" onClick={() => setPayOpen(true)}>
            💵 Record Payment
          </button>
          <span className="muted small">
            or add an individual line below
          </span>
        </div>
      )}

      {/* Month-by-month schedule with cumulative balance */}
      <ScheduleGrid
        monthRows={monthRows}
        pe={pe}
        canEdit={canEdit}
        onUpdate={onUpdate}
        onDelete={onDelete}
      />

      {canEdit ? <AddRow onAdd={onAdd} defaultDate={periodEndIso(period)} /> : null}

      {buildOpen && (
        <BuildScheduleModal
          period={period}
          onClose={() => setBuildOpen(false)}
          onSubmit={commitBuild}
        />
      )}
      {paymentOpen && (
        <PaymentModal
          defaultDate={periodEndIso(period)}
          onClose={() => setPayOpen(false)}
          onSubmit={commitPayment}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Schedule grid
// ─────────────────────────────────────────────────────────────────────────

function ScheduleGrid({ monthRows, pe, canEdit, onUpdate, onDelete }) {
  if (!monthRows.length) {
    return (
      <div className="data-grid accrual-schedule-grid">
        <div className="data-empty muted">
          No schedule yet — click <strong>Build Monthly Schedule</strong> above,
          or add an individual line at the bottom.
        </div>
      </div>
    );
  }
  return (
    <div className="data-grid accrual-schedule-grid">
      <div className="data-head">
        <div>Month</div>
        <div>Date</div>
        <div>Description</div>
        <div>Sub-Type</div>
        <div>Reference</div>
        <div className="num">Amount</div>
        <div className="num">Cumulative</div>
        <div></div>
      </div>
      {monthRows.map((mr, i) => (
        <React.Fragment key={mr.key}>
          <div className={`data-row static accrual-month-header ${mr.isFuture ? "future" : ""} ${mr.isCurrent ? "current" : ""}`}>
            <div className="cell-primary">
              {mr.label}
              {mr.isCurrent ? <span className="tag tag-info small" style={{ marginLeft: 8 }}>current period</span> : null}
              {mr.isFuture ? <span className="tag tag-warn small" style={{ marginLeft: 8 }}>future</span> : null}
            </div>
            <div />
            <div className="muted small">{mr.items.length} line{mr.items.length === 1 ? "" : "s"}</div>
            <div />
            <div />
            <div className="num muted small">{fmtMoney(mr.monthNet)}</div>
            <div className={`num ${mr.isCurrent ? "cell-primary" : ""}`}>{fmtMoney(mr.cumulative)}</div>
            <div />
          </div>
          {mr.items.map((it) => (
            <ScheduleItemRow
              key={it.id}
              item={it}
              canEdit={canEdit && !mr.isFuture ? canEdit : canEdit}
              onUpdate={(patch) => onUpdate(it.id, patch)}
              onDelete={() => onDelete(it.id)}
            />
          ))}
        </React.Fragment>
      ))}
    </div>
  );
}

function ScheduleItemRow({ item, canEdit, onUpdate, onDelete }) {
  const ex = extra(item);
  const [edit, setEdit] = useState(false);
  const [draft, setDraft] = useState({
    origination: item.origination || "",
    description: item.description || "",
    item_class:  item.item_class  || "CY-Accrual",
    amount:      item.amount ?? "",
    reference:   ex.reference || "",
  });

  const save = async () => {
    await onUpdate({
      origination: draft.origination,
      description: draft.description,
      item_class:  draft.item_class,
      amount:      parseNumber(draft.amount),
      extra:       { reference: draft.reference },
    });
    setEdit(false);
  };

  if (!edit) {
    return (
      <div className="data-row static accrual-item-row">
        <div />
        <div>{isoToMDY(item.origination) || "—"}</div>
        <div className="truncate">{item.description || "—"}</div>
        <div><span className={`tag tag-${slug(item.item_class)}`}>{item.item_class}</span></div>
        <div className="muted truncate">{ex.reference || "—"}</div>
        <div className="num">{fmtMoney(item.amount)}</div>
        <div />
        <div className="row-actions">
          {canEdit && (
            <>
              <button className="link-btn" onClick={() => setEdit(true)}>Edit</button>
              <button className="link-btn danger" onClick={onDelete}>Delete</button>
            </>
          )}
        </div>
      </div>
    );
  }
  return (
    <div className="data-row static accrual-item-row editing">
      <div />
      <DateInput value={draft.origination}
                 onChange={(v) => setDraft({ ...draft, origination: v })} />
      <input className="form-input" value={draft.description}
             onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
      <select className="form-input" value={draft.item_class}
              onChange={(e) => setDraft({ ...draft, item_class: e.target.value })}>
        {ACCRUAL_SUBTYPES.map((c) => <option key={c} value={c}>{c}</option>)}
      </select>
      <input className="form-input" value={draft.reference}
             onChange={(e) => setDraft({ ...draft, reference: e.target.value })}
             placeholder="Reference / JE #" />
      <input className="form-input num-input" value={draft.amount}
             onChange={(e) => setDraft({ ...draft, amount: e.target.value })} />
      <div />
      <div className="row-actions">
        <button className="link-btn" onClick={save}>Save</button>
        <button className="link-btn" onClick={() => setEdit(false)}>Cancel</button>
      </div>
    </div>
  );
}

function AddRow({ onAdd, defaultDate }) {
  const [draft, setDraft] = useState({
    origination: defaultDate || "",
    description: "",
    item_class:  "CY-Accrual",
    amount:      "",
    reference:   "",
  });

  const add = async () => {
    if (!draft.amount && !draft.description) return;
    await onAdd({
      origination: draft.origination,
      description: draft.description || draft.item_class,
      item_class:  draft.item_class,
      amount:      parseNumber(draft.amount),
      extra:       { reference: draft.reference },
    });
    setDraft({
      origination: defaultDate || "",
      description: "",
      item_class:  "CY-Accrual",
      amount:      "",
      reference:   "",
    });
  };

  return (
    <div className="add-row accrual-schedule-grid">
      <div />
      <DateInput value={draft.origination}
                 onChange={(v) => setDraft({ ...draft, origination: v })} />
      <input className="form-input" placeholder="Description"
             value={draft.description}
             onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
      <select className="form-input"
              value={draft.item_class}
              onChange={(e) => setDraft({ ...draft, item_class: e.target.value })}>
        {ACCRUAL_SUBTYPES.map((c) => <option key={c} value={c}>{c}</option>)}
      </select>
      <input className="form-input" placeholder="Reference"
             value={draft.reference}
             onChange={(e) => setDraft({ ...draft, reference: e.target.value })} />
      <input className="form-input num-input" placeholder="Amount"
             value={draft.amount}
             onChange={(e) => setDraft({ ...draft, amount: e.target.value })} />
      <div />
      <button className="btn primary small" onClick={add}>Add</button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// "Build Monthly Schedule" — generates one CY-Accrual entry per month
// ─────────────────────────────────────────────────────────────────────────

function BuildScheduleModal({ period, onClose, onSubmit }) {
  // Default window: current period through Dec of the same year.
  const [y, m] = (period || "").split("-").map(Number);
  const defStart = y && m ? `${y}-${String(m).padStart(2, "0")}-01` : "";
  const defEnd   = y && m ? `${y}-12-31` : "";
  const [form, setForm] = useState({
    monthlyAmount: "",
    startIso: defStart,
    endIso: defEnd,
    description: "Monthly accrual",
    reference: "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async () => {
    if (!parseNumber(form.monthlyAmount)) { setError("Enter a non-zero monthly amount"); return; }
    if (!form.startIso || !form.endIso) { setError("Pick both a start and an end date"); return; }
    setBusy(true); setError("");
    try { await onSubmit(form); }
    catch (e) { setError(e.message || "Failed"); }
    finally { setBusy(false); }
  };

  return (
    <Modal
      title="Build Monthly Schedule"
      onClose={onClose}
      wide
      footer={
        <>
          <button className="btn ghost" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn primary" onClick={submit} disabled={busy}>Generate</button>
        </>
      }
    >
      <p className="muted small">
        Generates one <code>CY-Accrual</code> entry per month in the selected range.
        Each entry is dated to the last day of its month — so the cumulative balance
        for any period reflects every accrual booked on or before its month-end.
      </p>
      <div className="form-grid">
        <label className="form-field">
          <div className="form-label">Monthly Amount</div>
          <input className="form-input num-input" placeholder="50000.00"
                 value={form.monthlyAmount}
                 onChange={(e) => setForm({ ...form, monthlyAmount: e.target.value })} />
        </label>
        <label className="form-field">
          <div className="form-label">Reference (optional)</div>
          <input className="form-input" value={form.reference}
                 placeholder="JE # / policy / etc"
                 onChange={(e) => setForm({ ...form, reference: e.target.value })} />
        </label>
        <label className="form-field">
          <div className="form-label">Start (first month)</div>
          <DateInput value={form.startIso}
                     onChange={(v) => setForm({ ...form, startIso: v })} />
        </label>
        <label className="form-field">
          <div className="form-label">End (last month)</div>
          <DateInput value={form.endIso}
                     onChange={(v) => setForm({ ...form, endIso: v })} />
        </label>
        <label className="form-field full">
          <div className="form-label">Description</div>
          <input className="form-input" value={form.description}
                 onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </label>
      </div>
      {error ? <div className="alert error" style={{ marginTop: 10 }}>{error}</div> : null}
    </Modal>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// "Record Payment" quick-add
// ─────────────────────────────────────────────────────────────────────────

function PaymentModal({ defaultDate, onClose, onSubmit }) {
  const [form, setForm] = useState({
    amount: "",
    dateIso: defaultDate || "",
    description: "Payment",
    reference: "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async () => {
    if (!parseNumber(form.amount)) { setError("Enter a non-zero amount"); return; }
    if (!form.dateIso) { setError("Pick a payment date"); return; }
    setBusy(true); setError("");
    try { await onSubmit(form); }
    catch (e) { setError(e.message || "Failed"); }
    finally { setBusy(false); }
  };

  return (
    <Modal
      title="Record Payment"
      onClose={onClose}
      footer={
        <>
          <button className="btn ghost" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn primary" onClick={submit} disabled={busy}>Record</button>
        </>
      }
    >
      <p className="muted small">
        Recorded as a <code>CY-Payment</code> line with a negative amount — it offsets
        accrued balances up to and including its date.
      </p>
      <div className="form-grid">
        <label className="form-field">
          <div className="form-label">Amount (positive; stored as negative)</div>
          <input className="form-input num-input" placeholder="300000.00"
                 value={form.amount}
                 onChange={(e) => setForm({ ...form, amount: e.target.value })} />
        </label>
        <label className="form-field">
          <div className="form-label">Payment Date</div>
          <DateInput value={form.dateIso}
                     onChange={(v) => setForm({ ...form, dateIso: v })} />
        </label>
        <label className="form-field full">
          <div className="form-label">Description</div>
          <input className="form-input" value={form.description}
                 onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </label>
        <label className="form-field full">
          <div className="form-label">Reference (optional)</div>
          <input className="form-input" value={form.reference}
                 placeholder="Check # / wire ref"
                 onChange={(e) => setForm({ ...form, reference: e.target.value })} />
        </label>
      </div>
      {error ? <div className="alert error" style={{ marginTop: 10 }}>{error}</div> : null}
    </Modal>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────

function MiniStat({ label, value, tone, emph }) {
  return (
    <div className={`mini-stat ${tone || ""} ${emph ? "emph" : ""}`}>
      <div className="muted small">{label}</div>
      <div className="mini-val">{fmtMoney(value)}</div>
    </div>
  );
}

/**
 * Group items by YYYY-MM, compute running cumulative total.
 * Also includes a row for the current period even if it's empty.
 */
function buildMonthRows(items, period) {
  const byMonth = new Map();
  for (const it of items) {
    const key = monthKey(it.origination) || period;
    if (!byMonth.has(key)) byMonth.set(key, []);
    byMonth.get(key).push(it);
  }
  // Ensure current period appears as a header even when empty.
  if (period && !byMonth.has(period)) byMonth.set(period, []);
  // Sort by month ascending.
  const keys = Array.from(byMonth.keys()).sort();
  const rows = [];
  let cum = 0;
  for (const k of keys) {
    const its = byMonth.get(k);
    const monthNet = its.reduce((t, i) => t + (Number(i.amount) || 0), 0);
    cum += monthNet;
    rows.push({
      key: k,
      label: labelForMonth(k),
      items: its.slice().sort((a, b) => (a.origination || "").localeCompare(b.origination || "")),
      monthNet,
      cumulative: cum,
      isCurrent: k === period,
      isFuture:  period ? k > period : false,
    });
  }
  return rows;
}

function monthKey(iso) {
  if (!iso) return "";
  const m = /^(\d{4})-(\d{2})/.exec(iso);
  return m ? `${m[1]}-${m[2]}` : "";
}

function labelForMonth(k) {
  if (!k) return "—";
  const [y, m] = k.split("-").map(Number);
  if (!y || !m) return k;
  const names = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return `${names[m - 1]} ${y}`;
}

function periodEndIso(period) {
  const d = periodEndDate(period);
  if (!d) return "";
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function slug(s = "") { return s.toLowerCase().replace(/[^a-z0-9]+/g, "-"); }
