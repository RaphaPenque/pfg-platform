import { useState, useMemo, useCallback, useEffect } from "react";
import { useToast } from "@/hooks/use-toast";
import { Link } from "wouter";
import { useDashboardData, type DashboardProject, type DashboardRoleSlot, type DashboardAssignment } from "@/hooks/use-dashboard-data";
import { OEM_BRAND_COLORS, PROJECT_CUSTOMER, EQUIPMENT_TYPES, OEM_OPTIONS, calcPeakHeadcount } from "@/lib/constants";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/context/AuthContext";
import {
  LayoutDashboard, Users, UserCheck, ClipboardList, FileText,
  Truck, FolderOpen, DollarSign, Megaphone, Star,
  ExternalLink, ChevronRight, AlertTriangle, CheckCircle2, Clock, Activity, XCircle, Loader2,
} from "lucide-react";
import ProjectRolePlanningTab from "@/components/project/ProjectRolePlanningTab";
import ProjectTeamTab from "@/components/project/ProjectTeamTab";
import InlineField from "@/components/project/InlineField";
import DailyReportHub from "@/components/project/DailyReportHub";
import CommercialTab from "@/components/project/CommercialTab";

// ─── Types ───────────────────────────────────────────────────────

type HealthStatus = "green" | "amber" | "red" | "grey";

interface HealthModule {
  status: HealthStatus;
  label: string;
  note: string;
}

interface HealthResult {
  overall: HealthStatus;
  overallLabel: string;
  modules: { key: string; name: string; icon: React.ReactNode; data: HealthModule }[];
  flags: string[];
  actionCount: number;
}

const HEALTH_COLORS: Record<HealthStatus, string> = {
  green: "var(--green)",
  amber: "var(--amber)",
  red: "var(--red)",
  grey: "#9ca3af",
};

const HEALTH_BG: Record<HealthStatus, string> = {
  green: "var(--green-bg)",
  amber: "var(--amber-bg)",
  red: "var(--red-bg)",
  grey: "hsl(var(--muted))",
};

const HEALTH_LABELS: Record<HealthStatus, string> = {
  green: "Good",
  amber: "Needs Attention",
  red: "Critical",
  grey: "Not Configured",
};

// ─── Health computation ──────────────────────────────────────────

function computeHealth(
  project: DashboardProject,
  roleSlots: DashboardRoleSlot[],
  assignments: DashboardAssignment[]
): HealthResult {
  const flags: string[] = [];
  let actionCount = 0;

  const projectSlots = roleSlots.filter(s => s.projectId === project.id);
  const FILLED_STATUSES = ["active", "flagged", "confirmed", "pending_confirmation"];
  const projectAssignments = assignments.filter(
    a => a.projectId === project.id && FILLED_STATUSES.includes(a.status || "")
  );
  // Per-slot filled count: how many workers are assigned to each slot
  const assignedPerSlot = new Map<number, number>();
  projectAssignments.forEach(a => {
    if (a.roleSlotId) assignedPerSlot.set(a.roleSlotId, (assignedPerSlot.get(a.roleSlotId) || 0) + 1);
  });
  const totalSlotQty = projectSlots.reduce((sum, s) => sum + s.quantity, 0);
  const filledCount = projectSlots.reduce((sum, s) => sum + Math.min(assignedPerSlot.get(s.id) || 0, s.quantity), 0);
  const unfilled = Math.max(0, totalSlotQty - filledCount);
  const pendingCount = projectAssignments.filter(a => a.status === "pending_confirmation").length;
  const declinedCount = assignments.filter(a => a.projectId === project.id && a.status === "declined").length;

  let workforceStatus: HealthStatus = "green";
  let workforceNote = "All slots filled";
  if (totalSlotQty === 0) {
    workforceStatus = "grey";
    workforceNote = "No roles planned";
  } else if (unfilled > 0 || declinedCount > 0) {
    workforceStatus = "red";
    const parts: string[] = [];
    if (unfilled > 0) parts.push(`${unfilled} of ${totalSlotQty} slots unfilled`);
    if (declinedCount > 0) parts.push(`${declinedCount} declined`);
    workforceNote = parts.join(", ");
    flags.push(workforceNote);
    actionCount += unfilled + declinedCount;
  } else if (pendingCount > 0) {
    workforceStatus = "amber";
    workforceNote = `${pendingCount} pending confirmation`;
    flags.push(workforceNote);
    actionCount += pendingCount;
  }

  let planningStatus: HealthStatus = "green";
  let planningNote = "All items complete";
  const hasSignatory = project.timesheetSignatoryName;
  if (!hasSignatory) {
    planningStatus = "red";
    planningNote = "No signatory set";
    flags.push("No signatory set");
    actionCount++;
  }

  const modules: HealthResult["modules"] = [
    { key: "workforce", name: "Workforce", icon: <Users className="w-4 h-4" />, data: { status: workforceStatus, label: HEALTH_LABELS[workforceStatus], note: workforceNote } },
    { key: "timesheets", name: "Timesheets", icon: <ClipboardList className="w-4 h-4" />, data: { status: "grey", label: "Not Configured", note: "Coming in Phase 2" } },
    { key: "planning", name: "Planning", icon: <LayoutDashboard className="w-4 h-4" />, data: { status: planningStatus, label: HEALTH_LABELS[planningStatus], note: planningNote } },
    { key: "dailyReports", name: "Daily Reports", icon: <FileText className="w-4 h-4" />, data: { status: "grey", label: "Not Configured", note: "Coming in Phase 2" } },
    { key: "logistics", name: "Logistics", icon: <Truck className="w-4 h-4" />, data: { status: "grey", label: "Not Configured", note: "Coming in Phase 2" } },
    { key: "commercial", name: "Commercial", icon: <DollarSign className="w-4 h-4" />, data: { status: "grey", label: "Not Configured", note: "Coming in Phase 2" } },
  ];

  const statuses = [workforceStatus, planningStatus];
  let overall: HealthStatus = "green";
  if (statuses.includes("red")) overall = "red";
  else if (statuses.includes("amber")) overall = "amber";

  return {
    overall,
    overallLabel: HEALTH_LABELS[overall],
    modules,
    flags,
    actionCount,
  };
}

// ─── Tab definitions ─────────────────────────────────────────────

const TAB_DEFS = [
  { key: "overview", label: "Overview", icon: <LayoutDashboard className="w-4 h-4" /> },
  { key: "rolePlanning", label: "Role Planning", icon: <Users className="w-4 h-4" /> },
  { key: "team", label: "Team", icon: <UserCheck className="w-4 h-4" /> },
  { key: "timesheets", label: "Timesheets", icon: <ClipboardList className="w-4 h-4" /> },
  { key: "dailyReports", label: "Daily Reports", icon: <FileText className="w-4 h-4" /> },
  { key: "logistics", label: "Logistics", icon: <Truck className="w-4 h-4" /> },
  { key: "documents", label: "Documents", icon: <FolderOpen className="w-4 h-4" /> },
  { key: "commercial", label: "Commercial", icon: <DollarSign className="w-4 h-4" /> },
  { key: "marketing", label: "Marketing", icon: <Megaphone className="w-4 h-4" /> },
  { key: "satisfaction", label: "Customer Satisfaction & Lessons Learned", icon: <Star className="w-4 h-4" /> },
];

