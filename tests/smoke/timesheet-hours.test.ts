/**
 * Smoke test for timesheet paid-hours helpers.
 * Verifies that MOB and DEMOB days never contribute paid hours regardless
 * of any stale time_in/time_out/total_hours value left on the row.
 *
 * Run: npx tsx tests/smoke/timesheet-hours.test.ts
 */

import assert from "node:assert";
import { isPaidDay, paidHours, sumPaidHours } from "../../shared/timesheet-hours";

function workEntry(hours: number) {
  return { day_type: "working", total_hours: String(hours) } as const;
}
function demobEntry(staleHours: number | null) {
  return { day_type: "demob", total_hours: staleHours === null ? null : String(staleHours) } as const;
}
function mobEntry(staleHours: number | null) {
  return { day_type: "mob", total_hours: staleHours === null ? null : String(staleHours) } as const;
}
function restEntry() {
  return { day_type: "rest_day", total_hours: null } as const;
}

// 1. isPaidDay
assert.strictEqual(isPaidDay("working"), true, "working is paid");
assert.strictEqual(isPaidDay("WORKING"), true, "case-insensitive");
assert.strictEqual(isPaidDay(" working "), true, "trims whitespace");
assert.strictEqual(isPaidDay("mob"), false, "mob is not paid");
assert.strictEqual(isPaidDay("demob"), false, "demob is not paid");
assert.strictEqual(isPaidDay("partial_mob"), false, "partial_mob is not paid");
assert.strictEqual(isPaidDay("partial_demob"), false, "partial_demob is not paid");
assert.strictEqual(isPaidDay("rest_day"), false, "rest_day is not paid");
assert.strictEqual(isPaidDay("absent_sick"), false, "absent_sick is not paid");
assert.strictEqual(isPaidDay("absent_unauthorised"), false, "absent is not paid");
assert.strictEqual(isPaidDay(null), false, "null is not paid");
assert.strictEqual(isPaidDay(undefined), false, "undefined is not paid");

// 2. paidHours respects day_type
assert.strictEqual(paidHours(workEntry(9)), 9, "working entry returns total_hours");
assert.strictEqual(paidHours(demobEntry(9)), 0, "demob entry returns 0 even if total_hours=9 (stale)");
assert.strictEqual(paidHours(mobEntry(9)), 0, "mob entry returns 0 even if total_hours=9 (stale)");
assert.strictEqual(paidHours(demobEntry(null)), 0, "demob with null returns 0");
assert.strictEqual(paidHours(restEntry()), 0, "rest_day returns 0");
assert.strictEqual(paidHours(workEntry(10)), 10, "10h night shift returns 10");
assert.strictEqual(paidHours(null), 0, "null entry returns 0");

// 3. Reported scenario: Goran Banjavcic — Mon-Thu Work 9.0h + Fri DEMOB + Sat/Sun Rest = 36.0h
const goran = [
  workEntry(9), workEntry(9), workEntry(9), workEntry(9), // Mon–Thu
  demobEntry(9), // Fri DEMOB — stale 9h must be ignored
  restEntry(), restEntry(), // Sat–Sun
];
assert.strictEqual(sumPaidHours(goran), 36, "4 Work@9h + 1 DEMOB + 2 Rest = 36h (was 54h before fix)");

// 4. MOB-only day = 0
const justMob = [mobEntry(9)];
assert.strictEqual(sumPaidHours(justMob), 0, "single MOB day = 0h");

// 5. Normal 6 Work days @ 9h still totals 54h
const sixWork = [
  workEntry(9), workEntry(9), workEntry(9),
  workEntry(9), workEntry(9), workEntry(9),
  restEntry(),
];
assert.strictEqual(sumPaidHours(sixWork), 54, "6 Work days @ 9h = 54h");

// 6. Night-shift workers @ 10h unaffected
const nightShift = [
  workEntry(10), workEntry(10), workEntry(10), workEntry(10),
  workEntry(10), workEntry(10), restEntry(),
];
assert.strictEqual(sumPaidHours(nightShift), 60, "6 Night shifts @ 10h = 60h");

// 7. Mixed week with DEMOB mid-week
const midWeekDemob = [
  workEntry(9), workEntry(9), workEntry(9), // Mon–Wed
  demobEntry(9), // Thu DEMOB
  restEntry(), restEntry(), restEntry(), // Fri–Sun
];
assert.strictEqual(sumPaidHours(midWeekDemob), 27, "3 Work@9h + 1 DEMOB + 3 Rest = 27h");

// 8. Numeric (not string) total_hours is also handled (DB drivers can return either)
assert.strictEqual(paidHours({ day_type: "working", total_hours: 9 }), 9, "numeric total_hours");
assert.strictEqual(paidHours({ day_type: "demob", total_hours: 9 }), 0, "numeric total_hours on demob = 0");

// 9. sumPaidHours on undefined/empty
assert.strictEqual(sumPaidHours(undefined), 0, "undefined entries = 0");
assert.strictEqual(sumPaidHours([]), 0, "empty entries = 0");

console.log("✓ timesheet-hours: all 25 assertions passed");
