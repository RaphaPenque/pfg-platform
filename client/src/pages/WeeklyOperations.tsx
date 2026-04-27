import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, RefreshCw, Send, FileText, AlertTriangle, CheckCircle2, Clock, XCircle, Info, Eye, ExternalLink, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

// ─── helpers ────────────────────────────────────────────────────────────────

function isoDate(d: Date): string {
  return d.toISOString().substring(0, 10);
}

/** Monday of the week containing `date` (UTC). */
function weekMonday(date: Date): Date {
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  const day = d.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diff);
  return d;
}

function shiftWeek(weekCommencing: string, weeks: number): string {
  const d = new Date(weekCommencing + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + weeks * 7);
  return isoDate(d);
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

function fmtDateTime(d?: string | null) {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Europe/London",
    });
  } catch {
    return String(d);
  }
}

// ─── types ──────────────────────────────────────────────────────────────────

type ProjectSummary = {
  id: number;
  code: string;
  name: string;
  customer: string | null;
  status: string;
};

type WeeklyOpsStatus = {
  ok: true;
  appUrl: string;
  project: {
    id: number;
    code: string;
    name: string;
    customer: string | null;
    status: string;
    shift: string | null;
    startDate: string | null;
    endDate: string | null;
    customerProjectManager: string | null;
    customerProjectManagerEmail: string | null;
    siteManager: string | null;
    siteManagerEmail: string | null;
    timesheetSignatoryName: string | null;
    timesheetSignatoryEmail: string | null;
    sourcingContactEmail: string | null;
    portalAccessToken: string | null;
    previewPortalUrl: string | null;
    draftPdfUrl: string | null;
  };
  pm: { id: number; name: string; email: string } | null;
  weekCommencing: string;
  weekEnding: string;
  timesheetWeek: null | {
    id: number;
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
    hasBillingPdf: boolean;
    hasTimesheetPdf: boolean;
    customerTokenExists: boolean;
    customerTokenExpiresAt: string | null;
  };
  entries: { count: number; workers: number; totalHours: number };
  assignments: { day: number; night: number; total: number; hasNightShift: boolean };
  weeklyReport: null | {
    id: number;
    status: string; // "draft" | "published"
    sentAt: string | null;
    hasPdf: boolean;
    hasAggregatedData: boolean;
  };
  dailyReportsPublished: number;
  warnings: { code: string; level: "warn" | "info" | "block"; message: string }[];
  headline: string;
};

// ─── component ──────────────────────────────────────────────────────────────

