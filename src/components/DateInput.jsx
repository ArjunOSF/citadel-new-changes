import React, { useEffect, useRef, useState, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import {
  formatDate as fmtDate,
  displayToIso,
  toIso,
  autoSlash,
  formatMask,
  onDateFormatChange,
} from "../lib/format.js";

/**
 * DateInput — a hybrid date control.
 *   • Typable  : accepts MM/DD/YYYY (or M/D/YYYY) while editing. Validates on blur.
 *   • Pickable : a calendar button opens a month-navigable popup.
 *
 * Value is always stored as ISO (YYYY-MM-DD) via onChange. Display is MM/DD/YYYY.
 * When `value` is an empty string the field is blank.
 *
 * Props:
 *   value       : "YYYY-MM-DD" | ""                  — ISO format
 *   onChange    : (iso: string) => void
 *   placeholder : string                              — default "MM/DD/YYYY"
 *   disabled    : boolean
 *   className   : extra classes for the wrapper
 *   required    : boolean (for form submission)
 */
export default function DateInput({
  value = "",
  onChange,
  placeholder,
  disabled = false,
  className = "",
  required = false,
  inputRef,
  small = false,
}) {
  const [typing, setTyping]   = useState(() => fmtDate(value));
  const [popOpen, setPopOpen] = useState(false);
  const [mask, setMask]       = useState(formatMask);
  const wrap   = useRef(null);

  // Keep displayed string in sync when the external value changes.
  useEffect(() => { setTyping(fmtDate(value)); }, [value]);

  // If Admin changes the date format while this field is on screen, re-render
  // with the new mask + display.
  useEffect(() => {
    return onDateFormatChange(() => {
      setMask(formatMask());
      setTyping(fmtDate(value));
    });
  }, [value]);

  // Outside-click/Escape handling for the portaled popup lives inside
  // CalendarPopup itself so it can see both the anchor and the popup node.

  const commitTyping = () => {
    const iso = displayToIso(typing);
    if (iso === null) {
      // invalid — snap back to the last good value
      setTyping(fmtDate(value));
    } else if (iso !== value) {
      onChange?.(iso);
    }
  };

  return (
    <div ref={wrap} className={`date-input-wrap ${className}`}>
      <input
        ref={inputRef}
        className={`form-input date-input-field ${small ? "small" : ""}`}
        type="text"
        inputMode="numeric"
        placeholder={placeholder || mask}
        value={typing}
        disabled={disabled}
        required={required}
        onChange={(e) => setTyping(autoSlash(e.target.value))}
        onBlur={commitTyping}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); commitTyping(); }
          if (e.key === "Escape") { setTyping(fmtDate(value)); e.currentTarget.blur(); }
        }}
      />
      <button
        type="button"
        className="date-input-btn"
        disabled={disabled}
        onClick={() => setPopOpen((o) => !o)}
        aria-label="Open calendar"
        tabIndex={-1}
      >
        📅
      </button>
      {popOpen && (
        <CalendarPopup
          anchor={wrap}
          value={value}
          onPick={(iso) => { onChange?.(iso); setPopOpen(false); }}
          onClose={() => setPopOpen(false)}
        />
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Calendar popup
// ──────────────────────────────────────────────────────────────────────────

function CalendarPopup({ anchor, value, onPick, onClose }) {
  const initial = parseIso(value) || new Date();
  const [view, setView] = useState({ y: initial.getFullYear(), m: initial.getMonth() });
  // Position anchored to the input's viewport rect — renders via portal so it's
  // never clipped by a scrolling modal body.
  const [pos, setPos] = useState(null);
  const popRef = useRef(null);

  useLayoutEffect(() => {
    const place = () => {
      const a = anchor?.current;
      if (!a) return;
      const rect = a.getBoundingClientRect();
      const popHeight = popRef.current?.offsetHeight || 320;
      const popWidth  = popRef.current?.offsetWidth  || 280;
      const gap = 6;
      const spaceBelow = window.innerHeight - rect.bottom;
      const openUp = spaceBelow < popHeight + gap && rect.top > popHeight + gap;
      const top = openUp
        ? Math.max(8, rect.top - popHeight - gap)
        : Math.min(window.innerHeight - popHeight - 8, rect.bottom + gap);
      const left = Math.max(8, Math.min(window.innerWidth - popWidth - 8, rect.left));
      setPos({ top, left });
    };
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [anchor]);

  // Outside-click / Escape handling (was on the wrap in the parent; the popup
  // now lives outside so we re-home the listeners here).
  useEffect(() => {
    const onDoc = (e) => {
      if (popRef.current?.contains(e.target)) return;
      if (anchor?.current?.contains(e.target)) return;
      onClose?.();
    };
    const onKey = (e) => {
      if (e.key === "Escape") { e.stopPropagation(); onClose?.(); }
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [anchor, onClose]);

  const today = new Date();
  const selected = parseIso(value);

  const daysInMonth = new Date(view.y, view.m + 1, 0).getDate();
  const firstDow    = new Date(view.y, view.m, 1).getDay(); // 0 = Sun

  // Build the 6x7 grid of day numbers (null for filler cells).
  const cells = [];
  for (let i = 0; i < firstDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);
  while (cells.length < 42) cells.push(null);

  const stepMonth = (delta) => {
    let m = view.m + delta, y = view.y;
    while (m < 0)  { m += 12; y -= 1; }
    while (m > 11) { m -= 12; y += 1; }
    setView({ y, m });
  };

  return createPortal(
    <div
      ref={popRef}
      className="date-picker-pop"
      style={{
        top:  pos ? `${pos.top}px`  : "-9999px",
        left: pos ? `${pos.left}px` : "-9999px",
        // Hide the popup for one frame until we've measured its real height,
        // so the flip-above-on-bottom logic doesn't flash in the wrong spot.
        visibility: pos ? "visible" : "hidden",
      }}
    >
      <div className="dp-head">
        <button type="button" className="dp-nav" onClick={() => stepMonth(-12)}>«</button>
        <button type="button" className="dp-nav" onClick={() => stepMonth(-1)}>‹</button>
        <div className="dp-title">
          <select
            className="dp-select"
            value={view.m}
            onChange={(e) => setView({ ...view, m: parseInt(e.target.value, 10) })}
          >
            {MONTHS.map((mn, idx) => <option key={mn} value={idx}>{mn}</option>)}
          </select>
          <input
            className="dp-year"
            type="number"
            value={view.y}
            onChange={(e) => {
              const v = parseInt(e.target.value, 10);
              if (!isNaN(v) && v >= 1900 && v <= 2999) setView({ ...view, y: v });
            }}
          />
        </div>
        <button type="button" className="dp-nav" onClick={() => stepMonth(1)}>›</button>
        <button type="button" className="dp-nav" onClick={() => stepMonth(12)}>»</button>
      </div>

      <div className="dp-dow">
        {DOW.map((d) => <div key={d} className="dp-dow-cell">{d}</div>)}
      </div>
      <div className="dp-grid">
        {cells.map((d, i) => {
          if (d === null) return <div key={i} className="dp-cell empty" />;
          const isToday = sameDay(today, view.y, view.m, d);
          const isSel   = selected && sameDay(selected, view.y, view.m, d);
          return (
            <button
              key={i}
              type="button"
              className={`dp-cell ${isSel ? "selected" : ""} ${isToday ? "today" : ""}`}
              onClick={() => onPick(fmtIso(view.y, view.m, d))}
            >
              {d}
            </button>
          );
        })}
      </div>
      <div className="dp-foot">
        <button
          type="button"
          className="dp-link"
          onClick={() => {
            const n = new Date();
            onPick(fmtIso(n.getFullYear(), n.getMonth(), n.getDate()));
          }}
        >
          Today
        </button>
        <button type="button" className="dp-link muted" onClick={() => onPick("")}>Clear</button>
        <button type="button" className="dp-link" onClick={onClose}>Close</button>
      </div>
    </div>,
    document.body
  );
}

const MONTHS = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December",
];
const DOW = ["Su","Mo","Tu","We","Th","Fr","Sa"];

// ──────────────────────────────────────────────────────────────────────────
// Helpers — exported so others can reuse the formatting logic
// ──────────────────────────────────────────────────────────────────────────

/** Back-compat shim → delegates to the app-wide format helper.
 *  Historically this produced "MM/DD/YYYY"; now it produces whatever the
 *  user has chosen in Settings. */
export function isoToMDY(iso) {
  return fmtDate(iso);
}

/** Back-compat shim → delegates to displayToIso. Accepts any supported
 *  display format the user could have typed. */
export function mdyToIso(s) {
  const r = displayToIso(s);
  return r; // "" for empty, null for invalid, "YYYY-MM-DD" otherwise
}

/** Parse ISO into a local Date. Returns null if invalid. */
export function parseIso(iso) {
  if (!iso) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return null;
  return new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10));
}

/** "YYYY-MM-DD" string for the given y/m/d (m is 0-based). */
function fmtIso(y, m, d) {
  return `${y}-${pad(m + 1)}-${pad(d)}`;
}
function pad(n) { return String(n).padStart(2, "0"); }
function sameDay(date, y, m, d) {
  return date.getFullYear() === y && date.getMonth() === m && date.getDate() === d;
}

/* autoSlash moved to src/lib/format.js so it can respect the user's chosen
 * date format. Imported at the top of this file. */
