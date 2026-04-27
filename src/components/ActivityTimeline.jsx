import React, { useEffect, useState } from "react";
import { api } from "../api.js";
import { formatDate } from "../lib/format.js";

/**
 * ActivityTimeline — shows who did what to a reconciliation (or to every
 * member of a group) over its lifetime. Designed for the bottom of the
 * recon/group detail pages.
 *
 * Fetches from /api/reconciliations/{rid}/activity or
 * /api/groups/{gid}/activity?period=... depending on the props passed.
 *
 * Props:
 *   reconId    — when set, loads per-recon activity
 *   groupId    — when set, loads per-group activity (period required)
 *   period     — required when groupId is set
 *   refreshKey — optional; bump to force a reload (e.g. after an action)
 */
export default function ActivityTimeline({ reconId, groupId, period, refreshKey }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");
  const [showDetails, setShowDetails] = useState({});

  const load = () => {
    setLoading(true); setError("");
    const p = reconId
      ? api.reconActivity(reconId)
      : api.groupActivity(groupId, period);
    p.then(setData).catch((e) => setError(e.message || "Failed to load activity"))
     .finally(() => setLoading(false));
  };

  useEffect(load, [reconId, groupId, period, refreshKey]);

  if (loading && !data) return <div className="muted">Loading activity…</div>;
  if (error) return <div className="alert error">{error}</div>;
  if (!data) return null;

  const events = (data.events || []).filter((e) => {
    if (filter === "all") return true;
    if (filter === "items") return ["add_item", "update_item", "delete_item"].includes(e.action);
    if (filter === "status") return [
      "certify", "approve", "reject", "auto_certify",
      "group_certify", "group_approve", "group_reject",
      "reopen", "balance_update", "recon_created",
    ].includes(e.action);
    if (filter === "docs") return ["upload_doc", "delete_doc"].includes(e.action);
    if (filter === "comments") return e.action === "add_comment";
    return true;
  });

  const eventsReverse = [...events].reverse();   // newest first for the timeline

  if (data.event_count === 0) {
    return (
      <div className="muted small">
        No activity yet. Actions on this reconciliation — adding supporting items,
        certifying, approving, uploading proof — will appear here with a timestamp and actor.
      </div>
    );
  }

  return (
    <div className="activity-timeline">
      <div className="activity-filters">
        <span className="muted small">{eventsReverse.length} events</span>
        {["all", "items", "status", "docs", "comments"].map((f) => (
          <button key={f}
                  className={`activity-filter ${filter === f ? "active" : ""}`}
                  onClick={() => setFilter(f)}>
            {FILTER_LABELS[f] || f}
          </button>
        ))}
      </div>
      <ol className="activity-list">
        {eventsReverse.map((ev, i) => (
          <ActivityRow
            key={i}
            ev={ev}
            expanded={!!showDetails[i]}
            onToggleDetails={() => setShowDetails((s) => ({ ...s, [i]: !s[i] }))}
          />
        ))}
      </ol>
    </div>
  );
}

const FILTER_LABELS = {
  all:      "All",
  items:    "Items",
  status:   "Status changes",
  docs:     "Documents",
  comments: "Comments",
};

function ActivityRow({ ev, expanded, onToggleDetails }) {
  const meta = describe(ev);
  const when = ev.at;
  const hasDetails = !!ev.details && Object.keys(ev.details).length > 0;
  return (
    <li className={`activity-item activity-kind-${meta.kind}`}>
      <div className={`activity-dot activity-dot-${meta.kind}`} aria-hidden="true">
        {meta.emoji}
      </div>
      <div className="activity-body">
        <div className="activity-head">
          <span className="activity-actor">{ev.actor || "—"}</span>
          <span className="activity-verb">{meta.verb}</span>
          {ev.account && (
            <span className="muted small">· {ev.account}</span>
          )}
          {ev.scope === "group" && (
            <span className="tag tag-info small" style={{ marginLeft: 6 }}>group-level</span>
          )}
        </div>
        {meta.summary && (
          <div className="activity-summary">{meta.summary}</div>
        )}
        <div className="activity-meta">
          <span className="muted small">{formatTimestamp(when)}</span>
          {hasDetails && (
            <button className="link-btn small" onClick={onToggleDetails}>
              {expanded ? "Hide details" : "Details"}
            </button>
          )}
        </div>
        {expanded && hasDetails && (
          <pre className="activity-details">
            {JSON.stringify(ev.details, null, 2)}
          </pre>
        )}
      </div>
    </li>
  );
}