// ─── Helpers ─────────────────────────────────────────────────────

function getOemColor(project: DashboardProject): string {
  const customer = project.customer || PROJECT_CUSTOMER[project.code] || "";
  return OEM_BRAND_COLORS[customer] || "#64748B";
}

function timelinePercent(startDate: string | null, endDate: string | null): number {
  if (!startDate || !endDate) return 0;
  const start = new Date(startDate).getTime();
  const end = new Date(endDate).getTime();
  const now = Date.now();
  if (now <= start) return 0;
  if (now >= end) return 100;
  return Math.round(((now - start) / (end - start)) * 100);
}

function daysBetween(start: string, end: string): number {
  return Math.max(1, Math.ceil((new Date(end).getTime() - new Date(start).getTime()) / 86400000));
}

function currentDay(start: string): number {
  const s = new Date(start).getTime();
  const now = Date.now();
  return Math.max(1, Math.ceil((now - s) / 86400000));
}

// ─── Placeholder tab ─────────────────────────────────────────────

function PlaceholderTab({ label, icon }: { label: string; icon: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="w-12 h-12 rounded-full flex items-center justify-center mb-4" style={{ background: "hsl(var(--muted))", color: "var(--pfg-steel)" }}>
        {icon}
      </div>
      <h3 className="text-lg font-semibold text-pfg-navy font-display mb-2">{label}</h3>
      <p className="text-[13px]" style={{ color: "var(--pfg-steel)" }}>
        Coming soon — this module is part of the V2 roadmap.
      </p>
    </div>
  );
}

// ─── Overview Tab ────────────────────────────────────────────────

const CONTRACT_TYPE_OPTIONS = [
  { value: "T&M", label: "T&M" },
  { value: "SOW", label: "SOW" },
];

const SHIFT_OPTIONS = [
  { value: "Day", label: "Day" },
  { value: "Night", label: "Night" },
  { value: "Day & Night", label: "Day & Night" },
];

const OEM_SELECT_OPTIONS = OEM_OPTIONS.map((o) => ({ value: o, label: o }));

