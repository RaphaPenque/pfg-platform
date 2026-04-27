/**
 * Smoke test for the WeeklyOpsWorkflowCard helpers.
 *
 * The card's stage, next-safe-action, and customer-exposure derivations are
 * pure functions exported from the component module. We verify each branch
 * here so the wording and the customer-send boundary cannot drift between
 * deploys without surfacing a test failure.
 *
 * In particular: the override stage (`pm_approved_override`) must NEVER be
 * classified as customer-facing, and its description / next-safe-action must
 * keep the wording introduced in PR #10 ("customer send remains separate").
 *
 * Run: npx tsx tests/smoke/weekly-ops-workflow-card.test.ts
 */

import assert from "node:assert";
import {
  deriveStage,
  deriveNextAction,
  deriveCustomerExposure,
  deriveSteps,
  isCustomerFacing,
  STAGE_META,
  type WorkflowCardTimesheetWeek,
} from "../../shared/weekly-ops-workflow";

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
  try {
    await fn();
    ok(label);
  } catch (e) {
    fail(label, e);
  }
}

// Convenience builder — the card only reads the fields below. Defaults match
// a brand-new draft week.
function tw(overrides: Partial<WorkflowCardTimesheetWeek> = {}): WorkflowCardTimesheetWeek {
  return {
    status: "draft",
    submittedAt: null,
    pmApprovedAt: null,
    sentToCustomerAt: null,
    customerApprovedAt: null,
    recalledAt: null,
    daySupName: null,
    daySupTokenExists: false,
    daySupSubmittedAt: null,
    nightSupName: null,
    nightSupTokenExists: false,
    nightSupSubmittedAt: null,
    overrideApproval: null,
    ...overrides,
  };
}