// ─── action → user-friendly description ────────────────────────────────

function describe(ev) {
  const a = ev.action;
  const d = ev.details || {};
  // Shared kind buckets drive the dot colour.
  switch (a) {
    // Status transitions
    case "certify":       return { verb: "certified and submitted for approval", kind: "certify",  emoji: "✓" };
    case "approve":       return { verb: "approved the reconciliation",          kind: "approve",  emoji: "✓" };
    case "reject":        return { verb: "rejected the reconciliation",          kind: "reject",   emoji: "✕",
                                   summary: d.reason ? `Reason: ${d.reason}` : null };
    case "auto_certify":  return { verb: "auto-certified via system rules",      kind: "approve",  emoji: "⚡" };
    case "group_certify": return { verb: "certified the whole group",            kind: "certify",  emoji: "✓",
                                   summary: summaryCount(d, "transitioned", "reconciliation") };
    case "group_approve": return { verb: "approved the whole group",             kind: "approve",  emoji: "✓",
                                   summary: summaryCount(d, "transitioned", "reconciliation") };
    case "group_reject":  return { verb: "rejected the whole group",             kind: "reject",   emoji: "✕",
                                   summary: d.reason ? `Reason: ${d.reason}` : null };
    case "reopen":        return { verb: "reopened after balance change", kind: "reopen", emoji: "↻",
                                   summary: moveSummary(d) };
    case "balance_update":return { verb: "balance updated from import",   kind: "edit",   emoji: "≈",
                                   summary: moveSummary(d) };
    case "recon_created": return { verb: "reconciliation created from import", kind: "create", emoji: "+",
                                   summary: d.balance !== undefined ? `Initial balance $${money(d.balance)}` : null };

    // Supporting items
    case "add_item":     return { verb: "added a supporting item", kind: "create", emoji: "+",
                                  summary: itemSummary(d) };
    case "update_item":  return { verb: "edited a supporting item", kind: "edit",   emoji: "✎",
                                  summary: itemSummary(d) };
    case "delete_item":  return { verb: "deleted a supporting item", kind: "delete", emoji: "−",
                                  summary: itemSummary(d) };

    // Comments
    case "add_comment":  return { verb: "added a comment", kind: "comment", emoji: "💬",
                                  summary: d.text ? d.text : (d.excerpt || null) };

    // Documents
    case "upload_doc":   return { verb: d.group_shared ? "uploaded a shared group document" : "uploaded a document",
                                  kind: "doc", emoji: "📎",
                                  summary: d.filename || null };
    case "delete_doc":   return { verb: "deleted a document", kind: "delete", emoji: "📎",
                                  summary: d.filename || null };

    default:
      return { verb: humanize(a), kind: "edit", emoji: "•" };
  }
}

function humanize(s) { return (s || "").replace(/_/g, " "); }

function money(n) {
  if (n === null || n === undefined || isNaN(n)) return "—";
  return Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function itemSummary(d) {
  const parts = [];
  if (d.item_class)  parts.push(d.item_class);
  if (d.description) parts.push(`"${d.description}"`);
  if (d.amount !== undefined && d.amount !== null) parts.push(`$${money(d.amount)}`);
  return parts.length ? parts.join(" · ") : null;
}

function moveSummary(d) {
  const prev = d.prev_balance, next = d.new_balance;
  if (prev === undefined || next === undefined) return null;
  return `$${money(prev)} → $${money(next)}`;
}

function summaryCount(d, key, noun) {
  const n = d?.[key];
  if (n === undefined || n === null) return null;
  return `${n} ${noun}${n === 1 ? "" : "s"} transitioned`;
}

function formatTimestamp(at) {
  // Backend timestamps are "YYYY-MM-DD HH:MM:SS" UTC (SQLite default).
  if (!at) return "";
  const [datePart, timePart] = at.split(" ");
  const date = datePart ? formatDate(datePart) : "";
  return timePart ? `${date} ${timePart}` : date;
}