function OverviewTab({
  project,
  roleSlots,
  assignments,
  workers,
  canEdit,
}: {
  project: DashboardProject;
  roleSlots: DashboardRoleSlot[];
  assignments: DashboardAssignment[];
  workers: { id: number; status: string }[];
  canEdit: boolean;
}) {
  const color = getOemColor(project);
  const customer = project.customer || PROJECT_CUSTOMER[project.code] || "";
  const health = computeHealth(project, roleSlots, assignments);

  // Fetch survey results for Quick Stats satisfaction tile
  const { data: surveyData } = useQuery<{ responses: any[] }>({
    queryKey: ["/api/projects", project.id, "survey"],
    queryFn: () => apiRequest("GET", `/api/projects/${project.id}/survey`).then((r: any) => r.json()),
    staleTime: 5 * 60 * 1000,
  });
  const latestSurveyScore: number | null = surveyData?.responses?.length
    ? surveyData.responses.reduce((best: any, r: any) => (
        r.submittedAt > (best?.submittedAt ?? '') ? r : best
      ), null)?.averageScore ?? null
    : null;

  const isCompleted = project.status === "completed" || project.status === "cancelled";
  const pct = timelinePercent(project.startDate, project.endDate);
  const totalDays = project.startDate && project.endDate ? daysBetween(project.startDate, project.endDate) : 0;
  const curDay = project.startDate ? currentDay(project.startDate) : 0;
  const _projectSlots2 = roleSlots.filter(s => s.projectId === project.id);
  const FILLED_STATUSES_DETAIL = ["active", "flagged", "confirmed", "pending_confirmation"];
  const _projectAssignments2 = assignments.filter(a => a.projectId === project.id && FILLED_STATUSES_DETAIL.includes(a.status || ""));
  const _assignedPerSlot2 = new Map<number, number>();
  _projectAssignments2.forEach(a => { if (a.roleSlotId) _assignedPerSlot2.set(a.roleSlotId, (_assignedPerSlot2.get(a.roleSlotId) || 0) + 1); });
  const totalSlotQty = _projectSlots2.reduce((sum, s) => sum + s.quantity, 0);
  const filledCount = _projectSlots2.reduce((sum, s) => sum + Math.min(_assignedPerSlot2.get(s.id) || 0, s.quantity), 0);
  const daysLeft = project.endDate ? Math.max(0, Math.ceil((new Date(project.endDate).getTime() - Date.now()) / 86400000)) : null;
  // FTE Coverage = FTE workers assigned / total role slots
  const workerMap = new Map(workers.map(w => [w.id, w.status]));
  const assignedWorkerIds = Array.from(new Set(_projectAssignments2.map(a => a.workerId).filter(Boolean)));
  const fteWorkers = assignedWorkerIds.filter(id => workerMap.get(id) === "FTE").length;
  const ftePct = totalSlotQty > 0 ? Math.round((fteWorkers / totalSlotQty) * 100) : 0;
  const equipLabel = EQUIPMENT_TYPES.find(e => e.value === project.equipmentType)?.label || project.equipmentType || "—";

  const saveField = useCallback(
    (fieldName: string) => async (newValue: string) => {
      let payload: Record<string, unknown> = { [fieldName]: newValue || null };
      if (fieldName === "headcount") {
        payload[fieldName] = newValue ? Number(newValue) : null;
      }
      await apiRequest("PATCH", `/api/projects/${project.id}`, payload);
      await queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
    },
    [project.id],
  );

  // Stakeholder rows
  const stakeholders = [
    { label: "Sourcing Contact", nameField: "sourcingContact" as const, value: project.sourcingContact, emailField: "sourcingContactEmail" as const, email: project.sourcingContactEmail },
    { label: "Customer Project Manager", nameField: "customerProjectManager" as const, value: project.customerProjectManager, emailField: "customerProjectManagerEmail" as const, email: project.customerProjectManagerEmail },
    { label: "Site Manager", nameField: "siteManager" as const, value: project.siteManager, emailField: "siteManagerEmail" as const, email: project.siteManagerEmail },
    { label: "Timesheet Signatory", nameField: "timesheetSignatoryName" as const, value: project.timesheetSignatoryName, emailField: "timesheetSignatoryEmail" as const, email: project.timesheetSignatoryEmail },
  ];

  return (
    <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
      {/* LEFT COLUMN (60%) */}
      <div className="lg:col-span-3 space-y-5">
        {/* Project Info Card */}
        <div className="rounded-xl border p-5" style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--card))" }}>
          <h3 className="text-[13px] font-bold uppercase tracking-wide mb-4" style={{ color: "var(--pfg-steel)" }}>Project Information</h3>
          <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-[13px]">
            <div>
              <span className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--pfg-steel)" }}>Code</span>
              <div className="font-semibold text-pfg-navy mt-0.5">
                <span className="inline-block text-[11px] font-bold px-2 py-0.5 rounded-full mr-2" style={{ background: "var(--pfg-navy)", color: "#fff" }}>
                  {project.code}
                </span>
              </div>
            </div>
            <div>
              <span className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--pfg-steel)" }}>Project Name</span>
              <div className="mt-0.5">
                <InlineField value={project.name} onSave={saveField("name")} canEdit={canEdit} placeholder="Project name" />
              </div>
            </div>
            <div>
              <span className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--pfg-steel)" }}>Customer / OEM</span>
              <div className="mt-0.5">
                <InlineField value={project.customer} onSave={saveField("customer")} type="select" options={OEM_SELECT_OPTIONS} canEdit={canEdit} />
              </div>
            </div>
            <div>
              <span className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--pfg-steel)" }}>Equipment</span>
              <div className="mt-0.5">
                <InlineField value={project.equipmentType} onSave={saveField("equipmentType")} type="select" options={EQUIPMENT_TYPES} canEdit={canEdit} />
              </div>
            </div>
            <div>
              <span className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--pfg-steel)" }}>Contract Type</span>
              <div className="mt-0.5">
                <InlineField value={project.contractType} onSave={saveField("contractType")} type="select" options={CONTRACT_TYPE_OPTIONS} canEdit={canEdit} />
              </div>
            </div>
            <div>
              <span className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--pfg-steel)" }}>Site Name</span>
              <div className="mt-0.5">
                <InlineField value={project.siteName} onSave={saveField("siteName")} canEdit={canEdit} placeholder="Site name" />
              </div>
            </div>
            <div>
              <span className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--pfg-steel)" }}>Site Address</span>
              <div className="mt-0.5">
                <InlineField value={project.siteAddress} onSave={saveField("siteAddress")} canEdit={canEdit} placeholder="Site address" />
              </div>
            </div>
            <div>
              <span className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--pfg-steel)" }}>Scope of Work</span>
              <div className="mt-0.5">
                <InlineField value={project.scopeOfWork} onSave={saveField("scopeOfWork")} canEdit={canEdit} placeholder="e.g. GT Major Inspection" />
              </div>
            </div>
            <div>
              <span className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--pfg-steel)" }}>Start Date</span>
              <div className="mt-0.5">
                <InlineField value={project.startDate} onSave={saveField("startDate")} type="date" canEdit={canEdit} />
              </div>
            </div>
            <div>
              <span className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--pfg-steel)" }}>End Date</span>
              <div className="mt-0.5">
                <InlineField value={project.endDate} onSave={saveField("endDate")} type="date" canEdit={canEdit} />
              </div>
            </div>
            <div>
              <span className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--pfg-steel)" }}>Shift Pattern</span>
              <div className="mt-0.5">
                <InlineField value={project.shift} onSave={saveField("shift")} type="select" options={SHIFT_OPTIONS} canEdit={canEdit} />
              </div>
            </div>
            <div>
              <span className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--pfg-steel)" }}>Headcount</span>
              <div className="mt-0.5">
                <InlineField value={project.headcount} onSave={saveField("headcount")} type="number" canEdit={canEdit} placeholder="0" />
              </div>
            </div>
            <div className="col-span-2">
              <span className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--pfg-steel)" }}>Notes</span>
              <div className="mt-0.5">
                <InlineField value={project.notes} onSave={saveField("notes")} type="textarea" canEdit={canEdit} placeholder="Project notes..." />
              </div>
            </div>
          </div>
        </div>

        {/* Timeline Progress Bar */}
        <div className="rounded-xl border p-5" style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--card))" }}>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-[13px] font-bold uppercase tracking-wide" style={{ color: "var(--pfg-steel)" }}>Timeline</h3>
            <span className="text-[12px] font-semibold" style={{ color: "var(--pfg-navy)" }}>
              Day {Math.min(curDay, totalDays)} of {totalDays}
            </span>
          </div>
          <div className="relative h-4 rounded-full overflow-hidden" style={{ background: "hsl(var(--muted))" }}>
            <div
              className="absolute left-0 top-0 h-full rounded-full transition-all"
              style={{ width: `${pct}%`, background: "var(--pfg-yellow)" }}
            />
            {pct > 0 && pct < 100 && (
              <div
                className="absolute top-[-2px] w-1 h-5 rounded"
                style={{ left: `${pct}%`, background: "var(--pfg-navy)" }}
              />
            )}
          </div>
          <div className="flex justify-between mt-2 text-[11px]" style={{ color: "var(--pfg-steel)" }}>
            <span>{project.startDate || "—"}</span>
            <span className="font-semibold" style={{ color: "var(--pfg-yellow-dark)" }}>{pct}% complete</span>
            <span>{project.endDate || "—"}</span>
          </div>
        </div>

        {/* Customer Stakeholders Card */}
        <div className="rounded-xl border p-5" style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--card))" }}>
          <h3 className="text-[13px] font-bold uppercase tracking-wide mb-4" style={{ color: "var(--pfg-steel)" }}>Customer Stakeholders</h3>
          <div className="rounded-lg border overflow-hidden" style={{ borderColor: "hsl(var(--border))" }}>
            <table className="w-full text-[13px]">
              <thead>
                <tr>
                  <th className="text-left px-4 py-2 text-[10px] font-semibold uppercase tracking-wide" style={{ background: "hsl(var(--muted))", color: "hsl(var(--muted-foreground))" }}>Role</th>
                  <th className="text-left px-4 py-2 text-[10px] font-semibold uppercase tracking-wide" style={{ background: "hsl(var(--muted))", color: "hsl(var(--muted-foreground))" }}>Name</th>
                  <th className="text-left px-4 py-2 text-[10px] font-semibold uppercase tracking-wide" style={{ background: "hsl(var(--muted))", color: "hsl(var(--muted-foreground))" }}>Email</th>
                </tr>
              </thead>
              <tbody>
                {stakeholders.map((s) => (
                  <tr key={s.label} style={{ borderTop: "1px solid hsl(var(--border))" }}>
                    <td className="px-4 py-2.5 font-medium text-pfg-navy">{s.label}</td>
                    <td className="px-4 py-2.5">
                      <InlineField value={s.value} onSave={saveField(s.nameField)} canEdit={canEdit} placeholder="Name" emptyLabel="Not set" />
                    </td>
                    <td className="px-4 py-2.5">
                      <InlineField value={s.email ?? null} onSave={saveField(s.emailField)} type="email" canEdit={canEdit} placeholder="email@example.com" emptyLabel="—" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* PFG Project Team Card */}
        <div className="rounded-xl border p-5" style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--card))" }}>
          <h3 className="text-[13px] font-bold uppercase tracking-wide mb-4" style={{ color: "var(--pfg-steel)" }}>PFG Project Team</h3>
          <PfgTeamCard project={project} canEdit={canEdit} />
        </div>
      </div>

      {/* RIGHT COLUMN (40%) */}
      <div className="lg:col-span-2 space-y-5">
        {/* Overall Health — or Project Complete badge */}
        {isCompleted ? (
          <div className="rounded-xl border p-5 text-center" style={{ borderColor: "var(--green)", background: "var(--green-bg, #F0FDF4)" }}>
            <div className="w-14 h-14 rounded-full mx-auto mb-3 flex items-center justify-center" style={{ background: "var(--green)" }}>
              <CheckCircle2 className="w-7 h-7 text-white" />
            </div>
            <div className="text-[15px] font-bold" style={{ color: "var(--green)" }}>
              Project {project.status === "cancelled" ? "Cancelled" : "Complete"}
            </div>
            {project.endDate && (
              <p className="text-[12px] mt-1" style={{ color: "var(--pfg-steel)" }}>
                {project.status === "cancelled" ? "Cancelled" : "Completed"} {new Date(project.endDate).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}
              </p>
            )}
          </div>
        ) : (
          <div className="rounded-xl border p-5 text-center" style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--card))" }}>
            <div
              className="w-16 h-16 rounded-full mx-auto mb-3 flex items-center justify-center"
              style={{ background: HEALTH_BG[health.overall] }}
            >
              <div className="w-8 h-8 rounded-full" style={{ background: HEALTH_COLORS[health.overall] }} />
            </div>
            <div className="text-[15px] font-bold text-pfg-navy font-display">
              Project Health: {health.overallLabel}
            </div>
            {health.actionCount > 0 && (
              <p className="text-[12px] mt-1" style={{ color: "var(--pfg-steel)" }}>
                {health.actionCount} action{health.actionCount > 1 ? "s" : ""} needed
              </p>
            )}
          </div>
        )}

        {/* Customer Satisfaction tile — only shown when survey response exists */}
        {latestSurveyScore !== null && (
          <div className="rounded-xl border p-5 text-center" style={{ borderColor: "var(--pfg-gold, #F5BD00)", background: "#FFFBEB" }}>
            <p className="text-[11px] font-semibold uppercase tracking-wide mb-2" style={{ color: "#92400E" }}>Customer Satisfaction</p>
            <div className="flex justify-center mb-1">
              <StarRating score={latestSurveyScore} size={22} />
            </div>
            <div className="text-[22px] font-bold" style={{ color: "#92400E" }}>{latestSurveyScore.toFixed(1)}</div>
            <div className="text-[11px]" style={{ color: "#B45309" }}>out of 5.0</div>
          </div>
        )}

        {/* Health Module Breakdown */}
        <div className="rounded-xl border p-5" style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--card))" }}>
          <h3 className="text-[13px] font-bold uppercase tracking-wide mb-3" style={{ color: "var(--pfg-steel)" }}>Health Breakdown</h3>
          <div className="space-y-2.5">
            {health.modules.map((m) => (
              <div key={m.key} className="flex items-center gap-3 text-[13px]">
                <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: HEALTH_COLORS[m.data.status] }} />
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-pfg-navy">{m.name}</div>
                  <div className="text-[11px]" style={{ color: "var(--pfg-steel)" }}>{m.data.note}</div>
                </div>
                <span
                  className="text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0"
                  style={{ background: HEALTH_BG[m.data.status], color: HEALTH_COLORS[m.data.status] }}
                >
                  {m.data.label}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Action Items */}
        {health.flags.length > 0 && (
          <div className="rounded-xl border p-5" style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--card))" }}>
            <h3 className="text-[13px] font-bold uppercase tracking-wide mb-3" style={{ color: "var(--pfg-steel)" }}>Action Items</h3>
            <div className="space-y-2">
              {health.flags.map((flag) => (
                <div
                  key={flag}
                  className="flex items-center gap-2 text-[12px] font-medium px-3 py-2 rounded-lg"
                  style={{
                    background: flag.includes("unfilled") ? "var(--red-bg)" : "var(--amber-bg)",
                    color: flag.includes("unfilled") ? "var(--red)" : "var(--amber)",
                  }}
                >
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                  {flag}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Quick Stats — horizontal 4-card strip */}
        <div className="rounded-xl border p-5" style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--card))" }}>
          <h3 className="text-[13px] font-bold uppercase tracking-wide mb-3" style={{ color: "var(--pfg-steel)" }}>Quick Stats</h3>
          <div className="grid grid-cols-4 gap-2">
            <div className="rounded-lg p-3 text-center" style={{ background: "hsl(var(--muted))" }}>
              <div className="text-[18px] font-bold text-pfg-navy font-display">{daysLeft ?? "—"}</div>
              <div className="text-[9px] font-semibold uppercase tracking-wide mt-0.5" style={{ color: "var(--pfg-steel)" }}>Days Left</div>
            </div>
            <div className="rounded-lg p-3 text-center" style={{ background: "hsl(var(--muted))" }}>
              <div className="text-[18px] font-bold font-display" style={{ color: ftePct >= 60 ? "var(--green)" : ftePct >= 50 ? "var(--amber)" : "var(--red)" }}>{ftePct}%</div>
              <div className="text-[9px] font-semibold uppercase tracking-wide mt-0.5" style={{ color: "var(--pfg-steel)" }}>FTE Cover</div>
            </div>
            <div className="rounded-lg p-3 text-center" style={{ background: "hsl(var(--muted))" }}>
              <div className="text-[18px] font-bold text-pfg-navy font-display">{filledCount}</div>
              <div className="text-[9px] font-semibold uppercase tracking-wide mt-0.5" style={{ color: "var(--pfg-steel)" }}>Workers</div>
            </div>
            <div className="rounded-lg p-3 text-center" style={{ background: "hsl(var(--muted))" }}>
              <div className="text-[18px] font-bold text-pfg-navy font-display">—</div>
              <div className="text-[9px] font-semibold uppercase tracking-wide mt-0.5" style={{ color: "var(--pfg-steel)" }}>On Time</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ───────────────────────────────────────────────────

