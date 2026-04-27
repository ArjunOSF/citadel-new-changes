import React, { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api.js";
import Modal from "../components/Modal.jsx";

/**
 * ManageGroups — Admin-only page to create account groups and assign
 * accounts to them. Grouped accounts share a single proof-doc upload
 * per period: uploading to any one of them satisfies the whole group.
 */
export default function ManageGroups({ user, onChange }) {
  const [groups, setGroups] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);   // group being edited
  const [creating, setCreating] = useState(false);
  const [managing, setManaging] = useState(null); // group whose members we're managing

  const reload = () =>
    Promise.all([api.groups(), api.accounts()])
      .then(([g, a]) => { setGroups(g); setAccounts(a); })
      .finally(() => { setLoading(false); onChange && onChange(); });

  useEffect(() => { reload(); }, []);

  if (user.role !== "Admin") {
    return <div className="page-padding"><div className="alert error">Only Admin users can manage account groups.</div></div>;
  }
  if (loading) return <div className="page-padding"><div className="muted">Loading…</div></div>;

  return (
    <div className="page-padding">
      <div className="toolbar">
        <div className="muted">
          Group related accounts (e.g. branch versions of the same GL) so a single proof document
          satisfies every reconciliation in the group for a given period.
        </div>
        <button className="btn primary" onClick={() => setCreating(true)}>+ New Group</button>
      </div>

      {groups.length === 0 ? (
        <div className="empty-state">
          <div className="empty-illustration">🔗</div>
          <h2>No account groups yet</h2>
          <p className="muted">Create a group to let a single proof doc satisfy several recons.</p>
        </div>
      ) : (
        <div className="data-grid groups-grid">
          <div className="data-head">
            <div>Group</div>
            <div>Description</div>
            <div className="num">Members</div>
            <div></div>
          </div>
          {groups.map((g) => (
            <div className="data-row static" key={g.id}>
              <div className="cell-primary">{g.name}</div>
              <div className="truncate muted">{g.description || "—"}</div>
              <div className="num">{g.member_count}</div>
              <div className="row-actions">
                <button className="link-btn" onClick={() => setManaging(g)}>Members</button>
                <button className="link-btn" onClick={() => setEditing(g)}>Edit</button>
                <button className="link-btn danger" onClick={async () => {
                  if (!confirm(`Delete group "${g.name}"? Accounts will be unassigned from it.`)) return;
                  await api.deleteGroup(g.id);
                  reload();
                }}>Delete</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {(editing || creating) && (
        <GroupModal
          mode={editing ? "edit" : "create"}
          initial={editing}
          onClose={() => { setEditing(null); setCreating(false); }}
          onSaved={() => { setEditing(null); setCreating(false); reload(); }}
        />
      )}

      {managing && (
        <MembersModal
          group={managing}
          accounts={accounts}
          onClose={() => setManaging(null)}
          onSaved={() => { setManaging(null); reload(); }}
        />
      )}
    </div>
  );
}

function GroupModal({ mode, initial, onClose, onSaved }) {
  const [form, setForm] = useState(initial || { name: "", description: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e) => {
    e?.preventDefault?.();
    if (!form.name.trim()) { setError("Name is required"); return; }
    setBusy(true); setError("");
    try {
      if (mode === "edit") await api.updateGroup(initial.id, form);
      else await api.createGroup(form);
      onSaved();
    } catch (err) { setError(err.message || "Failed"); }
    finally { setBusy(false); }
  };

  return (
    <Modal
      title={mode === "edit" ? "Edit Group" : "New Account Group"}
      onClose={onClose}
      footer={
        <>
          <button className="btn ghost" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn primary" onClick={submit} disabled={busy}>Save</button>
        </>
      }
    >
      <form className="form-grid" onSubmit={submit}>
        <label className="form-field full">
          <div className="form-label">Group Name</div>
          <input className="form-input" autoFocus
                 value={form.name}
                 onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </label>
        <label className="form-field full">
          <div className="form-label">Description</div>
          <input className="form-input"
                 value={form.description || ""}
                 onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </label>
        {error ? <div className="alert error full">{error}</div> : null}
      </form>
    </Modal>
  );
}

function MembersModal({ group, accounts, onClose, onSaved }) {
  const [selected, setSelected] = useState(() => new Set(group.member_account_ids || []));
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return accounts;
    return accounts.filter((a) =>
      [a.entity, a.entity_code, a.account_number, a.description]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q))
    );
  }, [accounts, search]);

  const toggle = (id) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelected(next);
  };

  // Select-all / clear-all logic scoped to whatever's currently visible
  // through the search filter — not the whole account list.
  const filteredIds = useMemo(() => filtered.map((a) => a.id), [filtered]);
  const selectedInFiltered = filteredIds.filter((id) => selected.has(id)).length;
  const allFilteredSelected = filteredIds.length > 0 && selectedInFiltered === filteredIds.length;
  const someFilteredSelected = selectedInFiltered > 0 && !allFilteredSelected;

  const selectAllCheckbox = useRef();
  useEffect(() => {
    // Indeterminate state is a DOM property, not a React attribute.
    if (selectAllCheckbox.current) {
      selectAllCheckbox.current.indeterminate = someFilteredSelected;
    }
  }, [someFilteredSelected]);

  const toggleAllFiltered = () => {
    const next = new Set(selected);
    if (allFilteredSelected) {
      // Everything visible is currently selected → clear exactly those.
      for (const id of filteredIds) next.delete(id);
    } else {
      // Otherwise → select everything visible.
      for (const id of filteredIds) next.add(id);
    }
    setSelected(next);
  };

  // An account already in another group is shown with a warning; selecting it
  // will move it out of that group and into this one.
  const warn = (a) => a.group_id && a.group_id !== group.id;

  const submit = async () => {
    setBusy(true); setError("");
    try {
      await api.assignGroupMembers(group.id, Array.from(selected));
      onSaved();
    } catch (err) { setError(err.message || "Failed"); }
    finally { setBusy(false); }
  };

  return (
    <Modal
      title={`Members of “${group.name}”`}
      onClose={onClose}
      wide
      footer={
        <>
          <button className="btn ghost" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn primary" onClick={submit} disabled={busy}>
            Save ({selected.size} selected)
          </button>
        </>
      }
    >
      <input className="form-input" placeholder="Search accounts…"
             value={search} onChange={(e) => setSearch(e.target.value)}
             style={{ marginBottom: 12 }} />
      {error ? <div className="alert error">{error}</div> : null}

      <label className={`member-row select-all ${allFilteredSelected ? "sel" : ""}`}>
        <input
          ref={selectAllCheckbox}
          type="checkbox"
          checked={allFilteredSelected}
          onChange={toggleAllFiltered}
          disabled={filteredIds.length === 0}
        />
        <div className="member-main">
          <div className="cell-primary">
            {allFilteredSelected
              ? `Clear all filtered (${filteredIds.length})`
              : someFilteredSelected
                ? `Select all filtered (${selectedInFiltered}/${filteredIds.length} selected)`
                : `Select all filtered (${filteredIds.length})`}
          </div>
          <div className="muted small">
            {search.trim()
              ? "Applies only to accounts matching the search above"
              : "Applies to every account in the list"}
          </div>
        </div>
      </label>

      <div className="members-list">
        {filtered.map((a) => (
          <label key={a.id} className={`member-row ${selected.has(a.id) ? "sel" : ""}`}>
            <input type="checkbox" checked={selected.has(a.id)} onChange={() => toggle(a.id)} />
            <div className="member-main">
              <div><strong>{a.entity_code}</strong> · {a.account_number}</div>
              <div className="muted small">{a.description}</div>
            </div>
            {warn(a) ? (
              <span className="tag tag-warn small" title="Currently in another group — will be reassigned">
                in another group
              </span>
            ) : null}
          </label>
        ))}
        {filtered.length === 0 ? <div className="muted">No accounts match.</div> : null}
      </div>
    </Modal>
  );
}
