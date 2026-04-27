import React, { useEffect, useState, useCallback } from "react";
import { api, saveToken, saveUser, loadUser } from "./api.js";
import { setDateFormat } from "./lib/format.js";
import Login from "./pages/Login.jsx";
import Shell from "./components/Shell.jsx";
import Summary from "./pages/Summary.jsx";
import ImportPage from "./pages/Import.jsx";
import ManageAccounts from "./pages/ManageAccounts.jsx";
import ManageGroups from "./pages/ManageGroups.jsx";
import ReconDetail from "./pages/ReconDetail.jsx";
import GroupDetail from "./pages/GroupDetail.jsx";
import Audit from "./pages/Audit.jsx";
import AutoRules from "./pages/AutoRules.jsx";
import DataSources from "./pages/DataSources.jsx";
import Flux from "./pages/Flux.jsx";
import Users from "./pages/Users.jsx";
import SettingsPage from "./pages/Settings.jsx";
import ErrorBoundary from "./components/ErrorBoundary.jsx";

/**
 * Top-level app shell. Responsible for:
 *  - holding the current authenticated user (or null),
 *  - holding the currently-selected period,
 *  - picking which page to render based on the active nav item.
 */
export default function App() {
  const [user, setUser] = useState(() => loadUser());
  const [page, setPage] = useState("summary");
  const [period, setPeriod] = useState("");
  const [periods, setPeriods] = useState([]);
  const [openRecon, setOpenRecon] = useState(null); // reconciliation id when drilled in
  const [refreshKey, setRefreshKey] = useState(0);

  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  // When a user logs in, load the list of known periods and pick the most recent.
  useEffect(() => {
    if (!user) return;
    api.periods().then((ps) => {
      setPeriods(ps);
      if (ps.length && !period) setPeriod(ps[0]);
      if (!ps.length && !period) setPeriod(defaultPeriod());
    }).catch(() => setPeriod((p) => p || defaultPeriod()));

    // Load app-wide settings (date format, etc.) and stash the date format
    // in the module-level helper so every date render uses the right format.
    api.settings().then((s) => {
      if (s?.date_format) setDateFormat(s.date_format);
    }).catch(() => {});
  }, [user, refreshKey]);

  const handleLogin = async (username, password) => {
    const res = await api.login(username, password);
    saveToken(res.token);
    saveUser(res.user);
    setUser(res.user);
  };

  const handleLogout = () => {
    saveToken(null);
    saveUser(null);
    setUser(null);
    setPage("summary");
    setOpenRecon(null);
  };

  if (!user) return <Login onLogin={handleLogin} />;

  // When user drills into a reconciliation, render the detail page full-width.
  // Group "recons" are synthetic — the Summary emits ids like "group:<gid>" for
  // collapsed group rows, so route those to GroupDetail instead of ReconDetail.
  let body;
  if (openRecon && typeof openRecon === "string" && openRecon.startsWith("group:")) {
    const gid = openRecon.slice(6);
    body = (
      <GroupDetail
        gid={gid}
        period={period}
        user={user}
        onOpen={(rid) => setOpenRecon(rid)}
        onClose={() => { setOpenRecon(null); refresh(); }}
      />
    );
  } else if (openRecon) {
    body = (
      <ReconDetail
        rid={openRecon}
        user={user}
        onClose={() => { setOpenRecon(null); refresh(); }}
      />
    );
  } else if (page === "summary") {
    body = (
      <Summary
        user={user}
        period={period}
        onOpen={(rid) => setOpenRecon(rid)}
        refreshKey={refreshKey}
      />
    );
  } else if (page === "import") {
    body = <ImportPage
      user={user}
      globalPeriod={period}
      onImported={(p) => { setPeriod(p); refresh(); setPage("summary"); }}
    />;
  } else if (page === "accounts") {
    body = <ManageAccounts user={user} onChange={refresh} />;
  } else if (page === "groups") {
    body = <ManageGroups user={user} onChange={refresh} />;
  } else if (page === "sources") {
    body = <DataSources user={user} />;
  } else if (page === "flux") {
    body = <Flux user={user} period={period} />;
  } else if (page === "rules") {
    body = <AutoRules user={user} period={period} />;
  } else if (page === "users") {
    body = <Users user={user} />;
  } else if (page === "settings") {
    body = <SettingsPage user={user} />;
  } else if (page === "audit") {
    body = <Audit user={user} />;
  }

  return (
    <Shell
      user={user}
      page={page}
      onNav={(p) => { setOpenRecon(null); setPage(p); }}
      onLogout={handleLogout}
      period={period}
      onPeriodChange={setPeriod}
      periods={periods}
    >
      {/* Key the boundary by the current page / open recon so switching
          routes automatically clears any stuck error. */}
      <ErrorBoundary
        key={openRecon || page}
        label={openRecon ? "reconciliation detail" : `${page} page`}
      >
        {body}
      </ErrorBoundary>
    </Shell>
  );
}

function defaultPeriod() {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${d.getFullYear()}-${m}`;
}