async function main() {
// ── Invariant 1: stage derivation covers every status the server can emit ────
section("Stage derivation");

await check("null timesheet week → not_built", () => {
  assert.strictEqual(deriveStage(null, false), "not_built");
});

await check("draft + no tokens → draft", () => {
  assert.strictEqual(deriveStage(tw(), false), "draft");
});

await check("draft + day token issued → awaiting_supervisor", () => {
  assert.strictEqual(
    deriveStage(tw({ daySupTokenExists: true }), false),
    "awaiting_supervisor",
  );
});

await check("submitted → supervisor_submitted", () => {
  assert.strictEqual(
    deriveStage(tw({ status: "submitted", submittedAt: "2026-04-26" }), false),
    "supervisor_submitted",
  );
});

await check("pm_approved without override → pm_approved", () => {
  assert.strictEqual(
    deriveStage(
      tw({ status: "pm_approved", pmApprovedAt: "2026-04-27" }),
      false,
    ),
    "pm_approved",
  );
});

await check("pm_approved + overrideApproval set → pm_approved_override", () => {
  assert.strictEqual(
    deriveStage(
      tw({
        status: "pm_approved",
        pmApprovedAt: "2026-04-27",
        overrideApproval: {
          at: "2026-04-27T10:00:00Z",
          byUserId: 1,
          reason: "Supervisor unreachable",
          evidence: "INC-1042",
        },
      }),
      false,
    ),
    "pm_approved_override",
  );
});

await check("sent_to_customer → sent_to_customer", () => {
  assert.strictEqual(
    deriveStage(
      tw({ status: "sent_to_customer", sentToCustomerAt: "2026-04-27" }),
      false,
    ),
    "sent_to_customer",
  );
});

await check("customer_approved → customer_approved (recall does not override final)", () => {
  // A customer-approved week should NEVER appear as recalled — once the
  // customer has signed off, the recall workflow is closed out.
  assert.strictEqual(
    deriveStage(
      tw({
        status: "customer_approved",
        customerApprovedAt: "2026-04-28",
        recalledAt: "2026-04-26",
      }),
      false,
    ),
    "customer_approved",
  );
});

await check("recalled marker on draft row → recalled", () => {
  assert.strictEqual(
    deriveStage(tw({ status: "draft", recalledAt: "2026-04-27" }), false),
    "recalled",
  );
});

// ── Invariant 2: customer-exposure boundary ──────────────────────────────────
// The platform's hardest rule — only sent_to_customer and customer_approved
// are customer-facing. Override approval MUST NOT cross this line.
section("Customer-exposure boundary (PR #10 contract)");

await check("only sent_to_customer + customer_approved are customer-facing", () => {
  for (const stage of Object.keys(STAGE_META) as (keyof typeof STAGE_META)[]) {
    const expected = stage === "sent_to_customer" || stage === "customer_approved";
    assert.strictEqual(
      isCustomerFacing(stage),
      expected,
      `stage ${stage} customer-facing should be ${expected}`,
    );
  }
});

await check("override approval is NEVER customer-facing", () => {
  assert.strictEqual(isCustomerFacing("pm_approved_override"), false);
  const exposure = deriveCustomerExposure("pm_approved_override");
  assert.strictEqual(exposure.label, "Not sent to customer");
  assert.match(exposure.description, /separate, explicit action/i);
});

await check("PM-approved (normal) is NEVER customer-facing — must show 'Not sent to customer'", () => {
  // Plain pm_approved is the same boundary — PR #10 introduced the override,
  // but the underlying invariant has always been "PM approval ≠ customer send".
  assert.strictEqual(isCustomerFacing("pm_approved"), false);
  const exposure = deriveCustomerExposure("pm_approved");
  assert.strictEqual(exposure.label, "Not sent to customer");
});

await check("sent_to_customer is customer-facing with 'sent' wording", () => {
  const exposure = deriveCustomerExposure("sent_to_customer");
  assert.match(exposure.label, /Customer-facing/);
  assert.strictEqual(isCustomerFacing("sent_to_customer"), true);
});

// ── Invariant 3: override stage wording reinforces no-customer-send ──────────
section("Override stage wording");

await check("override stage description must mention customer is NOT emailed", () => {
  const meta = STAGE_META.pm_approved_override;
  assert.match(meta.label, /OVERRIDE/i);
  // Wording must explicitly re-state the boundary so a PM glancing at the
  // card cannot mistake the override for a customer send. The exact phrase
  // is pinned: changing this is a deliberate workflow change.
  assert.match(meta.description, /Customer has NOT been emailed/);
});

await check("override stage tone is amber (visually distinct from green pm_approved)", () => {
  assert.strictEqual(STAGE_META.pm_approved_override.tone, "amber");
  assert.strictEqual(STAGE_META.pm_approved.tone, "success");
});

// ── Invariant 4: next safe action ────────────────────────────────────────────
section("Next safe action");

await check("not_built → warn to wait for / trigger Sunday rebuild", () => {
  const next = deriveNextAction("not_built", null, false, 1);
  assert.strictEqual(next.tone, "warn");
  assert.match(next.label, /Sunday rebuild/);
});

await check("pm_approved with no customer emails → blocked", () => {
  const next = deriveNextAction(
    "pm_approved",
    tw({ status: "pm_approved", pmApprovedAt: "2026-04-27" }),
    false,
    0, // <-- no customer emails on file
  );
  assert.strictEqual(next.tone, "blocked");
  assert.match(next.label, /no customer-facing emails/i);
});

await check("pm_approved with customer emails → info, send report", () => {
  const next = deriveNextAction(
    "pm_approved",
    tw({ status: "pm_approved", pmApprovedAt: "2026-04-27" }),
    false,
    2,
  );
  assert.strictEqual(next.tone, "info");
  assert.match(next.label, /Generate & send/);
});

await check("pm_approved_override with customer emails → still 'send', NOT auto-sent", () => {
  // The override does not auto-send. The next-safe-action must still tell
  // the operator to explicitly send the report. PR #10 contract.
  const next = deriveNextAction(
    "pm_approved_override",
    tw({
      status: "pm_approved",
      pmApprovedAt: "2026-04-27",
      overrideApproval: {
        at: "2026-04-27T10:00:00Z",
        byUserId: 1,
        reason: "Supervisor unreachable for >48h",
        evidence: "INC-1042",
      },
    }),
    false,
    2,
  );
  assert.strictEqual(next.tone, "info");
  assert.match(next.label, /Generate & send/);
});

await check("customer_approved → done", () => {
  const next = deriveNextAction(
    "customer_approved",
    tw({
      status: "customer_approved",
      customerApprovedAt: "2026-04-28",
    }),
    false,
    1,
  );
  assert.strictEqual(next.tone, "done");
});

await check("recalled → warn, instruct PM to edit + re-approve", () => {
  const next = deriveNextAction(
    "recalled",
    tw({ status: "draft", recalledAt: "2026-04-27" }),
    false,
    1,
  );
  assert.strictEqual(next.tone, "warn");
  assert.match(next.label, /edit the timesheet|re-approve/i);
});

// ── Invariant 5: progress steps respect override + customer boundary ─────────
section("Progress steps");

await check("override approval marks PM step as done with OVERRIDE label", () => {
  const steps = deriveSteps(
    "pm_approved_override",
    tw({
      status: "pm_approved",
      pmApprovedAt: "2026-04-27",
      overrideApproval: {
        at: "2026-04-27T10:00:00Z",
        byUserId: 1,
        reason: "x",
        evidence: "y",
      },
    }),
    false,
    null,
  );
  const pm = steps.find((s) => s.id === "pm");
  assert.ok(pm, "pm step must exist");
  assert.strictEqual(pm!.state, "done");
  assert.match(pm!.label, /OVERRIDE/);
  // Customer-facing steps must still be pending — the override does NOT
  // advance the customer-side state.
  const sent = steps.find((s) => s.id === "sent");
  assert.ok(sent && sent.state !== "done", "sent-to-customer must NOT be done after override");
});

await check("night shift skipped when project has no night assignments", () => {
  const steps = deriveSteps("draft", tw(), false, null);
  const skip = steps.find((s) => s.id === "night_skip");
  assert.ok(skip, "night_skip step must exist for day-only weeks");
  assert.strictEqual(skip!.state, "skipped");
  assert.ok(!steps.find((s) => s.id === "night_link"));
});

await check("night shift steps included when hasNightShift=true", () => {
  const steps = deriveSteps("draft", tw(), true, null);
  assert.ok(steps.find((s) => s.id === "night_link"));
  assert.ok(steps.find((s) => s.id === "night_submit"));
  assert.ok(!steps.find((s) => s.id === "night_skip"));
});

await check("first pending step is marked 'current' when work is in flight", () => {
  const steps = deriveSteps(
    "supervisor_submitted",
    tw({
      status: "submitted",
      submittedAt: "2026-04-26",
      daySupTokenExists: true,
      daySupSubmittedAt: "2026-04-26",
    }),
    false,
    null,
  );
  // Built, day-link, day-submit all done → next pending step (PM) is current.
  const pm = steps.find((s) => s.id === "pm");
  assert.strictEqual(pm!.state, "current");
});

// ── Invariant 6: recalled PM-step regression must be unambiguous ─────────────
// On recall the server retains pm_approved_at (audit trail) but resets
// customer-side state. The card must regress the PM step to `current` AND
// label it so a viewer cannot mistake it for "already approved".
section("Recalled PM-step regression");

await check("recalled stage regresses PM step to current and labels it as re-approval required", () => {
  const steps = deriveSteps(
    "recalled",
    tw({
      // Server post-recall row state: status reset to pm_approved,
      // recalled_at stamped, sent_to_customer_at cleared, pm_approved_at
      // retained.
      status: "pm_approved",
      pmApprovedAt: "2026-04-20T09:00:00Z",
      recalledAt: "2026-04-27T11:00:00Z",
      sentToCustomerAt: null,
    }),
    false,
    null,
  );
  const pm = steps.find((s) => s.id === "pm");
  assert.ok(pm, "pm step must exist");
  assert.strictEqual(
    pm!.state,
    "current",
    "PM step must regress to current on recall regardless of pmApprovedAt",
  );
  assert.doesNotMatch(
    pm!.label,
    /^PM approved$/,
    "PM step label must NOT read simply 'PM approved' on a recalled week",
  );
  assert.match(
    pm!.label,
    /recall|re-approval/i,
    "PM step label must indicate recall / re-approval required",
  );
  // Customer-side steps must be pending — recall clears them server-side.
  const sent = steps.find((s) => s.id === "sent");
  assert.strictEqual(sent!.state, "pending");
});

await check("recalled stage description reflects retained pm_approved_at and cleared customer state", () => {
  const meta = STAGE_META.recalled;
  // Description must NOT claim wholesale clearing of timestamps — server
  // retains pm_approved_at on recall.
  assert.doesNotMatch(
    meta.description,
    /^Week was recalled by the PM\. Timestamps cleared/,
    "Old wording overstated the reset — must reflect server behaviour",
  );
  assert.match(
    meta.description,
    /retained|audit/i,
    "Description must note PM approval timestamp is retained for audit",
  );
  assert.match(
    meta.description,
    /customer/i,
    "Description must mention customer-side state is cleared",
  );
});

// ── Invariant 7: override path is still blocked when no customer emails ──────
// PR #10 contract: pm_approved_override must NOT bypass the customer-email
// guard. The override only relaxes the supervisor requirement; it does not
// authorise sending to a project that has no customer-facing recipient.
section("Override path respects customer-email block");

await check("pm_approved_override with zero customer emails → blocked (override does not bypass send guard)", () => {
  const next = deriveNextAction(
    "pm_approved_override",
    tw({
      status: "pm_approved",
      pmApprovedAt: "2026-04-27",
      overrideApproval: {
        at: "2026-04-27T10:00:00Z",
        byUserId: 1,
        reason: "Supervisor unreachable for >48h",
        evidence: "INC-1042",
      },
    }),
    false,
    0, // <-- no customer-facing emails on file
  );
  assert.strictEqual(
    next.tone,
    "blocked",
    "override path must still hit the blocked tone when no customer emails are on file",
  );
  assert.match(next.label, /no customer-facing emails/i);
});

}

main()
  .then(() => {
    console.log(
      process.exitCode
        ? "\nFAILED — workflow card invariants drifted"
        : "\nAll WeeklyOpsWorkflowCard smoke tests passed.",
    );
  })
  .catch((e) => {
    console.error("\nweekly-ops-workflow-card runner crashed:", e);
    process.exit(1);
  });
