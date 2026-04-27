/**
 * Pure derivations for the Weekly Ops workflow status card.
 *
 * Lives in `shared/` so both the React component and the smoke tests can
 * import it without pulling JSX / React / lucide-react. The component in
 * `client/src/components/WeeklyOpsWorkflowCard.tsx` is the only renderer;
 * keep wording/tone changes here so the smoke test in
 * `tests/smoke/weekly-ops-workflow-card.test.ts` continues to pin them.
 *
 * Rules captured here that MUST NOT regress:
 *   • Only `sent_to_customer` and `customer_approved` are customer-facing.
 *     PM approval (with or without override) is NEVER customer-facing.
 *   • The override stage description must say the customer is NOT emailed.
 *   • The next-safe-action for any PM-approved variant tells the PM to
 *     EXPLICITLY send to the customer (no auto-send) and is BLOCKED if
 *     the project has no customer-facing emails on file.
 */

export type WorkflowCardTimesheetWeek = {
  status: string;
  submittedAt: string | null;
  pmApprovedAt: string | null;
  sentToCustomerAt: string | null;
  customerApprovedAt: string | null;
  recalledAt: string | null;
  daySupName: string | null;
  daySupTokenExists: boolean;
  daySupSubmittedAt: string | null;
  nightSupName: string | null;
  nightSupTokenExists: boolean;
  nightSupSubmittedAt: string | null;
  overrideApproval:
    | null
    | {
        at: string;
        byUserId: number | null;
        reason: string | null;
        evidence: string | null;
      };
};

export type WorkflowCardWeeklyReport = {
  id: number;
  status: string;
  sentAt: string | null;
} | null;

export type WorkflowStage =
  | "not_built"
  | "draft"
  | "awaiting_supervisor"
  | "supervisor_submitted"
  | "pm_approved"
  | "pm_approved_override"
  | "sent_to_customer"
  | "customer_approved"
  | "recalled";

export function deriveStage(
  tw: WorkflowCardTimesheetWeek | null,
  hasNightShift: boolean,
): WorkflowStage {
  if (!tw) return "not_built";
  // Recall takes precedence over the underlying status — a recalled week is
  // treated as in-flight regardless of its current row state. The recall row
  // is otherwise reset back to draft, so the marker would be lost.
  if (tw.recalledAt && tw.status !== "customer_approved") return "recalled";
  if (tw.status === "customer_approved") return "customer_approved";
  if (tw.status === "sent_to_customer") return "sent_to_customer";
  if (tw.status === "pm_approved") {
    return tw.overrideApproval ? "pm_approved_override" : "pm_approved";
  }
  if (tw.status === "submitted") return "supervisor_submitted";
  // Draft state — distinguish "supervisor links sent, awaiting submission"
  // from "completely empty draft".
  const anyTokenSent =
    tw.daySupTokenExists || (hasNightShift && tw.nightSupTokenExists);
  return anyTokenSent ? "awaiting_supervisor" : "draft";
}

// Customer-exposure boundary. The platform's hardest invariant.
export function isCustomerFacing(stage: WorkflowStage): boolean {
  return stage === "sent_to_customer" || stage === "customer_approved";
}

export type StageTone = "neutral" | "info" | "amber" | "success" | "danger";

export type StageMeta = {
  label: string;
  description: string;
  tone: StageTone;
};

export const STAGE_META: Record<WorkflowStage, StageMeta> = {
  not_built: {
    label: "Timesheet not built",
    description:
      "No timesheet week exists yet. The Sunday rebuild has not run for this project / week.",
    tone: "neutral",
  },
  draft: {
    label: "Draft — supervisor links not sent",
    description:
      "Timesheet entries are in place but no supervisor has been invited to review.",
    tone: "neutral",
  },
  awaiting_supervisor: {
    label: "Awaiting supervisor submission",
    description:
      "Supervisor link sent — waiting on the supervisor to review hours and submit.",
    tone: "info",
  },
  supervisor_submitted: {
    label: "Submitted by supervisor — needs PM review",
    description:
      "All supervisors have submitted. The PM still needs to approve before anything is sent to the customer.",
    tone: "info",
  },
  pm_approved: {
    label: "PM approved — ready to send",
    description:
      "PM has approved the hours. Customer has NOT been emailed yet.",
    tone: "success",
  },
  pm_approved_override: {
    label: "PM approved — OVERRIDE (no supervisor)",
    description:
      "Approved as a controlled exception with no supervisor submission on file. Customer has NOT been emailed.",
    tone: "amber",
  },
  sent_to_customer: {
    label: "Sent to customer — awaiting approval",
    description:
      "Timesheet has been emailed to the customer. They have not yet approved it via the signed link.",
    tone: "info",
  },
  customer_approved: {
    label: "Customer approved",
    description: "Customer has approved the timesheet via the signed link.",
    tone: "success",
  },
  recalled: {
    // Server behaviour (server/timesheet-routes.ts recall handler):
    //   • status reset to 'pm_approved' and recalled_at stamped
    //   • customer-side fields cleared: customer_token, approval_*,
    //     customer_challenge, sent_to_customer_at
    //   • pm_approved_at is RETAINED — the original PM approval timestamp is
    //     preserved for audit. The PM must still re-approve and resend.
    // The description below must reflect that, not claim a wholesale reset.
    label: "Recalled — re-approval required",
    description:
      "Week was recalled by the PM. Customer-side state cleared (token, signed approval, sent-to-customer timestamp); the original PM approval timestamp is retained for audit. PM must edit and re-approve before resending.",
    tone: "amber",
  },
};

export type NextActionTone = "info" | "warn" | "blocked" | "done";