export default function WeeklyOperations() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const [projectId, setProjectId] = useState<number | null>(null);
  const [weekCommencing, setWeekCommencing] = useState<string>(() =>
    isoDate(weekMonday(new Date(Date.now() - 24 * 60 * 60 * 1000))),
  );
  const [confirmAction, setConfirmAction] = useState<null | {
    kind: "resend_day" | "resend_night" | "generate_report";
    title: string;
    description: string;
    confirmLabel: string;
    onConfirm: () => void;
  }>(null);

  // 1. project list (also gives us defaultWeekCommencing)
  const projectsQuery = useQuery<{ ok: true; defaultWeekCommencing: string; projects: ProjectSummary[] }>({
    queryKey: ["/api/weekly-ops/projects"],
  });

  // Pick a sensible default project once list loads — prefer GRTY, else first.
  useEffect(() => {
    if (projectId !== null) return;
    const list = projectsQuery.data?.projects;
    if (!list || list.length === 0) return;
    const grty = list.find((p) => p.code === "GRTY");
    setProjectId((grty || list[0]).id);
  }, [projectsQuery.data, projectId]);

  // 2. status for selected project + week
  const statusQuery = useQuery<WeeklyOpsStatus>({
    queryKey: ["/api/weekly-ops/status", projectId, weekCommencing],
    queryFn: async () => {
      const url = `/api/weekly-ops/status?projectId=${projectId}&weekCommencing=${weekCommencing}`;
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
      return res.json();
    },
    enabled: projectId !== null,
  });

  const status = statusQuery.data;

  // ── mutations ─────────────────────────────────────────────────────────────

  const resendMutation = useMutation({
    mutationFn: async (shift: "day" | "night") => {
      const res = await apiRequest("POST", "/api/weekly-ops/resend-supervisor-link", {
        projectId,
        weekCommencing,
        shift,
      });
      return res.json();
    },
    onSuccess: (data: any, shift) => {
      toast({
        title: `${shift === "day" ? "Day" : "Night"} supervisor link sent`,
        description: data.supervisorEmail
          ? `Sent to ${data.supervisorName} (${data.supervisorEmail}).`
          : `Sent to ${data.supervisorName}.`,
      });
      qc.invalidateQueries({ queryKey: ["/api/weekly-ops/status", projectId, weekCommencing] });
    },
    onError: (err: any) => {
      toast({ title: "Failed to resend supervisor link", description: err.message, variant: "destructive" });
    },
  });

  const generateMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/weekly-ops/generate-weekly-report", {
        projectId,
        confirmSendToCustomer: true,
      });
      return res.json();
    },
    onSuccess: () => {
      toast({
        title: "Weekly report generated",
        description: "Report PDF generated and emailed to customer contacts.",
      });
      qc.invalidateQueries({ queryKey: ["/api/weekly-ops/status", projectId, weekCommencing] });
    },
    onError: (err: any) => {
      toast({ title: "Failed to generate weekly report", description: err.message, variant: "destructive" });
    },
  });

  const previewMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/weekly-ops/generate-weekly-report-preview", {
        projectId,
        weekCommencing,
      });
      return res.json();
    },
    onSuccess: (data: any) => {
      toast({
        title: "Preview generated (no email sent)",
        description:
          data.message ||
          `Draft weekly report saved for w/c ${data.weeklyReport?.weekCommencing || weekCommencing}.`,
      });
      qc.invalidateQueries({ queryKey: ["/api/weekly-ops/status", projectId, weekCommencing] });
      // Open preview portal in a new tab so PM can inspect what the customer would see
      if (data?.previewPortalUrl) {
        window.open(data.previewPortalUrl, "_blank", "noopener,noreferrer");
      }
    },
    onError: (err: any) => {
      toast({ title: "Failed to generate preview", description: err.message, variant: "destructive" });
    },
  });

  // ── derived state for buttons ────────────────────────────────────────────

  const tw = status?.timesheetWeek;
  const hasNightShift = !!status?.assignments.hasNightShift;
  const customerEmails = useMemo(() => {
    if (!status) return [] as string[];
    return [
      status.project.timesheetSignatoryEmail,
      status.project.customerProjectManagerEmail,
      status.project.siteManagerEmail,
      status.project.sourcingContactEmail,
    ].filter((e): e is string => !!e);
  }, [status]);

  // ── confirmation handlers ────────────────────────────────────────────────

  const askResend = (shift: "day" | "night") => {
    if (!status) return;
    setConfirmAction({
      kind: shift === "day" ? "resend_day" : "resend_night",
      title: `Resend ${shift === "day" ? "Day" : "Night"} Supervisor Link?`,
      description:
        `A new ${shift} shift review link will be generated and emailed to the assigned supervisor for ` +
        `${status.project.name} (${status.project.code}), week commencing ${fmtDate(status.weekCommencing)}. ` +
        `This invalidates any previously sent link.`,
      confirmLabel: "Send link",
      onConfirm: () => resendMutation.mutate(shift),
    });
  };

  const askGenerate = () => {
    if (!status) return;
    setConfirmAction({
      kind: "generate_report",
      title: "Generate & Send Weekly Report?",
      description:
        `This will generate the weekly report PDF for ${status.project.name} ` +
        `(${status.project.code}) — week commencing ${fmtDate(status.weekCommencing)} ` +
        `— and EMAIL it to the customer contacts: ${customerEmails.join(", ") || "(none on file — send will be skipped)"}.`,
      confirmLabel: "Generate & send to customer",
      onConfirm: () => generateMutation.mutate(),
    });
  };

  // ── render ───────────────────────────────────────────────────────────────

  return (
    <div className="py-2" data-testid="weekly-ops-page">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-semibold text-pfg-navy">Weekly Operations</h1>
          <p className="text-sm text-pfg-steel">
            Sunday/Monday workflow — visibility and manual triggers per project &amp; week.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => statusQuery.refetch()}
          data-testid="weekly-ops-refresh"
        >
          <RefreshCw className="w-4 h-4 mr-1.5" />
          Refresh status
        </Button>
      </div>

      {/* Selectors */}
      <Card className="p-4 mb-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="text-xs font-medium text-pfg-steel uppercase tracking-wider mb-1 block">
              Project
            </label>
            <select
              className="w-full border rounded-md px-3 py-2 text-sm bg-white"
              value={projectId ?? ""}
              onChange={(e) => setProjectId(e.target.value ? parseInt(e.target.value, 10) : null)}
              data-testid="weekly-ops-project-select"
              disabled={projectsQuery.isLoading}
            >
              {projectsQuery.data?.projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.code} — {p.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-pfg-steel uppercase tracking-wider mb-1 block">
              Week commencing (Mon)
            </label>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setWeekCommencing(shiftWeek(weekCommencing, -1))}
                data-testid="weekly-ops-prev-week"
              >
                ‹ Prev
              </Button>
              <input
                type="date"
                className="flex-1 border rounded-md px-3 py-1.5 text-sm bg-white"
                value={weekCommencing}
                onChange={(e) => setWeekCommencing(e.target.value || weekCommencing)}
                data-testid="weekly-ops-week-input"
              />
              <Button
                variant="outline"
                size="sm"
                onClick={() => setWeekCommencing(shiftWeek(weekCommencing, 1))}
                data-testid="weekly-ops-next-week"
              >
                Next ›
              </Button>
            </div>
          </div>
          <div className="flex items-end">
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                setWeekCommencing(isoDate(weekMonday(new Date(Date.now() - 24 * 60 * 60 * 1000))))
              }
              data-testid="weekly-ops-last-completed-week"
            >
              Jump to last completed week
            </Button>
          </div>
        </div>
      </Card>

      {/* Loading / error */}
      {statusQuery.isLoading && (
        <div className="flex items-center gap-2 text-pfg-steel py-8 justify-center">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading status…
        </div>
      )}
      {statusQuery.isError && (
        <Card className="p-4 border-red-200 bg-red-50">
          <div className="text-sm text-red-700" data-testid="weekly-ops-error">
            Failed to load status: {(statusQuery.error as any)?.message || "unknown error"}
          </div>
        </Card>
      )}

      {/* Body */}
      {status && (
        <div className="space-y-4">
          {/* Headline + project meta */}
          <Card className="p-4" data-testid="weekly-ops-headline">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-xs uppercase tracking-wider text-pfg-steel mb-1">Status</div>
                <div className="text-lg font-semibold text-pfg-navy" data-testid="weekly-ops-headline-text">
                  {status.headline}
                </div>
                <div className="text-sm text-pfg-steel mt-1">
                  {status.project.name} ({status.project.code}) — w/c{" "}
                  <span className="font-medium">{fmtDate(status.weekCommencing)}</span> to{" "}
                  <span className="font-medium">{fmtDate(status.weekEnding)}</span>
                </div>
              </div>
              <div className="text-right text-xs text-pfg-steel">
                <div>
                  <span className="font-semibold text-pfg-navy">PM:</span>{" "}
                  {status.pm ? `${status.pm.name} (${status.pm.email})` : "Not set"}
                </div>
                <div>
                  <span className="font-semibold text-pfg-navy">Customer:</span>{" "}
                  {status.project.customer || "—"}
                </div>
                <div>
                  <span className="font-semibold text-pfg-navy">Customer PM:</span>{" "}
                  {status.project.customerProjectManager || "—"}
                  {status.project.customerProjectManagerEmail
                    ? ` <${status.project.customerProjectManagerEmail}>`
                    : ""}
                </div>
              </div>
            </div>
          </Card>

          {/* Warnings */}
          {status.warnings.length > 0 && (
            <Card className="p-4" data-testid="weekly-ops-warnings">
              <div className="text-xs uppercase tracking-wider text-pfg-steel mb-2">Warnings</div>
              <ul className="space-y-1.5">
                {status.warnings.map((w) => (
                  <li
                    key={w.code}
                    className="flex items-start gap-2 text-sm"
                    data-testid={`warning-${w.code}`}
                  >
                    {w.level === "block" ? (
                      <XCircle className="w-4 h-4 text-red-600 mt-0.5 shrink-0" />
                    ) : w.level === "warn" ? (
                      <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
                    ) : (
                      <Info className="w-4 h-4 text-blue-600 mt-0.5 shrink-0" />
                    )}
                    <span>{w.message}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {/* Workflow timeline */}
          <Card className="p-4" data-testid="weekly-ops-timeline">
            <div className="text-xs uppercase tracking-wider text-pfg-steel mb-3">
              Weekly checklist
            </div>
            <ol className="space-y-2 text-sm">
              <TimelineRow
                ok={!!tw}
                label="Timesheet week built"
                detail={
                  tw
                    ? `id #${tw.id} · status ${tw.status}`
                    : "Not built — Sunday job did not run for this project/week."
                }
                testId="step-tw-built"
              />
              <TimelineRow
                ok={!!tw?.daySupTokenExists}
                label="Day supervisor link sent"
                detail={
                  tw?.daySupName
                    ? `${tw.daySupName}${tw.daySupTokenExists ? " — token issued" : ""}`
                    : "No day supervisor token on file."
                }
                testId="step-day-token"
              />
              <TimelineRow
                ok={!!tw?.daySupSubmittedAt}
                label="Day supervisor submitted"
                detail={tw?.daySupSubmittedAt ? fmtDateTime(tw.daySupSubmittedAt) : "Not submitted yet."}
                testId="step-day-submitted"
              />
              {hasNightShift && (
                <>
                  <TimelineRow
                    ok={!!tw?.nightSupTokenExists}
                    label="Night supervisor link sent"
                    detail={
                      tw?.nightSupName
                        ? `${tw.nightSupName}${tw.nightSupTokenExists ? " — token issued" : ""}`
                        : "No night supervisor token on file."
                    }
                    testId="step-night-token"
                  />
                  <TimelineRow
                    ok={!!tw?.nightSupSubmittedAt}
                    label="Night supervisor submitted"
                    detail={
                      tw?.nightSupSubmittedAt ? fmtDateTime(tw.nightSupSubmittedAt) : "Not submitted yet."
                    }
                    testId="step-night-submitted"
                  />
                </>
              )}
              <TimelineRow
                ok={!!tw?.pmApprovedAt}
                label="PM approved"
                detail={tw?.pmApprovedAt ? fmtDateTime(tw.pmApprovedAt) : "Not approved yet."}
                testId="step-pm-approved"
              />
              <TimelineRow
                ok={!!tw?.sentToCustomerAt}
                label="Sent to customer"
                detail={tw?.sentToCustomerAt ? fmtDateTime(tw.sentToCustomerAt) : "Not sent."}
                testId="step-sent-customer"
              />
              <TimelineRow
                ok={!!tw?.customerApprovedAt}
                label="Customer approved"
                detail={tw?.customerApprovedAt ? fmtDateTime(tw.customerApprovedAt) : "Not approved."}
                testId="step-customer-approved"
              />
              <TimelineRow
                ok={!!status.weeklyReport?.sentAt}
                label="Weekly report generated &amp; sent"
                detail={
                  status.weeklyReport?.sentAt
                    ? `Sent ${fmtDateTime(status.weeklyReport.sentAt)} (status: ${status.weeklyReport.status})`
                    : status.weeklyReport
                    ? status.weeklyReport.status === "draft"
                      ? `Draft preview exists (id ${status.weeklyReport.id}) — not sent to customer.`
                      : `Report row exists (id ${status.weeklyReport.id}, status: ${status.weeklyReport.status}) but not sent.`
                    : "No weekly report row yet."
                }
                testId="step-weekly-report"
              />
            </ol>
          </Card>

          {/* Stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard label="Timesheet entries" value={status.entries.count} testId="stat-entries" />
            <StatCard label="Workers covered" value={status.entries.workers} testId="stat-workers" />
            <StatCard
              label="Total hours"
              value={Number(status.entries.totalHours || 0).toFixed(1)}
              testId="stat-hours"
            />
            <StatCard
              label="Daily reports published"
              value={status.dailyReportsPublished}
              testId="stat-daily-reports"
            />
          </div>

          {/* Draft report panel — explicit, obvious access to the current draft */}
          {(() => {
            const wr = status.weeklyReport;
            const hasDraft = !!(wr && wr.status === "draft");
            const hasPublished = !!(wr && wr.status === "published");
            const portalToken = status.project.portalAccessToken;
            const previewUrl = status.project.previewPortalUrl;
            const draftPdfUrl = status.project.draftPdfUrl;

            return (
              <Card className="p-4" data-testid="weekly-ops-draft-panel">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-xs uppercase tracking-wider text-pfg-steel">
                    Draft weekly report
                  </div>
                  <Badge
                    variant="outline"
                    className={
                      hasDraft
                        ? "border-amber-300 bg-amber-50 text-amber-800"
                        : hasPublished
                        ? "border-green-300 bg-green-50 text-green-800"
                        : "border-gray-300 bg-gray-50 text-gray-700"
                    }
                    data-testid="draft-status-badge"
                  >
                    {hasDraft
                      ? "Draft ready for review"
                      : hasPublished
                      ? "Published — already sent"
                      : "No draft yet"}
                  </Badge>
                </div>

                {!portalToken && (
                  <div
                    className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 mb-2"
                    data-testid="draft-no-portal-token-warning"
                  >
                    <strong>Portal access token missing.</strong> Drafts cannot be previewed or
                    downloaded until a portal token is issued for this project. Open the project
                    settings to generate one.
                  </div>
                )}

                {portalToken && hasDraft && (
                  <div className="flex flex-wrap gap-2" data-testid="draft-actions">
                    <Button
                      variant="default"
                      size="sm"
                      onClick={() => {
                        if (previewUrl) window.open(previewUrl, "_blank", "noopener,noreferrer");
                      }}
                      disabled={!previewUrl}
                      data-testid="action-open-draft-preview"
                      className="bg-pfg-navy text-white hover:bg-pfg-navy/90"
                    >
                      <ExternalLink className="w-4 h-4 mr-1.5" />
                      Open draft preview
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        if (draftPdfUrl) window.open(draftPdfUrl, "_blank", "noopener,noreferrer");
                      }}
                      disabled={!draftPdfUrl}
                      data-testid="action-download-draft-pdf"
                    >
                      <Download className="w-4 h-4 mr-1.5" />
                      Download draft PDF
                    </Button>
                  </div>
                )}

                {portalToken && !hasDraft && !hasPublished && (
                  <div
                    className="text-xs text-pfg-steel"
                    data-testid="draft-helper-no-draft"
                  >
                    No draft has been generated for this week yet. Use{" "}
                    <strong>Generate preview (no email)</strong> below to build a draft you can
                    review on the portal before sending to the customer.
                  </div>
                )}

                {portalToken && hasPublished && (
                  <div
                    className="text-xs text-pfg-steel"
                    data-testid="draft-helper-published"
                  >
                    The weekly report for this week was already published and emailed to the
                    customer. To make further changes, regenerate the preview — that will overwrite
                    the published row with a fresh draft.
                  </div>
                )}
              </Card>
            );
          })()}

          {/* Actions */}
          <Card className="p-4" data-testid="weekly-ops-actions">
            <div className="text-xs uppercase tracking-wider text-pfg-steel mb-2">Manual actions</div>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={!tw || resendMutation.isPending}
                onClick={() => askResend("day")}
                data-testid="action-resend-day"
              >
                <Send className="w-4 h-4 mr-1.5" />
                {tw?.daySupTokenExists ? "Resend day supervisor link" : "Send day supervisor link"}
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={!tw || !hasNightShift || resendMutation.isPending}
                onClick={() => askResend("night")}
                data-testid="action-resend-night"
              >
                <Send className="w-4 h-4 mr-1.5" />
                {tw?.nightSupTokenExists ? "Resend night supervisor link" : "Send night supervisor link"}
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={previewMutation.isPending || generateMutation.isPending}
                onClick={() => previewMutation.mutate()}
                data-testid="action-generate-preview-report"
                title="Generate a draft report PDF and portal preview for this week — does NOT email the customer."
              >
                {previewMutation.isPending ? (
                  <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
                ) : (
                  <Eye className="w-4 h-4 mr-1.5" />
                )}
                Generate preview (no email)
              </Button>
              <Button
                variant="default"
                size="sm"
                disabled={generateMutation.isPending || customerEmails.length === 0}
                onClick={askGenerate}
                data-testid="action-generate-weekly-report"
                className="bg-pfg-navy text-white hover:bg-pfg-navy/90"
              >
                <FileText className="w-4 h-4 mr-1.5" />
                Generate &amp; send weekly report
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => statusQuery.refetch()}
                data-testid="action-refresh"
              >
                <RefreshCw className="w-4 h-4 mr-1.5" />
                Refresh
              </Button>
            </div>

            <div className="mt-3 text-xs text-pfg-steel space-y-1">
              <div>
                <strong>Resend supervisor link</strong> generates a fresh token and emails it to the
                first Superintendent / Foreman matching the selected shift on this project. Any
                previous link becomes invalid.
              </div>
              <div>
                <strong>Generate preview (no email)</strong> builds the report PDF and saves a{" "}
                <em>draft</em> weekly_reports row for the selected week. No emails are sent and
                customers cannot see drafts on the live portal. The preview portal opens in a new
                tab for internal review — you can also re-open it any time from the{" "}
                <em>Draft weekly report</em> panel above.
              </div>
              <div>
                <strong>Generate &amp; send weekly report</strong> calls the existing report pipeline.
                It builds the PDF and emails customer contacts. A confirmation step lists every
                recipient before anything is sent.
              </div>
              {!hasNightShift && (
                <div className="italic">No night shift assignments found for this project/week — night actions disabled.</div>
              )}
              {customerEmails.length === 0 && (
                <div className="text-amber-700">
                  No customer-facing emails on this project — the weekly report send is disabled.
                </div>
              )}
            </div>
          </Card>
        </div>
      )}

      {/* Confirmation dialog */}
      <AlertDialog open={!!confirmAction} onOpenChange={(open) => !open && setConfirmAction(null)}>
        <AlertDialogContent data-testid="weekly-ops-confirm-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>{confirmAction?.title}</AlertDialogTitle>
            <AlertDialogDescription>{confirmAction?.description}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="weekly-ops-confirm-cancel">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                confirmAction?.onConfirm();
                setConfirmAction(null);
              }}
              data-testid="weekly-ops-confirm-action"
            >
              {confirmAction?.confirmLabel}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ─── small subcomponents ────────────────────────────────────────────────────

function TimelineRow({
  ok,
  label,
  detail,
  testId,
}: {
  ok: boolean;
  label: string;
  detail: string;
  testId?: string;
}) {
  return (
    <li className="flex items-start gap-2" data-testid={testId}>
      {ok ? (
        <CheckCircle2 className="w-4 h-4 text-green-600 mt-0.5 shrink-0" />
      ) : (
        <Clock className="w-4 h-4 text-pfg-steel mt-0.5 shrink-0" />
      )}
      <div>
        <div className="font-medium text-pfg-navy">{label}</div>
        <div className="text-xs text-pfg-steel">{detail}</div>
      </div>
    </li>
  );
}

function StatCard({ label, value, testId }: { label: string; value: string | number; testId?: string }) {
  return (
    <Card className="p-3" data-testid={testId}>
      <div className="text-xs uppercase tracking-wider text-pfg-steel">{label}</div>
      <div className="text-lg font-semibold text-pfg-navy">{value}</div>
    </Card>
  );
}
