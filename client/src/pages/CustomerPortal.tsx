import React, { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import type { DashboardWorker, DashboardRoleSlot, DashboardAssignment } from "@/hooks/use-dashboard-data";
import { OEM_BRAND_COLORS, PROJECT_CUSTOMER, getProjectColorFromProject, sortSlots } from "@/lib/constants";
import { downloadSqepPdf, downloadCustomerPack } from "@/lib/sqep-pdf";
import { Download, FileDown, Info, Shield, AlertTriangle, AlertCircle } from "lucide-react";

// ─── Name cleaner ──────────────────────────────────────────────────
const cleanName = (n: string) => n.replace(/\s*\([^)]*\)/g, "").trim();

// ─── Weekly timeline helpers ────────────────────────────────────────

interface WeekColumn {
  label: string;
  startDay: Date;
  endDay: Date;
}

const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function buildWeekColumns(startDate: string, endDate: string): WeekColumn[] {
  const start = new Date(startDate);
  start.setDate(start.getDate() - 1);
  const end = new Date(endDate);

  const cols: WeekColumn[] = [];
  const d = new Date(start);
  while (d.getDay() !== 1) d.setDate(d.getDate() - 1);

  while (d <= end) {
    const weekEnd = new Date(d);
    weekEnd.setDate(weekEnd.getDate() + 6);
    cols.push({
      label: `${d.getDate()} ${SHORT_MONTHS[d.getMonth()]}`,
      startDay: new Date(d),
      endDay: new Date(weekEnd),
    });
    d.setDate(d.getDate() + 7);
  }
  return cols;
}

function dateToColumnFraction(date: Date, colStart: Date, colEnd: Date): number {
  const total = colEnd.getTime() - colStart.getTime();
  if (total <= 0) return 0;
  const offset = date.getTime() - colStart.getTime();
  return Math.max(0, Math.min(1, offset / total));
}

// ─── Current reporting week (Mon–Sun) ─────────────────────────────
function getReportingWeek(): string {
  const now = new Date();
  const day = now.getDay(); // 0=Sun
  const diffToMon = (day === 0 ? -6 : 1 - day);
  const mon = new Date(now);
  mon.setDate(now.getDate() + diffToMon);
  const sun = new Date(mon);
  sun.setDate(mon.getDate() + 6);
  const fmt = (d: Date) => `${d.getDate()} ${SHORT_MONTHS[d.getMonth()]}`;
  return `${fmt(mon)} – ${fmt(sun)}`;
}

