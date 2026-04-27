import React, { useEffect, useRef, useState } from "react";
import { api } from "../api.js";
import GeneralList from "../templates/GeneralList.jsx";
import Amortizable from "../templates/Amortizable.jsx";
import Accrual from "../templates/Accrual.jsx";
import ScheduleList from "../templates/ScheduleList.jsx";
import { fmtMoney, effectiveItemsTotal } from "../templates/common.js";
import Modal from "../components/Modal.jsx";
import ErrorBoundary from "../components/ErrorBoundary.jsx";
import ActivityTimeline from "../components/ActivityTimeline.jsx";

const TEMPLATES = {
  "General List":  GeneralList,
  "Amortizable":   Amortizable,
  "Accrual":       Accrual,
  "Schedule List": ScheduleList,
};

export default function ReconDetail({ rid, user, onClose }) {
  const [recon, setRecon] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState(null);
  const [rejectOpen, setRejectOpen] = useState(false);
  const docInputRef = useRef();

  const load = () => {
    setLoading(true);
    api.reconciliation(rid)
      .then((r) => { setRecon(r); setError(""); })
      .catch((e) => setError(e.message || "Failed to load"))
      .finally(() => setLoading(false));
  };

  useEffect(load, [rid]);

  if (loading) return <div className="page-padding"><div className="muted">Loading…</div></div>;
  if (error) return <div className="page-padding"><div className="alert error">{error}</div></div>;
  if (!recon) return null;

  const TemplateComp = TEMPLATES[recon.template] || GeneralList;

  // Permissions
  const isPreparer = user.role === "Preparer" && (recon.preparer === user.username || !recon.preparer);
  const isApprover = user.role === "Approver" && (recon.approver === user.username || !recon.approver);
  const isAdmin    = user.role === "Admin";
  const isAuditor  = user.role === "Auditor";

  // Editing the supporting items is allowed to preparer/admin, only when not in terminal states.
  const canEditItems =
    (isPreparer || isAdmin) &&
    recon.status !== "Pending Approval" &&
    recon.status !== "Reviewed" &&
    recon.status !== "Approved" &&
    recon.status !== "System Certified";

  const canCertify = (isPreparer || isAdmin) &&
    (recon.status === "Not Prepared" || recon.status === "In Progress" || recon.status === "Rejected");

  const canApprove = (isApprover || isAdmin) && recon.status === "Pending Approval";

  // Calculations
  const itemsTotal = effectiveItemsTotal(recon);
  const diff = (recon.gl_balance || 0) - itemsTotal;
  const withinTolerance = Math.abs(diff) <= toleranceFor(recon);

  const addItem    = async (data) => { await api.addItem(rid, data);           load(); };
  const updateItem = async (iid, d) => { await api.updateItem(rid, iid, d);    load(); };
  const deleteItem = async (iid) => { await api.deleteItem(rid, iid);          load(); };

  const addComment = async (text) => { await api.addComment(rid, text);        load(); };

  const doCertify = async () => {
    setBusy(true); setBanner(null);
    try {
      const res = await api.certify(rid);
      setBanner({ kind: "success", text: `Submitted — status is now ${res.status}.` });
      load();
    } catch (e) {
      setBanner({ kind: "error", text: e.message });
    } finally { setBusy(false); }
  };

  const doApprove = async () => {
    setBusy(true); setBanner(null);
    try {
      await api.approve(rid);
      setBanner({ kind: "success", text: "Reconciliation approved." });
      load();
    } catch (e) {
      setBanner({ kind: "error", text: e.message });
    } finally { setBusy(false); }
  };

  const doReject = async (reason) => {
    setBusy(true); setBanner(null);
    try {
      await api.reject(rid, reason);
      setBanner({ kind: "success", text: "Reconciliation rejected and returned to preparer." });
      setRejectOpen(false);
      load();
    } catch (e) {
      setBanner({ kind: "error", text: e.message });
    } finally { setBusy(false); }
  };

  const uploadDoc = async (f) => {
    if (!f) return;
    setBusy(true);
    try { await api.uploadDoc(rid, f); load(); }
    catch (e) { setBanner({ kind: "error", text: e.message }); }
    finally { setBusy(false); if (docInputRef.current) docInputRef.current.value = ""; }
  };

  return (
    <div className="page-padding recon-detail">
      <div className="detail-header">
        <button className="btn ghost small" onClick={onClose}>← Back to summary</button>
        <div className="detail-title-block">
          <h2 className="detail-title">
            {recon.entity}{" · "}
            <span className="muted">{recon.account}</span>
          </h2>
          <div className="detail-sub muted">{recon.description}</div>
          <div className="detail-chips">
            <span className={`tmpl-pill tmpl-${slug(recon.template)}`}>{recon.template}</span>
            <span className={`status-pill status-${slug(recon.status)}`}>{recon.status}</span>
            {recon.group_name ? (
              <span className="group-pill" title="This reconciliation is part of a group — a single uploaded proof doc satisfies all grouped recons for this period.">
                🔗 Group: {recon.group_name}
              </span>
            ) : null}
            <span className="muted small">Period: {recon.period}</span>
            <span className="muted small">Preparer: {recon.preparer || "—"}</span>
            <span className="muted small">Approver: {recon.approver || "—"}</span>
          </div>
        </div>
      </div>

      {banner ? <div className={`alert ${banner.kind}`}>{banner.text}</div> : null}
      {recon.reject_reason && recon.status === "Rejected" ? (
        <div className="alert warn">
          <strong>Rejected:</strong> {recon.reject_reason}
        </div>
      ) : null}

      {/* Key numbers at the top of the detail view */}
      <div className="balance-bar">
        <div>
          <div className="muted small">GL Balance</div>
          <div className="balance-val">{fmtMoney(recon.gl_balance)}</div>
        </div>
        <div>
          <div className="muted small">Supporting Total</div>
          <div className="balance-val">{fmtMoney(itemsTotal)}</div>
        </div>
        <div>
          <div className="muted small">Unidentified Difference</div>
          <div className={`balance-val ${Math.abs(diff) > 0.005 ? "diff" : "ok"}`}>{fmtMoney(diff)}</div>
        </div>
        <div>
          <div className="muted small">Tolerance</div>
          <div className="balance-val">{fmtMoney(toleranceFor(recon))}</div>
          {(() => {
            const parts = [];
            if (recon.cert_threshold_pct) parts.push(`${recon.cert_threshold_pct}% of GL`);
            if (recon.cert_threshold_amt) parts.push(`$${fmtMoney(recon.cert_threshold_amt)} min`);
            return parts.length
              ? <div className="muted small">{parts.join(" · ")}</div>
              : null;
          })()}
        </div>
        <div className="balance-flex" />
        <div className="balance-actions">
          {canCertify && (
            <button className="btn primary" disabled={busy || !withinTolerance}
                    onClick={doCertify}
                    title={!withinTolerance ? "Difference exceeds tolerance — investigate before certifying." : ""}>
              {recon.status === "Rejected" ? "Re-submit for Approval" : "Certify & Submit for Approval"}
            </button>
          )}
          {canApprove && (
            <>
              <button className="btn primary" disabled={busy} onClick={doApprove}>Approve</button>
              <button className="btn danger" disabled={busy} onClick={() => setRejectOpen(true)}>Reject</button>
            </>
          )}
        </div>
      </div>

      {/* Template-specific grid */}
      <section className="section">
        <h3>Supporting Items</h3>
        <ErrorBoundary label={`${recon.template} template`}>
          <TemplateComp
            recon={recon}
            canEdit={canEditItems}
            onAdd={addItem}
            onUpdate={updateItem}
            onDelete={deleteItem}
          />
        </ErrorBoundary>
      </section>

      {/* Documents */}
      <section className="section">
        <div className="section-head">
          <h3>Documents {recon.group_name ? <span className="muted small">(shared with group “{recon.group_name}”)</span> : null}</h3>
          {(isPreparer || isApprover || isAdmin) && (
            <label className="btn ghost small">
              + Upload
              <input ref={docInputRef} type="file" hidden
                     onChange={(e) => uploadDoc(e.target.files?.[0])} />
            </label>
          )}
        </div>
        {recon.group_name ? (
          <div className="muted small doc-hint">
            Uploading a proof document here applies to every reconciliation in the group for this period.
          </div>
        ) : null}
        {(recon.documents || []).length === 0 ? (
          <div className="muted">No supporting documents attached.</div>
        ) : (
          <ul className="doc-list">
            {recon.documents.map((d) => (
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

      {/* Comments / conversation */}
      <section className="section">
        <h3>Comments</h3>
        <Comments comments={recon.comments || []} canComment={!isAuditor} onAdd={addComment} />
      </section>

      {/* Activity history — every action on this recon over its lifetime. */}
      <section className="section">
        <div className="section-head">
          <h3>Activity history</h3>
          <span className="muted small">
            Who did what, and when — the full audit trail for this reconciliation.
          </span>
        </div>
        <ActivityTimeline reconId={recon.id} refreshKey={recon.updated_at} />
      </section>

      {rejectOpen && (
        <RejectModal onCancel={() => setRejectOpen(false)} onConfirm={doReject} busy={busy} />
      )}
    </div>
  );
}

function RejectModal({ onCancel, onConfirm, busy }) {
  const [reason, setReason] = useState("");
  return (
    <Modal
      title="Reject reconciliation"
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
      <p className="muted">Please describe what needs to be corrected. The preparer will be notified.</p>
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

function Comments({ comments, canComment, onAdd }) {
  const [draft, setDraft] = useState("");
  const submit = async () => {
    const t = draft.trim();
    if (!t) return;
    await onAdd(t);
    setDraft("");
  };
  return (
    <div className="comments">
      {comments.length === 0 ? (
        <div className="muted">No comments yet.</div>
      ) : comments.map((c) => (
        <div className="comment" key={c.id}>
          <div className="comment-head">
            <strong>{c.author}</strong>
            <span className="muted small">{c.created_at}</span>
          </div>
          <div className="comment-body">{c.text}</div>
        </div>
      ))}
      {canComment && (
        <div className="comment-add">
          <textarea
            className="form-input"
            rows={2}
            placeholder="Add a comment…"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
          <button className="btn primary" onClick={submit} disabled={!draft.trim()}>Post</button>
        </div>
      )}
    </div>
  );
}

function toleranceFor(r) {
  const pct  = Number(r.cert_threshold_pct) || 0;
  const amt  = Number(r.cert_threshold_amt) || 0;
  const pctAmt = Math.abs((r.gl_balance || 0) * pct / 100);
  return Math.max(amt, pctAmt);
}

function slug(s = "") { return s.toLowerCase().replace(/[^a-z0-9]+/g, "-"); }