// ─── Customer Satisfaction Tab ──────────────────────────────────

type SurveyToken = {
  id: number;
  projectId: number;
  contactEmail: string;
  contactName: string | null;
  contactRole: string | null;
  token: string;
  expiresAt: string;
  usedAt: string | null;
  reminderSentAt: string | null;
  finalReminderSentAt: string | null;
  createdAt: string | null;
};

type SurveyResponse = {
  id: number;
  projectId: number;
  tokenId: number | null;
  contactEmail: string;
  contactName: string | null;
  submittedAt: string | null;
  q1Planning: number | null;
  q2Quality: number | null;
  q3Hse: number | null;
  q4Supervision: number | null;
  q5Pm: number | null;
  q6Overall: number | null;
  averageScore: number | null;
  nps: number | null;
  openFeedback: string | null;
  individualFeedbackGiven: boolean | null;
};

type LessonsLearnedRecord = {
  id: number;
  projectId: number;
  completedBy: number;
  completedAt: string | null;
  overallAssessment: string | null;
  wentWell: string | null;
  couldImprove: string | null;
  qhsePerformance: string | null;
  qhseNotes: string | null;
  commercialPerformance: string | null;
  commercialNotes: string | null;
  customerRelationship: string | null;
  customerRelationshipNotes: string | null;
  sameTeamAgain: string | null;
  sameTeamNotes: string | null;
  additionalNotes: string | null;
  actionPoints: any[];
};

const RATING_LABELS: Record<number, string> = {
  1: "Very Dissatisfied",
  2: "Dissatisfied",
  3: "Neutral",
  4: "Satisfied",
  5: "Extremely Satisfied",
};

