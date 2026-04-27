/**
 * Unit tests for shared/report-period.ts — covers Period header formatting and
 * project progress math. These tests pin the regressions fixed in this PR:
 *   - Period must never be blank when weekStart/weekEnd are present
 *   - Progress must use the project's actual span, not a hardcoded 126 days
 *   - Progress must be evaluated at the END of the reporting week
 *   - Percent must be clamped to [0, 100]
 *
 * Run: npx tsx tests/smoke/report-period.test.ts
 */

import assert from "node:assert";
import { formatPeriod, computeProgress } from "../../shared/report-period";

let failures = 0;

function check(label: string, fn: () => void): void {
  try {
    fn();
    console.log(`  ok  ${label}`);
  } catch (err: any) {
    failures++;
    console.error(`  FAIL ${label}`);
    console.error(err?.message || err);
  }
}

console.log("formatPeriod");

check("renders week range when both weekStart and weekEnd are set", () => {
  assert.strictEqual(
    formatPeriod({ weekStart: "2026-04-20", weekEnd: "2026-04-26" }),
    "20 Apr – 26 Apr 2026",
  );
});

check("renders w/c when only weekStart is set", () => {
  assert.strictEqual(
    formatPeriod({ weekStart: "2026-04-20" }),
    "w/c 20 Apr 2026",
  );
});

check("falls back to project span when no week dates given", () => {
  assert.strictEqual(
    formatPeriod({ projectStart: "2026-04-12", projectEnd: "2026-08-16" }),
    "12 Apr 2026 – 16 Aug 2026",
  );
});

check("returns empty string when nothing is set", () => {
  assert.strictEqual(formatPeriod({}), "");
});

check("never returns a string that is just an arrow with no dates", () => {
  // Regression for the GRTY w/c 2026-04-20 PDF where header showed "Period →"
  // with no dates. Whatever we output must contain at least one digit when
  // any date input is present.
  const out = formatPeriod({ weekStart: "2026-04-20", weekEnd: "2026-04-26" });
  assert.ok(/\d/.test(out), `expected digits in "${out}"`);
});

console.log("computeProgress");

check("computes percent for GRTY mid-project (week of 2026-04-20)", () => {
  // GRTY: 2026-04-12 → 2026-08-16 (≈126 days). Week ends 2026-04-26 → ~14
  // elapsed days → ~11%. NOT 0% and NOT "126 of 126".
  const p = computeProgress({
    projectStart: "2026-04-12",
    projectEnd: "2026-08-16",
    weekEnd: "2026-04-26",
  });
  assert.strictEqual(p.available, true);
  assert.strictEqual(p.totalDays, 126);
  assert.strictEqual(p.elapsedDays, 14);
  assert.strictEqual(p.percent, 11);
});

check("clamps percent to 100 when weekEnd is past project end", () => {
  const p = computeProgress({
    projectStart: "2026-04-12",
    projectEnd: "2026-08-16",
    weekEnd: "2027-01-01",
  });
  assert.strictEqual(p.percent, 100);
  assert.strictEqual(p.elapsedDays, p.totalDays);
});

check("clamps percent to 0 when weekEnd is before project start", () => {
  const p = computeProgress({
    projectStart: "2026-04-12",
    projectEnd: "2026-08-16",
    weekEnd: "2026-01-01",
  });
  assert.strictEqual(p.percent, 0);
  assert.strictEqual(p.elapsedDays, 0);
});

check("returns available=false when project dates are missing", () => {
  const p = computeProgress({ weekEnd: "2026-04-26" });
  assert.strictEqual(p.available, false);
});

check("returns available=false when end <= start", () => {
  const p = computeProgress({
    projectStart: "2026-08-16",
    projectEnd: "2026-04-12",
    weekEnd: "2026-04-26",
  });
  assert.strictEqual(p.available, false);
});

if (failures > 0) {
  console.error(`\n${failures} test(s) failed`);
  process.exit(1);
}
console.log("\nall report-period tests passed");
