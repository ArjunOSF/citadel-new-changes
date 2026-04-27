import React, { useRef, useState } from "react";
import { api } from "../api.js";
import { fmtMoney, parseNumber, sumItems } from "./common.js";
import DateInput, { isoToMDY } from "../components/DateInput.jsx";
import Modal from "../components/Modal.jsx";

/**
 * General List template.
 *
 * The preparer lists every supporting item that makes up the ending balance.
 * Each item is classified as:
 *   - Required Adjustment  (GL needs to change)
 *   - List Component       (a valid piece of the ending balance)
 *   - Timing Item          (in transit / will clear next period)
 *
 * Total of all items must equal GL balance (within tolerance) to certify.
 *
 * Quick action: "Extract from Invoice PDF" uploads a PDF to the backend,
 * which calls the Claude API to pull out one line-item per invoice (vendor,
 * description, amount, date, invoice#). The user reviews the extracted rows
 * in a modal and picks which to commit as supporting items.
 */
export default function GeneralList({ recon, canEdit, onAdd, onUpdate, onDelete }) {
  const items = recon.items || [];
  const classes = ["List Component", "Required Adjustment", "Timing Item"];

  const fileInputRef = useRef();
  const [extractBusy, setExtractBusy] = useState(false);
  const [extractError, setExtractError] = useState("");
  const [extracted, setExtracted]   = useState(null); // {items:[], source_filename, count, model}

  const onPickPdf = async (file) => {
    if (!file) return;
    setExtractError(""); setExtractBusy(true); setExtracted(null);
    try {
      const res = await api.extractInvoice(recon.id, file);
      if (!res.items.length) {
        setExtractError("No invoices found in the PDF.");
      } else {
        setExtracted(res);
      }
    } catch (e) {
      setExtractError(e.message || "Extract failed");
    } finally {
      setExtractBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const commitExtracted = async (selectedItems) => {
    // Sequential adds so each in-flight reload completes before the next one.
    for (const it of selectedItems) {
      await onAdd({
        amount: Number(it.amount) || 0,
        item_class: "List Component",
        origination: it.date || "",
        description: formatDescription(it),
      });
    }
    setExtracted(null);
  };

  return (
    <div className="tmpl">
      <TotalsBar gl={recon.gl_balance} items={items} />

      {canEdit && (
        <div className="accrual-quick-actions">
          <button className="btn ghost small"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={extractBusy}>
            {extractBusy ? "📄 Extracting…" : "📄 Extract from Invoice PDF"}
          </button>
          <input type="file" accept="application/pdf,.pdf"
                 ref={fileInputRef} hidden
                 onChange={(e) => onPickPdf(e.target.files?.[0])} />
          <span className="muted small">
            Osfin AI reads the PDF and pulls out each invoice as a supporting item.
          </span>
        </div>
      )}
      {extractError ? (
        <div className="alert error" style={{ marginBottom: 12 }}>{extractError}</div>
      ) : null}

      <div className="data-grid items-grid gl-grid">
        <div className="data-head">
          <div>Date</div>
          <div>Description</div>
          <div>Classification</div>
          <div className="num">Amount</div>
          <div></div>
        </div>
        {items.length === 0 ? (
          <div className="data-empty muted">No items yet — add the components that make up this balance.</div>
        ) : items.map((it) => (
          <Row key={it.id} item={it} classes={classes}
               canEdit={canEdit}
               onUpdate={(patch) => onUpdate(it.id, patch)}
               onDelete={() => onDelete(it.id)} />
        ))}
      </div>

      {canEdit ? <AddRow classes={classes} onAdd={onAdd} /> : null}

      {extracted && (
        <ExtractReviewModal
          data={extracted}
          onCancel={() => setExtracted(null)}
          onCommit={commitExtracted}
        />
      )}
    </div>
  );
}

function formatDescription(it) {
  const parts = [];
  if (it.vendor) parts.push(it.vendor);
  if (it.description) parts.push(it.description);
  let s = parts.join(" — ");
  if (it.invoice_number) s += ` (#${it.invoice_number})`;
  return s || "Invoice";
}

// ─────────────────────────────────────────────────────────────────────────
// Extract review modal — the user picks which extracted items to commit
// ─────────────────────────────────────────────────────────────────────────

function ExtractReviewModal({ data, onCancel, onCommit }) {
  // Local editable copy of each row so the user can tweak before committing.
  const [rows, setRows] = useState(() =>
    data.items.map((it, i) => ({
      id: `ext-${i}`,
      selected: true,
      vendor: it.vendor || "",
      description: it.description || "",
      amount: it.amount ?? 0,
      date: it.date || "",
      invoice_number: it.invoice_number || "",
    }))
  );
  const [busy, setBusy] = useState(false);

  const toggle = (i) => setRows((rs) => rs.map((r, j) => j === i ? { ...r, selected: !r.selected } : r));
  const patch  = (i, k, v) => setRows((rs) => rs.map((r, j) => j === i ? { ...r, [k]: v } : r));

  const selected = rows.filter((r) => r.selected);
  const selectedTotal = selected.reduce((t, r) => t + (Number(r.amount) || 0), 0);

  const selectAll = () => setRows((rs) => rs.map((r) => ({ ...r, selected: true })));
  const clearAll  = () => setRows((rs) => rs.map((r) => ({ ...r, selected: false })));

  const commit = async () => {
    if (!selected.length) return;
    setBusy(true);
    try {
      await onCommit(selected.map((r) => ({
        vendor: r.vendor, description: r.description,
        amount: parseNumber(r.amount),
        date: r.date, invoice_number: r.invoice_number,
      })));
    } finally { setBusy(false); }
  };

  return (
    <Modal
      title={`Review extracted items — ${data.source_filename}`}
      onClose={onCancel}
      xwide
      footer={
        <>
          <div className="muted small" style={{ marginRight: "auto" }}>
            Selected: <strong>{selected.length}</strong> · Total: <strong>{fmtMoney(selectedTotal)}</strong>
          </div>
          <button className="btn ghost" onClick={onCancel} disabled={busy}>Cancel</button>
          <button className="btn primary"
                  onClick={commit}
                  disabled={busy || selected.length === 0}>
            {busy ? "Adding…" : `Add ${selected.length} item${selected.length === 1 ? "" : "s"}`}
          </button>
        </>
      }
    >
      <div className="extract-toolbar">
        <div className="muted small">
          Osfin AI extracted <strong>{data.count}</strong> line{data.count === 1 ? "" : "s"} using <code>{data.model}</code>.
          Review, edit, and deselect any that shouldn't be added.
        </div>
        <div>
          <button className="link-btn" onClick={selectAll}>Select all</button>
          {" · "}
          <button className="link-btn" onClick={clearAll}>Clear</button>
        </div>
      </div>
      <div className="extract-grid">
        <div className="extract-head">
          <div></div>
          <div>Vendor</div>
          <div>Description</div>
          <div>Inv #</div>
          <div>Date</div>
          <div className="num">Amount</div>
        </div>
        {rows.map((r, i) => (
          <div className={`extract-row ${r.selected ? "sel" : ""}`} key={r.id}>
            <input type="checkbox"
                   checked={r.selected}
                   onChange={() => toggle(i)} />
            <input className="form-input" value={r.vendor}
                   onChange={(e) => patch(i, "vendor", e.target.value)} />
            <input className="form-input" value={r.description}
                   onChange={(e) => patch(i, "description", e.target.value)} />
            <input className="form-input" value={r.invoice_number}
                   onChange={(e) => patch(i, "invoice_number", e.target.value)} />
            <DateInput value={r.date}
                       onChange={(v) => patch(i, "date", v)} />
            <input className="form-input num-input"
                   value={r.amount}
                   onChange={(e) => patch(i, "amount", e.target.value)} />
          </div>
        ))}
      </div>
    </Modal>
  );
}

function Row({ item, classes, canEdit, onUpdate, onDelete }) {
  const [edit, setEdit] = useState(false);
  const [draft, setDraft] = useState({
    origination: item.origination || "",
    description: item.description || "",
    item_class:  item.item_class || classes[0],
    amount:      item.amount ?? 0,
  });

  const save = async () => {
    await onUpdate({ ...draft, amount: parseNumber(draft.amount) });
    setEdit(false);
  };

  if (!edit) {
    return (
      <div className="data-row static">
        <div>{isoToMDY(item.origination) || "—"}</div>
        <div className="truncate">{item.description || "—"}</div>
        <div>{item.item_class || "—"}</div>
        <div className="num">{fmtMoney(item.amount)}</div>
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
    <div className="data-row static editing">
      <DateInput value={draft.origination}
                 onChange={(v) => setDraft({ ...draft, origination: v })} />
      <input className="form-input" value={draft.description}
             onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
      <select className="form-input" value={draft.item_class}
              onChange={(e) => setDraft({ ...draft, item_class: e.target.value })}>
        {classes.map((c) => <option key={c} value={c}>{c}</option>)}
      </select>
      <input className="form-input num-input" type="text" value={draft.amount}
             onChange={(e) => setDraft({ ...draft, amount: e.target.value })} />
      <div className="row-actions">
        <button className="link-btn" onClick={save}>Save</button>
        <button className="link-btn" onClick={() => setEdit(false)}>Cancel</button>
      </div>
    </div>
  );
}

function AddRow({ classes, onAdd }) {
  const [draft, setDraft] = useState({
    origination: "",
    description: "",
    item_class:  classes[0],
    amount:      "",
  });

  const add = async () => {
    if (!draft.amount && !draft.description) return;
    await onAdd({ ...draft, amount: parseNumber(draft.amount) });
    setDraft({ origination: "", description: "", item_class: classes[0], amount: "" });
  };

  return (
    <div className="add-row gl-grid">
      <DateInput value={draft.origination}
                 onChange={(v) => setDraft({ ...draft, origination: v })} />
      <input className="form-input" placeholder="Description"
             value={draft.description}
             onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
      <select className="form-input" value={draft.item_class}
              onChange={(e) => setDraft({ ...draft, item_class: e.target.value })}>
        {classes.map((c) => <option key={c} value={c}>{c}</option>)}
      </select>
      <input className="form-input num-input" placeholder="0.00" type="text"
             value={draft.amount}
             onChange={(e) => setDraft({ ...draft, amount: e.target.value })} />
      <button className="btn primary small" onClick={add}>Add</button>
    </div>
  );
}

function TotalsBar({ gl, items }) {
  const total = sumItems(items);
  const diff = (gl || 0) - total;
  return (
    <div className="totals-bar">
      <div>
        <div className="muted small">GL Balance</div>
        <div className="totals-val">{fmtMoney(gl)}</div>
      </div>
      <div>
        <div className="muted small">Sum of Items</div>
        <div className="totals-val">{fmtMoney(total)}</div>
      </div>
      <div>
        <div className="muted small">Unidentified Difference</div>
        <div className={`totals-val ${Math.abs(diff) > 0.005 ? "diff" : "ok"}`}>{fmtMoney(diff)}</div>
      </div>
    </div>
  );
}
