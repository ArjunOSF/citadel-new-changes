import React, { useState, useEffect, useRef } from "react";
import osfinLogo from "../assets/osfin-logo.svg";
import { api } from "../api.js";
import PeriodPicker, { defaultStatus, slugStatus } from "./PeriodPicker.jsx";

const ROLE_NAV = {
  Admin:    ["summary", "flux", "import", "sources", "accounts", "groups", "rules", "users", "settings", "audit"],
  Preparer: ["summary", "flux"],
  Approver: ["summary", "flux"],
  Auditor:  ["summary", "flux", "audit"],
};

const NAV_LABEL = {
  summary:  "Reconciliation summary",
  flux:     "Flux analysis",
  import:   "Import GL balances",
  sources:  "Data sources",
  accounts: "Manage accounts",
  groups:   "Account groups",
  rules:    "Auto-recon rules",
  users:    "User management",
  settings: "Settings",
  audit:    "Audit log",
};

const NAV_ICON = {
  summary:  "📊",
  flux:     "📈",
  import:   "📥",
  sources:  "🔌",
  accounts: "📁",
  groups:   "🔗",
  rules:    "⚡",
  users:    "👥",
  settings: "⚙️",
  audit:    "🔍",
};

export default function Shell({ user, page, onNav, onLogout, period, onPeriodChange, periods, children }) {
  const nav = ROLE_NAV[user.role] || ["summary"];
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem("recon_nav_collapsed") === "1"
  );
  useEffect(() => {
    localStorage.setItem("recon_nav_collapsed", collapsed ? "1" : "0");
  }, [collapsed]);

  // Period statuses — refreshed each time the user logs in, navigates, or
  // changes the period. Cheap enough to re-fetch proactively.
  const [statuses, setStatuses] = useState([]);
  const loadStatuses = () => {
    api.periodStatuses().then(setStatuses).catch(() => setStatuses([]));
  };
  useEffect(loadStatuses, [period, page]);
  const statusForPeriod = (statuses.find((s) => s.period === period) || {}).status
    || defaultStatus(period);

  return (
    <div className={`shell ${collapsed ? "nav-collapsed" : ""}`}>
      <aside className="sidenav">
        <div className="brand">
          <img src={osfinLogo} alt="Osfin" className="brand-logo" />
          <div className="brand-text">
            <div className="brand-sub">Account reconciliation</div>
          </div>
        </div>

        <nav className="nav-list">
          {nav.map((p) => (
            <button
              key={p}
              className={`nav-item ${page === p ? "active" : ""}`}
              onClick={() => onNav(p)}
              title={collapsed ? NAV_LABEL[p] : undefined}
            >
              <span className="nav-icon">{NAV_ICON[p]}</span>
              <span className="nav-label">{NAV_LABEL[p]}</span>
            </button>
          ))}
        </nav>

        <div className="nav-footer">
          <div className="user-card">
            <div className="avatar" title={collapsed ? user.name : undefined}>
              {initials(user.name)}
            </div>
            <div className="user-card-text">
              <div className="user-name">{user.name}</div>
              <div className={`role-pill role-${user.role.toLowerCase()}`}>{user.role}</div>
            </div>
          </div>
          <button className="btn ghost full" onClick={onLogout} title={collapsed ? "Sign out" : undefined}>
            <span className="nav-label">Sign out</span>
            <span className="nav-label-collapsed" aria-hidden="true">⎋</span>
          </button>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div className="topbar-left">
            <button
              className="icon-btn collapse-btn"
              onClick={() => setCollapsed((c) => !c)}
              title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
              aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            >
              {collapsed ? "»" : "«"}
            </button>
            <div className="topbar-title">{NAV_LABEL[page] || ""}</div>
          </div>
          <div className="topbar-right">
            <PeriodStatusChip
              period={period}
              status={statusForPeriod}
              canEdit={user.role === "Admin"}
              onChange={async (next) => {
                if (!period) return;
                try {
                  await api.setPeriodStatus(period, next);
                  loadStatuses();
                } catch (e) { alert(e.message || "Failed to change status"); }
              }}
            />
            <PeriodPicker
              period={period}
              onChange={onPeriodChange}
              knownPeriods={periods}
              statuses={statuses}
            />
          </div>
        </header>
        <div className="page-body">{children}</div>
      </main>
    </div>
  );
}

/* PeriodPicker is now in ./PeriodPicker.jsx. Below is the topbar-specific
   PeriodStatusChip that lets Admins change a period's lifecycle state. */

// PRD-style period lifecycle statuses.
const PERIOD_STATUSES = ["Future", "Open", "Soft-Close", "Closed", "Reopened"];

function PeriodStatusChip({ period, status, canEdit, onChange }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => {
      if (wrap.current && !wrap.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const cls = `period-status-chip status-period-${slugStatus(status)}`;
  if (!canEdit) {
    return <span className={cls} title="Period lifecycle status">{status}</span>;
  }
  return (
    <div className="period-status-wrap" ref={wrap}>
      <button type="button" className={cls + " editable"} onClick={() => setOpen((o) => !o)}
              title="Change period status">
        {status} ▾
      </button>
      {open ? (
        <div className="period-status-pop">
          <div className="period-status-pop-title muted small">Set {period} status</div>
          {PERIOD_STATUSES.map((s) => (
            <button
              key={s}
              className={`period-status-opt ${s === status ? "active" : ""}`}
              onClick={() => { setOpen(false); if (s !== status) onChange(s); }}
            >
              <span className={`status-dot status-period-${slugStatus(s)}`} />
              {s}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function initials(name = "") {
  const parts = name.replace(",", "").trim().split(/\s+/);
  const first = parts[0]?.[0] || "";
  const last = parts[parts.length - 1]?.[0] || "";
  return (first + last).toUpperCase();
}
