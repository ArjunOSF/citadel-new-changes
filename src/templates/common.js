// Shared helpers used across every reconciliation template.

export function fmtMoney(n) {
  if (n === null || n === undefined || isNaN(n)) return "0.00";
  return Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function parseNumber(s) {
  if (s === null || s === undefined || s === "") return 0;
  const n = parseFloat(String(s).replace(/[,$]/g, ""));
  return isNaN(n) ? 0 : n;
}

export function sumItems(items) {
  return (items || []).reduce((t, i) => t + (Number(i.amount) || 0), 0);
}

/**
 * Accrual sub-types per PRD §2.2.5. The schedule line items use these in the
 * `item_class` column.
 */
export const ACCRUAL_SUBTYPES = [
  "Opening",
  "CY-Accrual",
  "CY-Payment",
  "PY-Accrual",
  "PY-Payment",
];

/** Last day of a "YYYY-MM" period. Returns null on bad input. */
export function periodEndDate(period) {
  if (!period) return null;
  const [y, m] = period.split("-").map(Number);
  if (!y || !m) return null;
  return new Date(y, m, 0); // day 0 of next month = last day of current
}

/** Parse an origination value ("YYYY-MM-DD" or "MM/DD/YYYY") to a Date, else null. */
function _itemDate(iso) {
  if (!iso) return null;
  const s = String(iso);
  const mISO = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (mISO) return new Date(+mISO[1], +mISO[2] - 1, +mISO[3]);
  const mMDY = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s);
  if (mMDY) return new Date(+mMDY[3], +mMDY[1] - 1, +mMDY[2]);
  return null;
}

/** Schedule-backed templates use cumulative-through-period totals. */
const _SCHEDULE_TEMPLATES = new Set(["Accrual", "Schedule List"]);

/**
 * Effective "supporting items total" for a recon, template-aware.
 * - Accrual / Schedule List: cumulative sum of items whose origination date
 *   falls in or before the recon's period (future-scheduled rows don't count
 *   toward the current period's unidentified diff).
 * - Every other template: sum of all items (existing behaviour).
 */
export function effectiveItemsTotal(recon) {
  const items = recon?.items || [];
  if (!_SCHEDULE_TEMPLATES.has(recon?.template || "")) return sumItems(items);
  const pe = periodEndDate(recon?.period);
  if (!pe) return sumItems(items);
  let t = 0;
  for (const it of items) {
    const d = _itemDate(it.origination);
    // Items with no date behave like current-period items (count in).
    if (!d || d <= pe) t += Number(it.amount) || 0;
  }
  return t;
}

/** Is this item dated after the given period-end date? */
export function isFutureItem(item, period) {
  const pe = periodEndDate(period);
  if (!pe) return false;
  const d = _itemDate(item.origination);
  return !!(d && d > pe);
}

/**
 * Simple monthly straight-line amortization (legacy — kept for compatibility).
 * Use `amortSchedule` for the full day-based calculation.
 */
export function amortMonthly(original, totalMonths, monthsElapsed) {
  totalMonths = Math.max(1, Number(totalMonths) || 1);
  monthsElapsed = Math.min(totalMonths, Math.max(0, Number(monthsElapsed) || 0));
  const monthly = original / totalMonths;
  const amortized = monthly * monthsElapsed;
  const remaining = original - amortized;
  return { monthly, amortized, remaining };
}

/** Extract the "extra" JSON blob off a supporting_item (stored server-side as TEXT). */
export function extra(item) {
  if (!item.extra) return {};
  if (typeof item.extra === "object") return item.extra;
  try { return JSON.parse(item.extra); } catch { return {}; }
}

/** Month difference (inclusive) between two YYYY-MM periods. */
export function monthsBetween(startPeriod, currentPeriod) {
  if (!startPeriod || !currentPeriod) return 0;
  const [ys, ms] = startPeriod.split("-").map(Number);
  const [yc, mc] = currentPeriod.split("-").map(Number);
  return Math.max(0, (yc - ys) * 12 + (mc - ms) + 1);
}

// ────────────────────────────────────────────────────────────────────────────
// Amortization — day-based calculation supporting 5 methods per PRD Section 2.2.4
// ────────────────────────────────────────────────────────────────────────────

