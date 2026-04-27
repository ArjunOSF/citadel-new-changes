import React, { useEffect, useMemo, useState } from "react";
import { api } from "../api.js";
import DonutChart from "../components/DonutChart.jsx";
import { formatDate } from "../lib/format.js";

const STATUS_ORDER = [
  "Not Prepared",
  "In Progress",
  "Pending Approval",
  "Reviewed",
  "Approved",
  "System Certified",
  "Rejected",
];

const TEMPLATES = ["General List", "Amortizable", "Accrual", "Schedule List"];

// Used to pick the aggregate status of a group — the "least advanced" member
// status wins (e.g. a group with one "Not Prepared" member is not yet completed).
// "Rejected" is treated as the lowest since the whole group needs rework.
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

export default function Summary({ user, period, onOpen, refreshKey }) {
  const [summary, setSummary] = useState(null);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all"); // all | completed | not_completed | status:XYZ
  const [tick, setTick] = useState(0); // bumps after an inline action (template change / auto-certify)
  const [banner, setBanner] = useState(null);
  const [autoBusy, setAutoBusy] = useState(false);

  const reload = () => setTick((t) => t + 1);

  useEffect(() => {
    if (!period) return;
    setLoading(true);
    Promise.all([
      api.summary(period),
      api.reconciliations(period),
    ]).then(([s, r]) => {
      setSummary(s);
      setRows(r);
    }).catch(() => {
      setSummary({ total: 0, completed: 0, not_completed: 0, by_status: {} });
      setRows([]);
    }).finally(() => setLoading(false));
  }, [period, refreshKey, tick]);

  const isAdmin = user.role === "Admin";

  const changeTemplate = async (accountId, nextTemplate) => {
    setBanner(null);
    try {
      await api.patchAccountTemplate(accountId, nextTemplate);
      reload();
    } catch (e) {
      setBanner({ kind: "error", text: e.message || "Could not change template" });
    }
  };

  const runAutoCertify = async () => {
    if (!period) return;
    setAutoBusy(true); setBanner(null);
    try {
      const res = await api.autoCertify(period);
      const parts = [];
      if (res.by_rule.rule1) parts.push(`${res.by_rule.rule1} via zero-balance rule`);
      if (res.by_rule.rule2) parts.push(`${res.by_rule.rule2} via schedule-match rule`);
      if (res.by_rule.rule3) parts.push(`${res.by_rule.rule3} via unchanged-balance rule`);
      setBanner({
        kind: res.certified_count > 0 ? "success" : "warn",
        text: res.certified_count > 0
          ? `Auto-certified ${res.certified_count} reconciliation${res.certified_count === 1 ? "" : "s"} (${parts.join(", ")}).`
          : "No reconciliations matched any auto-certification rule.",
      });
      reload();
    } catch (e) {
      setBanner({ kind: "error", text: e.message || "Auto-certify failed" });
    } finally { setAutoBusy(false); }
  };

  // Collapse grouped recons into a single synthetic row per group. Non-grouped
  // recons pass through unchanged. This is what the user actually reconciles
  // against — the group IS the reconciliation unit on this page.
  const collapsed = useMemo(() => collapseGroups(rows), [rows]);

  const filtered = useMemo(() => {
    let items = collapsed;
    if (filter === "completed") {
      items = items.filter((r) => isCompleted(r.status));
    } else if (filter === "not_completed") {
      items = items.filter((r) => !isCompleted(r.status));
    } else if (filter.startsWith("status:")) {
      const s = filter.slice(7);
      items = items.filter((r) => r.status === s);
    }
    const q = search.trim().toLowerCase();
    if (q) {
      items = items.filter((r) =>
        [r.entity, r.entity_code, r.account, r.description, r.preparer, r.approver, r.group_name]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(q))
      );
    }
    return items;
  }, [collapsed, filter, search]);

  // Re-derive card counts from the collapsed view so groups count as one.
  const localSummary = useMemo(() => {
    const total = collapsed.length;
    const completed = collapsed.filter((r) => isCompleted(r.status)).length;
    const not_completed = total - completed;
    const by_status = {};
    for (const r of collapsed) by_status[r.status] = (by_status[r.status] || 0) + 1;
    return { total, completed, not_completed, by_status };
  }, [collapsed]);

  if (loading) {
    return <div className="page-padding"><div className="muted">Loading…</div></div>;
  }

  // Empty state - no accounts imported yet for this period
  const hasAny = (summary?.total || 0) > 0;

  return (
    <div className="page-padding">
      <SummaryCards summary={localSummary} onPickFilter={setFilter} activeFilter={filter} />

      {banner ? <div className={`alert ${banner.kind}`}>{banner.text}</div> : null}

      {!hasAny ? (
        <EmptyState user={user} />
      ) : (
        <>
          <div className="toolbar">
            <div className="toolbar-left">
              <input
                className="form-input search"
                placeholder="Search entity, account, description…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <select
                className="form-input select"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              >
                <option value="all">All ({collapsed.length})</option>
                <option value="completed">Completed</option>
                <option value="not_completed">Not Completed</option>
                <option disabled>──────────</option>
                {STATUS_ORDER.map((s) => (
                  <option key={s} value={`status:${s}`}>{s}</option>
                ))}
              </select>
            </div>
            <div className="toolbar-right">
              {isAdmin && (
                <button
                  className="btn ghost small"
                  onClick={runAutoCertify}
                  disabled={autoBusy}
                  title="Run zero-balance, schedule-match, and unchanged-balance rules against this period"
                >
                  {autoBusy ? "Running…" : "⚡ Run Auto-Certify"}
                </button>
              )}
              <span className="muted small">Showing {filtered.length} of {collapsed.length}</span>
            </div>
          </div>

          <ReconTable rows={filtered} onOpen={onOpen} isAdmin={isAdmin} onChangeTemplate={changeTemplate} />
        </>
      )}
    </div>
  );
}

