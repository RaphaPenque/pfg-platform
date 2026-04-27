/**
 * Pure helpers for weekly-report header rendering.
 *
 * Two concerns:
 *  - formatPeriod: human-readable "Period" label for the report header. The
 *    weekly report's header period IS the reporting week, not the project
 *    lifespan (the project lifespan is implicit in Project Progress below).
 *  - computeProgress: elapsed/total days + percent complete, computed against
 *    the END of the reported week (not "now"), and clamped 0–100. Returns
 *    `available: false` when project dates are missing so callers can render
 *    a neutral fallback instead of misleading numbers.
 */

const MS_PER_DAY = 86_400_000;
const MONTHS_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

function parseISODate(d: string): Date | null {
  if (!d) return null;
  const m = d.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const yr = Number(m[1]);
  const mo = Number(m[2]);
  const da = Number(m[3]);
  if (!yr || !mo || !da) return null;
  return new Date(Date.UTC(yr, mo - 1, da));
}

function fmt(d: Date): string {
  return `${d.getUTCDate()} ${MONTHS_SHORT[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/**
 * Format the Period header for a weekly report.
 *
 * Preference order:
 *   1. weekStart + weekEnd  → "20 Apr – 26 Apr 2026"
 *   2. weekStart only       → "w/c 20 Apr 2026"
 *   3. project start + end  → "12 Apr 2026 – 16 Aug 2026"
 *   4. ""                   → caller decides fallback (never blank in template)
 */
export function formatPeriod(input: {
  weekStart?: string;
  weekEnd?: string;
  projectStart?: string;
  projectEnd?: string;
}): string {
  const ws = parseISODate(input.weekStart || "");
  const we = parseISODate(input.weekEnd || "");
  if (ws && we) {
    const sameYear = ws.getUTCFullYear() === we.getUTCFullYear();
    const left = sameYear
      ? `${ws.getUTCDate()} ${MONTHS_SHORT[ws.getUTCMonth()]}`
      : fmt(ws);
    return `${left} – ${fmt(we)}`;
  }
  if (ws) return `w/c ${fmt(ws)}`;
  const ps = parseISODate(input.projectStart || "");
  const pe = parseISODate(input.projectEnd || "");
  if (ps && pe) return `${fmt(ps)} – ${fmt(pe)}`;
  return "";
}

export interface ProgressInfo {
  available: boolean;
  totalDays: number;
  elapsedDays: number;
  percent: number;
}

/**
 * Compute project progress as of the end of the reported week.
 *
 * - elapsedDays clamped to [0, totalDays]
 * - percent clamped to [0, 100], rounded to nearest integer
 * - returns { available: false } when project dates are missing/invalid;
 *   callers should hide the progress text/bar in that case.
 */
export function computeProgress(input: {
  projectStart?: string;
  projectEnd?: string;
  weekEnd?: string;
}): ProgressInfo {
  const ps = parseISODate(input.projectStart || "");
  const pe = parseISODate(input.projectEnd || "");
  if (!ps || !pe || pe.getTime() <= ps.getTime()) {
    return { available: false, totalDays: 0, elapsedDays: 0, percent: 0 };
  }
  const we = parseISODate(input.weekEnd || "") ?? new Date();
  const totalDays = Math.max(1, Math.round((pe.getTime() - ps.getTime()) / MS_PER_DAY));
  const rawElapsed = Math.round((we.getTime() - ps.getTime()) / MS_PER_DAY);
  const elapsedDays = Math.min(totalDays, Math.max(0, rawElapsed));
  const percent = Math.round((elapsedDays / totalDays) * 100);
  return { available: true, totalDays, elapsedDays, percent };
}