const Q_LABELS = [
  { key: "q1Planning", label: "Planning & Preparation" },
  { key: "q2Quality", label: "Quality of Work" },
  { key: "q3Hse", label: "Health & Safety" },
  { key: "q4Supervision", label: "Supervision" },
  { key: "q5Pm", label: "Project Manager" },
  { key: "q6Overall", label: "Overall Performance" },
];

const ASSESSMENT_OPTIONS = [
  { value: "excellent", label: "Excellent" },
  { value: "good", label: "Good" },
  { value: "satisfactory", label: "Satisfactory" },
  { value: "below_expectations", label: "Below Expectations" },
  { value: "poor", label: "Poor" },
];

function StarRating({ score, max = 5, size = 20 }: { score: number; max?: number; size?: number }) {
  return (
    <div className="flex items-center gap-0.5">
      {Array.from({ length: max }).map((_, i) => {
        const fill = Math.min(1, Math.max(0, score - i)); // 0=empty, 0.5=half, 1=full
        const uid = `star-clip-${i}-${Math.round(score * 10)}`;
        return (
          <svg key={i} width={size} height={size} viewBox="0 0 24 24" style={{ overflow: 'visible' }}>
            {fill > 0 && fill < 1 && (
              <defs>
                <clipPath id={uid}>
                  <rect x="0" y="0" width={12 * fill * 2} height="24" />
                </clipPath>
              </defs>
            )}
            {/* Empty star background */}
            <polygon
              points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"
              fill="none"
              stroke="hsl(var(--border))"
              strokeWidth="1.5"
            />
            {/* Filled portion */}
            {fill > 0 && (
              <polygon
                points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"
                fill="var(--pfg-yellow)"
                stroke="var(--pfg-yellow-dark)"
                strokeWidth="1.5"
                clipPath={fill < 1 ? `url(#${uid})` : undefined}
              />
            )}
          </svg>
        );
      })}
    </div>
  );
}

function ScoreBar({ score, max = 5 }: { score: number; max?: number }) {
  const pct = (score / max) * 100;
  const color = score >= 4 ? "var(--green)" : score >= 3 ? "var(--amber)" : "var(--red)";
  return (
    <div className="flex items-center gap-3">
      <div className="flex-1 rounded-full overflow-hidden" style={{ background: "hsl(var(--muted))", height: 8 }}>
        <div style={{ width: `${pct}%`, background: color, height: "100%", transition: "width 0.4s ease" }} />
      </div>
      <span className="text-[13px] font-semibold w-6 text-right" style={{ color }}>{score}</span>
    </div>
  );
}

