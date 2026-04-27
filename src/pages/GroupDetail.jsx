import React, { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api.js";
import { fmtMoney, parseNumber } from "../templates/common.js";
import DateInput, { isoToMDY } from "../components/DateInput.jsx";
import { formatDate } from "../lib/format.js";
import Modal from "../components/Modal.jsx";
import ActivityTimeline from "../components/ActivityTimeline.jsx";

const STATUS_RANK = {
  "Rejected":          0,
  "Not Prepared":      1,
  "In Progress":       2,
  "Pending Approval":  3,
  "Reviewed":          4,
  "Approved":          5,
  "System Certified":  6,
};
function aggregateStatus(members) {
  if (!members.length) return "Not Prepared";
  return members.reduce((acc, m) => {
    if (STATUS_RANK[m.status] < STATUS_RANK[acc]) return m.status;
    return acc;
  }, members[0].status);
}

// A member recon is "locked" for editing items once it's submitted/approved.
const LOCKED_STATES = new Set(["Pending Approval", "Reviewed", "Approved", "System Certified"]);

const CLASSES = ["List Component", "Required Adjustment", "Timing Item"];

/**
 * GroupDetail — the "one reconciliation, many accounts" view.
 *
 * Shows all member accounts under a group for the current period, summed
 * balances, shared documents, and a combined Supporting Items list. Each item
 * still belongs to exactly one member recon (that's where the FK points), but
 * preparers can add/edit/delete from this combined view — the add row has a
 * target-account selector so the user picks which member a new item attaches
 * to.
 *
 * Certification still happens per-member-recon because each member has its
 * own template, so clicking a member row drills into ReconDetail.
 */
export default function GroupDetail({ gid, period, user, onOpen, onClose }) {
  const [rows, setRows] = useState([]);                    // summary list (from /api/reconciliations)
  const [fullByRid, setFullByRid] = useState({});          // rid -> full recon (items, docs, etc.)
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState(null);
  const [rejectOpen, setRejectOpen] = useState(false);
  const docInputRef = useRef();

  const load = () => {
    if (!period || !gid) return;
    setLoading(true);
    api.reconciliations(period)
      .then(async (all) => {
        const mine = all.filter((r) => r.group_id === gid);
        setRows(mine);
        if (mine.length === 0) {
          setFullByRid({});
          return;
        }
        // Pull each member's full detail so we can aggregate items + pick up
        // group-scoped documents (the backend attaches them to every member
        // in the group for the period).
        const fulls = await Promise.all(mine.map((m) => api.reconciliation(m.id)));
        const map = {};
        fulls.forEach((f) => { map[f.id] = f; });
        setFullByRid(map);
      })
      .catch((e) => setError(e.message || "Failed to load group"))
      .finally(() => setLoading(false));
  };

  useEffect(load, [gid, period]);

  const totals = useMemo(() => {
    const gl    = rows.reduce((t, r) => t + (Number(r.gl_balance) || 0), 0);
    const items = rows.reduce((t, r) => t + (Number(r.items_total) || 0), 0);
    return { gl, items, diff: gl - items };
  }, [rows]);

  // Combine items across all members. Each item is tagged with its source
  // member so the edit/delete actions know which recon to hit.
  const allItems = useMemo(() => {
    const out = [];
    for (const r of rows) {
      const full = fullByRid[r.id];
      if (!full) continue;
      for (const it of (full.items || [])) {
        out.push({
          ...it,
          _rid: r.id,
          _entity: r.entity,
          _account: r.account,
          _locked: LOCKED_STATES.has(r.status),
        });
      }
    }
    return out;
  }, [rows, fullByRid]);

  if (loading) return <div className="page-padding"><div className="muted">Loading…</div></div>;
  if (error)   return <div className="page-padding"><div className="alert error">{error}</div></div>;

  if (!rows.length) {
    return (
      <div className="page-padding">
        <div className="detail-header">
          <button className="btn ghost small" onClick={onClose}>← Back to summary</button>
        </div>
        <div className="empty-state">
          <div className="empty-illustration">🔗</div>
          <h2>No accounts in this group for {period}</h2>
          <p className="muted">Either the group is empty or nothing has been imported for this period yet.</p>
        </div>
      </div>
    );
  }

  const anchor     = fullByRid[rows[0].id] || null;
  const groupName  = anchor?.group_name || rows[0].group_name || "(unnamed group)";
  const aggStatus  = aggregateStatus(rows);
  const isAdmin    = user.role === "Admin";
  const isPreparer = user.role === "Preparer";
  const isApprover = user.role === "Approver";

  // Combined tolerance for the whole group: sum per-account amount thresholds
  // and take the highest pct threshold against the combined GL. Mirrors the
  // server-side check in /api/groups/{gid}/certify.
  const combinedTolerance = (() => {
    const sumAmt = rows.reduce((t, r) => t + (Number(r.cert_threshold_amt) || 0), 0);
    const maxPct = rows.reduce((t, r) => Math.max(t, Number(r.cert_threshold_pct) || 0), 0);
    const pctAmt = Math.abs(totals.gl) * maxPct / 100;
    return Math.max(sumAmt, pctAmt, 0.01);
  })();
  const withinTolerance = Math.abs(totals.diff) <= combinedTolerance;

  // A group-level action is meaningful only when at least one member is in
  // a status where that action applies.
  const hasCertifiable = rows.some((r) =>
    ["Not Prepared", "In Progress", "Rejected"].includes(r.status)
  );
  const hasPending = rows.some((r) => r.status === "Pending Approval");

  const canGroupCertify = (isPreparer || isAdmin) && hasCertifiable;
  const canGroupApprove = (isApprover || isAdmin) && hasPending;

  // Targets the user is allowed to add/edit items on. Admin can touch any
  // unlocked member; Preparer can only touch unlocked members assigned to
  // them (or unassigned). Approver/Auditor can't edit items.
  const editableMembers = rows.filter((r) => {
    if (LOCKED_STATES.has(r.status)) return false;
    if (isAdmin) return true;
    if (isPreparer) return !r.preparer || r.preparer === user.username;
    return false;
  });
  const canEditAny = editableMembers.length > 0;

  const uploadDoc = async (f) => {
    if (!f || !anchor) return;
    setBusy(true); setBanner(null);
    try {
      await api.uploadDoc(anchor.id, f);
      load();
    } catch (e) {
      setBanner({ kind: "error", text: e.message });
    } finally {
      setBusy(false);
      if (docInputRef.current) docInputRef.current.value = "";
    }
  };

  const addItem = async (targetRid, data) => {
    setBanner(null);
    try { await api.addItem(targetRid, data); load(); }
    catch (e) { setBanner({ kind: "error", text: e.message }); throw e; }
  };
  const updateItem = async (rid, iid, data) => {
    setBanner(null);
    try { await api.updateItem(rid, iid, data); load(); }
    catch (e) { setBanner({ kind: "error", text: e.message }); }
  };
  const deleteItem = async (rid, iid) => {
    setBanner(null);
    try { await api.deleteItem(rid, iid); load(); }
    catch (e) { setBanner({ kind: "error", text: e.message }); }
  };

  const doGroupCertify = async () => {
    setBusy(true); setBanner(null);
    try {
      const res = await api.certifyGroup(gid, period);
      setBanner({
        kind: "success",
        text: `Group submitted — ${res.transitioned} reconciliation${res.transitioned === 1 ? "" : "s"} moved to Pending Approval.`,
      });
      load();
    } catch (e) {
      setBanner({ kind: "error", text: e.message });
    } finally { setBusy(false); }
  };

  const doGroupApprove = async () => {
    setBusy(true); setBanner(null);
    try {
      const res = await api.approveGroup(gid, period);
      setBanner({
        kind: "success",
        text: `Group approved — ${res.transitioned} reconciliation${res.transitioned === 1 ? "" : "s"} marked Reviewed.`,
      });
      load();
    } catch (e) {
      setBanner({ kind: "error", text: e.message });
    } finally { setBusy(false); }
  };

  const doGroupReject = async (reason) => {
    setBusy(true); setBanner(null);
    try {
      const res = await api.rejectGroup(gid, period, reason);
      setBanner({
        kind: "success",
        text: `Group returned to preparer — ${res.transitioned} reconciliation${res.transitioned === 1 ? "" : "s"} reset.`,
      });
      setRejectOpen(false);
      load();
    } catch (e) {
      setBanner({ kind: "error", text: e.message });
    } finally { setBusy(false); }
  };

  const docs = anchor?.documents || [];

  return (
    <div className="page-padding recon-detail">
      <div className="detail-header">
        <button className="btn ghost small" onClick={onClose}>← Back to summary</button>
        <div className="detail-title-block">
          <h2 className="detail-title">
            🔗 {groupName}{" "}
            <span className="muted">· grouped reconciliation</span>
          </h2>
          <div className="detail-sub muted">
            {rows.length} account{rows.length === 1 ? "" : "s"} reconciled together for this period.
          </div>
          <div className="detail-chips">
            <span className="group-pill">Group</span>
            <span className={`status-pill status-${slug(aggStatus)}`}>{aggStatus}</span>
            <span className="muted small">Period: {period}</span>
          </div>
        </div>
      </div>

      {banner ? <div className={`alert ${banner.kind}`}>{banner.text}</div> : null}

      {/* Combined balance bar */}
      <div className="balance-bar">
        <div>
          <div className="muted small">Combined GL Balance</div>
          <div className="balance-val">{fmtMoney(totals.gl)}</div>
        </div>
        <div>
          <div className="muted small">Combined Supporting Total</div>
          <div className="balance-val">{fmtMoney(totals.items)}</div>
        </div>
        <div>
          <div className="muted small">Combined Unidentified Difference</div>
          <div className={`balance-val ${Math.abs(totals.diff) > 0.005 ? "diff" : "ok"}`}>
            {fmtMoney(totals.diff)}
          </div>
        </div>
        <div>
          <div className="muted small">Accounts</div>
          <div className="balance-val">{rows.length}</div>
        </div>
        <div>
          <div className="muted small">Combined Tolerance</div>
          <div className="balance-val">{fmtMoney(combinedTolerance)}</div>
        </div>
        <div className="balance-flex" />
        <div className="balance-actions">
          {canGroupCertify && (
            <button
              className="btn primary"
              disabled={busy || !withinTolerance}
              onClick={doGroupCertify}
              title={!withinTolerance
                ? "Combined difference exceeds tolerance — investigate before certifying."
                : "Submit every unprepared member for approval."}
            >
              Certify Group & Submit for Approval
            </button>
          )}
          {canGroupApprove && (
            <>
              <button className="btn primary" disabled={busy} onClick={doGroupApprove}>
                Approve Group
              </button>
              <button className="btn danger" disabled={busy} onClick={() => setRejectOpen(true)}>
                Reject Group
              </button>
            </>
          )}
        </div>
      </div>

      {/* Combined Supporting Items */}
      <section className="section">
        <h3>Supporting Items <span className="muted small">(combined across all {rows.length} accounts)</span></h3>

        <div className="data-grid items-grid group-items-grid">
          <div className="data-head">
            <div>Date</div>
            <div>Account</div>
            <div>Description</div>
            <div>Classification</div>
            <div className="num">Amount</div>
            <div></div>
          </div>
          {allItems.length === 0 ? (
            <div className="data-empty muted">No items yet — add the components that make up the combined balance.</div>
          ) : allItems.map((it) => (
            <ItemRow key={`${it._rid}:${it.id}`}
                     item={it}
                     canEdit={
                       !it._locked &&
                       (isAdmin ||
                        (isPreparer &&
                          (() => {
                            const src = rows.find((r) => r.id === it._rid);
                            return src && (!src.preparer || src.preparer === user.username);
                          })()))
                     }
                     onUpdate={(patch) => updateItem(it._rid, it.id, patch)}
                     onDelete={() => deleteItem(it._rid, it.id)} />
          ))}
        </div>

        {canEditAny ? (
          <AddRow members={editableMembers} onAdd={addItem} />
        ) : (
          <div className="muted small" style={{ marginTop: 8 }}>
            {LOCKED_STATES.has(aggStatus) && !isAdmin
              ? "This group is past preparation — items can't be added once submitted."
              : "You don't have permission to add items on these accounts."}
          </div>
        )}
      </section>

      {/* Shared documents */}
      <section className="section">
        <div className="section-head">
          <h3>Shared Documents <span className="muted small">(one proof satisfies the whole group)</span></h3>
          {(isAdmin || isPreparer || isApprover) && (
            <label className="btn ghost small">
              + Upload
              <input ref={docInputRef} type="file" hidden
                     onChange={(e) => uploadDoc(e.target.files?.[0])}
                     disabled={busy} />
            </label>
          )}
        </div>
        <div className="muted small doc-hint">
          Uploading here attaches the document to every account in this group for {period}.
        </div>
        {docs.length === 0 ? (
          <div className="muted">No supporting documents attached yet.</div>
        ) : (
          <ul className="doc-list">
            {docs.map((d) => (
              <li key={d.id}>
                <a href={api.docUrl(d.id)} target="_blank" rel="noreferrer">📎 {d.filename}</a>
                {d.group_id ? <span className="tag tag-info small" style={{ marginLeft: 8 }}>group</span> : null}
                <span className="muted small"> · {((d.size_bytes || 0) / 1024).toFixed(1)} KB · uploaded by {d.uploaded_by}</span>
                {(isAdmin || d.uploaded_by === user.name) && (
                  <button className="link-btn danger small" style={{ marginLeft: 8 }}
                          onClick={async () => {
                            if (!confirm(`Delete ${d.filename}?`)) return;
                            try { await api.deleteDoc(d.id); load(); }
                            catch (e) { setBanner({ kind: "error", text: e.message }); }
                          }}>Delete</button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Member accounts */}
      <section className="section">
        <h3>Member Accounts</h3>
        <div className="muted small" style={{ marginBottom: 8 }}>
          Each account keeps its own template and certification. Click a row to open the individual reconciliation.
        </div>
        <div className="data-grid">
          <div className="data-head">
            <div>Entity</div>
            <div>Account</div>
            <div>Description</div>
            <div>Template</div>
            <div className="num">GL Balance</div>
            <div>Preparer</div>
            <div>Approver</div>
            <div>Prep. Date</div>
            <div>Appr. Date</div>
            <div>Status</div>
          </div>
          {rows.map((r) => (
            <button className="data-row" key={r.id} onClick={() => onOpen(r.id)}>
              <div className="cell-primary truncate">{r.entity}</div>
              <div className="cell-primary truncate">{r.account}</div>
              <div className="truncate">{r.description}</div>
              <div><span className={`tmpl-pill tmpl-${slug(r.template)}`}>{r.template}</span></div>
              <div className={`num ${Math.abs(r.unidentified || 0) > 0.005 ? "diff-cell" : ""}`}
                   title={Math.abs(r.unidentified || 0) > 0.005
                     ? `Unidentified difference: ${fmtMoney(r.unidentified)}`
                     : undefined}>
                {fmtMoney(r.gl_balance)}
              </div>
              <div className="truncate">{r.preparer || r.certified_by || "—"}</div>
              <div className="truncate">{r.approver || r.approved_by || "—"}</div>
              <div className="muted small">{r.prep_date ? formatDate(r.prep_date) : "—"}</div>
              <div className="muted small">{r.app_date  ? formatDate(r.app_date)  : "—"}</div>
              <div><span className={`status-pill status-${slug(r.status)}`}>{r.status}</span></div>
            </button>
          ))}
        </div>
      </section>

      {/* Activity history — per-period trail across the whole group. */}
      <section className="section">
        <div className="section-head">
          <h3>Activity history</h3>
          <span className="muted small">
            Every action on this group or its member reconciliations for {period}.
          </span>
        </div>
        <ActivityTimeline groupId={gid} period={period} refreshKey={aggStatus} />
      </section>

      {rejectOpen && (
        <GroupRejectModal
          onCancel={() => setRejectOpen(false)}
          onConfirm={doGroupReject}
          busy={busy}
        />
      )}
    </div>
  );
}

function GroupRejectModal({ onCancel, onConfirm, busy }) {
  const [reason, setReason] = useState("");
  return (
    <Modal
      title="Reject grouped reconciliation"
      onClose={onCancel}
      footer={
        <>
          <button className="btn ghost" onClick={onCancel} disabled={busy}>Cancel</button>
          <button className="btn danger" disabled={busy || !reason.trim()}
                  onClick={() => onConfirm(reason.trim())}>
            Reject
          </button>
        </>
      }
    >
      <p className="muted">
        Describe what needs to be corrected. The reason is recorded as a comment on every
        member reconciliation, and each one returns to In Progress.
      </p>
      <textarea
        className="form-input"
        rows={5}
        placeholder="Reason for rejection…"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        autoFocus
      />
    </Modal>
  );
}

function ItemRow({ item, canEdit, onUpdate, onDelete }) {
  const [edit, setEdit] = useState(false);
  const [draft, setDraft] = useState({
    origination: item.origination || "",
    description: item.description || "",
    item_class:  item.item_class || CLASSES[0],
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
        <div>
          <div className="cell-primary">{item._account}</div>
          <div className="cell-sub muted">{item._entity}</div>
        </div>
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
      <div className="muted small">
        {item._account}
        <div className="cell-sub">{item._entity}</div>
      </div>
      <input className="form-input" value={draft.description}
             onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
      <select className="form-input" value={draft.item_class}
              onChange={(e) => setDraft({ ...draft, item_class: e.target.value })}>
        {CLASSES.map((c) => <option key={c} value={c}>{c}</option>)}
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

function AddRow({ members, onAdd }) {
  const [target, setTarget] = useState(members[0]?.id || "");
  const [draft, setDraft] = useState({
    origination: "",
    description: "",
    item_class:  CLASSES[0],
    amount:      "",
  });

  // Keep target valid if the list of editable members shifts (e.g. one got
  // certified in another tab and we reloaded).
  useEffect(() => {
    if (!members.find((m) => m.id === target)) {
      setTarget(members[0]?.id || "");
    }
  }, [members, target]);

  const add = async () => {
    if (!target) return;
    if (!draft.amount && !draft.description) return;
    try {
      await onAdd(target, { ...draft, amount: parseNumber(draft.amount) });
      setDraft({ origination: "", description: "", item_class: CLASSES[0], amount: "" });
    } catch (_) {
      // banner already set by caller
    }
  };

  return (
    <div className="add-row group-items-grid">
      <DateInput value={draft.origination}
                 onChange={(v) => setDraft({ ...draft, origination: v })} />
      <select className="form-input" value={target} onChange={(e) => setTarget(e.target.value)}>
        {members.map((m) => (
          <option key={m.id} value={m.id}>{m.account} · {m.entity}</option>
        ))}
      </select>
      <input className="form-input" placeholder="Description"
             value={draft.description}
             onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
      <select className="form-input" value={draft.item_class}
              onChange={(e) => setDraft({ ...draft, item_class: e.target.value })}>
        {CLASSES.map((c) => <option key={c} value={c}>{c}</option>)}
      </select>
      <input className="form-input num-input" placeholder="0.00" type="text"
             value={draft.amount}
             onChange={(e) => setDraft({ ...draft, amount: e.target.value })} />
      <button className="btn primary small" onClick={add} disabled={!target}>Add</button>
    </div>
  );
}

function slug(s = "") { return s.toLowerCase().replace(/[^a-z0-9]+/g, "-"); }
