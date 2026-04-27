// Canonical paid-hours rules for timesheet entries.
//
// Only "working" days contribute paid hours. MOB, DEMOB, partial MOB/DEMOB,
// rest days, sick, and absences must always count as 0 hours regardless of
// any time_in/time_out or stale total_hours value left on the row.
//
// Use these helpers everywhere a row total or grand total is rendered or
// transmitted (UI, PDF, customer email, billing summary).

export type TimesheetEntryLike = {
  day_type?: string | null;
  total_hours?: string | number | null;
};

const PAID_DAY_TYPES = new Set<string>(["working"]);

export function normalizeDayType(dt: string | null | undefined): string {
  return (dt ?? "").toString().trim().toLowerCase();
}

export function isPaidDay(dt: string | null | undefined): boolean {
  return PAID_DAY_TYPES.has(normalizeDayType(dt));
}

export function paidHours(entry: TimesheetEntryLike | null | undefined): number {
  if (!entry) return 0;
  if (!isPaidDay(entry.day_type)) return 0;
  const raw = entry.total_hours;
  if (raw === null || raw === undefined) return 0;
  const num = typeof raw === "number" ? raw : parseFloat(String(raw));
  return Number.isFinite(num) && num > 0 ? num : 0;
}

export function sumPaidHours(entries: ReadonlyArray<TimesheetEntryLike> | null | undefined): number {
  if (!entries) return 0;
  let total = 0;
  for (const e of entries) total += paidHours(e);
  return total;
}
