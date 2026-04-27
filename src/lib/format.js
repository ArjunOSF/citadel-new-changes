// ─────────────────────────────────────────────────────────────────────
// Date format handling — app-wide setting, read from the backend once at
// startup and stored here as module-level state. Components call
// formatDate(value) / parseDate(str) without needing to pass the format
// through the tree.
// ─────────────────────────────────────────────────────────────────────

/** One of "MM-DD-YYYY" | "DD-MM-YYYY" | "YYYY-MM-DD". */
let _dateFormat = "MM-DD-YYYY";

/** Optional subscribers so downstream components can re-render when Admin
 *  changes the format in Settings without a page reload. */
const _listeners = new Set();

export function setDateFormat(fmt) {
  if (!fmt) return;
  if (fmt !== _dateFormat) {
    _dateFormat = fmt;
    for (const fn of _listeners) { try { fn(fmt); } catch {} }
  }
}

export function getDateFormat() { return _dateFormat; }

export function onDateFormatChange(fn) {
  _listeners.add(fn);
  return () => _listeners.delete(fn);
}

/** Placeholder / mask text for inputs ("MM/DD/YYYY" etc). Uses slashes for
 *  display even though the setting uses dashes — slashes are familiar and
 *  date inputs historically use them. */
export function formatMask() {
  return _dateFormat.replace(/-/g, "/");
}

// ─── parsers / formatters ────────────────────────────────────────────

/** Parse ANY supported input (ISO 'YYYY-MM-DD', MM/DD/YYYY, DD/MM/YYYY,
 *  Date) to a plain { y, m, d } object or null. */
function _parseAny(value) {
  if (!value) return null;
  if (value instanceof Date) {
    return isNaN(value.getTime()) ? null : {
      y: value.getFullYear(), m: value.getMonth() + 1, d: value.getDate(),
    };
  }
  const s = String(value).trim();
  // ISO YYYY-MM-DD (possibly with time appended)
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (m) return { y: +m[1], m: +m[2], d: +m[3] };
  // Common display formats using either / or - as separator
  const parts = s.split(/[\/-]/);
  if (parts.length === 3) {
    // Try to disambiguate: the format that puts a 4-digit year is ISO-ish.
    if (parts[0].length === 4) return { y: +parts[0], m: +parts[1], d: +parts[2] };
    if (parts[2].length === 4) {
      // Could be MM/DD/YYYY or DD/MM/YYYY — pick per current setting unless
      // one of the first two clearly can't be a month (>12).
      const a = +parts[0], b = +parts[1];
      if (a > 12 && b <= 12) return { y: +parts[2], m: b, d: a };
      if (b > 12 && a <= 12) return { y: +parts[2], m: a, d: b };
      if (_dateFormat === "DD-MM-YYYY") return { y: +parts[2], m: b, d: a };
      return { y: +parts[2], m: a, d: b };     // default MM-DD-YYYY
    }
  }
  return null;
}

/** Parse a value and return a Date (local midnight) or null. */
export function parseDate(value) {
  const p = _parseAny(value);
  if (!p) return null;
  if (!p.y || !p.m || !p.d) return null;
  if (p.m < 1 || p.m > 12 || p.d < 1 || p.d > 31) return null;
  const d = new Date(p.y, p.m - 1, p.d);
  if (d.getFullYear() !== p.y || d.getMonth() !== p.m - 1 || d.getDate() !== p.d) return null;
  return d;
}

/** Render a value (ISO string, display string, or Date) using the current
 *  app-wide date format. Returns "" for null/empty. */
export function formatDate(value) {
  const p = _parseAny(value);
  if (!p) return "";
  const pad = (n) => String(n).padStart(2, "0");
  const m = pad(p.m), d = pad(p.d), y = String(p.y).padStart(4, "0");
  if (_dateFormat === "DD-MM-YYYY") return `${d}/${m}/${y}`;
  if (_dateFormat === "YYYY-MM-DD") return `${y}-${m}-${d}`;
  return `${m}/${d}/${y}`;            // default MM/DD/YYYY
}

/** Canonical ISO "YYYY-MM-DD" string (or "" if input invalid). Useful when
 *  you need a format-agnostic value to store. */
export function toIso(value) {
  const p = _parseAny(value);
  if (!p) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${String(p.y).padStart(4, "0")}-${pad(p.m)}-${pad(p.d)}`;
}

/** Parse a display-formatted string (e.g. what the DateInput field holds)
 *  back to ISO. Returns "" for empty, null for invalid. */
export function displayToIso(s) {
  if (!s || !s.trim()) return "";
  const d = parseDate(s);
  if (!d) return null;
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Auto-insert slashes as the user types digits (e.g. "04302026" → "04/30/2026").
 *  Uses the current format to decide slash positions. */
export function autoSlash(raw) {
  let s = (raw || "").replace(/[^\d/]/g, "");
  s = s.replace(/\/{2,}/g, "/");
  if (!s.includes("/")) {
    // MM-DD-YYYY and DD-MM-YYYY both use DD/DD/YYYY visual — position is same.
    if (_dateFormat === "YYYY-MM-DD") {
      if (s.length > 6) s = s.slice(0, 4) + "/" + s.slice(4, 6) + "/" + s.slice(6, 8);
      else if (s.length > 4) s = s.slice(0, 4) + "/" + s.slice(4);
      return s.slice(0, 10);
    }
    if (s.length > 4) s = s.slice(0, 2) + "/" + s.slice(2, 4) + "/" + s.slice(4, 8);
    else if (s.length > 2) s = s.slice(0, 2) + "/" + s.slice(2);
  }
  return s.slice(0, 10);
}
