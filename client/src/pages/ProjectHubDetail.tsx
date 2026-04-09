import { useState, useMemo, useCallback } from "react";
import { Link } from "wouter";
import { useDashboardData, type DashboardProject, type DashboardRoleSlot, type DashboardAssignment } from "@/hooks/use-dashboard-data";
import { OEM_BRAND_COLORS, PROJECT_CUSTOMER, EQUIPMENT_TYPES, OEM_OPTIONS, calcPeakHeadcount } from "@/lib/constants";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/context/AuthContext";
import {
  LayoutDashboard, Users, UserCheck, ClipboardList, FileText,
  Truck, FolderOpen, DollarSign, Megaphone, Star,
  ExternalLink, ChevronRight, AlertTriangle, CheckCircle2, Clock, Activity,
} from "lucide-react";
import ProjectRolePlanningTab from "@/components/project/ProjectRolePlanningTab";
import ProjectTeamTab from "@/components/project/ProjectTeamTab";
import InlineField from "@/components/project/InlineField";

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
  const totalSlotQty = calcPeakHeadcount(projectSlots);
  const projectAssignments = assignments.filter(
    a => a.projectId === project.id && (a.status === "active" || a.status === "flagged")
  );
  const filledCount = projectAssignments.length;
  const unfilled = Math.max(0, totalSlotQty - filledCount);

  let workforceStatus: HealthStatus = "green";
  let workforceNote = "All slots filled";
  if (totalSlotQty === 0) {
    workforceStatus = "grey";
    workforceNote = "No roles planned";
  } else if (unfilled > 0) {
    workforceStatus = "red";
    workforceNote = `${unfilled} of ${totalSlotQty} slots unfilled`;
    flags.push(`${unfilled} slot${unfilled > 1 ? "s" : ""} unfilled`);
    actionCount += unfilled;
  }

  let planningStatus: HealthStatus = "green";
  let planningNote = "All items complete";
  const hasSignatory = project.dayShiftSignatoryName || project.nightShiftSignatoryName;
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
  canEdit,
}: {
  project: DashboardProject;
  roleSlots: DashboardRoleSlot[];
  assignments: DashboardAssignment[];
  canEdit: boolean;
}) {
  const color = getOemColor(project);
  const customer = project.customer || PROJECT_CUSTOMER[project.code] || "";
  const health = computeHealth(project, roleSlots, assignments);
  const pct = timelinePercent(project.startDate, project.endDate);
  const totalDays = project.startDate && project.endDate ? daysBetween(project.startDate, project.endDate) : 0;
  const curDay = project.startDate ? currentDay(project.startDate) : 0;
  const totalSlotQty = calcPeakHeadcount(roleSlots.filter(s => s.projectId === project.id));
  const filledCount = assignments.filter(
    a => a.projectId === project.id && (a.status === "active" || a.status === "flagged")
  ).length;
  const daysLeft = project.endDate ? Math.max(0, Math.ceil((new Date(project.endDate).getTime() - Date.now()) / 86400000)) : null;
  const ftePct = totalSlotQty > 0 ? Math.round((filledCount / totalSlotQty) * 100) : 0;
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
    { label: "Sourcing Contact", nameField: "sourcingContact" as const, value: project.sourcingContact },
    { label: "Customer Project Manager", nameField: "customerProjectManager" as const, value: project.customerProjectManager },
    { label: "Site Manager", nameField: "siteManager" as const, value: project.siteManager },
    { label: "Day Shift Signatory", nameField: "dayShiftSignatoryName" as const, value: project.dayShiftSignatoryName, emailField: "dayShiftSignatoryEmail" as const, email: project.dayShiftSignatoryEmail },
    { label: "Night Shift Signatory", nameField: "nightShiftSignatoryName" as const, value: project.nightShiftSignatoryName, emailField: "nightShiftSignatoryEmail" as const, email: project.nightShiftSignatoryEmail },
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
                      {s.emailField ? (
                        <InlineField value={s.email ?? null} onSave={saveField(s.emailField)} type="email" canEdit={canEdit} placeholder="email@example.com" emptyLabel="—" />
                      ) : (
                        <span style={{ color: "#9ca3af" }}>—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* RIGHT COLUMN (40%) */}
      <div className="lg:col-span-2 space-y-5">
        {/* Overall Health */}
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

        {/* Quick Stats */}
        <div className="rounded-xl border p-5" style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--card))" }}>
          <h3 className="text-[13px] font-bold uppercase tracking-wide mb-3" style={{ color: "var(--pfg-steel)" }}>Quick Stats</h3>
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg p-3 text-center" style={{ background: "hsl(var(--muted))" }}>
              <div className="text-xl font-bold text-pfg-navy font-display">{daysLeft ?? "—"}</div>
              <div className="text-[10px] font-semibold uppercase tracking-wide mt-0.5" style={{ color: "var(--pfg-steel)" }}>Days Remaining</div>
            </div>
            <div className="rounded-lg p-3 text-center" style={{ background: "hsl(var(--muted))" }}>
              <div className="text-xl font-bold font-display" style={{ color: ftePct >= 100 ? "var(--green)" : ftePct >= 50 ? "var(--amber)" : "var(--red)" }}>{ftePct}%</div>
              <div className="text-[10px] font-semibold uppercase tracking-wide mt-0.5" style={{ color: "var(--pfg-steel)" }}>FTE Coverage</div>
            </div>
            <div className="rounded-lg p-3 text-center" style={{ background: "hsl(var(--muted))" }}>
              <div className="text-xl font-bold text-pfg-navy font-display">{filledCount}</div>
              <div className="text-[10px] font-semibold uppercase tracking-wide mt-0.5" style={{ color: "var(--pfg-steel)" }}>Active Workers</div>
            </div>
            <div className="rounded-lg p-3 text-center" style={{ background: "hsl(var(--muted))" }}>
              <div className="text-xl font-bold text-pfg-navy font-display">—</div>
              <div className="text-[10px] font-semibold uppercase tracking-wide mt-0.5" style={{ color: "var(--pfg-steel)" }}>On Time</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ───────────────────────────────────────────────────

export default function ProjectHubDetail({ params }: { params: { code: string } }) {
  const { data, isLoading, refetch } = useDashboardData();
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState("overview");
  const canEdit = user?.role === "admin" || user?.role === "resource_manager";

  const project = useMemo(
    () => data?.projects.find(p => p.code === params.code) || null,
    [data, params.code]
  );

  const roleSlots = data?.roleSlots || [];
  const assignments: DashboardAssignment[] = data?.assignments || [];

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
          <OverviewTab project={project} roleSlots={roleSlots} assignments={assignments} canEdit={canEdit} />
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
          <PlaceholderTab label="Daily Reports" icon={<FileText className="w-6 h-6" />} />
        )}
        {activeTab === "logistics" && (
          <PlaceholderTab label="Logistics" icon={<Truck className="w-6 h-6" />} />
        )}
        {activeTab === "documents" && (
          <PlaceholderTab label="Documents" icon={<FolderOpen className="w-6 h-6" />} />
        )}
        {activeTab === "commercial" && (
          <PlaceholderTab label="Commercial" icon={<DollarSign className="w-6 h-6" />} />
        )}
        {activeTab === "marketing" && (
          <PlaceholderTab label="Marketing" icon={<Megaphone className="w-6 h-6" />} />
        )}
        {activeTab === "satisfaction" && (
          <PlaceholderTab label="Customer Satisfaction & Lessons Learned" icon={<Star className="w-6 h-6" />} />
        )}
      </div>
    </div>
  );
}
