/**
 * Smoke test pinning the reporting / timesheet workflow invariants
 * documented in PLATFORM_CONTEXT.md ("Reporting & Timesheet Workflow
 * Invariants" section). These are the same rules the production
 * health-check Section N enforces against live data — this file verifies
 * that the pure, in-process helpers behave the same way so a refactor
 * can't silently break the invariants between deploys.
 *
 * Run: npx tsx tests/smoke/workflow-invariants.test.ts
 */

import assert from "node:assert";
import { isPaidDay, paidHours, sumPaidHours } from "../../shared/timesheet-hours";
import { buildSenderIdentityFromPm } from "../../server/project-sender";

function section(label: string) {
  console.log(`\n${label}`);
}
function ok(label: string) {
  console.log(`  ✓ ${label}`);
}
function fail(label: string, err: unknown) {
  console.error(`  ✗ ${label}`);
  console.error(`    ${(err as any)?.message ?? err}`);
  process.exitCode = 1;
}
function check(label: string, fn: () => void) {
  try { fn(); ok(label); } catch (e) { fail(label, e); }
}

// ── Invariant 1: MOB / DEMOB are non-paid ─────────────────────────────────────
section("MOB / DEMOB non-paid invariant (mirrors health-check N1, N2)");

check("isPaidDay treats every MOB/DEMOB variant as non-paid", () => {
  assert.strictEqual(isPaidDay("mob"), false);
  assert.strictEqual(isPaidDay("demob"), false);
  assert.strictEqual(isPaidDay("partial_mob"), false);
  assert.strictEqual(isPaidDay("partial_demob"), false);
  // Any future day_type added to the schema MUST be evaluated explicitly —
  // a default-true would silently bill the customer.
  assert.strictEqual(isPaidDay("unknown_day_type"), false);
});

check("paidHours ignores stale total_hours on MOB/DEMOB rows", () => {
  // The DB may keep the old total_hours value when a row is converted from
  // 'working' to 'mob'/'demob'. The helper must not surface that as paid.
  assert.strictEqual(paidHours({ day_type: "mob", total_hours: "9" }), 0);
  assert.strictEqual(paidHours({ day_type: "demob", total_hours: 9 }), 0);
  assert.strictEqual(paidHours({ day_type: "partial_mob", total_hours: "4.5" }), 0);
  assert.strictEqual(paidHours({ day_type: "partial_demob", total_hours: 4.5 }), 0);
});

check("worker week total = sum of working days only (MOB/DEMOB excluded)", () => {
  // Mirrors the production query in health-check Section N3:
  // sum(working hours) MUST equal the row total visible to the customer.
  const week = [
    { day_type: "working", total_hours: 9 },
    { day_type: "working", total_hours: 9 },
    { day_type: "working", total_hours: 9 },
    { day_type: "working", total_hours: 9 },
    { day_type: "demob",   total_hours: 9 }, // stale 9h must be ignored
    { day_type: "rest_day", total_hours: null },
    { day_type: "rest_day", total_hours: null },
  ];
  const paid = sumPaidHours(week);
  // Customer-visible row total in the PDF/portal = paid total. If anything
  // else were used, the customer would see 45h or 54h depending on which side
  // of the bug was rendered.
  assert.strictEqual(paid, 36, `expected 36h paid, got ${paid}`);
});

// ── Invariant 2: PM sender identity (mirrors health-check N7–N9) ──────────────
section("PM sender identity invariant (mirrors health-check N8, N9)");

check("Missing PM email → no `from`, no `replyTo`; central send-as", () => {
  const id = buildSenderIdentityFromPm(null, "Some PM");
  assert.strictEqual(id.from, undefined,    "from must be undefined when no PM email");
  assert.strictEqual(id.replyTo, undefined, "replyTo must be undefined when no PM email");
});

check("Off-domain PM email → no impersonation, replyTo still routes to PM", () => {
  const id = buildSenderIdentityFromPm("ext@external.com", "Ext PM");
  assert.strictEqual(id.from, undefined,         "from must be undefined for off-domain PM");
  assert.strictEqual(id.replyTo, "ext@external.com", "replyTo must still be set so customer replies reach PM");
  assert.ok(id.warnings.some(w => w.includes("powerforce.global")), "must warn about off-domain");
});

check("@powerforce.global PM → full impersonation (from + replyTo + name)", () => {
  const id = buildSenderIdentityFromPm("pm@powerforce.global", "PM Name");
  assert.strictEqual(id.from, "pm@powerforce.global");
  assert.strictEqual(id.replyTo, "pm@powerforce.global");
  assert.strictEqual(id.fromName, "PM Name");
});

// ── Invariant 3: Documented future rule — PM 'approve without supervisor' ─────
// This rule is documented in PLATFORM_CONTEXT.md as a controlled, audited
// override that is NOT YET IMPLEMENTED. The smoke test guards the CONTRACT
// (when implemented, must require role + audit log) by failing if a
// matching endpoint quietly appears without the documented controls.
//
// Static check only: scan server/weekly-ops-routes.ts for the endpoint name.
// If the route exists, an audit-log + role gate must be visible nearby.
section("approve-without-supervisor controlled-override contract");

check("approve-without-supervisor, if implemented, has role + audit gates", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const here = path.dirname(fileURLToPath(import.meta.url));
  const wopsPath = path.resolve(here, "../../server/weekly-ops-routes.ts");
  const src = fs.readFileSync(wopsPath, "utf8");
  const idx = src.indexOf("/api/weekly-ops/approve-without-supervisor");
  if (idx < 0) {
    // Not yet implemented — pass by design.
    return;
  }
  const handler = src.slice(idx, Math.min(src.length, idx + 4000));
  assert.ok(/requireRole\s*\(\s*"admin"/.test(handler),
    "approve-without-supervisor handler must call requireRole('admin', ...)");
  assert.ok(/audit/i.test(handler),
    "approve-without-supervisor handler must write an audit log entry");
});

console.log(process.exitCode
  ? "\nFAILED — workflow invariants drifted"
  : "\nAll workflow-invariant smoke tests passed.");
