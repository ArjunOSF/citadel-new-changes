import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

/**
 * PeriodPicker — calendar-style month/year selector.
 *
 *   Button:  shows the currently-selected period, e.g. "Apr 2026", with
 *            an optional prefix label ("Period", "Current", "Prior", …).
 *   Popup:   year navigation header + 12-month grid. Each cell shows the
 *            month label and a status dot colour-coded by the period's
 *            lifecycle status (Future / Open / Soft-Close / Closed /
 *            Reopened). Known periods (ones with actual recon data) are
 *            marked with a small green dot indicator.
 *
 * Any month is selectable — past, current, or future — so users can jump
 * to, say, Q4 2027 to configure forward schedules, or deeper history for
 * YoY flux comparisons.
 *
 * Rendered via a portal so it escapes ancestor overflow clipping.
 *
 * Props:
 *   period         "YYYY-MM"
 *   onChange       (period: "YYYY-MM") => void
 *   knownPeriods   array of "YYYY-MM" strings with real data (green dot)
 *   statuses       [{ period, status }] from /api/period-statuses
 *   labelPrefix    short leading label, e.g. "Period", "Current", "Prior"
 *   showStatusDots  bool — false hides the tiny status row per cell (tighter)
 */
export default function PeriodPicker({
  period, onChange, knownPeriods, statuses,
  labelPrefix = "Period", showStatusDots = true,
}) {
  const [open, setOpen] = useState(false);
  const [viewYear, setViewYear] = useState(() => {
    const [y] = (period || "").split("-").map(Number);
    return y || new Date().getFullYear();
  });
  const [pos, setPos] = useState(null);
  const btnRef = useRef(null);
  const popRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const [y] = (period || "").split("-").map(Number);
    if (y) setViewYear(y);
  }, [open, period]);

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const a = btnRef.current;
      if (!a) return;
      const rect = a.getBoundingClientRect();
      const popHeight = popRef.current?.offsetHeight || 320;
      const popWidth  = popRef.current?.offsetWidth  || 300;
      const gap = 6;
      const spaceBelow = window.innerHeight - rect.bottom;
      const openUp = spaceBelow < popHeight + gap && rect.top > popHeight + gap;
      const top = openUp
        ? Math.max(8, rect.top - popHeight - gap)
        : Math.min(window.innerHeight - popHeight - 8, rect.bottom + gap);
      // Keep the popup on-screen. Prefer right-aligning to the trigger for
      // header-bar triggers; otherwise left-align.
      const wantRight = rect.right > window.innerWidth * 0.6;
      const desiredLeft = wantRight ? rect.right - popWidth : rect.left;
      const left = Math.max(8, Math.min(window.innerWidth - popWidth - 8, desiredLeft));
      setPos({ top, left });
    };
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => {
      if (popRef.current?.contains(e.target)) return;
      if (btnRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    const onKey = (e) => { if (e.key === "Escape") { e.stopPropagation(); setOpen(false); } };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open]);

  const statusMap = useMemo(() => {
    const m = new Map();
    for (const s of statuses || []) m.set(s.period, s.status);
    return m;
  }, [statuses]);

  const knownSet = useMemo(() => new Set(knownPeriods || []), [knownPeriods]);

  const now = new Date();
  const currentPeriod = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  const statusFor = (p) => statusMap.get(p) || defaultStatus(p);
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

  const pick = (y, mIdx) => {
    const p = `${y}-${String(mIdx + 1).padStart(2, "0")}`;
    onChange(p);
    setOpen(false);
  };

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className="period-picker-btn"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        {labelPrefix ? <span className="muted small">{labelPrefix}</span> : null}
        <span className="period-picker-val">{formatPeriod(period) || "—"}</span>
        <span className="period-picker-caret" aria-hidden="true">▾</span>
      </button>
      {open && createPortal(
        <div
          ref={popRef}
          className="period-picker-pop"
          style={{
            top:  pos ? `${pos.top}px`  : "-9999px",
            left: pos ? `${pos.left}px` : "-9999px",
            visibility: pos ? "visible" : "hidden",
          }}
        >
          <div className="pp-head">
            <button type="button" className="pp-nav" onClick={() => setViewYear((y) => y - 10)} title="−10 years">«</button>
            <button type="button" className="pp-nav" onClick={() => setViewYear((y) => y - 1)} title="Previous year">‹</button>
            <div className="pp-year">
              <input
                type="number"
                value={viewYear}
                onChange={(e) => {
                  const v = parseInt(e.target.value, 10);
                  if (!isNaN(v) && v >= 1900 && v <= 2999) setViewYear(v);
                }}
              />
            </div>
            <button type="button" className="pp-nav" onClick={() => setViewYear((y) => y + 1)} title="Next year">›</button>
            <button type="button" className="pp-nav" onClick={() => setViewYear((y) => y + 10)} title="+10 years">»</button>
          </div>

          <div className="pp-grid">
            {months.map((label, i) => {
              const p = `${viewYear}-${String(i + 1).padStart(2, "0")}`;
              const isSel = p === period;
              const isCurrent = p === currentPeriod;
              const st = statusFor(p);
              const hasData = knownSet.has(p);
              return (
                <button
                  key={p}
                  type="button"
                  className={`pp-cell status-period-${slugStatus(st)} ${isSel ? "selected" : ""} ${isCurrent ? "current" : ""}`}
                  onClick={() => pick(viewYear, i)}
                  title={`${label} ${viewYear} · ${st}${hasData ? " · has data" : ""}`}
                >
                  <span className="pp-cell-label">{label}</span>
                  {showStatusDots ? (
                    <span className="pp-cell-status">
                      <span className={`status-dot status-period-${slugStatus(st)}`} />
                      {st}
                    </span>
                  ) : null}
                  {hasData ? <span className="pp-cell-dot" aria-hidden="true" /> : null}
                </button>
              );
            })}
          </div>

          <div className="pp-foot">
            <button
              type="button"
              className="dp-link"
              onClick={() => {
                const p = currentPeriod;
                setViewYear(now.getFullYear());
                onChange(p);
                setOpen(false);
              }}
            >
              Today · {formatPeriod(currentPeriod)}
            </button>
            <button type="button" className="dp-link" onClick={() => setOpen(false)}>Close</button>
          </div>

          {showStatusDots && (
            <div className="pp-legend">
              <span><span className="status-dot status-period-future" />Future</span>
              <span><span className="status-dot status-period-open" />Open</span>
              <span><span className="status-dot status-period-soft-close" />Soft-Close</span>
              <span><span className="status-dot status-period-closed" />Closed</span>
              <span><span className="status-dot status-period-reopened" />Reopened</span>
            </div>
          )}
        </div>,
        document.body
      )}
    </>
  );
}

// ─── helpers (exported so other pages can reuse) ────────────────────────

export function formatPeriod(p) {
  if (!p) return "—";
  const [y, m] = p.split("-");
  const names = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return `${names[parseInt(m, 10) - 1]} ${y}`;
}

export function defaultStatus(period) {
  if (!period) return "Open";
  const now = new Date();
  const cur = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  if (period < cur) return "Closed";
  if (period === cur) return "Open";
  return "Future";
}

export function slugStatus(s) {
  return (s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-");
}
