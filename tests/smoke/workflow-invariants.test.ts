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
async function check(label: string, fn: () => void | Promise<void>) {
  try { await fn(); ok(label); } catch (e) { fail(label, e); }
}

async function main() {
// ── Invariant 1: MOB / DEMOB are non-paid ─────────────────────────────────────
section("MOB / DEMOB non-paid invariant (mirrors health-check N1, N2)");

await check("isPaidDay treats every MOB/DEMOB variant as non-paid", () => {
  assert.strictEqual(isPaidDay("mob"), false);
  assert.strictEqual(isPaidDay("demob"), false);
  assert.strictEqual(isPaidDay("partial_mob"), false);
  assert.strictEqual(isPaidDay("partial_demob"), false);
  // Any future day_type added to the schema MUST be evaluated explicitly —
  // a default-true would silently bill the customer.
  assert.strictEqual(isPaidDay("unknown_day_type"), false);
});

await check("paidHours ignores stale total_hours on MOB/DEMOB rows", () => {
  // The DB may keep the old total_hours value when a row is converted from
  // 'working' to 'mob'/'demob'. The helper must not surface that as paid.
  assert.strictEqual(paidHours({ day_type: "mob", total_hours: "9" }), 0);
  assert.strictEqual(paidHours({ day_type: "demob", total_hours: 9 }), 0);
  assert.strictEqual(paidHours({ day_type: "partial_mob", total_hours: "4.5" }), 0);
  assert.strictEqual(paidHours({ day_type: "partial_demob", total_hours: 4.5 }), 0);
});

await check("worker week total = sum of working days only (MOB/DEMOB excluded)", () => {
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

await check("Missing PM email → no `from`, no `replyTo`; central send-as", () => {
  const id = buildSenderIdentityFromPm(null, "Some PM");
  assert.strictEqual(id.from, undefined,    "from must be undefined when no PM email");
  assert.strictEqual(id.replyTo, undefined, "replyTo must be undefined when no PM email");
});

await check("Off-domain PM email → no impersonation, replyTo still routes to PM", () => {
  const id = buildSenderIdentityFromPm("ext@external.com", "Ext PM");
  assert.strictEqual(id.from, undefined,         "from must be undefined for off-domain PM");
  assert.strictEqual(id.replyTo, "ext@external.com", "replyTo must still be set so customer replies reach PM");
  assert.ok(id.warnings.some(w => w.includes("powerforce.global")), "must warn about off-domain");
});

await check("@powerforce.global PM → full impersonation (from + replyTo + name)", () => {
  const id = buildSenderIdentityFromPm("pm@powerforce.global", "PM Name");
  assert.strictEqual(id.from, "pm@powerforce.global");
  assert.strictEqual(id.replyTo, "pm@powerforce.global");
  assert.strictEqual(id.fromName, "PM Name");
});

// ── Invariant 3: PM 'approve without supervisor' controlled override ──────────
// This rule is documented in PLATFORM_CONTEXT.md. The endpoint MUST be a
// controlled exception, not a normal approval — the static checks below pin
// every gate so a refactor cannot silently weaken the override.
//
// The handler lives in server/weekly-ops-routes.ts; we scan its source rather
// than running the route to keep this a fast pure smoke test.
section("approve-without-supervisor controlled-override contract");

async function readHandler(): Promise<string | null> {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const here = path.dirname(fileURLToPath(import.meta.url));
  const wopsPath = path.resolve(here, "../../server/weekly-ops-routes.ts");
  const src = fs.readFileSync(wopsPath, "utf8");
  // Find the route REGISTRATION (app.post(...)), not the docstring mention.
  const marker = '"/api/weekly-ops/approve-without-supervisor"';
  let idx = -1;
  let from = 0;
  while (true) {
    const next = src.indexOf(marker, from);
    if (next < 0) break;
    // Walk backwards a few hundred chars and check for `app.post(`
    const context = src.slice(Math.max(0, next - 200), next);
    if (/app\.post\s*\(\s*$/.test(context)) {
      idx = next;
      break;
    }
    from = next + marker.length;
  }
  if (idx < 0) return null;
  return src.slice(idx, Math.min(src.length, idx + 8000));
}

await check("approve-without-supervisor endpoint exists and is role-gated to PM/admin/RM", async () => {
  const handler = await readHandler();
  assert.ok(handler, "approve-without-supervisor endpoint must exist in server/weekly-ops-routes.ts");
  assert.ok(/requireRole\s*\(\s*"admin"\s*,\s*"project_manager"\s*,\s*"resource_manager"\s*\)/.test(handler!),
    "must call requireRole('admin', 'project_manager', 'resource_manager') — never authenticated-only");
});

await check("override handler requires reason, evidence, and both acknowledgements", async () => {
  const handler = await readHandler();
  assert.ok(handler, "override endpoint missing");
  assert.ok(/reason/i.test(handler!), "must read a reason field from the body");
  assert.ok(/evidence/i.test(handler!), "must read an evidence field from the body");
  assert.ok(/acknowledgeNoSupervisor/.test(handler!),
    "must require acknowledgeNoSupervisor === true (explicit acknowledgement that no supervisor submitted)");
  assert.ok(/acknowledgeCustomerSendSeparate/.test(handler!),
    "must require acknowledgeCustomerSendSeparate === true (explicit acknowledgement that the customer send remains separate)");
});

await check("override handler writes an audit_logs row via storage.createAuditLog", async () => {
  const handler = await readHandler();
  assert.ok(handler, "override endpoint missing");
  assert.ok(/storage\.createAuditLog/.test(handler!),
    "override handler must call storage.createAuditLog so who/when/why is captured");
  assert.ok(/timesheet\.approve_override/.test(handler!),
    "audit log action must be 'timesheet.approve_override' for downstream filtering");
  assert.ok(/missingSupervisors/.test(handler!),
    "audit metadata must record which supervisor submission(s) were missing");
  assert.ok(/previousStatus/.test(handler!),
    "audit metadata must record the previous timesheet_week status");
});

await check("override handler refuses inappropriate states and never emails customer", async () => {
  const handler = await readHandler();
  assert.ok(handler, "override endpoint missing");
  // Status guard — only draft/submitted may be overridden. The handler builds
  // an explicit allow-set so the guard is auditable in source.
  assert.ok(/allowedFrom/.test(handler!) && /draft/.test(handler!) && /submitted/.test(handler!),
    "override must restrict source statuses to draft / submitted (not pm_approved, sent_to_customer, customer_approved, recalled)");
  // No email — the override is approval-only.
  assert.ok(!/sendMail\s*\(/.test(handler!),
    "override handler must NOT call sendMail — customer send remains a separate action");
});

}

main().then(() => {
  console.log(process.exitCode
    ? "\nFAILED — workflow invariants drifted"
    : "\nAll workflow-invariant smoke tests passed.");
}).catch((e) => {
  console.error("\nworkflow invariants runner crashed:", e);
  process.exit(1);
});