export const AMORT_METHODS = [
  { value: "straight_line",     label: "Straight Line" },
  { value: "partial",           label: "Partial" },
  { value: "catchup",           label: "Straight Line Catchup" },
  { value: "partial_catchup",   label: "Partial + Catchup" },
  { value: "manual",            label: "Manual" },
];

export const AMORT_METHOD_LABEL = Object.fromEntries(
  AMORT_METHODS.map((m) => [m.value, m.label])
);

/** Parse "YYYY-MM-DD" → Date (local midnight). Null on bad input. */
export function parseDate(iso) {
  if (!iso) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return null;
  const d = new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10));
  return isNaN(d.getTime()) ? null : d;
}

/** Inclusive day count between two Date objects. */
function daysInclusive(a, b) {
  const ms = 24 * 60 * 60 * 1000;
  const da = new Date(a.getFullYear(), a.getMonth(), a.getDate());
  const db = new Date(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.round((db - da) / ms) + 1;
}

/** First day of month. */
function startOfMonth(y, m) { return new Date(y, m, 1); }
/** Last day of month. */
function endOfMonth(y, m)   { return new Date(y, m + 1, 0); }

/**
 * Convert a "YYYY-MM" period to its last day as a Date.
 * This is the "as-of" date for a given reconciliation period.
 */
export function periodEnd(periodStr) {
  if (!periodStr) return null;
  const [y, m] = periodStr.split("-").map(Number);
  return endOfMonth(y, m - 1);
}

/** Period end as an ISO string. */
export function periodEndIso(periodStr) {
  const d = periodEnd(periodStr);
  if (!d) return null;
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function pad(n) { return String(n).padStart(2, "0"); }

/**
 * Iterate every month from startDate through endDate (inclusive), returning
 * { y, m, first, last, days } — where `days` is the count of days that fall
 * within [startDate, endDate] for that month.
 */
function monthsCovered(startDate, endDate) {
  const out = [];
  if (!startDate || !endDate || endDate < startDate) return out;
  let y = startDate.getFullYear();
  let m = startDate.getMonth();
  while (y < endDate.getFullYear() || (y === endDate.getFullYear() && m <= endDate.getMonth())) {
    const first = startOfMonth(y, m);
    const last  = endOfMonth(y, m);
    const winStart = first < startDate ? startDate : first;
    const winEnd   = last  > endDate   ? endDate   : last;
    const days = daysInclusive(winStart, winEnd);
    out.push({ y, m, first, last, days, winStart, winEnd });
    m += 1;
    if (m > 11) { m = 0; y += 1; }
  }
  return out;
}

/**
 * Build a month-by-month amortization schedule for an item.
 *
 *   startIso / endIso  — the amortization window (can start mid-month)
 *   originalAmount     — total to amortize
 *   method             — one of AMORT_METHODS.value
 *   currentPeriod      — "YYYY-MM" reconciliation period (used by *catchup methods)
 *   manualByKey        — { "YYYY-MM": amount } overrides when method === "manual"
 *
 * Returns { rows, totals } where each row is
 *   { key:"YYYY-MM", label, y, m, days, amount, cumulative, remaining, locked:false }
 * and totals = { total, scheduled, unscheduled }.
 */
export function amortSchedule({
  startIso, endIso, originalAmount,
  method = "straight_line",
  currentPeriod = null,
  manualByKey = {},
}) {
  const start = parseDate(startIso);
  const end   = parseDate(endIso);
  const total = Number(originalAmount) || 0;

  if (!start || !end || end < start || total <= 0) {
    return { rows: [], totals: { total, scheduled: 0, unscheduled: total } };
  }

  const months = monthsCovered(start, end);
  if (months.length === 0) {
    return { rows: [], totals: { total, scheduled: 0, unscheduled: total } };
  }

  // Totals in days — used by Partial / Partial+Catchup.
  const totalDays = months.reduce((s, m) => s + m.days, 0);
  const dailyRate = total / totalDays;

  // Build raw allocations per month by method.
  let amounts = [];

  if (method === "straight_line") {
    // Even split across all months in the window (ignores partial days).
    const per = total / months.length;
    amounts = months.map(() => per);
    // Force last-month rounding so sum === total exactly.
    amounts = distributeRoundingError(amounts, total);

  } else if (method === "partial") {
    // Day-based pro-rata for first/last months, rounded to 2dp.
    amounts = months.map((mo) => round2(mo.days * dailyRate));
    amounts = distributeRoundingError(amounts, total);

  } else if (method === "catchup" || method === "partial_catchup") {
    // Compute the "base" amounts (Straight Line or Partial) then collapse
    // every month that's *before* the current period into the current period.
    const base = method === "catchup"
      ? months.map(() => total / months.length)
      : months.map((mo) => mo.days * dailyRate);
    // Find the index matching currentPeriod; if not in the window, catchup
    // has no effect (treat everything as base).
    const curIdx = currentPeriod
      ? months.findIndex((mo) => monthKey(mo.y, mo.m) === currentPeriod)
      : -1;
    if (curIdx <= 0) {
      amounts = base.map(round2);
    } else {
      amounts = new Array(months.length).fill(0);
      let accum = 0;
      for (let i = 0; i <= curIdx; i++) accum += base[i];
      amounts[curIdx] = round2(accum);
      for (let i = curIdx + 1; i < months.length; i++) amounts[i] = round2(base[i]);
    }
    amounts = distributeRoundingError(amounts, total);

  } else if (method === "manual") {
    amounts = months.map((mo) => {
      const k = monthKey(mo.y, mo.m);
      const v = manualByKey[k];
      return v === undefined || v === null || v === "" ? 0 : Number(v);
    });

  } else {
    // Unknown method — fall back to straight line.
    const per = total / months.length;
    amounts = months.map(() => per);
  }

  // Build rows with running cumulative & remaining.
  let cum = 0;
  const rows = months.map((mo, i) => {
    const amount = Number(amounts[i]) || 0;
    cum += amount;
    return {
      key: monthKey(mo.y, mo.m),
      label: `${MON_SHORT[mo.m]} ${mo.y}`,
      y: mo.y, m: mo.m,
      startDate: mo.winStart, endDate: mo.winEnd,
      days: mo.days,
      amount,
      cumulative: cum,
      remaining: total - cum,
    };
  });

  const scheduled = rows.reduce((t, r) => t + r.amount, 0);
  return {
    rows,
    totals: {
      total,
      scheduled: round2(scheduled),
      unscheduled: round2(total - scheduled),
      dailyRate,
      totalDays,
    },
  };
}

/** Amortization amount for a single period "YYYY-MM". */
export function amortAmountForPeriod(opts, periodStr) {
  const { rows } = amortSchedule(opts);
  const hit = rows.find((r) => r.key === periodStr);
  return hit ? hit.amount : 0;
}

/**
 * Remaining balance as of the end of the given period.
 * Returns the original amount for periods before start, 0 for periods after end.
 */
export function amortRemainingAtPeriod(opts, periodStr) {
  const { rows, totals } = amortSchedule(opts);
  if (!rows.length) return totals.total || 0;
  // Before the schedule starts → full original.
  if (periodStr < rows[0].key) return totals.total;
  // After the schedule ends → 0.
  if (periodStr > rows[rows.length - 1].key) return 0;
  const hit = rows.find((r) => r.key === periodStr);
  return hit ? hit.remaining : totals.total;
}

function monthKey(y, m) { return `${y}-${pad(m + 1)}`; }
function round2(n) { return Math.round(Number(n) * 100) / 100; }
const MON_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

/**
 * Rounding errors from per-row round-to-2dp can make the sum drift a cent or
 * two. Absorb the drift into the last non-zero row.
 */
function distributeRoundingError(amounts, expectedTotal) {
  const a = amounts.map(round2);
  const diff = round2(expectedTotal - a.reduce((t, v) => t + v, 0));
  if (Math.abs(diff) < 0.005) return a;
  // Find last non-zero cell and absorb.
  for (let i = a.length - 1; i >= 0; i--) {
    if (a[i] !== 0) { a[i] = round2(a[i] + diff); break; }
  }
  return a;
}
