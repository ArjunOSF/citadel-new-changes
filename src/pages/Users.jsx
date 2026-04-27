import React, { useEffect, useMemo, useState } from "react";
import { api } from "../api.js";
import Modal from "../components/Modal.jsx";

/**
 * User management — Admin-only page.
 *
 * CRUD for app users with a data-grid layout and a global search box
 * (name / email / username / role). Safety rails enforced server-side:
 *   • Admin cannot delete their own account.
 *   • Admin cannot demote themselves out of Admin.
 *   • The last remaining Admin can't be deleted.
 */
export default function Users({ user }) {
  const [users, setUsers]     = useState([]);
  const [loading, setLoading] = useState(true);
  const [banner, setBanner]   = useState(null);
  const [search, setSearch]   = useState("");
  const [editing, setEditing] = useState(null);
  const [creating, setCreating] = useState(false);

  const load = () => {
    setLoading(true);
    api.users()
      .then(setUsers)
      .catch((e) => setBanner({ kind: "error", text: e.message }))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return users;
    return users.filter((u) =>
      [u.username, u.name, u.email, u.role].filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q))
    );
  }, [users, search]);

  const byRole = useMemo(() => {
    const c = { Admin: 0, Preparer: 0, Approver: 0, Auditor: 0 };
    for (const u of users) c[u.role] = (c[u.role] || 0) + 1;
    return c;
  }, [users]);

  const remove = async (u) => {
    if (!confirm(`Delete user "${u.name}" (${u.username})?`)) return;
    try {
      await api.deleteUser(u.id);
      setBanner({ kind: "success", text: `Deleted ${u.name}.` });
      load();
    } catch (e) {
      setBanner({ kind: "error", text: e.message });
    }
  };

  if (user.role !== "Admin") {
    return (
      <div className="page-padding">
        <div className="alert error">Only Admin users can manage the user roster.</div>
      </div>
    );
  }

  if (loading) return <div className="page-padding"><div className="muted">Loading…</div></div>;

  return (
    <div className="page-padding">
      <div className="users-summary">
        <RoleCard label="Admins"    count={byRole.Admin}    color="role-admin" />
        <RoleCard label="Preparers" count={byRole.Preparer} color="role-preparer" />
        <RoleCard label="Approvers" count={byRole.Approver} color="role-approver" />
        <RoleCard label="Auditors"  count={byRole.Auditor}  color="role-auditor" />
      </div>

      {banner ? <div className={`alert ${banner.kind}`}>{banner.text}</div> : null}

      <div className="toolbar">
        <div className="toolbar-left">
          <input className="form-input search"
                 placeholder="🔍 Search by name, email, username, role…"
                 value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <button className="btn primary" onClick={() => setCreating(true)}>+ New user</button>
      </div>

      {filtered.length === 0 ? (
        <div className="empty-inline muted">No users match the search.</div>
      ) : (
        <div className="data-grid users-grid">
          <div className="data-head">
            <div>Name</div>
            <div>Username</div>
            <div>Email</div>
            <div>Role</div>
            <div></div>
          </div>
          {filtered.map((u) => (
            <div className="data-row static" key={u.id}>
              <div className="cell-primary">{u.name}</div>
              <div><code>{u.username}</code></div>
              <div className="truncate">{u.email || <span className="muted">—</span>}</div>
              <div>
                <span className={`role-pill role-${u.role.toLowerCase()}`}>{u.role}</span>
              </div>
              <div className="row-actions">
                <button className="link-btn" onClick={() => setEditing(u)}>Edit</button>
                {u.username !== user.username && (
                  <button className="link-btn danger" onClick={() => remove(u)}>Delete</button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {(editing || creating) && (
        <UserModal
          mode={editing ? "edit" : "create"}
          initial={editing}
          self={user}
          onClose={() => { setEditing(null); setCreating(false); }}
          onSaved={() => {
            setBanner({
              kind: "success",
              text: editing ? "User updated." : "User created.",
            });
            setEditing(null); setCreating(false); load();
          }}
        />
      )}
    </div>
  );
}

function RoleCard({ label, count, color }) {
  return (
    <div className="role-card">
      <div className={`role-pill ${color}`}>{label}</div>
      <div className="role-count">{count}</div>
    </div>
  );
}

function UserModal({ mode, initial, self, onClose, onSaved }) {
  const [form, setForm] = useState(() => initial ? {
    username: initial.username,
    name: initial.name,
    email: initial.email || "",
    role: initial.role,
    password: "",        // blank = keep current
  } : {
    username: "",
    name:     "",
    email:    "",
    role:     "Preparer",
    password: "",
  });
  const [busy, setBusy]   = useState(false);
  const [error, setError] = useState("");

  const isSelf = initial && self && initial.username === self.username;

  const submit = async () => {
    if (!form.username.trim()) { setError("Username is required"); return; }
    if (!form.name.trim())     { setError("Name is required");     return; }
    if (mode === "create" && !form.password) {
      setError("Password is required when creating a user"); return;
    }
    setBusy(true); setError("");
    try {
      if (mode === "edit") {
        const payload = {
          name: form.name.trim(),
          email: form.email.trim(),
          role: form.role,
        };
        if (form.password) payload.password = form.password;
        await api.updateUser(initial.id, payload);
      } else {
        await api.createUser({
          username: form.username.trim().toLowerCase(),
          name:     form.name.trim(),
          email:    form.email.trim(),
          role:     form.role,
          password: form.password,
        });
      }
      onSaved();
    } catch (e) { setError(e.message || "Save failed"); }
    finally { setBusy(false); }
  };

  return (
    <Modal
      title={mode === "edit" ? `Edit user — ${initial.name}` : "Add a new user"}
      onClose={onClose}
      wide
      footer={
        <>
          <button className="btn ghost" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn primary" onClick={submit} disabled={busy}>
            {mode === "edit" ? "Save changes" : "Create user"}
          </button>
        </>
      }
    >
      <div className="form-grid">
        <label className="form-field">
          <div className="form-label">Username</div>
          <input
            className="form-input"
            value={form.username}
            disabled={mode === "edit"}
            placeholder="e.g. kim"
            autoFocus={mode === "create"}
            onChange={(e) => setForm({ ...form, username: e.target.value })}
          />
          {mode === "edit" && (
            <div className="muted small">Username is immutable.</div>
          )}
        </label>
        <label className="form-field">
          <div className="form-label">Role</div>
          <select className="form-input" value={form.role}
                  disabled={isSelf}
                  onChange={(e) => setForm({ ...form, role: e.target.value })}>
            {["Admin", "Preparer", "Approver", "Auditor"].map((r) =>
              <option key={r} value={r}>{r}</option>)}
          </select>
          {isSelf && <div className="muted small">You can't change your own role.</div>}
        </label>
        <label className="form-field">
          <div className="form-label">Full name</div>
          <input className="form-input" value={form.name}
                 placeholder='e.g. "Wilson, Kim"'
                 onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </label>
        <label className="form-field">
          <div className="form-label">Email</div>
          <input className="form-input" type="email" value={form.email}
                 onChange={(e) => setForm({ ...form, email: e.target.value })} />
        </label>
        <label className="form-field full">
          <div className="form-label">
            {mode === "edit" ? "Reset password (leave blank to keep current)" : "Password"}
          </div>
          <input className="form-input" type="password" value={form.password}
                 placeholder={mode === "edit" ? "unchanged" : "e.g. demo123"}
                 onChange={(e) => setForm({ ...form, password: e.target.value })} />
        </label>
      </div>
      {error ? <div className="alert error" style={{ marginTop: 10 }}>{error}</div> : null}
    </Modal>
  );
}