export function deriveNextAction(
  stage: WorkflowStage,
  tw: WorkflowCardTimesheetWeek | null,
  hasNightShift: boolean,
  customerEmailsCount: number,
): { label: string; tone: NextActionTone } {
  if (stage === "not_built") {
    return {
      label:
        "Wait for the Sunday rebuild, or trigger a manual rebuild for this project / week.",
      tone: "warn",
    };
  }
  if (stage === "draft") {
    return {
      label: "Send the day supervisor link to start the review.",
      tone: "info",
    };
  }
  if (stage === "awaiting_supervisor") {
    const dayMissing = !!tw && !tw.daySupSubmittedAt;
    const nightMissing = hasNightShift && !!tw && !tw.nightSupSubmittedAt;
    const shifts = [
      dayMissing ? "day" : null,
      nightMissing ? "night" : null,
    ].filter(Boolean);
    return {
      label:
        shifts.length > 0
          ? `Waiting on the ${shifts.join(" + ")} supervisor. Resend the link if delivery has failed.`
          : "Waiting on supervisor submission.",
      tone: "info",
    };
  }
  if (stage === "supervisor_submitted") {
    return { label: "PM: review the submitted hours and approve.", tone: "info" };
  }
  if (stage === "pm_approved" || stage === "pm_approved_override") {
    if (customerEmailsCount === 0) {
      return {
        label:
          "Blocked — no customer-facing emails on the project. Add a customer PM / signatory email before sending.",
        tone: "blocked",
      };
    }
    return {
      label: "Generate & send the weekly report to the customer.",
      tone: "info",
    };
  }
  if (stage === "sent_to_customer") {
    return {
      label:
        "Waiting on customer approval via signed link. PM can recall the week if changes are needed.",
      tone: "info",
    };
  }
  if (stage === "customer_approved") {
    return { label: "Done. No further action for this week.", tone: "done" };
  }
  if (stage === "recalled") {
    return {
      label: "PM: edit the timesheet directly, then re-approve and resend.",
      tone: "warn",
    };
  }
  return { label: "—", tone: "info" };
}

export type CustomerExposureTone = "amber" | "info";

export function deriveCustomerExposure(stage: WorkflowStage): {
  label: string;
  description: string;
  tone: CustomerExposureTone;
} {
  if (stage === "customer_approved") {
    return {
      label: "Customer-facing — approved",
      description:
        "Customer has signed off. This week is visible to the customer.",
      tone: "info",
    };
  }
  if (stage === "sent_to_customer") {
    return {
      label: "Customer-facing — sent",
      description:
        "Email and signed approval link have been delivered to the customer.",
      tone: "info",
    };
  }
  // Everything else — including PM-approved (with or without override) — is
  // explicitly NOT customer-facing. We render this with the same wording PR #10
  // used in the override modal so PMs can't confuse approval with sending.
  return {
    label: "Not sent to customer",
    description:
      "Customer has not been emailed. Sending is a separate, explicit action.",
    tone: "amber",
  };
}

export type StepState =
  | "done"
  | "current"
  | "pending"
  | "blocked"
  | "skipped";

export type WorkflowStep = {
  id: string;
  label: string;
  state: StepState;
  detail?: string;
};

export function deriveSteps(
  stage: WorkflowStage,
  tw: WorkflowCardTimesheetWeek | null,
  hasNightShift: boolean,
  weeklyReport: WorkflowCardWeeklyReport,
): WorkflowStep[] {
  const steps: WorkflowStep[] = [
    { id: "built", label: "Timesheet week built", state: "pending" },
    {
      id: "day_link",
      label: "Day supervisor link sent",
      state: tw?.daySupTokenExists ? "done" : "pending",
    },
    {
      id: "day_submit",
      label: "Day supervisor submitted",
      state: tw?.daySupSubmittedAt ? "done" : "pending",
    },
  ];
  if (hasNightShift) {
    steps.push(
      {
        id: "night_link",
        label: "Night supervisor link sent",
        state: tw?.nightSupTokenExists ? "done" : "pending",
      },
      {
        id: "night_submit",
        label: "Night supervisor submitted",
        state: tw?.nightSupSubmittedAt ? "done" : "pending",
      },
    );
  } else {
    steps.push({
      id: "night_skip",
      label: "Night shift",
      state: "skipped",
      detail: "No night shift on this project / week.",
    });
  }
  steps.push(
    {
      id: "pm",
      // Recalled weeks: pm_approved_at is retained on the row but the recall
      // requires a fresh re-approval before resend. Labelling the step
      // simply "PM approved" + state=current would read as a contradiction
      // ("done but in progress"). Make the label unambiguous instead.
      label:
        stage === "pm_approved_override"
          ? "PM approved — OVERRIDE"
          : stage === "recalled"
            ? "PM re-approval required (recalled)"
            : "PM approved",
      state: tw?.pmApprovedAt ? "done" : "pending",
    },
    {
      id: "sent",
      label: "Sent to customer",
      state: tw?.sentToCustomerAt ? "done" : "pending",
    },
    {
      id: "approved",
      label: "Customer approved",
      state: tw?.customerApprovedAt ? "done" : "pending",
    },
    {
      id: "report",
      label: "Weekly report sent",
      state: weeklyReport?.sentAt ? "done" : "pending",
    },
  );

  if (tw) steps[0].state = "done";

  if (stage !== "not_built" && stage !== "recalled") {
    const firstPending = steps.findIndex((s) => s.state === "pending");
    if (firstPending >= 0) steps[firstPending].state = "current";
  }
  if (stage === "recalled") {
    const pmIdx = steps.findIndex((s) => s.id === "pm");
    if (pmIdx >= 0) steps[pmIdx].state = "current";
  }
  return steps;
}
