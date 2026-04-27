import React, { useMemo, useState } from "react";
import {
  fmtMoney, parseNumber, extra, ACCRUAL_SUBTYPES,
  periodEndDate, isFutureItem,
} from "./common.js";
import DateInput, { isoToMDY, parseIso } from "../components/DateInput.jsx";
import Modal from "../components/Modal.jsx";

/**
 * Schedule List template — PRD §2.2.7.
 *
 * For accounts where amounts accrue periodically and are settled at irregular
 * intervals (audit-fee accruals paid 2–3×/year, retainer-style fees, etc.).
 * Builds on the same data model as the Accrual template:
 *
 *   • sub-types in `item_class`:   CY-Accrual, CY-Payment, PY-Accrual,
 *                                  PY-Payment, Opening
 *   • dated line items             — date decides which period it rolls up into
 *   • cumulative balance            = SUM(items ≤ period-end)
 *
 * The distinguishing UI feature vs Accrual is the concept of a *schedule
 * item*: a named recurring stream (e.g. "RSM audit fees") with its own
 * counterparty and date range. The preparer clicks **Add Schedule Item** to
 * spin up N monthly CY-Accrual entries at once, then records settlements
 * (CY-Payment) against the counterparty as they occur.
 */
export default function ScheduleList({ recon, canEdit, onAdd, onUpdate, onDelete }) {
  const items = recon.items || [];
  const period = recon.period;

  const actual = items.filter((it) => !isFutureItem(it, period));
  const sumWhere = (pred) => actual.filter(pred).reduce((t, i) => t + (Number(i.amount) || 0), 0);
  const sumOpening = sumWhere((i) => i.item_class === "Opening");
  const sumAccrual = sumWhere((i) => i.item_class === "CY-Accrual" || i.item_class === "PY-Accrual");
  const sumPayment = sumWhere((i) => i.item_class === "CY-Payment" || i.item_class === "PY-Payment");
  const expected   = sumOpening + sumAccrual + sumPayment;
  const diff       = (recon.gl_balance || 0) - expected;

  // Unique counterparties across items — used to populate the settlement
  // counterparty selector so payments snap to an existing schedule.
  const counterparties = useMemo(() => {
    const s = new Set();
    for (const it of items) {
      const cp = extra(it).counterparty;
      if (cp) s.add(cp);
    }
    return Array.from(s).sort();
  }, [items]);

  // Group items by counterparty (the "schedule name") then by month.
  const groups = useMemo(() => buildScheduleGroups(items, period), [items, period]);

  const [schedOpen, setSchedOpen]   = useState(false);
  const [payOpen,   setPayOpen]     = useState(false);

  const commitScheduleItem = async (opts) => {
    const start = parseIso(opts.startIso);
    const end   = parseIso(opts.endIso);
    if (!start || !end || end < start) return;
    let y = start.getFullYear(), m = start.getMonth();
    const endY = end.getFullYear(), endM = end.getMonth();
    while (y < endY || (y === endY && m <= endM)) {
      const lastDay = new Date(y, m + 1, 0);
      const iso = `${y}-${String(m + 1).padStart(2, "0")}-${String(lastDay.getDate()).padStart(2, "0")}`;
      await onAdd({
        amount: parseNumber(opts.monthlyAmount),
        item_class: "CY-Accrual",
        origination: iso,
        description: opts.description || opts.counterparty || "Monthly accrual",
        extra: {
          counterparty: opts.counterparty || "",
          reference: opts.reference || "",
        },
      });
      m += 1; if (m > 11) { m = 0; y += 1; }
    }
    setSchedOpen(false);
  };

  const commitSettlement = async (p) => {
    const amt = -Math.abs(parseNumber(p.amount));
    await onAdd({
      amount: amt,
      item_class: "CY-Payment",
      origination: p.dateIso,
      description: p.description || `Settlement — ${p.counterparty || ""}`.trim(),
      extra: {
        counterparty: p.counterparty || "",
        reference: p.reference || "",
      },
    });
    setPayOpen(false);
  };

  return (
    <div className="tmpl">
      <div className="accrual-totals">
        <MiniStat label="Opening" value={sumOpening} />
        <MiniStat label="+ Accruals" value={sumAccrual} tone="pos" />
        <MiniStat label="− Settlements" value={-Math.abs(sumPayment)} tone={sumPayment ? "neg" : ""} />
        <MiniStat label={`Expected Balance (thru ${period})`} value={expected} emph />
        <MiniStat label="GL Balance" value={recon.gl_balance} emph />
        <MiniStat
          label="Unidentified Diff"
          value={diff}
          tone={Math.abs(diff) > 0.005 ? "bad" : "ok"}
        />
      </div>

      {canEdit && (
        <div className="accrual-quick-actions">
          <button className="btn ghost small" onClick={() => setSchedOpen(true)}>
            📅 Add Schedule Item
          </button>
          <button className="btn ghost small" onClick={() => setPayOpen(true)}
                  disabled={!counterparties.length && false /* allow even without an existing schedule */}>
            💵 Record Settlement
          </button>
          <span className="muted small">
            or add an individual line below
          </span>
        </div>
      )}

      {/* Grouped view: schedule → month → items */}
      <GroupedScheduleGrid
        groups={groups}
        canEdit={canEdit}
        onUpdate={onUpdate}
        onDelete={onDelete}
      />

      {canEdit ? (
        <AddRow onAdd={onAdd} defaultDate={periodEndIso(period)} counterparties={counterparties} />
      ) : null}

      {schedOpen && (
        <AddScheduleItemModal
          period={period}
          counterparties={counterparties}
          onClose={() => setSchedOpen(false)}
          onSubmit={commitScheduleItem}
        />
      )}
      {payOpen && (
        <SettlementModal
          defaultDate={periodEndIso(period)}
          counterparties={counterparties}
          onClose={() => setPayOpen(false)}
          onSubmit={commitSettlement}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Grid: schedule (counterparty) → month header → items
// ─────────────────────────────────────────────────────────────────────────

function GroupedScheduleGrid({ groups, canEdit, currentPeriod, onUpdate, onDelete }) {
  if (!groups.length) {
    return (
      <div className="data-grid schedule-list-grid">
        <div className="data-empty muted">
          No schedule yet — click <strong>Add Schedule Item</strong> above to build a
          monthly accrual schedule, or add an individual line at the bottom.
        </div>
      </div>
    );
  }
  return (
    <div className="data-grid schedule-list-grid">
      <div className="data-head">
        <div>Schedule</div>
        <div>Date</div>
        <div>Description</div>
        <div>Sub-Type</div>
        <div>Reference</div>
        <div className="num">Amount</div>
        <div className="num">Cumulative</div>
        <div></div>
      </div>
      {groups.map((g) => (
        <React.Fragment key={g.key}>
          <div className="data-row static schedule-group-header">
            <div className="cell-primary">🗓 {g.label}</div>
            <div className="muted small">{g.dateRange}</div>
            <div className="muted small">
              {g.itemCount} line{g.itemCount === 1 ? "" : "s"}
            </div>
            <div />
            <div />
            <div className="num muted">{fmtMoney(g.netTotal)}</div>
            <div className="num cell-primary">{fmtMoney(g.cumulativeAtPeriodEnd)}</div>
            <div />
          </div>
          {g.items.map((it) => (
            <ItemRow key={it.id}
                     item={it}
                     cumulative={it._cumulative}
                     isFuture={it._isFuture}
                     isCurrentPeriod={it._isCurrentPeriod}
                     canEdit={canEdit}
                     onUpdate={(patch) => onUpdate(it.id, patch)}
                     onDelete={() => onDelete(it.id)} />
          ))}
        </React.Fragment>
      ))}
    </div>
  );
}

function ItemRow({ item, cumulative, isFuture, isCurrentPeriod, canEdit, onUpdate, onDelete }) {
  const ex = extra(item);
  const [edit, setEdit] = useState(false);
  const [draft, setDraft] = useState({
    origination: item.origination || "",
    description: item.description || "",
    item_class:  item.item_class  || "CY-Accrual",
    amount:      item.amount ?? "",
    reference:   ex.reference || "",
    counterparty: ex.counterparty || "",
  });

  const save = async () => {
    await onUpdate({
      origination: draft.origination,
      description: draft.description,
      item_class:  draft.item_class,
      amount:      parseNumber(draft.amount),
      extra:       { reference: draft.reference, counterparty: draft.counterparty },
    });
    setEdit(false);
  };

  const rowClass = [
    "data-row static schedule-item-row",
    isCurrentPeriod ? "current" : "",
    isFuture ? "future" : "",
  ].filter(Boolean).join(" ");

  if (!edit) {
    return (
      <div className={rowClass}>
        <div className="schedule-indent-2" />
        <div>{isoToMDY(item.origination) || "—"}</div>
        <div className="truncate">{item.description || "—"}</div>
        <div><span className={`tag tag-${slug(item.item_class)}`}>{item.item_class}</span></div>
        <div className="muted truncate">{ex.reference || "—"}</div>
        <div className="num">{fmtMoney(item.amount)}</div>
        <div className={`num ${isCurrentPeriod ? "cell-primary" : "muted"}`}>
          {fmtMoney(cumulative)}
        </div>
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
    <div className={`${rowClass} editing`}>
      <div className="schedule-indent-2" />
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

function AddRow({ onAdd, defaultDate, counterparties }) {
  const [draft, setDraft] = useState({
    origination: defaultDate || "",
    description: "",
    item_class:  "CY-Accrual",
    amount:      "",
    reference:   "",
    counterparty: "",
  });

  const add = async () => {
    if (!draft.amount && !draft.description) return;
    await onAdd({
      origination: draft.origination,
      description: draft.description || draft.item_class,
      item_class:  draft.item_class,
      amount:      parseNumber(draft.amount),
      extra:       { reference: draft.reference, counterparty: draft.counterparty },
    });
    setDraft({
      origination: defaultDate || "",
      description: "",
      item_class:  "CY-Accrual",
      amount:      "",
      reference:   "",
      counterparty: "",
    });
  };

  return (
    <div className="add-row schedule-list-grid">
      <input className="form-input" placeholder="Counterparty"
             list="schedule-list-counterparties"
             value={draft.counterparty}
             onChange={(e) => setDraft({ ...draft, counterparty: e.target.value })} />
      <datalist id="schedule-list-counterparties">
        {counterparties.map((c) => <option key={c} value={c} />)}
      </datalist>
      <DateInput value={draft.origination}
                 onChange={(v) => setDraft({ ...draft, origination: v })} />
      <input className="form-input" placeholder="Description"
             value={draft.description}
             onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
      <select className="form-input" value={draft.item_class}
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
// "Add Schedule Item" modal — generates one CY-Accrual per month
// ─────────────────────────────────────────────────────────────────────────

function AddScheduleItemModal({ period, counterparties, onClose, onSubmit }) {
  const [y, m] = (period || "").split("-").map(Number);
  const defStart = y && m ? `${y}-${String(m).padStart(2, "0")}-01` : "";
  const defEnd   = y && m ? `${y}-12-31` : "";
  const [form, setForm] = useState({
    counterparty: "",
    monthlyAmount: "",
    startIso: defStart,
    endIso: defEnd,
    description: "",
    reference: "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async () => {
    if (!form.counterparty.trim()) { setError("Counterparty / schedule name is required"); return; }
    if (!parseNumber(form.monthlyAmount)) { setError("Enter a non-zero monthly amount"); return; }
    if (!form.startIso || !form.endIso) { setError("Pick both a start and an end date"); return; }
    setBusy(true); setError("");
    try { await onSubmit(form); }
    catch (e) { setError(e.message || "Failed"); }
    finally { setBusy(false); }
  };

  return (
    <Modal
      title="Add Schedule Item"
      onClose={onClose}
      wide
      footer={
        <>
          <button className="btn ghost" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn primary" onClick={submit} disabled={busy}>Create Schedule</button>
        </>
      }
    >
      <p className="muted small">
        Creates one <code>CY-Accrual</code> entry for each month in the selected range,
        each tagged with this counterparty/schedule name. Settlements against this
        counterparty are recorded separately using <strong>Record Settlement</strong>.
      </p>
      <div className="form-grid">
        <label className="form-field full">
          <div className="form-label">Counterparty / Schedule Name</div>
          <input className="form-input"
                 list="schedule-item-counterparties"
                 placeholder="e.g. RSM (audit partner)"
                 value={form.counterparty}
                 onChange={(e) => setForm({ ...form, counterparty: e.target.value })}
                 autoFocus />
          <datalist id="schedule-item-counterparties">
            {counterparties.map((c) => <option key={c} value={c} />)}
          </datalist>
        </label>
        <label className="form-field">
          <div className="form-label">Monthly Amount</div>
          <input className="form-input num-input" placeholder="10000.00"
                 value={form.monthlyAmount}
                 onChange={(e) => setForm({ ...form, monthlyAmount: e.target.value })} />
        </label>
        <label className="form-field">
          <div className="form-label">Reference (optional)</div>
          <input className="form-input" placeholder="Contract / PO #"
                 value={form.reference}
                 onChange={(e) => setForm({ ...form, reference: e.target.value })} />
        </label>
        <label className="form-field">
          <div className="form-label">Start Month</div>
          <DateInput value={form.startIso}
                     onChange={(v) => setForm({ ...form, startIso: v })} />
        </label>
        <label className="form-field">
          <div className="form-label">End Month</div>
          <DateInput value={form.endIso}
                     onChange={(v) => setForm({ ...form, endIso: v })} />
        </label>
        <label className="form-field full">
          <div className="form-label">Description (optional — defaults to counterparty)</div>
          <input className="form-input"
                 value={form.description}
                 onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </label>
      </div>
      {error ? <div className="alert error" style={{ marginTop: 10 }}>{error}</div> : null}
    </Modal>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// "Record Settlement" modal — adds a negative CY-Payment line
// ─────────────────────────────────────────────────────────────────────────

function SettlementModal({ defaultDate, counterparties, onClose, onSubmit }) {
  const [form, setForm] = useState({
    counterparty: counterparties[0] || "",
    amount: "",
    dateIso: defaultDate || "",
    description: "",
    reference: "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async () => {
    if (!parseNumber(form.amount)) { setError("Enter a non-zero amount"); return; }
    if (!form.dateIso) { setError("Pick a settlement date"); return; }
    setBusy(true); setError("");
    try { await onSubmit(form); }
    catch (e) { setError(e.message || "Failed"); }
    finally { setBusy(false); }
  };

  return (
    <Modal
      title="Record Settlement"
      onClose={onClose}
      footer={
        <>
          <button className="btn ghost" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn primary" onClick={submit} disabled={busy}>Record</button>
        </>
      }
    >
      <p className="muted small">
        Recorded as a <code>CY-Payment</code> with a negative amount — it offsets
        the accrued balance up to and including the settlement date.
      </p>
      <div className="form-grid">
        <label className="form-field full">
          <div className="form-label">Counterparty / Schedule</div>
          <input className="form-input"
                 list="settlement-counterparties"
                 placeholder="RSM (audit partner)"
                 value={form.counterparty}
                 onChange={(e) => setForm({ ...form, counterparty: e.target.value })} />
          <datalist id="settlement-counterparties">
            {counterparties.map((c) => <option key={c} value={c} />)}
          </datalist>
        </label>
        <label className="form-field">
          <div className="form-label">Amount (positive; stored as negative)</div>
          <input className="form-input num-input" placeholder="7000.00"
                 value={form.amount}
                 onChange={(e) => setForm({ ...form, amount: e.target.value })} />
        </label>
        <label className="form-field">
          <div className="form-label">Settlement Date</div>
          <DateInput value={form.dateIso}
                     onChange={(v) => setForm({ ...form, dateIso: v })} />
        </label>
        <label className="form-field full">
          <div className="form-label">Description (optional)</div>
          <input className="form-input"
                 placeholder="Wire transfer / check #"
                 value={form.description}
                 onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </label>
        <label className="form-field full">
          <div className="form-label">Reference (optional)</div>
          <input className="form-input"
                 value={form.reference}
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
 * Bucket items by counterparty ("schedule name"). Within each group, items
 * are sorted by date ascending and annotated with a running cumulative total.
 * Items without a counterparty fall into "(no schedule)" so they still render.
 */
function buildScheduleGroups(items, period) {
  const byCp = new Map();
  for (const it of items) {
    const cp = (extra(it).counterparty || "").trim() || "(no schedule)";
    if (!byCp.has(cp)) byCp.set(cp, []);
    byCp.get(cp).push(it);
  }
  const groups = [];
  for (const [cp, its] of byCp) {
    const sorted = its.slice().sort((a, b) => {
      return (a.origination || "").localeCompare(b.origination || "");
    });
    let cum = 0;
    let cumAtPeriodEnd = 0;
    const annotated = sorted.map((it) => {
      const amt = Number(it.amount) || 0;
      cum += amt;
      const mk = monthKey(it.origination) || period || "";
      const isFuture = period ? mk > period : false;
      if (!isFuture) cumAtPeriodEnd = cum;
      return {
        ...it,
        _cumulative: cum,
        _isFuture: isFuture,
        _isCurrentPeriod: mk === period,
      };
    });
    const dates = sorted.map((i) => i.origination).filter(Boolean);
    const dateRange = dates.length
      ? `${isoToMDY(dates[0])} → ${isoToMDY(dates[dates.length - 1])}`
      : "";
    groups.push({
      key: cp,
      label: cp,
      itemCount: sorted.length,
      netTotal: sorted.reduce((t, i) => t + (Number(i.amount) || 0), 0),
      cumulativeAtPeriodEnd: cumAtPeriodEnd,
      dateRange,
      items: annotated,
    });
  }
  groups.sort((a, b) => a.label.localeCompare(b.label));
  return groups;
}

function monthKey(iso) {
  if (!iso) return "";
  const m = /^(\d{4})-(\d{2})/.exec(iso);
  return m ? `${m[1]}-${m[2]}` : "";
}

function periodEndIso(period) {
  const d = periodEndDate(period);
  if (!d) return "";
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function slug(s = "") { return s.toLowerCase().replace(/[^a-z0-9]+/g, "-"); }
