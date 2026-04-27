import {
  CheckCircle2,
  Circle,
  Clock,
  ShieldAlert,
  Send,
  AlertTriangle,
  Lock,
  EyeOff,
  Mail,
  XCircle,
  RefreshCw,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  deriveStage,
  deriveNextAction,
  deriveCustomerExposure,
  deriveSteps,
  isCustomerFacing,
  STAGE_META,
  type WorkflowCardTimesheetWeek,
  type WorkflowCardWeeklyReport,
  type StageTone,
  type NextActionTone,
  type CustomerExposureTone,
  type StepState,
} from "@shared/weekly-ops-workflow";

export type WorkflowCardProps = {
  projectCode: string;
  projectName: string;
  weekCommencing: string;
  weekEnding: string;
  timesheetWeek: WorkflowCardTimesheetWeek | null;
  hasNightShift: boolean;
  dayAssignments: number;
  nightAssignments: number;
  customerEmailsCount: number;
  weeklyReport: WorkflowCardWeeklyReport;
};

// ─── tone → tailwind helpers ────────────────────────────────────────────────
// Color is supplemented by an icon and explicit text so a11y users do not
// rely on hue alone.

const TONE_CHIP: Record<StageTone, string> = {
  neutral: "border-gray-300 bg-gray-50 text-gray-800",
  info: "border-blue-300 bg-blue-50 text-blue-800",
  amber: "border-amber-500 bg-amber-50 text-amber-900",
  success: "border-green-300 bg-green-50 text-green-800",
  danger: "border-red-300 bg-red-50 text-red-800",
};

const NEXT_ACTION_CHIP: Record<NextActionTone, string> = {
  info: "border-blue-300 bg-blue-50 text-blue-900",
  warn: "border-amber-400 bg-amber-50 text-amber-900",
  blocked: "border-red-300 bg-red-50 text-red-900",
  done: "border-green-300 bg-green-50 text-green-900",
};

const CUSTOMER_CHIP: Record<CustomerExposureTone, string> = {
  amber: "border-amber-400 bg-amber-50 text-amber-900",
  info: "border-blue-300 bg-blue-50 text-blue-900",
};

function StepIcon({ state }: { state: StepState }) {
  if (state === "done")
    return <CheckCircle2 className="w-4 h-4 text-green-600 shrink-0" aria-hidden />;
  if (state === "current")
    return <Clock className="w-4 h-4 text-blue-600 shrink-0" aria-hidden />;
  if (state === "blocked")
    return <XCircle className="w-4 h-4 text-red-600 shrink-0" aria-hidden />;
  if (state === "skipped")
    return <Circle className="w-4 h-4 text-pfg-steel/50 shrink-0" aria-hidden />;
  return <Circle className="w-4 h-4 text-pfg-steel shrink-0" aria-hidden />;
}

function StepLabel({ state, label }: { state: StepState; label: string }) {
  // Screen readers get the explicit state — sighted users see icon + text.
  // We never rely on color alone (a11y rule documented in PR scope).
  const srState =
    state === "done"
      ? "completed"
      : state === "current"
        ? "in progress"
        : state === "blocked"
          ? "blocked"
          : state === "skipped"
            ? "not applicable"
            : "pending";
  return (
    <span
      className={
        state === "skipped"
          ? "text-pfg-steel/70 line-through"
          : state === "current"
            ? "text-pfg-navy font-medium"
            : "text-pfg-navy"
      }
    >
      <span className="sr-only">[{srState}] </span>
      {label}
    </span>
  );
}

function fmtDate(d?: string | null) {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      timeZone: "UTC",
    });
  } catch {
    return String(d);
  }
}

