import React, { useEffect, useMemo, useState } from "react";
import { api } from "../api.js";
import Modal from "../components/Modal.jsx";
import PeriodPicker from "../components/PeriodPicker.jsx";

/**
 * Flux (variance) analysis — CFO-oriented close-process view.
 *
 * For a chosen (current, prior) period pair, compute the per-account change
 * in GL balance, filter by the significance thresholds the CFO cares about,
 * and surface a grid of movers ranked by |Δ$| descending. Preparers (and
 * Admins) write a business explanation per significant row; Approvers /
 * Admins sign off on each explanation.
 *
 * The "Suggest with Osfin AI" button drafts a starting-point commentary
 * using the account metadata + the two balances + the supporting-item list.
 */
export default function Flux({ user, period }) {
  const [current, setCurrent]   = useState(period || defaultPeriod());
  const [prior,   setPrior]     = useState(() => prevMonth(period || defaultPeriod()));
  const [minAmt,  setMinAmt]    = useState(1000);
  const [minPct,  setMinPct]    = useState(5);
  const [data,    setData]      = useState(null);
  const [loading, setLoading]   = useState(true);
  const [banner,  setBanner]    = useState(null);
  const [filter,  setFilter]    = useState("significant");   // all | significant | unexplained | explained | reviewed
  const [entity,  setEntity]    = useState("all");
  const [search,  setSearch]    = useState("");
  const [openRow, setOpenRow]   = useState(null);  // row object currently being commented on
  const [statuses, setStatuses] = useState([]);
  const [knownPeriods, setKnownPeriods] = useState([]);

  useEffect(() => {
    if (period && period !== current) {
      setCurrent(period);
      setPrior(prevMonth(period));
    }
  }, [period]);

  // Pull period statuses + periods with data so the calendar pickers render
  // their colour cues and green "has data" dots, matching the Summary topbar.
  useEffect(() => {
    api.periodStatuses().then(setStatuses).catch(() => setStatuses([]));
    api.periods().then(setKnownPeriods).catch(() => setKnownPeriods([]));
  }, []);

  const load = () => {
    setLoading(true);
    api.flux(current, prior, minAmt, minPct)
      .then(setData)
      .catch((e) => setBanner({ kind: "error", text: e.message || "Failed to compute flux" }))
      .finally(() => setLoading(false));
  };

  useEffect(load, [current, prior, minAmt, minPct]);

  const entities = useMemo(() => {
    if (!data) return [];
    return Array.from(new Set(data.rows.map((r) => r.entity).filter(Boolean))).sort();
  }, [data]);

  const rows = useMemo(() => {
    if (!data) return [];
    let items = data.rows;
    if (entity !== "all") items = items.filter((r) => r.entity === entity);
    if (filter === "significant")   items = items.filter((r) => r.significant);
    if (filter === "unexplained")   items = items.filter((r) => r.significant && r.comment_status === "needs_explanation");
    if (filter === "explained")     items = items.filter((r) => r.comment_status === "explained");
    if (filter === "reviewed")      items = items.filter((r) => r.comment_status === "reviewed");
    const q = search.trim().toLowerCase();
    if (q) {
      items = items.filter((r) =>
        [r.account_number, r.description, r.entity, r.template, r.comment]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(q))
      );
    }
    return items;
  }, [data, filter, entity, search]);

  const onExplained = async (row, comment, aiGenerated) => {
    try {
      await api.fluxComment({
        account_id:     row.account_id,
        current_period: current,
        prior_period:   prior,
        comment,
        ai_generated:   aiGenerated,
      });
      setBanner({ kind: "success", text: `Saved explanation for ${row.account_number}.` });
      setOpenRow(null);
      load();
    } catch (e) {
      setBanner({ kind: "error", text: e.message });
    }
  };

  const onReview = async (row) => {
    if (!row.comment_id) return;
    try {
      await api.fluxReview(row.comment_id);
      setBanner({ kind: "success", text: `Reviewed ${row.account_number}.` });
      load();
    } catch (e) {
      setBanner({ kind: "error", text: e.message });
    }
  };

  const canReview = user.role === "Approver" || user.role === "Admin";
  const canExplain = user.role === "Preparer" || user.role === "Admin" || user.role === "Approver";

  return (
    <div className="page-padding">
      <div className="flux-header">
        <div>
          <h2 style={{ margin: 0 }}>Flux analysis</h2>
          <div className="muted small" style={{ marginTop: 4 }}>
            Period-over-period variance digest. Preparers explain, Approvers sign off,
            the CFO gets a one-pager.
          </div>
        </div>
        <div className="flux-controls">
          <PeriodPicker
            period={current}
            onChange={setCurrent}
            knownPeriods={knownPeriods}
            statuses={statuses}
            labelPrefix="Current"
          />
          <span className="muted">vs</span>
          <PeriodPicker
            period={prior}
            onChange={setPrior}
            knownPeriods={knownPeriods}
            statuses={statuses}
            labelPrefix="Prior"
          />
          <label className="flux-control">
            <span>Min $</span>
            <input type="number" className="form-input num-input"
                   style={{ width: 110 }}
                   value={minAmt}
                   onChange={(e) => setMinAmt(Math.max(0, Number(e.target.value) || 0))} />
          </label>
          <label className="flux-control">
            <span>Min %</span>
            <input type="number" className="form-input num-input"
                   style={{ width: 80 }}
                   value={minPct} min={0} max={1000}
                   onChange={(e) => setMinPct(Math.max(0, Number(e.target.value) || 0))} />
          </label>
          <a
            href={api.fluxExportUrl(current, prior, minAmt, minPct)}
            className="btn ghost small" download
            title="Download significant-rows CSV"
          >⬇ CSV</a>
        </div>
      </div>

      {banner ? <div className={`alert ${banner.kind}`}>{banner.text}</div> : null}

      {loading && !data ? (
        <div className="muted">Computing variance…</div>
      ) : !data ? (
        <div className="muted">No data.</div>
      ) : (
        <>
          <FluxSummary summary={data.summary} current={current} prior={prior} />

          <div className="toolbar" style={{ marginTop: 16 }}>
            <div className="toolbar-left">
              <select className="form-input select" value={filter}
                      onChange={(e) => setFilter(e.target.value)}>
                <option value="significant">Above threshold ({data.summary.significant_rows})</option>
                <option value="unexplained">Unexplained ({data.summary.unexplained})</option>
                <option value="explained">Explained, pending review ({data.summary.explained - data.summary.reviewed})</option>
                <option value="reviewed">Reviewed ({data.summary.reviewed})</option>
                <option value="all">All accounts ({data.summary.total_rows})</option>
              </select>
              <input
                className="form-input search"
                placeholder="🔍 Search account, description, commentary…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              {entities.length > 1 && (
                <select className="form-input select" value={entity}
                        onChange={(e) => setEntity(e.target.value)}>
                  <option value="all">All entities</option>
                  {entities.map((e) => <option key={e} value={e}>{e}</option>)}
                </select>
              )}
            </div>
            <div className="toolbar-right muted small">
              Showing {rows.length} of {data.summary.total_rows}
            </div>
          </div>

          <FluxTable rows={rows}
                     canExplain={canExplain}
                     canReview={canReview}
                     onOpen={(r) => setOpenRow(r)}
                     onReview={onReview} />
        </>
      )}

      {openRow && (
        <ExplainModal
          row={openRow}
          current={current}
          prior={prior}
          onClose={() => setOpenRow(null)}
          onSave={onExplained}
        />
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Executive summary strip
// ────────────────────────────────────────────────────────────────────────────

function FluxSummary({ summary, current, prior }) {
  const pctExplained = summary.significant_rows
    ? Math.round((summary.explained / summary.significant_rows) * 100)
    : 100;
  return (
    <div className="flux-summary">
      {/* Combined: Net change + Total up + Total down in one card */}
      <div className="flux-card flux-card-change">
        <div className="stat-label">Period change · {prior} → {current}</div>
        <div className={`flux-big ${summary.net_change >= 0 ? "up" : "down"}`}>
          {signedMoney(summary.net_change)}
        </div>
        <div className="muted small">net change</div>
        <div className="flux-change-splits">
          <div>
            <div className="muted small">Total up</div>
            <div className="flux-split-val up">{money(summary.total_up)}</div>
          </div>
          <div>
            <div className="muted small">Total down</div>
            <div className="flux-split-val down">{signedMoney(summary.total_down)}</div>
          </div>
        </div>
      </div>

      <div className="flux-card">
        <div className="stat-label">Significant accounts</div>
        <div className="flux-big">{summary.significant_rows}</div>
        <div className="muted small">of {summary.total_rows} total</div>
      </div>

      <div className="flux-card">
        <div className="stat-label">Commentary coverage</div>
        <div className="flux-big">{pctExplained}%</div>
        <div className="muted small">
          {summary.unexplained > 0
            ? <span className="flux-pill-bad">{summary.unexplained} unexplained</span>
            : <span className="flux-pill-ok">all explained</span>}
        </div>
      </div>

      {/* Top movers — roomier now that 3 cards collapsed into 1 */}
      {summary.top_movers.length > 0 && (
        <div className="flux-card flux-card-top">
          <div className="stat-label">Top movers</div>
          <ul className="flux-top-list">
            {summary.top_movers.map((m, i) => (
              <li key={i}>
                <span className="flux-top-rank">#{i + 1}</span>
                <div className="flux-top-meta">
                  <div className="flux-top-acct">{m.account_number}</div>
                  <div className="muted small truncate">{m.description}</div>
                </div>
                <div className={`flux-top-amt ${m.delta_abs >= 0 ? "up" : "down"}`}>
                  {signedMoney(m.delta_abs)}
                  {m.delta_pct !== null && <div className="muted small">{signedPct(m.delta_pct)}</div>}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Main grid
// ────────────────────────────────────────────────────────────────────────────

function FluxTable({ rows, canExplain, canReview, onOpen, onReview }) {
  if (!rows.length) {
    return <div className="empty-inline muted">No rows match the current filter.</div>;
  }
  return (
    <div className="data-grid flux-grid">
      <div className="data-head">
        <div>Entity</div>
        <div>Account</div>
        <div>Description</div>
        <div className="num">Prior</div>
        <div className="num">Current</div>
        <div className="num">Δ $</div>
        <div className="num">Δ %</div>
        <div>Explanation</div>
        <div></div>
      </div>
      {rows.map((r) => (
        <div className={`data-row static flux-row ${r.direction} ${!r.significant ? "below" : ""}`}
             key={r.account_id}>
          <div className="truncate">{r.entity}</div>
          <div className="cell-primary truncate">{r.account_number}</div>
          <div className="truncate">{r.description}</div>
          <div className="num">{money(r.prior_balance)}</div>
          <div className="num">{money(r.current_balance)}</div>
          <div className={`num flux-delta ${r.direction}`}>
            {r.delta_abs === 0 ? (
              "—"
            ) : (
              <>
                <span className="flux-arrow">{r.direction === "up" ? "▲" : "▼"}</span>
                {signedMoney(r.delta_abs)}
              </>
            )}
          </div>
          <div className={`num flux-delta ${r.direction}`}>
            {r.delta_pct === null ? <span className="muted">new</span> : signedPct(r.delta_pct)}
          </div>
          <div>
            {!r.significant
              ? <span className="muted small">below threshold</span>
              : r.comment_status === "needs_explanation"
                ? <span className="flux-pill-bad">Needs explanation</span>
                : r.comment_status === "explained"
                  ? (
                      <div className="flux-explain-cell">
                        <span className="flux-pill-warn">
                          Explained · awaiting review
                          {r.ai_generated ? " · 🤖 AI" : ""}
                        </span>
                        <div className="muted small truncate" title={r.comment}>{r.comment}</div>
                      </div>
                    )
                  : (
                      <div className="flux-explain-cell">
                        <span className="flux-pill-ok">
                          Reviewed by {r.reviewer}
                          {r.ai_generated ? " · 🤖 AI draft" : ""}
                        </span>
                        <div className="muted small truncate" title={r.comment}>{r.comment}</div>
                      </div>
                    )}
          </div>
          <div className="row-actions">
            {r.significant && canExplain && (
              <button className="link-btn" onClick={() => onOpen(r)}>
                {r.comment_status === "needs_explanation" ? "Explain" : "Edit"}
              </button>
            )}
            {r.significant && canReview && r.comment_status === "explained" && (
              <button className="link-btn" onClick={() => onReview(r)}>Mark reviewed</button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Explain modal — write commentary or ask Osfin AI to draft one
// ────────────────────────────────────────────────────────────────────────────

function ExplainModal({ row, current, prior, onClose, onSave }) {
  const [comment, setComment]   = useState(row.comment || "");
  const [aiUsed, setAiUsed]     = useState(false);
  const [busy, setBusy]         = useState(false);
  const [error, setError]       = useState("");
  const [suggesting, setSuggesting] = useState(false);

  const suggest = async () => {
    setSuggesting(true); setError("");
    try {
      const res = await api.fluxSuggest({
        account_id:     row.account_id,
        current_period: current,
        prior_period:   prior,
      });
      if (res?.suggestion) {
        setComment(res.suggestion);
        setAiUsed(true);
      }
    } catch (e) {
      setError(e.message || "AI suggest failed");
    } finally { setSuggesting(false); }
  };

  const save = async () => {
    if (!comment.trim()) { setError("Please write (or generate) an explanation."); return; }
    setBusy(true); setError("");
    try {
      await onSave(row, comment.trim(), aiUsed);
    } catch (e) { setError(e.message || "Save failed"); }
    finally { setBusy(false); }
  };

  return (
    <Modal
      title={`Explain variance — ${row.account_number}`}
      onClose={onClose}
      xwide
      footer={
        <>
          <button className="btn ghost small" onClick={suggest} disabled={suggesting || busy}>
            {suggesting ? "🤖 Drafting…" : "🤖 Suggest with Osfin AI"}
          </button>
          <div style={{ flex: 1 }} />
          <button className="btn ghost" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn primary" onClick={save} disabled={busy || !comment.trim()}>
            {busy ? "Saving…" : "Save explanation"}
          </button>
        </>
      }
    >
      <div className="flux-explain-head">
        <div>
          <div className="muted small">Entity</div>
          <div className="cell-primary">{row.entity}</div>
        </div>
        <div>
          <div className="muted small">Account</div>
          <div className="cell-primary">{row.account_number}</div>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="muted small">Description</div>
          <div className="cell-primary truncate">{row.description}</div>
        </div>
        <div>
          <div className="muted small">Template</div>
          <div><span className={`tmpl-pill tmpl-${slug(row.template)}`}>{row.template}</span></div>
        </div>
      </div>

      <div className="flux-explain-balances">
        <div>
          <div className="muted small">{prior}</div>
          <div className="flux-big">{money(row.prior_balance)}</div>
        </div>
        <div className="flux-arrow-big">→</div>
        <div>
          <div className="muted small">{current}</div>
          <div className="flux-big">{money(row.current_balance)}</div>
        </div>
        <div style={{ marginLeft: "auto" }}>
          <div className="muted small">Change</div>
          <div className={`flux-big ${row.direction}`}>
            {row.direction === "up" ? "▲ " : row.direction === "down" ? "▼ " : ""}
            {signedMoney(row.delta_abs)}
            {row.delta_pct !== null && <span className="muted small"> ({signedPct(row.delta_pct)})</span>}
          </div>
        </div>
      </div>

      <label className="form-label" style={{ marginTop: 14 }}>Explanation for the CFO close deck</label>
      <textarea
        className="form-input"
        rows={5}
        placeholder="e.g. Q1 bonus pool accrued over Jan–Mar; current-period $300K reflects 4 months of $75K monthly accrual."
        value={comment}
        onChange={(e) => { setComment(e.target.value); setAiUsed(false); }}
        autoFocus
      />
      <div className="muted small" style={{ marginTop: 6 }}>
        Focus on <em>why</em> the balance moved — drivers, timing, non-recurring events, etc.
        Click <strong>🤖 Suggest with Osfin AI</strong> to draft a starting point.
      </div>
      {aiUsed && (
        <div className="muted small" style={{ marginTop: 6 }}>
          ✨ This draft was suggested by Osfin AI — please review before saving.
        </div>
      )}
      {error ? <div className="alert error" style={{ marginTop: 10 }}>{error}</div> : null}
    </Modal>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

function money(n) {
  if (n === null || n === undefined || isNaN(n)) return "—";
  return Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function signedMoney(n) {
  if (n === null || n === undefined || isNaN(n)) return "—";
  if (n === 0) return "0.00";
  const sign = n > 0 ? "+" : "";
  return sign + Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function signedPct(p) {
  if (p === null || p === undefined || isNaN(p)) return "—";
  const sign = p > 0 ? "+" : "";
  return `${sign}${Number(p).toFixed(1)}%`;
}

function defaultPeriod() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function prevMonth(p) {
  if (!p) return "";
  const [y, m] = p.split("-").map(Number);
  const d = new Date(y, m - 1, 1);
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function slug(s = "") { return s.toLowerCase().replace(/[^a-z0-9]+/g, "-"); }