/**
 * Collapse grouped reconciliations into one synthetic row per group.
 *
 * A group row carries:
 *   id:          "group:<gid>"   (App.jsx dispatches on this prefix)
 *   is_group:    true
 *   group_name:  display label
 *   gl_balance:  Σ members.gl_balance
 *   items_total: Σ members.items_total
 *   unidentified:Σ members.unidentified
 *   status:      least-advanced member status
 *   members:     raw member rows (for the detail page)
 */
function collapseGroups(rows) {
  const groups = new Map();
  const solo = [];
  for (const r of rows) {
    if (r.group_id) {
      if (!groups.has(r.group_id)) groups.set(r.group_id, []);
      groups.get(r.group_id).push(r);
    } else {
      solo.push(r);
    }
  }
  const groupRows = [];
  for (const [gid, members] of groups) {
    const gl     = members.reduce((t, m) => t + (Number(m.gl_balance) || 0), 0);
    const items  = members.reduce((t, m) => t + (Number(m.items_total) || 0), 0);
    const diff   = gl - items;
    const name   = members[0].group_name || "(unnamed group)";
    const entities = Array.from(new Set(members.map((m) => m.entity).filter(Boolean)));
    // Show member preparers/approvers only if unique across the group
    const uniq = (k) => {
      const xs = Array.from(new Set(members.map((m) => m[k]).filter(Boolean)));
      return xs.length === 1 ? xs[0] : (xs.length > 1 ? `${xs.length} people` : "—");
    };
    // For a group row, pick the LATEST prep/appr date across members so the
    // user sees "when the group last moved". Unique-or-count logic applies to
    // the people fields (uniq()).
    const latest = (k) =>
      members.map((m) => m[k]).filter(Boolean).sort().pop() || "";
    groupRows.push({
      id: `group:${gid}`,
      is_group: true,
      group_id: gid,
      group_name: name,
      entity: entities.length === 1 ? entities[0] : `${entities.length} entities`,
      entity_code: "",
      account: name,
      description: `${members.length} accounts reconciled together`,
      template: "Grouped",
      gl_balance: gl,
      items_total: items,
      unidentified: diff,
      status: aggregateStatus(members),
      preparer: uniq("preparer"),
      approver: uniq("approver"),
      certified_by: uniq("certified_by"),
      approved_by:  uniq("approved_by"),
      prep_date: latest("prep_date"),
      app_date:  latest("app_date"),
      currency: members[0].currency || "USD",
      period: members[0].period,
      members,
    });
  }
  // Surface group rows first, then individual rows.
  return [...groupRows, ...solo];
}