export default function WeeklyOpsWorkflowCard(props: WorkflowCardProps) {
  const {
    projectCode,
    projectName,
    weekCommencing,
    weekEnding,
    timesheetWeek: tw,
    hasNightShift,
    dayAssignments,
    nightAssignments,
    customerEmailsCount,
    weeklyReport,
  } = props;

  const stage = deriveStage(tw, hasNightShift);
  const meta = STAGE_META[stage];
  const next = deriveNextAction(stage, tw, hasNightShift, customerEmailsCount);
  const exposure = deriveCustomerExposure(stage);
  const steps = deriveSteps(stage, tw, hasNightShift, weeklyReport);

  const ExposureIcon = isCustomerFacing(stage) ? Mail : EyeOff;
  const isOverride = stage === "pm_approved_override";
  const isRecalled = stage === "recalled";

  return (
    <Card className="p-4" data-testid="weekly-ops-workflow-card">
      {/* Header: stage chip, project, week */}
      <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <div className="text-xs uppercase tracking-wider text-pfg-steel mb-1">
            Workflow stage
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge
              variant="outline"
              className={`${TONE_CHIP[meta.tone]} text-sm font-semibold`}
              data-testid="workflow-stage-badge"
              data-stage={stage}
            >
              {meta.label}
            </Badge>
            {isOverride && (
              <Badge
                variant="outline"
                className="border-amber-500 bg-amber-50 text-amber-800"
                data-testid="workflow-override-badge"
              >
                <ShieldAlert className="w-3 h-3 mr-1" aria-hidden />
                Override approval
              </Badge>
            )}
            {isRecalled && (
              <Badge
                variant="outline"
                className="border-amber-500 bg-amber-50 text-amber-800"
                data-testid="workflow-recalled-badge"
              >
                <RefreshCw className="w-3 h-3 mr-1" aria-hidden />
                Recalled
              </Badge>
            )}
          </div>
          <p className="text-xs text-pfg-steel mt-1">{meta.description}</p>
        </div>
        <div className="text-xs text-pfg-steel md:text-right shrink-0">
          <div>
            <span className="font-semibold text-pfg-navy">{projectName}</span> (
            {projectCode})
          </div>
          <div>
            w/c <span className="font-medium">{fmtDate(weekCommencing)}</span> –{" "}
            <span className="font-medium">{fmtDate(weekEnding)}</span>
          </div>
          <div>
            Day shift: {dayAssignments}
            {hasNightShift ? ` · Night shift: ${nightAssignments}` : ""}
          </div>
        </div>
      </div>

      {/* Customer-exposure boundary — always visible, prominent */}
      <div
        className={`mt-3 rounded-md border px-3 py-2 flex items-start gap-2 text-sm ${CUSTOMER_CHIP[exposure.tone]}`}
        data-testid="workflow-customer-exposure"
        data-customer-facing={isCustomerFacing(stage) ? "true" : "false"}
      >
        <ExposureIcon className="w-4 h-4 mt-0.5 shrink-0" aria-hidden />
        <div>
          <div className="font-semibold">{exposure.label}</div>
          <div className="text-xs">{exposure.description}</div>
        </div>
      </div>

      {/* Override evidence summary — only when applicable */}
      {isOverride && tw?.overrideApproval && (
        <div
          className="mt-3 rounded-md border border-amber-400 bg-amber-50 px-3 py-2 text-sm text-amber-900"
          data-testid="workflow-override-evidence"
        >
          <div className="flex items-start gap-2">
            <ShieldAlert className="w-4 h-4 mt-0.5 shrink-0" aria-hidden />
            <div className="min-w-0">
              <div className="font-semibold">Override approval — audit summary</div>
              <div className="text-xs mt-1 break-words">
                <span className="font-medium">Reason:</span>{" "}
                {tw.overrideApproval.reason || "—"}
              </div>
              <div className="text-xs break-words">
                <span className="font-medium">Evidence:</span>{" "}
                {tw.overrideApproval.evidence || "—"}
              </div>
              <div className="text-[11px] mt-1 italic">
                Approved as a controlled exception with no supervisor submission. Customer
                has not been emailed; sending remains a separate action.
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Next safe action — concise, single line */}
      <div
        className={`mt-3 rounded-md border px-3 py-2 flex items-start gap-2 text-sm ${NEXT_ACTION_CHIP[next.tone]}`}
        data-testid="workflow-next-action"
        data-tone={next.tone}
      >
        {next.tone === "blocked" ? (
          <Lock className="w-4 h-4 mt-0.5 shrink-0" aria-hidden />
        ) : next.tone === "warn" ? (
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" aria-hidden />
        ) : next.tone === "done" ? (
          <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" aria-hidden />
        ) : (
          <Send className="w-4 h-4 mt-0.5 shrink-0" aria-hidden />
        )}
        <div>
          <div className="text-[11px] uppercase tracking-wider font-semibold">
            {next.tone === "blocked"
              ? "Blocked"
              : next.tone === "done"
                ? "Complete"
                : "Next safe action"}
          </div>
          <div>{next.label}</div>
        </div>
      </div>

      {/* Compact step list */}
      <div className="mt-3">
        <div className="text-xs uppercase tracking-wider text-pfg-steel mb-2">
          Progress
        </div>
        <ol
          className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5 text-sm"
          data-testid="workflow-progress-list"
        >
          {steps.map((s) => (
            <li
              key={s.id}
              className="flex items-start gap-2"
              data-testid={`workflow-step-${s.id}`}
              data-step-state={s.state}
            >
              <StepIcon state={s.state} />
              <div className="min-w-0">
                <StepLabel state={s.state} label={s.label} />
                {s.detail && (
                  <div className="text-xs text-pfg-steel">{s.detail}</div>
                )}
              </div>
            </li>
          ))}
        </ol>
      </div>
    </Card>
  );
}
