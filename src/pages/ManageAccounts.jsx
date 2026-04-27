import React, { useEffect, useMemo, useState } from "react";
import { api } from "../api.js";
import Modal from "../components/Modal.jsx";

const TEMPLATES = ["General List", "Amortizable", "Accrual", "Schedule List"];

export default function ManageAccounts({ user, onChange }) {
  const [accounts, setAccounts] = useState([]);
  const [users, setUsers] = useState([]);
  const [groups, setGroups] = useState([]);
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState(null); // null or account obj
  const [creating, setCreating] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([api.accounts(), api.users(), api.groups()])
      .then(([a, u, g]) => { setAccounts(a); setUsers(u); setGroups(g); })
      .finally(() => setLoading(false));
  }, []);

  const reload = () =>
    Promise.all([api.accounts(), api.groups()])
      .then(([a, g]) => { setAccounts(a); setGroups(g); })
      .finally(() => onChange && onChange());

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return accounts;
    return accounts.filter((a) =>
      [a.entity, a.entity_code, a.account_number, a.description, a.preparer, a.approver, a.template]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q))
    );
  }, [accounts, search]);

  if (user.role !== "Admin") {
    return <div className="page-padding"><div className="alert error">Only Admin users can manage accounts.</div></div>;
  }

  if (loading) {
    return <div className="page-padding"><div className="muted">Loading…</div></div>;
  }

  return (
    <div className="page-padding">
      <div className="toolbar">
        <input className="form-input search" placeholder="Search accounts…"
               value={search} onChange={(e) => setSearch(e.target.value)} />
        <button className="btn primary" onClick={() => setCreating(true)}>+ New Account</button>
      </div>

      {accounts.length === 0 ? (
        <div className="empty-state">
          <div className="empty-illustration">📁</div>
          <h2>No accounts yet</h2>
          <p className="muted">Create accounts individually here, or import them in bulk via the Import page.</p>
        </div>
      ) : (
        <div className="data-grid accounts-grid">
          <div className="data-head">
            <div>Entity</div>
            <div>Account</div>
            <div>Description</div>
            <div>Template</div>
            <div>Preparer</div>
            <div>Approver</div>
            <div className="num">Threshold</div>
            <div></div>
          </div>
          {filtered.map((a) => (
            <div className="data-row static" key={a.id}>
              <div>
                <div className="cell-primary">{a.entity}</div>
                <div className="cell-sub muted">{a.entity_code}</div>
              </div>
              <div>{a.account_number}</div>
              <div className="truncate">{a.description}</div>
              <div><span className={`tmpl-pill tmpl-${slug(a.template)}`}>{a.template}</span></div>
              <div>{a.preparer || "—"}</div>
              <div>{a.approver || "—"}</div>
              <div className="num">
                {a.cert_threshold_pct ? `${a.cert_threshold_pct}%` : "—"}
                {a.cert_threshold_amt ? ` / $${fmt(a.cert_threshold_amt)}` : ""}
              </div>
              <div className="row-actions">
                <button className="link-btn" onClick={() => setEditing(a)}>Edit</button>
                <button className="link-btn danger" onClick={async () => {
                  if (!confirm(`Delete account ${a.entity_code}-${a.account_number}?`)) return;
                  await api.deleteAccount(a.id);
                  reload();
                }}>Delete</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {(editing || creating) && (
        <AccountModal
          mode={editing ? "edit" : "create"}
          initial={editing}
          users={users}
          groups={groups}
          onClose={() => { setEditing(null); setCreating(false); }}
          onSaved={() => { setEditing(null); setCreating(false); reload(); }}
        />
      )}
    </div>
  );
}

function AccountModal({ mode, initial, users, groups = [], onClose, onSaved }) {
  const [form, setForm] = useState(initial || {
    entity: "",
    entity_code: "",
    account_number: "",
    description: "",
    template: "General List",
    preparer: "",
    approver: "",
    currency: "USD",
    cert_threshold_pct: 0,
    cert_threshold_amt: 0,
    group_id: "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setError("");
    try {
      const payload = {
        ...form,
        cert_threshold_pct: Number(form.cert_threshold_pct) || 0,
        cert_threshold_amt: Number(form.cert_threshold_amt) || 0,
        group_id: form.group_id || null,
      };
      if (mode === "edit") await api.updateAccount(initial.id, payload);
      else await api.createAccount(payload);
      onSaved();
    } catch (err) {
      setError(err.message || "Failed");
    } finally {
      setBusy(false);
    }
  };

  const preparers = users.filter((u) => u.role === "Preparer");
  const approvers = users.filter((u) => u.role === "Approver");

  return (
    <Modal
      title={mode === "edit" ? "Edit Account" : "New Account"}
      onClose={onClose}
      wide
      footer={
        <>
          <button className="btn ghost" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn primary" onClick={submit} disabled={busy}>Save</button>
        </>
      }
    >
      <form className="form-grid" onSubmit={submit}>
        <Field label="Entity">
          <input className="form-input" value={form.entity}
                 onChange={(e) => setForm({ ...form, entity: e.target.value })} required />
        </Field>
        <Field label="Entity Code">
          <input className="form-input" value={form.entity_code}
                 onChange={(e) => setForm({ ...form, entity_code: e.target.value })} required />
        </Field>
        <Field label="Account Number">
          <input className="form-input" value={form.account_number}
                 onChange={(e) => setForm({ ...form, account_number: e.target.value })} required />
        </Field>
        <Field label="Currency">
          <input className="form-input" value={form.currency}
                 onChange={(e) => setForm({ ...form, currency: e.target.value })} />
        </Field>
        <Field label="Description" full>
          <input className="form-input" value={form.description}
                 onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </Field>
        <Field label="Template">
          <select className="form-input" value={form.template}
                  onChange={(e) => setForm({ ...form, template: e.target.value })}>
            {TEMPLATES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </Field>
        <Field label="Preparer">
          <select className="form-input" value={form.preparer || ""}
                  onChange={(e) => setForm({ ...form, preparer: e.target.value })}>
            <option value="">— none —</option>
            {preparers.map((u) => <option key={u.id} value={u.username}>{u.name} ({u.username})</option>)}
          </select>
        </Field>
        <Field label="Approver">
          <select className="form-input" value={form.approver || ""}
                  onChange={(e) => setForm({ ...form, approver: e.target.value })}>
            <option value="">— none —</option>
            {approvers.map((u) => <option key={u.id} value={u.username}>{u.name} ({u.username})</option>)}
          </select>
        </Field>
        <Field label="Threshold %">
          <input className="form-input" type="number" step="0.01"
                 value={form.cert_threshold_pct}
                 onChange={(e) => setForm({ ...form, cert_threshold_pct: e.target.value })} />
        </Field>
        <Field label="Threshold Amount">
          <input className="form-input" type="number" step="0.01"
                 value={form.cert_threshold_amt}
                 onChange={(e) => setForm({ ...form, cert_threshold_amt: e.target.value })} />
        </Field>
        <Field label="Group" full>
          <select className="form-input" value={form.group_id || ""}
                  onChange={(e) => setForm({ ...form, group_id: e.target.value })}>
            <option value="">— none —</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>{g.name}</option>
            ))}
          </select>
        </Field>
        {error ? <div className="alert error full">{error}</div> : null}
      </form>
    </Modal>
  );
}

function Field({ label, full, children }) {
  return (
    <label className={`form-field ${full ? "full" : ""}`}>
      <div className="form-label">{label}</div>
      {children}
    </label>
  );
}

function slug(s = "") { return s.toLowerCase().replace(/[^a-z0-9]+/g, "-"); }
function fmt(n) { return Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