function CustomerSatisfactionTab({
  project,
  userRole,
}: {
  project: DashboardProject;
  userRole: string;
}) {
  const { toast } = useToast();
  const canManage = userRole === "admin" || userRole === "resource_manager";
  const canPM = canManage || userRole === "project_manager";
  const isObserver = userRole === "observer";

  const [activeSubTab, setActiveSubTab] = useState<"survey" | "lessons">("survey");
  const [surveyData, setSurveyData] = useState<{ tokens: SurveyToken[]; responses: SurveyResponse[] } | null>(null);
  const [surveyLoading, setSurveyLoading] = useState(false);
  const [sending, setSending] = useState(false);

  // Lessons Learned state
  const [ll, setLl] = useState<LessonsLearnedRecord | null>(null);
  const [llLoading, setLlLoading] = useState(false);
  const [llEditing, setLlEditing] = useState(false);
  const [llSaving, setLlSaving] = useState(false);
  const [llForm, setLlForm] = useState<Partial<LessonsLearnedRecord>>({});

  // Load survey data on mount
  useEffect(() => {
    setSurveyLoading(true);
    apiRequest("GET", `/api/projects/${project.id}/survey`)
      .then(r => r.json())
      .then(d => setSurveyData(d))
      .catch(() => setSurveyData({ tokens: [], responses: [] }))
      .finally(() => setSurveyLoading(false));
  }, [project.id]);

  // Load lessons learned on mount
  useEffect(() => {
    if (!canPM) return;
    setLlLoading(true);
    apiRequest("GET", `/api/projects/${project.id}/lessons-learned`)
      .then(r => r.json())
      .then(d => { setLl(d); if (d) setLlForm(d); })
      .catch(() => {})
      .finally(() => setLlLoading(false));
  }, [project.id, canPM]);

  const handleSendSurvey = async () => {
    if (!window.confirm("Send satisfaction survey to all project contacts?")) return;
    setSending(true);
    try {
      const r = await apiRequest("POST", `/api/projects/${project.id}/survey/send`, {});
      const d = await r.json();
      toast({ title: "Survey sent", description: `Sent to ${d.sent} contact${d.sent !== 1 ? "s" : ""}` });
      // Reload survey data
      const r2 = await apiRequest("GET", `/api/projects/${project.id}/survey`);
      setSurveyData(await r2.json());
    } catch (e: any) {
      toast({ title: "Error", description: e.message || "Failed to send survey", variant: "destructive" });
    } finally {
      setSending(false);
    }
  };

  const handleSaveLessons = async () => {
    setLlSaving(true);
    try {
      const r = await apiRequest("POST", `/api/projects/${project.id}/lessons-learned`, llForm);
      const d = await r.json();
      setLl(d);
      setLlForm(d);
      setLlEditing(false);
      toast({ title: "Lessons Learned saved" });
    } catch (e: any) {
      toast({ title: "Error saving", description: e.message, variant: "destructive" });
    } finally {
      setLlSaving(false);
    }
  };

  const latestResponse = surveyData?.responses?.[0] ?? null;
  const sentToken = surveyData?.tokens?.[0] ?? null;
  const hasSentSurvey = (surveyData?.tokens?.length ?? 0) > 0;
  const hasResponse = (surveyData?.responses?.length ?? 0) > 0;

  return (
    <div className="space-y-4">
      {/* Sub-tab bar */}
      <div className="flex gap-1 p-1 rounded-lg" style={{ background: "hsl(var(--muted))" }}>
        <button
          onClick={() => setActiveSubTab("survey")}
          className="flex-1 text-[12px] font-semibold py-2 px-3 rounded-md transition-colors"
          style={{
            background: activeSubTab === "survey" ? "#fff" : "transparent",
            color: activeSubTab === "survey" ? "var(--pfg-navy)" : "hsl(var(--muted-foreground))",
            boxShadow: activeSubTab === "survey" ? "0 1px 3px rgba(0,0,0,0.1)" : "none",
          }}
        >
          Survey Results
        </button>
        {canPM && (
          <button
            onClick={() => setActiveSubTab("lessons")}
            className="flex-1 text-[12px] font-semibold py-2 px-3 rounded-md transition-colors"
            style={{
              background: activeSubTab === "lessons" ? "#fff" : "transparent",
              color: activeSubTab === "lessons" ? "var(--pfg-navy)" : "hsl(var(--muted-foreground))",
              boxShadow: activeSubTab === "lessons" ? "0 1px 3px rgba(0,0,0,0.1)" : "none",
            }}
          >
            Lessons Learned
          </button>
        )}
      </div>

      {/* Survey Results sub-tab */}
      {activeSubTab === "survey" && (
        <div className="space-y-5">
          {surveyLoading ? (
            <div className="flex items-center justify-center py-12 text-[13px]" style={{ color: "var(--pfg-steel)" }}>Loading...</div>
          ) : !hasSentSurvey ? (
            // No survey sent yet
            <div className="text-center py-10">
              <div className="w-12 h-12 rounded-full flex items-center justify-center mb-4 mx-auto" style={{ background: "hsl(var(--muted))", color: "var(--pfg-steel)" }}>
                <Star className="w-6 h-6" />
              </div>
              <h3 className="text-[15px] font-semibold text-pfg-navy font-display mb-2">No survey sent yet</h3>
              <p className="text-[13px] mb-6" style={{ color: "var(--pfg-steel)" }}>Send a satisfaction survey to the project contacts to collect feedback.</p>
              {canManage && (
                <button
                  onClick={handleSendSurvey}
                  disabled={sending}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-[13px] font-semibold text-white transition-colors"
                  style={{ background: "var(--pfg-navy)" }}
                >
                  {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Star className="w-4 h-4" />}
                  Send Survey
                </button>
              )}
            </div>
          ) : !hasResponse ? (
            // Sent but not responded
            <div className="space-y-4">
              {canManage && (
                <button
                  onClick={handleSendSurvey}
                  disabled={sending}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-[12px] font-semibold border transition-colors"
                  style={{ borderColor: "hsl(var(--border))", color: "var(--pfg-steel)" }}
                >
                  {sending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Star className="w-3.5 h-3.5" />}
                  Resend Survey
                </button>
              )}
              <div className="rounded-xl p-5 text-center" style={{ background: "hsl(var(--muted))" }}>
                <div className="w-10 h-10 rounded-full flex items-center justify-center mx-auto mb-3" style={{ background: "var(--amber-bg)", color: "var(--amber)" }}>
                  <Activity className="w-5 h-5" />
                </div>
                <h3 className="text-[14px] font-semibold text-pfg-navy mb-1">Awaiting Response</h3>
                {sentToken?.createdAt && (
                  <p className="text-[12px]" style={{ color: "var(--pfg-steel)" }}>
                    Sent {new Date(sentToken.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                  </p>
                )}
                {sentToken?.reminderSentAt && (
                  <p className="text-[11px] mt-1" style={{ color: "var(--pfg-steel)" }}>
                    Reminder sent {new Date(sentToken.reminderSentAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                  </p>
                )}
                {sentToken?.finalReminderSentAt && (
                  <p className="text-[11px] mt-0.5" style={{ color: "var(--pfg-steel)" }}>
                    Final reminder sent {new Date(sentToken.finalReminderSentAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                  </p>
                )}
                <p className="text-[11px] mt-2" style={{ color: "var(--pfg-steel)" }}>
                  Expires {sentToken?.expiresAt ? new Date(sentToken.expiresAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—"}
                </p>
              </div>
            </div>
          ) : (
            // Survey submitted — show results
            <div className="space-y-5">
              {canManage && (
                <button
                  onClick={handleSendSurvey}
                  disabled={sending}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-[12px] font-semibold border transition-colors"
                  style={{ borderColor: "hsl(var(--border))", color: "var(--pfg-steel)" }}
                >
                  {sending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Star className="w-3.5 h-3.5" />}
                  Send Another Survey
                </button>
              )}

              {/* Score summary card */}
              <div className="rounded-xl p-5" style={{ background: "hsl(var(--muted))" }}>
                <div className="flex items-center gap-4">
                  <div className="text-center">
                    <div className="text-4xl font-extrabold font-display" style={{ color: "var(--pfg-navy)" }}>
                      {latestResponse?.averageScore?.toFixed(1) ?? "—"}
                    </div>
                    <div className="text-[11px] font-medium mt-0.5" style={{ color: "var(--pfg-steel)" }}>out of 5.0</div>
                    <div className="mt-2">
                      <StarRating score={latestResponse?.averageScore ?? 0} />
                    </div>
                  </div>
                  <div className="flex-1">
                    <p className="text-[13px] font-semibold text-pfg-navy mb-1">
                      {latestResponse?.contactName || latestResponse?.contactEmail || "Anonymous"}
                    </p>
                    <p className="text-[12px]" style={{ color: "var(--pfg-steel)" }}>
                      Submitted {latestResponse?.submittedAt
                        ? new Date(latestResponse.submittedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
                        : "—"}
                    </p>
                  </div>
                </div>
              </div>

              {/* Question breakdown */}
              <div className="rounded-xl p-5 space-y-3" style={{ background: "#fff", border: "1px solid hsl(var(--border))" }}>
                <h4 className="text-[13px] font-semibold text-pfg-navy mb-3">Question Breakdown</h4>
                {Q_LABELS.map(({ key, label }) => {
                  const score = latestResponse?.[key as keyof SurveyResponse] as number | null;
                  return (
                    <div key={key}>
                      <div className="flex justify-between text-[12px] mb-1">
                        <span style={{ color: "var(--pfg-steel)" }}>{label}</span>
                        <span className="font-semibold" style={{ color: "var(--pfg-navy)" }}>
                          {score != null ? RATING_LABELS[score] || score : "—"}
                        </span>
                      </div>
                      {score != null && <ScoreBar score={score} />}
                    </div>
                  );
                })}
              </div>

              {/* NPS — hidden from Observer */}
              {!isObserver && latestResponse?.nps != null && (
                <div className="rounded-xl p-5" style={{ background: "#fff", border: "1px solid hsl(var(--border))" }}>
                  <h4 className="text-[13px] font-semibold text-pfg-navy mb-3">Net Promoter Score</h4>
                  <div className="flex items-center gap-3">
                    <div
                      className="w-12 h-12 rounded-full flex items-center justify-center text-xl font-extrabold font-display"
                      style={{
                        background: latestResponse.nps >= 9 ? "var(--green-bg)" : latestResponse.nps >= 7 ? "var(--amber-bg)" : "var(--red-bg)",
                        color: latestResponse.nps >= 9 ? "var(--green)" : latestResponse.nps >= 7 ? "var(--amber)" : "var(--red)",
                      }}
                    >
                      {latestResponse.nps}
                    </div>
                    <div>
                      <p className="text-[13px] font-semibold" style={{ color: "var(--pfg-navy)" }}>
                        {latestResponse.nps >= 9 ? "Promoter" : latestResponse.nps >= 7 ? "Passive" : "Detractor"}
                      </p>
                      <p className="text-[11px]" style={{ color: "var(--pfg-steel)" }}>Score out of 10</p>
                    </div>
                  </div>
                </div>
              )}

              {/* Open feedback — hidden from Observer */}
              {!isObserver && latestResponse?.openFeedback && (
                <div className="rounded-xl p-5" style={{ background: "#fff", border: "1px solid hsl(var(--border))" }}>
                  <h4 className="text-[13px] font-semibold text-pfg-navy mb-2">Additional Comments</h4>
                  <p className="text-[13px] leading-relaxed" style={{ color: "var(--pfg-steel)" }}>{latestResponse.openFeedback}</p>
                </div>
              )}

              {/* Individual feedback section — hidden from Observer */}
              {!isObserver && latestResponse?.individualFeedbackGiven && (
                <div className="rounded-xl p-5" style={{ background: "#fff", border: "1px solid hsl(var(--border))" }}>
                  <h4 className="text-[13px] font-semibold text-pfg-navy mb-2">Individual Feedback Given</h4>
                  <p className="text-[12px]" style={{ color: "var(--pfg-steel)" }}>
                    Individual worker comments were submitted. View them in the worker profile pages.
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Lessons Learned sub-tab */}
      {activeSubTab === "lessons" && canPM && (
        <div className="space-y-4">
          {llLoading ? (
            <div className="flex items-center justify-center py-12 text-[13px]" style={{ color: "var(--pfg-steel)" }}>Loading...</div>
          ) : ll && !llEditing ? (
            // Read-only view
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-[14px] font-semibold text-pfg-navy">Lessons Learned</h3>
                {canPM && (
                  <button
                    onClick={() => { setLlForm(ll); setLlEditing(true); }}
                    className="text-[12px] font-semibold px-3 py-1.5 rounded-lg border transition-colors"
                    style={{ borderColor: "hsl(var(--border))", color: "var(--pfg-steel)" }}
                  >
                    Edit
                  </button>
                )}
              </div>
              {ll.overallAssessment && (
                <div className="rounded-xl p-4" style={{ background: "hsl(var(--muted))" }}>
                  <div className="text-[11px] font-semibold uppercase tracking-wide mb-1" style={{ color: "var(--pfg-steel)" }}>Overall Assessment</div>
                  <div className="text-[14px] font-semibold text-pfg-navy">
                    {ASSESSMENT_OPTIONS.find(o => o.value === ll.overallAssessment)?.label || ll.overallAssessment}
                  </div>
                </div>
              )}
              {[
                { field: "wentWell" as const, label: "What went well" },
                { field: "couldImprove" as const, label: "What could improve" },
                { field: "qhseNotes" as const, label: "QHSE Notes" },
                { field: "commercialNotes" as const, label: "Commercial Notes" },
                { field: "customerRelationshipNotes" as const, label: "Customer Relationship" },
                { field: "sameTeamNotes" as const, label: "Same team again?" },
                { field: "additionalNotes" as const, label: "Additional Notes" },
              ].filter(({ field }) => ll[field]).map(({ field, label }) => (
                <div key={field} className="rounded-xl p-4" style={{ background: "#fff", border: "1px solid hsl(var(--border))" }}>
                  <div className="text-[11px] font-semibold uppercase tracking-wide mb-1" style={{ color: "var(--pfg-steel)" }}>{label}</div>
                  <div className="text-[13px] leading-relaxed" style={{ color: "var(--pfg-navy)" }}>{ll[field]}</div>
                </div>
              ))}
            </div>
          ) : (
            // Form (new or editing)
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-[14px] font-semibold text-pfg-navy">{ll ? "Edit Lessons Learned" : "New Lessons Learned"}</h3>
              </div>

              <div className="space-y-3">
                <div>
                  <label className="block text-[12px] font-semibold mb-1" style={{ color: "var(--pfg-steel)" }}>Overall Assessment</label>
                  <select
                    className="w-full border rounded-lg px-3 py-2 text-[13px]"
                    style={{ borderColor: "hsl(var(--border))" }}
                    value={llForm.overallAssessment || ""}
                    onChange={e => setLlForm(f => ({ ...f, overallAssessment: e.target.value || null }))}
                  >
                    <option value="">Select...</option>
                    {ASSESSMENT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>

                {[
                  { field: "wentWell" as const, label: "What went well?", placeholder: "Things that worked well on this project..." },
                  { field: "couldImprove" as const, label: "What could be improved?", placeholder: "Areas for improvement..." },
                  { field: "qhseNotes" as const, label: "QHSE Performance Notes", placeholder: "Health, safety, and environment observations..." },
                  { field: "commercialNotes" as const, label: "Commercial Performance Notes", placeholder: "Budget, margins, variations..." },
                  { field: "customerRelationshipNotes" as const, label: "Customer Relationship Notes", placeholder: "How was the relationship with the customer?" },
                  { field: "sameTeamNotes" as const, label: "Same Team Again?", placeholder: "Would you use the same team? Any personnel notes?" },
                  { field: "additionalNotes" as const, label: "Additional Notes", placeholder: "Anything else..." },
                ].map(({ field, label, placeholder }) => (
                  <div key={field}>
                    <label className="block text-[12px] font-semibold mb-1" style={{ color: "var(--pfg-steel)" }}>{label}</label>
                    <textarea
                      className="w-full border rounded-lg px-3 py-2 text-[13px] resize-y"
                      style={{ borderColor: "hsl(var(--border))", minHeight: 80 }}
                      rows={3}
                      placeholder={placeholder}
                      value={(llForm[field] as string | null) || ""}
                      onChange={e => setLlForm(f => ({ ...f, [field]: e.target.value || null }))}
                    />
                  </div>
                ))}
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  onClick={handleSaveLessons}
                  disabled={llSaving}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg text-[13px] font-semibold text-white transition-colors"
                  style={{ background: "var(--pfg-navy)" }}
                >
                  {llSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                  Save Lessons Learned
                </button>
                {ll && (
                  <button
                    onClick={() => setLlEditing(false)}
                    className="px-4 py-2 rounded-lg text-[13px] font-semibold border transition-colors"
                    style={{ borderColor: "hsl(var(--border))", color: "var(--pfg-steel)" }}
                  >
                    Cancel
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── PFG Project Team Card ───────────────────────────────────────────────
function PfgTeamCard({ project, canEdit }: { project: DashboardProject; canEdit: boolean }) {
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();
  const { data } = useDashboardData();

  const users: any[] = data?.users || [];
  const projectLeads: Record<number, { id: number; name: string }> = data?.projectLeads || {};
  const assignedLead = projectLeads[project.id];
  const assignedUser = assignedLead ? users.find((u: any) => u.id === assignedLead.id) : undefined;
  const pmUsers = users.filter((u: any) => u.role === 'project_manager' && u.isActive);

  const assignPm = async (userId: string) => {
    setSaving(true);
    try {
      await apiRequest('PUT', `/api/projects/${project.id}/lead`, { userId: parseInt(userId) });
      await queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
      toast({ title: 'Project Manager assigned' });
    } catch (e: any) {
      toast({ title: 'Error', description: e.message, variant: 'destructive' });
    }
    setSaving(false);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide mb-1" style={{ color: 'var(--pfg-steel)' }}>Project Manager</p>
          {assignedUser ? (
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold text-white"
                style={{ background: 'var(--pfg-navy)' }}>
                {assignedUser.name.split(' ').map((n: string) => n[0]).slice(0,2).join('')}
              </div>
              <div>
                <p className="text-[13px] font-semibold" style={{ color: 'var(--pfg-navy)' }}>{assignedUser.name}</p>
                <p className="text-[11px]" style={{ color: 'var(--pfg-steel)' }}>{assignedUser.email}</p>
              </div>
            </div>
          ) : (
            <p className="text-[12px]" style={{ color: 'var(--pfg-steel)' }}>No PM assigned</p>
          )}
        </div>
        {canEdit && (
          <select
            className="text-[12px] border rounded-lg px-2 py-1.5"
            style={{ borderColor: 'hsl(var(--border))', color: 'var(--pfg-navy)' }}
            value={assignedLead?.id || ''}
            disabled={saving}
            onChange={e => assignPm(e.target.value)}
          >
            <option value="">{assignedUser ? 'Change PM' : 'Assign PM'}</option>
            {pmUsers.map((u: any) => (
              <option key={u.id} value={u.id}>{u.name}</option>
            ))}
          </select>
        )}
      </div>
    </div>
  );
}

export default function ProjectHubDetail({ params }: { params: { code: string } }) {
  const { data, isLoading, refetch } = useDashboardData();
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState("overview");
  const [cancelling, setCancelling] = useState(false);
  const canEdit = user?.role === "admin" || user?.role === "resource_manager";

  const project = useMemo(
    () => data?.projects.find(p => p.code === params.code) || null,
    [data, params.code]
  );

  const roleSlots = data?.roleSlots || [];
  const assignments: DashboardAssignment[] = data?.assignments || [];
  const { toast } = useToast();

  const handleCancelProject = useCallback(async () => {
    if (!project) return;
    const assignedCount = assignments.filter(
      a => a.projectId === project.id && ["active","confirmed","pending_confirmation","flagged"].includes(a.status || "")
    ).length;
    const msg = assignedCount > 0
      ? `Cancel "${project.name}"? This will release ${assignedCount} assigned worker${assignedCount !== 1 ? "s" : ""} back to available.`
      : `Cancel "${project.name}"? This cannot be undone.`;
    if (!window.confirm(msg)) return;
    setCancelling(true);
    try {
      await apiRequest("PATCH", `/api/projects/${project.id}/status`, { status: "cancelled" });
      await queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
      toast({ title: "Project cancelled", description: assignedCount > 0 ? `${assignedCount} worker${assignedCount !== 1 ? "s" : ""} released back to available.` : undefined });
    } catch (e: any) {
      toast({ title: "Error cancelling project", description: e.message || "Unknown error", variant: "destructive" });
    }
    setCancelling(false);
  }, [project, assignments, toast]);

  if (isLoading) {
    return (
      <div className="space-y-4 animate-pulse">
        <div className="h-8 w-64 rounded-lg" style={{ background: "hsl(var(--muted))" }} />
        <div className="h-12 rounded-lg" style={{ background: "hsl(var(--muted))" }} />
        <div className="h-96 rounded-xl" style={{ background: "hsl(var(--muted))" }} />
      </div>
    );
  }

  if (!project) {
    return (
      <div className="text-center py-20">
        <div className="text-[48px] mb-3 opacity-30">🔍</div>
        <div className="text-lg font-semibold text-pfg-navy font-display mb-2">Project not found</div>
        <p className="text-[13px] mb-4" style={{ color: "var(--pfg-steel)" }}>
          No project with code "{params.code}" was found.
        </p>
        <Link href="/projects">
          <span className="text-[13px] font-semibold" style={{ color: "var(--pfg-yellow-dark)" }}>
            ← Back to Project Hub
          </span>
        </Link>
      </div>
    );
  }

  const color = getOemColor(project);
  const customer = project.customer || PROJECT_CUSTOMER[project.code] || "";

  return (
    <div className="space-y-0">
      {/* Breadcrumb + actions */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-1.5 text-[13px]">
          <Link href="/projects">
            <span className="font-medium hover:underline" style={{ color: "var(--pfg-steel)" }}>Project Hub</span>
          </Link>
          <ChevronRight className="w-3.5 h-3.5" style={{ color: "var(--pfg-steel)" }} />
          <span className="font-semibold text-pfg-navy">{project.name}</span>
          {customer && (
            <span className="oem-pill rounded-full text-white font-semibold ml-2" style={{ background: color }}>
              {customer}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {canEdit && project.status !== "cancelled" && project.status !== "completed" && (
            <button
              onClick={handleCancelProject}
              disabled={cancelling}
              className="flex items-center gap-1.5 text-[12px] font-semibold px-3 py-1.5 rounded-lg border transition-colors hover:bg-red-50"
              style={{ borderColor: "var(--red)", color: "var(--red)" }}
              title="Cancel project and release all assigned workers"
            >
              {cancelling ? <Loader2 className="w-3 h-3 animate-spin" /> : <XCircle className="w-3 h-3" />}
              Cancel Project
            </button>
          )}
          <Link href={`/portal/${project.code}`}>
            <span className="flex items-center gap-1.5 text-[12px] font-semibold px-3 py-1.5 rounded-lg border transition-colors hover:bg-black/5" style={{ borderColor: "hsl(var(--border))", color: "var(--pfg-steel)" }}>
              Customer Portal <ExternalLink className="w-3 h-3" />
            </span>
          </Link>
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex border-b overflow-x-auto no-print" style={{ borderColor: "hsl(var(--border))" }}>
        {TAB_DEFS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className="flex items-center gap-1.5 px-4 py-3 text-[12px] font-semibold border-b-[3px] transition-colors whitespace-nowrap shrink-0"
            style={{
              borderColor: activeTab === tab.key ? "var(--pfg-yellow)" : "transparent",
              color: activeTab === tab.key ? "var(--pfg-navy)" : "hsl(var(--muted-foreground))",
              background: activeTab === tab.key ? "hsl(var(--accent))" : "transparent",
            }}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="pt-5">
        {activeTab === "overview" && (
          <OverviewTab project={project} roleSlots={roleSlots} assignments={assignments} workers={data?.workers || []} canEdit={canEdit} />
        )}
        {activeTab === "rolePlanning" && (
          <ProjectRolePlanningTab project={project} onUpdate={() => refetch()} />
        )}
        {activeTab === "team" && (
          <ProjectTeamTab project={project} onUpdate={() => refetch()} />
        )}
        {activeTab === "timesheets" && (
          <PlaceholderTab label="Timesheets" icon={<ClipboardList className="w-6 h-6" />} />
        )}
        {activeTab === "dailyReports" && (
          <DailyReportHub 
            project={project} 
            workers={data?.workers || []} 
            assignments={assignments}
            roleSlots={data?.roleSlots || []}
            user={user}
          />
        )}
        {activeTab === "logistics" && (
          <PlaceholderTab label="Logistics" icon={<Truck className="w-6 h-6" />} />
        )}
        {activeTab === "documents" && (
          <PlaceholderTab label="Documents" icon={<FolderOpen className="w-6 h-6" />} />
        )}
        {activeTab === "commercial" && (
          <CommercialTab project={project} user={user} workers={data?.workers || []} assignments={assignments} />
        )}
        {activeTab === "marketing" && (
          <PlaceholderTab label="Marketing" icon={<Megaphone className="w-6 h-6" />} />
        )}
        {activeTab === "satisfaction" && (
          <CustomerSatisfactionTab project={project} userRole={user?.role || "observer"} />
        )}
      </div>
    </div>
  );
}