function SummaryCards({ summary, onPickFilter, activeFilter }) {
  const total = summary?.total || 0;
  const completed = summary?.completed || 0;
  const notCompleted = summary?.not_completed || 0;
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;

  return (
    <div className="summary-grid">
      <button
        className={`stat-card ${activeFilter === "all" ? "active" : ""}`}
        onClick={() => onPickFilter("all")}
      >
        <div className="stat-label">Total reconciliations</div>
        <div className="stat-value">{total}</div>
        <div className="stat-sub muted">for this period</div>
      </button>

      <button
        className={`stat-card green ${activeFilter === "completed" ? "active" : ""}`}
        onClick={() => onPickFilter("completed")}
      >
        <div className="stat-label">Completed</div>
        <div className="stat-value">{completed}</div>
        <div className="stat-sub muted">Reviewed · Approved</div>
      </button>

      <button
        className={`stat-card yellow ${activeFilter === "not_completed" ? "active" : ""}`}
        onClick={() => onPickFilter("not_completed")}
      >
        <div className="stat-label">Not completed</div>
        <div className="stat-value">{notCompleted}</div>
        <div className="stat-sub muted">Not prepared · In progress · Pending</div>
      </button>

      <div className="stat-card chart">
        <div className="stat-label">Completion</div>
        <DonutChart completed={completed} notCompleted={notCompleted} size={120} stroke={16} />
      </div>
    </div>
  );
}

function ReconTable({ rows, onOpen, isAdmin, onChangeTemplate }) {
  if (!rows.length) {
    return <div className="empty-inline muted">No reconciliations match the current filter.</div>;
  }
  return (
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
      {rows.map((r) => {
        // Admins get an inline template dropdown — but not on synthetic group rows
        // (a group spans multiple accounts, each with its own template).
        const showTemplateDropdown = isAdmin && !r.is_group && r.account_id;
        return (
          <div
            className={`data-row recon-row ${r.is_group ? "group-row" : ""}`}
            key={r.id}
            role="button"
            tabIndex={0}
            onClick={(e) => {
              // Don't drill in when clicking the inline template control.
              if (e.target.closest(".tmpl-inline-select")) return;
              onOpen(r.id);
            }}
            onKeyDown={(e) => { if (e.key === "Enter") onOpen(r.id); }}
          >
            <div className="cell-primary truncate">
              {r.is_group ? <span className="group-icon" title="Grouped reconciliation">🔗 </span> : null}
              {r.entity}
            </div>
            <div className="cell-primary truncate">{r.account}</div>
            <div className="truncate">{r.description}</div>
            <div>
              {r.is_group ? (
                <span className="tmpl-pill tmpl-grouped">Grouped</span>
              ) : showTemplateDropdown ? (
                <select
                  className="tmpl-inline-select"
                  value={r.template}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => onChangeTemplate(r.account_id, e.target.value)}
                  title="Admin: change reconciliation template"
                >
                  {TEMPLATES.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              ) : (
                <span className={`tmpl-pill tmpl-${slug(r.template)}`}>{r.template}</span>
              )}
            </div>
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
          </div>
        );
      })}
    </div>
  );
}

function EmptyState({ user }) {
  return (
    <div className="empty-state">
      <div className="empty-illustration">📥</div>
      <h2>No reconciliations yet</h2>
      <p className="muted">
        Accounts and GL balances will appear here once an Admin imports them for this period.
      </p>
      {user.role === "Admin" ? (
        <p className="muted small">
          Head to <strong>Import GL Balances</strong> in the left nav to upload a CSV or Excel file.
        </p>
      ) : (
        <p className="muted small">
          Ask your Admin to upload the monthly GL balances to get started.
        </p>
      )}
    </div>
  );
}

function isCompleted(s) {
  return s === "Reviewed" || s === "Approved" || s === "System Certified";
}
function slug(s = "") { return s.toLowerCase().replace(/[^a-z0-9]+/g, "-"); }
function fmtMoney(n) {
  if (n === null || n === undefined || isNaN(n)) return "—";
  return Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