// ─── Shade OEM colour slightly darker for pill badge ───────────────
function darkenHex(hex: string, amount = 20): string {
  const h = hex.replace("#", "");
  let r = parseInt(h.substring(0, 2), 16);
  let g = parseInt(h.substring(2, 4), 16);
  let b = parseInt(h.substring(4, 6), 16);
  r = Math.max(0, r - amount);
  g = Math.max(0, g - amount);
  b = Math.max(0, b - amount);
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

// ─── Loading skeleton ───────────────────────────────────────────────
function LoadingSkeleton() {
  return (
    <div className="min-h-screen" style={{ background: "#F4F5F7" }}>
      <div className="h-14 bg-pfg-navy" />
      <div className="max-w-[1200px] mx-auto px-6 py-8 space-y-6 animate-pulse">
        <div className="h-28 rounded-xl bg-gray-200" />
        <div className="h-20 rounded-xl bg-gray-200" />
        <div className="h-64 rounded-xl bg-gray-200" />
        <div className="h-96 rounded-xl bg-gray-200" />
      </div>
    </div>
  );
}

// ─── Histogram row type ────────────────────────────────────────────
interface HistogramRow {
  slot: DashboardRoleSlot;
  assignedWorker: DashboardWorker | null;
  assignment: DashboardAssignment | null;
  filled: boolean;
}

// ─── Type pills for observations ──────────────────────────────────
function ObsTypePill({ type }: { type: string }) {
  const map: Record<string, { label: string; bg: string; color: string; border: string }> = {
    positive:         { label: "Positive",        bg: "#f0fdf4", color: "#15803d", border: "#bbf7d0" },
    unsafe_condition: { label: "Unsafe Condition", bg: "#fffbeb", color: "#92400e", border: "#fde68a" },
    negative:         { label: "Negative",         bg: "#fff7ed", color: "#c2410c", border: "#fed7aa" },
    stop_work:        { label: "STOP WORK",        bg: "#fef2f2", color: "#b91c1c", border: "#fecaca" },
  };
  const s = map[type] || { label: type, bg: "#f3f4f6", color: "#6b7280", border: "#e5e7eb" };
  return (
    <span
      className="inline-flex items-center text-[11px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap"
      style={{ background: s.bg, color: s.color, border: `1px solid ${s.border}` }}
    >
      {s.label}
    </span>
  );
}

function IncidentTypePill({ type }: { type: string }) {
  const map: Record<string, { label: string; bg: string; color: string; border: string }> = {
    near_miss:           { label: "Near Miss",       bg: "#fffbeb", color: "#92400e", border: "#fde68a" },
    first_aid:           { label: "First Aid",       bg: "#fff7ed", color: "#c2410c", border: "#fed7aa" },
    medical_treatment:   { label: "Medical Treat.",  bg: "#fff7ed", color: "#c2410c", border: "#fed7aa" },
    lost_time_injury:    { label: "LTI",             bg: "#fef2f2", color: "#b91c1c", border: "#fecaca" },
    dangerous_occurrence:{ label: "Dangerous Occ.", bg: "#fef2f2", color: "#b91c1c", border: "#fecaca" },
  };
  const s = map[type] || { label: type, bg: "#f3f4f6", color: "#6b7280", border: "#e5e7eb" };
  return (
    <span
      className="inline-flex items-center text-[11px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap"
      style={{ background: s.bg, color: s.color, border: `1px solid ${s.border}` }}
    >
      {s.label}
    </span>
  );
}

function StatusPill({ status }: { status: string }) {
  const closed = status === "closed";
  return (
    <span
      className="inline-flex items-center text-[11px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap"
      style={
        closed
          ? { background: "#f0fdf4", color: "#15803d", border: "1px solid #bbf7d0" }
          : { background: "#f3f4f6", color: "#6b7280", border: "1px solid #e5e7eb" }
      }
    >
      {closed ? "Closed" : status === "under_investigation" ? "Investigating" : "Open"}
    </span>
  );
}

// ─── Report row with expandable tasks accordion ────────────────────
function ReportRow({ report, color, projectCode }: { report: any; color: string; projectCode: string }) {
  const [tasksOpen, setTasksOpen] = React.useState(false);
  const tasks = Array.isArray(report.completedTasks) ? report.completedTasks : [];
  const delayCount = Array.isArray(report.delaysLog) ? report.delaysLog.length : 0;

  return (
    <div className="rounded-xl" style={{ background: "#fff", border: "1px solid #e2e5eb", borderLeft: `3px solid ${color}`, boxShadow: "0 1px 3px rgba(0,0,0,0.06)" }}>
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4" style={{ padding: "20px 24px" }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, color: "#111318", marginBottom: 6 }}>Week of {report.reportDate}</div>
          <div className="flex items-center gap-3 flex-wrap">
            <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full" style={{ background: "#f0fdf4", color: "#15803d", border: "1px solid #bbf7d0" }}>
              <svg width="8" height="8" viewBox="0 0 10 10" fill="currentColor"><circle cx="5" cy="5" r="4"/></svg>
              Published
            </span>
            <span style={{ fontSize: 12, color: "#6b7280" }}>{tasks.length} tasks · {delayCount} delays</span>
          </div>
        </div>
        <div className="flex gap-2 flex-wrap items-center">
          {tasks.length > 0 && (
            <button
              onClick={() => setTasksOpen(o => !o)}
              className="inline-flex items-center gap-1 text-xs font-semibold rounded-lg"
              style={{ background: "#f4f5f7", color: "#1A1D23", padding: "6px 12px", border: "1px solid #e2e5eb" }}
            >
              {tasksOpen ? "Hide Tasks" : `View ${tasks.length} Tasks`}
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" style={{ transform: tasksOpen ? "rotate(180deg)" : "none", transition: "transform 160ms" }}>
                <path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
          )}
          <a
            href={`/api/portal/${projectCode}/report/${report.id}/pdf`}
            target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs font-semibold rounded-lg"
            style={{ background: color, color: "#fff", padding: "6px 12px", textDecoration: "none" }}
          >
            <Download className="w-3 h-3" />
            Download PDF
          </a>
        </div>
      </div>

      {/* Expandable tasks */}
      {tasksOpen && (
        <div style={{ borderTop: "1px solid #eaecf0", padding: "16px 24px" }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: "#6b7280", marginBottom: 10, textTransform: "uppercase", letterSpacing: "0.05em" }}>Completed Tasks</div>
          <div className="flex flex-col gap-2">
            {tasks.map((task: any, i: number) => (
              <div key={i} className="flex items-start gap-3" style={{ padding: "10px 12px", background: "#f9fafb", borderRadius: 6 }}>
                <div style={{ minWidth: 36, height: 20, background: color + "18", color, borderRadius: 4, fontSize: 11, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  {task.pctComplete ?? 0}%
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, color: "#111318", fontWeight: 500 }}>{task.description}</div>
                  {task.notes && <div style={{ fontSize: 12, color: "#6b7280", marginTop: 2 }}>{task.notes}</div>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════

export default function CustomerPortal({ params }: { params: { projectCode: string } }) {
  const [activeTab, setActiveTab] = useState<"overview" | "reports" | "hs">("overview");
  const [downloading, setDownloading] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["/api/portal", params.projectCode],
    queryFn: () => apiRequest("GET", `/api/portal/${params.projectCode}`).then(r => (r as any).json()),
    retry: false,
  });

  const portalData = useMemo(() => {
    if (!data) return null;
    const { project, roleSlots, assignments, workers: workersMap, publishedReports, safetyData, kpis } = data as any;
    if (!project) return null;

    const customer = project.customer || PROJECT_CUSTOMER[project.code] || "";
    const color = getProjectColorFromProject(project);

    const projectRoleSlots: DashboardRoleSlot[] = (roleSlots || []).map((s: any) => ({
      ...s,
      projectCode: project.code,
      projectName: project.name,
    }));

    const teamMembers: { worker: DashboardWorker; assignment: DashboardAssignment }[] = [];
    for (const a of (assignments || [])) {
      const w = workersMap[a.workerId];
      if (w) teamMembers.push({ worker: w as DashboardWorker, assignment: a as DashboardAssignment });
    }

    const seen = new Set<string>();
    const uniqueTeamMembers = teamMembers.filter((m) => {
      const key = `${m.worker.id}-${m.assignment.startDate}-${m.assignment.endDate}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    const histogramRows: HistogramRow[] = projectRoleSlots.flatMap((slot) => {
      const slotAssignments = uniqueTeamMembers.filter((m) => m.assignment.roleSlotId === slot.id);
      const rows: HistogramRow[] = [];
      for (const m of slotAssignments) {
        rows.push({ slot, assignedWorker: m.worker, assignment: m.assignment, filled: true });
      }
      const unfilled = Math.max(0, slot.quantity - slotAssignments.length);
      for (let i = 0; i < unfilled; i++) {
        rows.push({ slot, assignedWorker: null, assignment: null, filled: false });
      }
      return rows;
    });

    if (histogramRows.length === 0 && uniqueTeamMembers.length > 0) {
      for (const m of uniqueTeamMembers) {
        histogramRows.push({
          slot: {
            id: 0, projectId: project.id,
            role: m.assignment.task || m.worker.role,
            startDate: m.assignment.startDate || "",
            endDate: m.assignment.endDate || "",
            quantity: 1,
            shift: m.assignment.shift || "Day",
            projectCode: project.code,
            projectName: project.name,
          },
          assignedWorker: m.worker,
          assignment: m.assignment,
          filled: true,
        });
      }
    }

    const SHIFT_ORDER: Record<string, number> = { Day: 0, Night: 1 };
    const ROLE_ORDER = ["Superintendent","Foreman","Lead Technician","Technician 2","Technician 1","Rigger","Crane Driver","HSE Officer","Welder","I&C Technician","Electrician","Apprentice"];
    histogramRows.sort((a, b) => {
      const shiftA = SHIFT_ORDER[a.slot.shift ?? "Day"] ?? 0;
      const shiftB = SHIFT_ORDER[b.slot.shift ?? "Day"] ?? 0;
      if (shiftA !== shiftB) return shiftA - shiftB;
      const roleA = ROLE_ORDER.indexOf(a.slot.role);
      const roleB = ROLE_ORDER.indexOf(b.slot.role);
      return (roleA === -1 ? 99 : roleA) - (roleB === -1 ? 99 : roleB);
    });

    const weekColumns = (project.startDate && project.endDate)
      ? buildWeekColumns(project.startDate, project.endDate)
      : [];

    return { project, customer, color, teamMembers: uniqueTeamMembers, histogramRows, weekColumns, projectRoleSlots, publishedReports: publishedReports || [], safetyData: safetyData || {}, kpis: kpis || {} };
  }, [data, params.projectCode]);

  if (isLoading || !data) return <LoadingSkeleton />;

  if (!portalData) {
    return (
      <div className="min-h-screen" style={{ background: "#F4F5F7" }}>
        <header className="bg-pfg-navy text-white px-6 h-14 flex items-center" style={{ boxShadow: "0 1px 0 rgba(255,255,255,0.06)" }}>
          <img src="/logo-gold.png" alt="Powerforce Global" style={{ height: 32, display: "block" }} />
          <span className="text-xs font-medium tracking-widest uppercase text-white/40 ml-4">Customer Portal</span>
        </header>
        <div className="flex items-center justify-center py-32">
          <div className="text-center">
            <h2 className="text-xl font-bold text-pfg-navy mb-2">Project Not Found</h2>
            <p className="text-sm text-gray-500">No project found with code "{params.projectCode}"</p>
          </div>
        </div>
      </div>
    );
  }

  const { project, customer, color, teamMembers, histogramRows, weekColumns, projectRoleSlots, publishedReports, safetyData, kpis } = portalData;
  const today = new Date();

  // Progress calculation
  const projectStart = project.startDate ? new Date(project.startDate) : null;
  const projectEnd = project.endDate ? new Date(project.endDate) : null;
  const totalDays = (projectStart && projectEnd) ? Math.ceil((projectEnd.getTime() - projectStart.getTime()) / 86400000) : null;
  const daysElapsed = projectStart ? Math.max(0, Math.ceil((today.getTime() - projectStart.getTime()) / 86400000)) : 0;
  const progressPct = (totalDays && totalDays > 0) ? Math.min(100, Math.round(daysElapsed / totalDays * 100)) : 0;

  const darkerColor = darkenHex(color, 25);
  const reportingWeek = getReportingWeek();

  // Toolbox talks / safety obs / incidents from safetyData
  const toolboxTalksList: any[] = safetyData?.toolboxTalks?.list || [];
  const safetyObsList: any[] = safetyData?.safetyObservations?.list || [];
  const incidentsList: any[] = safetyData?.incidentReports?.list || [];

  // Obs type breakdown
  const obsPositive = safetyObsList.filter(o => o.observationType === "positive").length;
  const obsUnsafe = safetyObsList.filter(o => o.observationType === "unsafe_condition").length;
  const obsNegative = safetyObsList.filter(o => o.observationType === "negative").length;
  const obsStop = safetyObsList.filter(o => o.observationType === "stop_work").length;

  // Incident type breakdown
  const incNearMiss = incidentsList.filter(i => i.incidentType === "near_miss").length;
  const incFirstAid = incidentsList.filter(i => i.incidentType === "first_aid").length;
  const incLTI = incidentsList.filter(i => i.incidentType === "lost_time_injury").length;

  // Sorted team for table (Day first, then Night; by role rank)
  const ROLE_ORDER_TABLE = ["Superintendent","Foreman","Lead Technician","Technician 2","Technician 1","Rigger","Crane Driver","HSE Officer","Welder","I&C Technician","Electrician","Apprentice"];
  const sortedTeam = [...teamMembers].sort((a, b) => {
    const SHIFT_ORDER: Record<string, number> = { Day: 0, Night: 1 };
    const slotA = projectRoleSlots.find(s => s.id === a.assignment.roleSlotId);
    const slotB = projectRoleSlots.find(s => s.id === b.assignment.roleSlotId);
    const shiftA = SHIFT_ORDER[slotA?.shift ?? a.assignment.shift ?? "Day"] ?? 0;
    const shiftB = SHIFT_ORDER[slotB?.shift ?? b.assignment.shift ?? "Day"] ?? 0;
    if (shiftA !== shiftB) return shiftA - shiftB;
    const roleA = ROLE_ORDER_TABLE.indexOf(slotA?.role ?? a.assignment.task ?? a.worker.role);
    const roleB = ROLE_ORDER_TABLE.indexOf(slotB?.role ?? b.assignment.task ?? b.worker.role);
    return (roleA === -1 ? 99 : roleA) - (roleB === -1 ? 99 : roleB);
  });

  return (
    <div className="min-h-screen" style={{ background: "#F4F5F7" }}>

      {/* ── TOP NAVBAR ── */}
      <header
        className="sticky top-0 z-50 flex items-center"
        style={{ background: "#1A1D23", height: 56, boxShadow: "0 1px 0 rgba(255,255,255,0.06)", padding: "0 24px" }}
      >
        <div className="flex items-center justify-between w-full" style={{ maxWidth: 1200, margin: "0 auto" }}>
          <div className="flex items-center gap-3">
            <img src="/logo-gold.png" alt="Powerforce Global" style={{ height: 32, display: "block" }} />
          </div>
          <div className="flex items-center gap-4">
            <span style={{ fontSize: 11, color: "rgba(255,255,255,0.45)", letterSpacing: "0.04em", textTransform: "uppercase", fontWeight: 500 }}>
              Customer Portal
            </span>
            <div style={{ width: 1, height: 16, background: "rgba(255,255,255,0.15)" }} />
            <span style={{ fontSize: 11, color: "rgba(255,255,255,0.3)", fontWeight: 400 }}>Confidential</span>
          </div>
        </div>
      </header>

      {/* ── PROJECT HEADER BAND ── */}
      <div style={{ background: "#ffffff", borderBottom: "1px solid #e2e5eb", padding: "24px 24px 0" }}>
        <div style={{ maxWidth: 1200, margin: "0 auto" }}>
          <div className="flex items-start justify-between flex-wrap gap-4 mb-5">

            {/* Left: title + meta */}
            <div>
              <div className="flex items-center gap-3 flex-wrap mb-2">
                <h1 style={{ fontSize: "clamp(1.25rem, 1.1rem + 0.75vw, 1.75rem)", fontWeight: 700, letterSpacing: "-0.025em", color: "#111318", lineHeight: 1.2 }}>
                  {project.name}
                </h1>
                {customer && (
                  <span
                    className="inline-flex items-center text-xs font-semibold px-2.5 py-1 rounded-full whitespace-nowrap"
                    style={{ background: darkerColor, color: "#fff", letterSpacing: "0.02em" }}
                  >
                    {customer}
                  </span>
                )}
                {/* Reporting week badge */}
                <span
                  className="ml-auto text-[11px] font-bold px-3 py-1 rounded-full whitespace-nowrap"
                  style={{ background: "#F5BD00", color: "#1A1D23", letterSpacing: "0.03em" }}
                >
                  REPORTING WEEK: {reportingWeek}
                </span>
              </div>

              <div className="flex items-center gap-3 flex-wrap" style={{ color: color }}>
                {project.siteName && (
                  <span className="flex items-center gap-1.5 text-xs font-normal">
                    <svg width="11" height="11" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M8 1.5C5.51 1.5 3.5 3.51 3.5 6c0 3.75 4.5 8.5 4.5 8.5s4.5-4.75 4.5-8.5c0-2.49-2.01-4.5-4.5-4.5zm0 6.25A1.75 1.75 0 1 1 8 4a1.75 1.75 0 0 1 0 3.75z" fill="currentColor"/></svg>
                    {project.siteName}
                  </span>
                )}
                {project.startDate && project.endDate && (
                  <>
                    {project.siteName && <span style={{ color: "#b0b8c4", fontSize: 10 }}>·</span>}
                    <span className="flex items-center gap-1.5 text-xs">
                      <svg width="11" height="11" viewBox="0 0 16 16" fill="none" aria-hidden="true"><rect x="1.5" y="3" width="13" height="12" rx="1.5" stroke="currentColor" strokeWidth="1.5"/><path d="M1.5 7h13" stroke="currentColor" strokeWidth="1.5"/><path d="M5 1.5v3M11 1.5v3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
                      {project.startDate} → {project.endDate}
                    </span>
                  </>
                )}
                {project.shift && (
                  <>
                    <span style={{ color: "#b0b8c4", fontSize: 10 }}>·</span>
                    <span className="flex items-center gap-1.5 text-xs">
                      <svg width="11" height="11" viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle cx="8" cy="8" r="2.5" stroke="currentColor" strokeWidth="1.5"/><path d="M8 1v2M8 13v2M1 8h2M13 8h2M2.93 2.93l1.41 1.41M11.66 11.66l1.41 1.41M2.93 13.07l1.41-1.41M11.66 4.34l1.41-1.41" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
                      {project.shift}
                    </span>
                  </>
                )}
                {project.code && (
                  <>
                    <span style={{ color: "#b0b8c4", fontSize: 10 }}>·</span>
                    <span className="text-xs font-mono">{project.code}</span>
                  </>
                )}
              </div>
            </div>

            {/* Right: progress bar */}
            <div style={{ minWidth: 200, flexShrink: 0 }}>
              <div className="flex justify-between items-center mb-1.5">
                <span style={{ fontSize: 11, color: "#6b7280", fontWeight: 500 }}>Project Progress</span>
                <span style={{ fontSize: 11, fontWeight: 700, color: color }}>{progressPct}%</span>
              </div>
              <div style={{ height: 6, background: color + "22", borderRadius: 999, overflow: "hidden" }}>
                <div style={{ height: "100%", background: color, borderRadius: 999, width: `${progressPct}%`, transition: "width 0.6s cubic-bezier(0.16,1,0.3,1)" }} />
              </div>
              {project.startDate && project.endDate && (
                <div className="flex justify-between mt-1">
                  <span style={{ fontSize: 11, color: "#b0b8c4" }}>{project.startDate}</span>
                  <span style={{ fontSize: 11, color: "#b0b8c4" }}>{project.endDate}</span>
                </div>
              )}
            </div>
          </div>

          {/* TAB BAR */}
          <nav className="flex" role="tablist" aria-label="Portal sections" style={{ marginTop: 16 }}>
            {(["overview", "reports", "hs"] as const).map((tab) => {
              const labels: Record<typeof tab, string> = { overview: "Overview", reports: "Project Reports", hs: "Health & Safety" };
              const isActive = activeTab === tab;
              return (
                <button
                  key={tab}
                  role="tab"
                  aria-selected={isActive}
                  onClick={() => setActiveTab(tab)}
                  style={{
                    padding: "10px 20px",
                    fontSize: 14,
                    fontWeight: isActive ? 600 : 500,
                    color: isActive ? color : "#6b7280",
                    borderBottom: isActive ? `2px solid ${color}` : "2px solid transparent",
                    borderRadius: 0,
                    background: "none",
                    cursor: "pointer",
                    whiteSpace: "nowrap",
                    position: "relative",
                    top: 1,
                    transition: "color 160ms, border-color 160ms",
                  }}
                >
                  {labels[tab]}
                </button>
              );
            })}
          </nav>
        </div>
      </div>

      {/* ── MAIN CONTENT ── */}
      <main style={{ maxWidth: 1200, margin: "0 auto", padding: "32px 24px" }}>

        {/* ════════════════ TAB 1: OVERVIEW ════════════════ */}
        {activeTab === "overview" && (
          <div style={{ animation: "fadeIn 180ms ease-out" }}>

            {/* KPI Strip */}
            <div
              className="grid gap-4 mb-8"
              style={{ gridTemplateColumns: "repeat(4, 1fr)" }}
              aria-label="Key metrics"
            >
              {/* Days Remaining */}
              <div
                className="rounded-xl p-5"
                style={{ background: "#fff", border: "1px solid #e2e5eb", boxShadow: "0 1px 3px rgba(0,0,0,0.06)", borderLeft: `3px solid ${color}` }}
              >
                <div style={{ fontSize: 11, fontWeight: 500, color: "#6b7280", letterSpacing: "0.04em", textTransform: "uppercase", marginBottom: 8 }}>Days Remaining</div>
                <div style={{ fontSize: "clamp(1.5rem,1.2rem+1vw,2rem)", fontWeight: 700, letterSpacing: "-0.03em", color: color, lineHeight: 1, marginBottom: 8 }}>
                  {kpis.daysRemaining ?? "—"}
                </div>
                <div style={{ fontSize: 12, color: "#6b7280" }}>of {kpis.totalDays ?? "—"} total days</div>
              </div>

              {/* Active Team */}
              <div
                className="rounded-xl p-5"
                style={{ background: "#fff", border: "1px solid #e2e5eb", boxShadow: "0 1px 3px rgba(0,0,0,0.06)", borderLeft: `3px solid ${color}` }}
              >
                <div style={{ fontSize: 11, fontWeight: 500, color: "#6b7280", letterSpacing: "0.04em", textTransform: "uppercase", marginBottom: 8 }}>On Site Now</div>
                <div style={{ fontSize: "clamp(1.5rem,1.2rem+1vw,2rem)", fontWeight: 700, letterSpacing: "-0.03em", color: "#111318", lineHeight: 1, marginBottom: 8 }}>
                  {teamMembers.filter(m => {
                    const s = m.assignment.startDate ? new Date(m.assignment.startDate) : null;
                    const e = m.assignment.endDate ? new Date(m.assignment.endDate) : null;
                    const t = new Date(); t.setHours(0,0,0,0);
                    return s && e && s <= t && e >= t;
                  }).length}
                </div>
                <div style={{ fontSize: 12, color: "#6b7280" }}>Day &amp; Night shifts</div>
              </div>

              {/* Delays */}
              <div
                className="rounded-xl p-5"
                style={{ background: "#fff", border: "1px solid #e2e5eb", boxShadow: "0 1px 3px rgba(0,0,0,0.06)", borderLeft: `3px solid ${(kpis.delayCount ?? 0) === 0 ? "#15803d" : "#d97706"}` }}
              >
                <div style={{ fontSize: 11, fontWeight: 500, color: "#6b7280", letterSpacing: "0.04em", textTransform: "uppercase", marginBottom: 8 }}>Delays</div>
                <div style={{ marginBottom: 8, paddingTop: 4 }}>
                  {(kpis.delayCount ?? 0) === 0 ? (
                    <span className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded-full" style={{ background: "#f0fdf4", color: "#15803d", border: "1px solid #bbf7d0" }}>
                      <svg width="10" height="10" viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>
                      No delays logged
                    </span>
                  ) : (
                    <span style={{ fontSize: "clamp(1.5rem,1.2rem+1vw,2rem)", fontWeight: 700, color: "#d97706", lineHeight: 1 }}>{kpis.delayCount}</span>
                  )}
                </div>
                <div style={{ fontSize: 12, color: "#6b7280" }}>{(kpis.delayCount ?? 0) === 0 ? "On schedule" : "delay(s) recorded"}</div>
              </div>

              {/* Safety Observations */}
              <div
                className="rounded-xl p-5"
                style={{ background: "#fff", border: "1px solid #e2e5eb", boxShadow: "0 1px 3px rgba(0,0,0,0.06)", borderLeft: `3px solid ${(kpis.safetyObsCount ?? 0) === 0 ? "#15803d" : "#111318"}` }}
              >
                <div style={{ fontSize: 11, fontWeight: 500, color: "#6b7280", letterSpacing: "0.04em", textTransform: "uppercase", marginBottom: 8 }}>Safety Observations</div>
                <div style={{ fontSize: "clamp(1.5rem,1.2rem+1vw,2rem)", fontWeight: 700, letterSpacing: "-0.03em", color: "#111318", lineHeight: 1, marginBottom: 8 }}>
                  {kpis.safetyObsCount ?? 0}
                </div>
                <div>
                  {(kpis.safetyObsCount ?? 0) === 0 ? (
                    <span className="inline-flex items-center gap-1 text-[11px] font-500 px-2 py-0.5 rounded-full" style={{ background: "#f3f4f6", color: "#6b7280", border: "1px solid #e5e7eb" }}>
                      Zero incidents
                    </span>
                  ) : (
                    <span style={{ fontSize: 12, color: "#6b7280" }}>observations logged</span>
                  )}
                </div>
              </div>
            </div>

            {/* Team Deployment Gantt */}
            <section aria-labelledby="gantt-heading" className="mb-8">
              <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
                <div className="flex items-center gap-3">
                  <h2 id="gantt-heading" style={{ fontSize: 15, fontWeight: 700, letterSpacing: "0.01em", color: "#1a2744" }}>Team Deployment</h2>
                  <span
                    className="text-xs font-semibold px-2 py-0.5 rounded-full"
                    style={{ background: "#f3f4f6", border: "1px solid #e2e5eb", color: "#6b7280" }}
                  >
                    {histogramRows.filter(r => r.filled).length} assigned
                  </span>
                </div>
                <button
                  onClick={async () => {
                    if (!portalData || downloading) return;
                    setDownloading(true);
                    try { await downloadCustomerPack(portalData.project, portalData.teamMembers, portalData.customer, portalData.projectRoleSlots); }
                    finally { setDownloading(false); }
                  }}
                  disabled={downloading}
                  className="inline-flex items-center gap-2 rounded-lg text-xs font-bold transition-all hover:opacity-90 disabled:opacity-60"
                  style={{ background: "#F5BD00", color: "#1A1D23", padding: "8px 16px" }}
                >
                  <Download className="w-3.5 h-3.5" />
                  {downloading ? "Preparing…" : "Download Team SQEP"}
                </button>
              </div>

              <div className="rounded-xl" style={{ background: "#fff", border: "1px solid #e2e5eb", boxShadow: "0 1px 3px rgba(0,0,0,0.06)", padding: 24, overflowX: "auto" }}>
                {/* Legend */}
                <div className="flex gap-5 mb-5 flex-wrap">
                  <div className="flex items-center gap-2 text-xs font-medium" style={{ color: "#6b7280" }}>
                    <div style={{ width: 20, height: 10, borderRadius: 2, background: color }} />
                    Confirmed deployment
                  </div>
                  <div className="flex items-center gap-2 text-xs font-medium" style={{ color: "#6b7280" }}>
                    <div style={{ width: 20, height: 10, borderRadius: 2, background: "transparent", border: "1.5px dashed #b0b8c4" }} />
                    Provisional / TBC
                  </div>
                  <div className="flex items-center gap-2 ml-auto" style={{ fontSize: 11, color: "#dc2626", fontWeight: 600 }}>
                    <div style={{ width: 2, height: 14, background: "#dc2626", borderRadius: 1 }} />
                    Today
                  </div>
                </div>

                {weekColumns.length > 0 ? (
                  <div style={{ minWidth: Math.max(720, 220 + weekColumns.length * 48) }}>
                    {/* Header */}
                    <div style={{ display: "grid", gridTemplateColumns: "220px 1fr", marginBottom: 12, paddingBottom: 12, borderBottom: "1px solid #eaecf0" }}>
                      <div style={{ fontSize: 11, fontWeight: 600, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.05em" }}>Team Member</div>
                      <div style={{ display: "grid", gridTemplateColumns: `repeat(${weekColumns.length}, 1fr)` }}>
                        {weekColumns.map((col, i) => {
                          const parts = col.label.split(" ");
                          const dayNum = parseInt(parts[0]);
                          const isMonthStart = dayNum <= 7 || i === 0;
                          return (
                            <div key={i} style={{ fontSize: isMonthStart ? 10 : 9, fontWeight: isMonthStart ? 700 : 400, color: isMonthStart ? color : "#b0b8c4", letterSpacing: "0.04em", textTransform: "uppercase", textAlign: "center" }}>
                              {isMonthStart ? parts[1] : parts[0]}
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {/* Gantt rows */}
                    {histogramRows.length === 0 ? (
                      <div className="text-center py-12 text-sm" style={{ color: "#6b7280" }}>No assignments defined</div>
                    ) : (() => {
                      const elements: React.ReactNode[] = [];
                      let lastShift: string | null = null;
                      histogramRows.forEach((row, idx) => {
                        const shift = row.slot.shift || "Day";
                        const personName = row.assignedWorker ? cleanName(row.assignedWorker.name) : null;
                        const roleName = row.slot.role;
                        const isFilled = row.filled;
                        // Bars come from slot periods — same for filled and unfilled
                        const slotPeriods = (row.slot as any).periods as Array<{ startDate: string; endDate: string }> | undefined;
                        // Prefer assignment dates over slot periods — slot periods can be wrong (old data)
                        // Fall back: if assignment has valid dates, use those; otherwise use slot periods
                        const assignStart = row.assignment?.startDate;
                        const assignEnd = row.assignment?.endDate;
                        const barsToRender: Array<{ start: string; end: string }> = assignStart && assignEnd
                          ? [{ start: assignStart, end: assignEnd }]
                          : slotPeriods && slotPeriods.length > 0
                            ? slotPeriods.map(p => ({ start: p.startDate, end: p.endDate }))
                            : [{ start: row.slot.startDate, end: row.slot.endDate }];
                        const barStart = barsToRender[0].start;
                        const barEnd = barsToRender[barsToRender.length - 1].end;

                        if (shift !== lastShift) {
                          elements.push(
                            <div key={`shift-${shift}-${idx}`} style={{
                              fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase",
                              color: shift === "Night" ? "#F5BD00" : "#b0b8c4",
                              padding: "12px 0 6px",
                              borderTop: lastShift !== null ? "1px solid #eaecf0" : undefined,
                              background: shift === "Night" ? "#1a2744" : undefined,
                              marginLeft: shift === "Night" ? -24 : undefined,
                              marginRight: shift === "Night" ? -24 : undefined,
                              paddingLeft: shift === "Night" ? 24 : undefined,
                              paddingRight: shift === "Night" ? 24 : undefined,
                            }}>
                              {shift === "Night" ? "🌙 NIGHT SHIFT" : "☀️ DAY SHIFT"}
                            </div>
                          );
                          lastShift = shift;
                        }

                        // Position number: index among all rows sharing the same slotId
                        const slotRows = histogramRows.filter(r => r.slot.id === row.slot.id || (r.slot.id === 0 && row.slot.id === 0 && r.slot.role === row.slot.role));
                        const posNum = slotRows.indexOf(row) + 1;
                        const slotTotal = row.slot.quantity;
                        const showPosition = slotTotal > 1;

                        elements.push(
                          <div key={idx} style={{ display: "grid", gridTemplateColumns: "220px 1fr", alignItems: "center", minHeight: 40, borderBottom: "1px solid #eaecf0" }}>
                            <div style={{ paddingRight: 16 }}>
                              <div style={{ fontSize: 13, fontWeight: 500, color: "#111318", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                                {personName || <span style={{ color: "#d97706", fontStyle: "italic" }}>Unfilled</span>}
                              </div>
                              <div style={{ fontSize: 11, color: "#6b7280" }}>
                                {roleName}{showPosition ? <span style={{ marginLeft: 4, opacity: 0.6 }}>{posNum}/{slotTotal}</span> : null}
                              </div>
                            </div>
                            <div style={{ position: "relative", height: 40, display: "flex", alignItems: "center" }}>
                              {/* Grid cells */}
                              <div style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, display: "grid", gridTemplateColumns: `repeat(${weekColumns.length}, 1fr)`, pointerEvents: "none" }}>
                                {weekColumns.map((_, ci) => (
                                  <div key={ci} style={{ borderRight: ci < weekColumns.length - 1 ? "1px solid #eaecf0" : "none" }} />
                                ))}
                              </div>
                              {/* Bars — one per period */}
                              {(() => {
                                const totalCols = weekColumns.length;
                                if (totalCols === 0) return null;
                                const rangeStart = weekColumns[0].startDay.getTime();
                                const rangeEnd = weekColumns[totalCols - 1].endDay.getTime();
                                const rangeMs = rangeEnd - rangeStart;
                                if (rangeMs <= 0) return null;
                                return barsToRender.map((bar, bIdx) => {
                                  const barStartDate = new Date(bar.start);
                                  const barEndDate = new Date(bar.end);
                                  const leftPct = Math.max(0, Math.min(100, (barStartDate.getTime() - rangeStart) / rangeMs * 100));
                                  const rightMs = Math.max(rangeStart, Math.min(rangeEnd, barEndDate.getTime()));
                                  const widthPct = Math.max(0, (rightMs - Math.max(barStartDate.getTime(), rangeStart)) / rangeMs * 100);
                                  const periodLabel = barsToRender.length > 1 ? ` — Period ${bIdx + 1}` : "";
                                  return (
                                    <div
                                      key={bIdx}
                                      style={{
                                        position: "absolute",
                                        left: `${leftPct}%`,
                                        width: `${widthPct}%`,
                                        height: 20,
                                        borderRadius: 3,
                                        background: isFilled ? color : "transparent",
                                        border: isFilled ? "none" : `1.5px dashed ${color}`,
                                        opacity: isFilled ? 0.85 : 0.55,
                                        zIndex: 1,
                                      }}
                                      title={`${roleName} — ${personName || "Unfilled"} (${bar.start} → ${bar.end})${periodLabel}`}
                                    />
                                  );
                                });
                              })()}
                              {/* Today line */}
                              {(() => {
                                const totalCols = weekColumns.length;
                                if (totalCols === 0) return null;
                                const rangeStart = weekColumns[0].startDay.getTime();
                                const rangeEnd = weekColumns[totalCols - 1].endDay.getTime();
                                const rangeMs = rangeEnd - rangeStart;
                                if (rangeMs <= 0) return null;
                                const todayMs = today.getTime();
                                if (todayMs < rangeStart || todayMs > rangeEnd) return null;
                                const todayPct = (todayMs - rangeStart) / rangeMs * 100;
                                return (
                                  <div style={{ position: "absolute", top: 0, bottom: 0, left: `${todayPct}%`, width: 2, background: "#dc2626", zIndex: 10 }}>
                                    {idx === 0 && (
                                      <div style={{ position: "absolute", top: -18, left: -14, fontSize: 10, fontWeight: 700, color: "#dc2626", whiteSpace: "nowrap" }}>Today</div>
                                    )}
                                  </div>
                                );
                              })()}
                            </div>
                          </div>
                        );
                      });
                      return elements;
                    })()}
                  </div>
                ) : (
                  <div className="text-center py-12 text-sm" style={{ color: "#6b7280" }}>No timeline data available</div>
                )}
              </div>
            </section>
          </div>
        )}

        {/* ════════════════ TAB 2: PROJECT REPORTS ════════════════ */}
        {activeTab === "reports" && (
          <div style={{ animation: "fadeIn 180ms ease-out" }}>
            <div className="flex items-center gap-3 mb-6">
              <h2 style={{ fontSize: 16, fontWeight: 700, letterSpacing: "-0.01em", color: "#111318" }}>Weekly Project Reports</h2>
            </div>

            {(!publishedReports || publishedReports.length === 0) ? (
              <div className="rounded-xl p-12 text-center" style={{ background: "#fff", border: "1px solid #e2e5eb", boxShadow: "0 1px 3px rgba(0,0,0,0.06)" }}>
                <div className="w-10 h-10 rounded-xl flex items-center justify-center mx-auto mb-3" style={{ background: "#F4F5F7", color: "#b0b8c4" }}>
                  <Info className="w-5 h-5" />
                </div>
                <div style={{ fontSize: 14, fontWeight: 600, color: "#6b7280", marginBottom: 4 }}>No reports published yet</div>
                <p style={{ fontSize: 12, color: "#b0b8c4", maxWidth: "36ch", margin: "0 auto" }}>
                  Weekly reports will appear here every Monday morning.
                </p>
              </div>
            ) : (
              <>
                <div className="rounded-xl p-6 mb-6" style={{ background: "#fff", border: "1px solid #e2e5eb", boxShadow: "0 1px 3px rgba(0,0,0,0.06)" }}>
                  <div style={{ fontSize: 15, fontWeight: 700, color: "#111318", marginBottom: 8 }}>Automated Weekly Reports</div>
                  <p style={{ fontSize: 14, color: "#6b7280", maxWidth: "60ch" }}>
                    Reports are published every Monday. You'll receive an email with the PDF attached.
                  </p>
                </div>
                <div className="flex flex-col gap-3">
                  {publishedReports.map((report: any) => (
                    <ReportRow key={report.id} report={report} color={color} projectCode={params.projectCode} />
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {/* ════════════════ TAB 3: HEALTH & SAFETY ════════════════ */}
        {activeTab === "hs" && (
          <div style={{ animation: "fadeIn 180ms ease-out" }}>
            <div className="flex items-center justify-between flex-wrap gap-3 mb-6">
              <div className="flex items-center gap-3">
                <h2 style={{ fontSize: 16, fontWeight: 700, letterSpacing: "-0.01em", color: "#111318" }}>Health &amp; Safety</h2>
                <span className="text-xs font-semibold px-2 py-0.5 rounded-full" style={{ background: "#f3f4f6", border: "1px solid #e2e5eb", color: "#6b7280" }}>
                  {project.code}
                </span>
              </div>
            </div>

            <div className="flex flex-col gap-6">

              {/* ── Toolbox Talks ── */}
              <div className="rounded-xl overflow-hidden" style={{ background: "#fff", border: "1px solid #e2e5eb", boxShadow: "0 1px 3px rgba(0,0,0,0.06)" }}>
                <div className="flex items-center gap-3 px-6 py-4" style={{ borderBottom: "1px solid #eaecf0" }}>
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: color + "18", color: color }}>
                    <Shield className="w-4 h-4" />
                  </div>
                  <div className="flex-1">
                    <div style={{ fontSize: 14, fontWeight: 700, color: "#111318" }}>Toolbox Talks</div>
                    <div style={{ fontSize: 12, color: "#6b7280" }}>Pre-shift safety briefings</div>
                  </div>
                  <span className="text-xs font-semibold px-2 py-0.5 rounded-full" style={{ background: color + "18", color: color, border: `1px solid ${color}30` }}>
                    {toolboxTalksList.length} recorded
                  </span>
                </div>

                {toolboxTalksList.length === 0 ? (
                  <div className="py-10 text-center">
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center mx-auto mb-3" style={{ background: "#F4F5F7", color: "#b0b8c4" }}>
                      <Shield className="w-5 h-5" />
                    </div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: "#6b7280", marginBottom: 4 }}>No toolbox talks recorded yet</div>
                    <p style={{ fontSize: 12, color: "#b0b8c4", maxWidth: "36ch", margin: "0 auto" }}>
                      Toolbox talk records will appear here as they are submitted by shift supervisors.
                    </p>
                  </div>
                ) : (
                  <div style={{ overflowX: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse" }}>
                      <thead>
                        <tr style={{ background: "#F4F5F7" }}>
                          {["Date", "Shift", "Topic", "Attendees", ""].map(h => (
                            <th key={h} style={{ fontSize: 11, fontWeight: 600, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.05em", padding: "12px 20px", textAlign: "left", borderBottom: "1px solid #e2e5eb", whiteSpace: "nowrap" }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {toolboxTalksList.map((t: any) => (
                          <tr key={t.id} style={{ borderBottom: "1px solid #eaecf0", transition: "background 160ms" }}
                            onMouseEnter={e => (e.currentTarget.style.background = "#F4F5F7")}
                            onMouseLeave={e => (e.currentTarget.style.background = "")}>
                            <td style={{ padding: "13px 20px", fontSize: 13, verticalAlign: "middle" }}>{t.reportDate}</td>
                            <td style={{ padding: "13px 20px", fontSize: 13, verticalAlign: "middle" }}>{t.shift || "—"}</td>
                            <td style={{ padding: "13px 20px", fontSize: 13, verticalAlign: "middle" }}>{t.topic || "—"}</td>
                            <td style={{ padding: "13px 20px", fontSize: 13, verticalAlign: "middle" }}>{t.attendeeCount ?? "—"}</td>
                            <td style={{ padding: "13px 20px", verticalAlign: "middle" }}>
                              {t.filePath && (
                                <a href={t.filePath} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs font-semibold" style={{ color: color }}>
                                  <FileDown className="w-4 h-4" />
                                </a>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* ── Safety Observations ── */}
              <div className="rounded-xl overflow-hidden" style={{ background: "#fff", border: "1px solid #e2e5eb", boxShadow: "0 1px 3px rgba(0,0,0,0.06)" }}>
                <div className="flex items-center gap-3 px-6 py-4 flex-wrap" style={{ borderBottom: "1px solid #eaecf0" }}>
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: "#fffbeb", color: "#b45309" }}>
                    <AlertTriangle className="w-4 h-4" />
                  </div>
                  <div className="flex-1">
                    <div style={{ fontSize: 14, fontWeight: 700, color: "#111318" }}>Safety Observations</div>
                    <div style={{ fontSize: 12, color: "#6b7280" }}>Positive, unsafe conditions, STOP WORK</div>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="inline-flex items-center text-[10px] font-semibold px-2 py-0.5 rounded-full" style={{ background: "#f0fdf4", color: "#15803d", border: "1px solid #bbf7d0" }}>Positive {obsPositive}</span>
                    <span className="inline-flex items-center text-[10px] font-semibold px-2 py-0.5 rounded-full" style={{ background: "#fffbeb", color: "#92400e", border: "1px solid #fde68a" }}>Unsafe {obsUnsafe}</span>
                    <span className="inline-flex items-center text-[10px] font-semibold px-2 py-0.5 rounded-full" style={{ background: "#fff7ed", color: "#c2410c", border: "1px solid #fed7aa" }}>Negative {obsNegative}</span>
                    <span className="inline-flex items-center text-[10px] font-semibold px-2 py-0.5 rounded-full" style={{ background: "#fef2f2", color: "#b91c1c", border: "1px solid #fecaca" }}>STOP {obsStop}</span>
                  </div>
                </div>

                {safetyObsList.length === 0 ? (
                  <div className="py-10 text-center">
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center mx-auto mb-3" style={{ background: "#fffbeb", color: "#b45309" }}>
                      <AlertTriangle className="w-5 h-5" />
                    </div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: "#6b7280", marginBottom: 4 }}>No observations recorded yet</div>
                    <p style={{ fontSize: 12, color: "#b0b8c4", maxWidth: "36ch", margin: "0 auto" }}>
                      All safety observation types will be displayed and colour-coded here once submitted.
                    </p>
                  </div>
                ) : (
                  <div style={{ overflowX: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse" }}>
                      <thead>
                        <tr style={{ background: "#F4F5F7" }}>
                          {["Date", "Type", "Location", "Description", "Status"].map(h => (
                            <th key={h} style={{ fontSize: 11, fontWeight: 600, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.05em", padding: "12px 20px", textAlign: "left", borderBottom: "1px solid #e2e5eb", whiteSpace: "nowrap" }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {safetyObsList.map((o: any) => (
                          <tr
                            key={o.id}
                            style={{ borderBottom: "1px solid #eaecf0", background: o.observationType === "stop_work" ? "#fff1f2" : undefined, transition: "background 160ms" }}
                            onMouseEnter={e => (e.currentTarget.style.background = o.observationType === "stop_work" ? "#ffe4e6" : "#F4F5F7")}
                            onMouseLeave={e => (e.currentTarget.style.background = o.observationType === "stop_work" ? "#fff1f2" : "")}
                          >
                            <td style={{ padding: "13px 20px", fontSize: 13, verticalAlign: "middle" }}>{o.observationDate}</td>
                            <td style={{ padding: "13px 20px", verticalAlign: "middle" }}><ObsTypePill type={o.observationType} /></td>
                            <td style={{ padding: "13px 20px", fontSize: 13, color: "#6b7280", verticalAlign: "middle" }}>{o.locationOnSite || "—"}</td>
                            <td style={{ padding: "13px 20px", fontSize: 13, maxWidth: 280, verticalAlign: "middle" }}>
                              <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{o.description || "—"}</div>
                            </td>
                            <td style={{ padding: "13px 20px", verticalAlign: "middle" }}><StatusPill status={o.status || "open"} /></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* ── Incident Reports ── */}
              <div className="rounded-xl overflow-hidden" style={{ background: "#fff", border: "1px solid #e2e5eb", boxShadow: "0 1px 3px rgba(0,0,0,0.06)" }}>
                <div className="flex items-center gap-3 px-6 py-4 flex-wrap" style={{ borderBottom: "1px solid #eaecf0" }}>
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: "#fef2f2", color: "#dc2626" }}>
                    <AlertCircle className="w-4 h-4" />
                  </div>
                  <div className="flex-1">
                    <div style={{ fontSize: 14, fontWeight: 700, color: "#111318" }}>Incident Reports</div>
                    <div style={{ fontSize: 12, color: "#6b7280" }}>Near miss, first aid, LTI</div>
                  </div>
                  {incidentsList.length === 0 ? (
                    <span className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full" style={{ background: "#f0fdf4", color: "#15803d", border: "1px solid #bbf7d0" }}>
                      <svg width="9" height="9" viewBox="0 0 10 10" fill="none" aria-hidden="true"><path d="M2 5l2.5 2.5L8 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                      Zero incidents
                    </span>
                  ) : (
                    <span className="text-xs font-semibold px-2 py-0.5 rounded-full" style={{ background: "#fef2f2", color: "#dc2626", border: "1px solid #fecaca" }}>
                      {incidentsList.length} reported
                    </span>
                  )}
                </div>

                {/* Type breakdown row */}
                <div className="flex gap-3 flex-wrap px-6 py-3" style={{ borderBottom: "1px solid #eaecf0" }}>
                  <span className="inline-flex items-center text-[10px] font-semibold px-2 py-0.5 rounded-full" style={{ background: "#fffbeb", color: "#92400e", border: "1px solid #fde68a" }}>Near Miss {incNearMiss}</span>
                  <span className="inline-flex items-center text-[10px] font-semibold px-2 py-0.5 rounded-full" style={{ background: "#fff7ed", color: "#c2410c", border: "1px solid #fed7aa" }}>First Aid {incFirstAid}</span>
                  <span className="inline-flex items-center text-[10px] font-semibold px-2 py-0.5 rounded-full" style={{ background: "#fef2f2", color: "#b91c1c", border: "1px solid #fecaca" }}>LTI {incLTI}</span>
                </div>

                {incidentsList.length === 0 ? (
                  <div className="py-10 text-center">
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center mx-auto mb-3" style={{ background: "#f0fdf4", color: "#15803d" }}>
                      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M5 10.5l4 4 7-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                    </div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: "#6b7280", marginBottom: 4 }}>No incidents reported</div>
                    <p style={{ fontSize: 12, color: "#b0b8c4", maxWidth: "36ch", margin: "0 auto" }}>
                      The project is maintaining a clean safety record.
                    </p>
                  </div>
                ) : (
                  <div style={{ overflowX: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse" }}>
                      <thead>
                        <tr style={{ background: "#F4F5F7" }}>
                          {["Date", "Type", "Worker Involved", "Status"].map(h => (
                            <th key={h} style={{ fontSize: 11, fontWeight: 600, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.05em", padding: "12px 20px", textAlign: "left", borderBottom: "1px solid #e2e5eb", whiteSpace: "nowrap" }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {incidentsList.map((inc: any) => {
                          const isLTI = inc.incidentType === "lost_time_injury";
                          return (
                            <tr key={inc.id} style={{ borderBottom: "1px solid #eaecf0", background: isLTI ? "#fffbeb" : undefined, transition: "background 160ms" }}
                              onMouseEnter={e => (e.currentTarget.style.background = isLTI ? "#fef3c7" : "#F4F5F7")}
                              onMouseLeave={e => (e.currentTarget.style.background = isLTI ? "#fffbeb" : "")}>
                              <td style={{ padding: "13px 20px", fontSize: 13, verticalAlign: "middle" }}>{inc.incidentDate}</td>
                              <td style={{ padding: "13px 20px", verticalAlign: "middle" }}><IncidentTypePill type={inc.incidentType} /></td>
                              <td style={{ padding: "13px 20px", fontSize: 13, verticalAlign: "middle" }}>—</td>
                              <td style={{ padding: "13px 20px", verticalAlign: "middle" }}><StatusPill status={inc.status || "open"} /></td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

            </div>
          </div>
        )}
      </main>

      {/* ── FOOTER ── */}
      <footer style={{ borderTop: "1px solid #e2e5eb", padding: 24, marginTop: 64 }}>
        <div className="flex items-center justify-between flex-wrap gap-3" style={{ maxWidth: 1200, margin: "0 auto" }}>
          <span style={{ fontSize: 12, color: "#b0b8c4" }}>© 2026 Powerforce Global · Customer Portal · Confidential</span>
          <span style={{ fontSize: 12, color: "#b0b8c4", fontFamily: "monospace", background: "#F4F5F7", border: "1px solid #e2e5eb", padding: "2px 8px", borderRadius: 4 }}>
            {project.code}
          </span>
        </div>
      </footer>

      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(4px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
