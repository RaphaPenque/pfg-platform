import { useState, useMemo } from "react";
import { Link, useLocation } from "wouter";
import { useDashboardData, type DashboardProject, type DashboardRoleSlot, type DashboardAssignment } from "@/hooks/use-dashboard-data";
import { OEM_BRAND_COLORS, PROJECT_CUSTOMER, calcPeakHeadcount, OEM_OPTIONS, EQUIPMENT_TYPES } from "@/lib/constants";
import { ChevronDown, ChevronUp, AlertTriangle, Users, Clock, Activity, Plus, X } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

// ─── Health computation ──────────────────────────────────────────

type HealthStatus = "green" | "amber" | "red" | "grey";

interface HealthResult {
  overall: HealthStatus;
  workforce: { status: HealthStatus; note: string };
  timesheets: { status: HealthStatus; note: string };
  planning: { status: HealthStatus; note: string };
  dailyReports: { status: HealthStatus; note: string };
  logistics: { status: HealthStatus; note: string };
  commercial: { status: HealthStatus; note: string };
  flags: string[];
  actionCount: number;
}

function computeHealth(
  project: DashboardProject,
  roleSlots: DashboardRoleSlot[],
  assignments: DashboardAssignment[]
): HealthResult {
  const flags: string[] = [];
  let actionCount = 0;

  // Workforce — per-slot filled count with confirmation awareness
  const projectSlots = roleSlots.filter(s => s.projectId === project.id);
  const FILLED_STATUSES = ["active", "flagged", "confirmed", "pending_confirmation"];
  const projectAssignments = assignments.filter(
    a => a.projectId === project.id && FILLED_STATUSES.includes(a.status || "")
  );
  const assignedPerSlot = new Map<number, number>();
  projectAssignments.forEach(a => { if (a.roleSlotId) assignedPerSlot.set(a.roleSlotId, (assignedPerSlot.get(a.roleSlotId) || 0) + 1); });
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
    if (unfilled > 0) parts.push(`${unfilled} slot${unfilled > 1 ? "s" : ""} unfilled`);
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

  // Planning: check signatory
  let planningStatus: HealthStatus = "green";
  let planningNote = "All items complete";
  const hasSignatory = project.timesheetSignatoryName;
  if (!hasSignatory) {
    planningStatus = "red";
    planningNote = "No signatory set";
    flags.push("No signatory set");
    actionCount++;
  }

  // Timesheets, Daily Reports, Logistics, Commercial: grey placeholders
  const timesheets = { status: "grey" as HealthStatus, note: "Not yet configured" };
  const dailyReports = { status: "grey" as HealthStatus, note: "Not yet configured" };
  const logistics = { status: "grey" as HealthStatus, note: "Not yet configured" };
  const commercial = { status: "grey" as HealthStatus, note: "Not yet configured" };

  // Overall = worst non-grey score
  const statuses = [workforceStatus, planningStatus];
  let overall: HealthStatus = "green";
  if (statuses.includes("red")) overall = "red";
  else if (statuses.includes("amber")) overall = "amber";

  return {
    overall,
    workforce: { status: workforceStatus, note: workforceNote },
    timesheets,
    planning: { status: planningStatus, note: planningNote },
    dailyReports,
    logistics,
    commercial,
    flags,
    actionCount,
  };
}

// ─── Helpers ─────────────────────────────────────────────────────

function getOemColor(project: DashboardProject): string {
  const customer = project.customer || PROJECT_CUSTOMER[project.code] || "";
  return OEM_BRAND_COLORS[customer] || "#64748B";
}

function daysRemaining(endDate: string | null): number | null {
  if (!endDate) return null;
  const end = new Date(endDate);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.ceil((end.getTime() - today.getTime()) / 86400000);
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

const HEALTH_COLORS: Record<HealthStatus, string> = {
  green: "var(--green)",
  amber: "var(--amber)",
  red: "var(--red)",
  grey: "#9ca3af",
};

const HEALTH_LABELS: Record<HealthStatus, string> = {
  green: "Good",
  amber: "Needs Attention",
  red: "Critical",
  grey: "Not Set",
};

// ─── Project Card ────────────────────────────────────────────────

function ProjectCard({
  project,
  roleSlots,
  assignments,
  compact,
}: {
  project: DashboardProject;
  roleSlots: DashboardRoleSlot[];
  assignments: DashboardAssignment[];
  compact?: boolean;
}) {
  const color = getOemColor(project);
  const customer = project.customer || PROJECT_CUSTOMER[project.code] || "";
  const health = computeHealth(project, roleSlots, assignments);
  const pct = timelinePercent(project.startDate, project.endDate);
  const days = daysRemaining(project.endDate);
  const _pSlots = roleSlots.filter(s => s.projectId === project.id);
  const _pAssigns = assignments.filter(a => a.projectId === project.id && (a.status === "active" || a.status === "flagged"));
  const _aPerSlot = new Map<number, number>();
  _pAssigns.forEach(a => { if (a.roleSlotId) _aPerSlot.set(a.roleSlotId, (_aPerSlot.get(a.roleSlotId) || 0) + 1); });
  const totalSlotQty = _pSlots.reduce((sum, s) => sum + s.quantity, 0);
  const filledCount = _pSlots.reduce((sum, s) => sum + Math.min(_aPerSlot.get(s.id) || 0, s.quantity), 0);
  const shiftLabel = project.shift || "Day";

  return (
    <Link href={`/projects/${project.code}`}>
      <div
        className={`rounded-xl border cursor-pointer transition-all hover:shadow-lg ${compact ? "opacity-90" : ""}`}
        style={{
          borderColor: "hsl(var(--border))",
          background: "hsl(var(--card))",
        }}
      >
        {/* Header */}
        <div className="px-4 py-3 flex items-center gap-3">
          {/* Code badge */}
          <span
            className="text-[11px] font-bold px-2.5 py-1 rounded-full shrink-0"
            style={{ background: "var(--pfg-navy)", color: "#fff" }}
          >
            {project.code}
          </span>
          <div className="flex-1 min-w-0">
            <div className="text-[14px] font-semibold text-pfg-navy font-display truncate">
              {project.name}
            </div>
          </div>
          {/* OEM badge */}
          {customer && (
            <span
              className="oem-pill shrink-0 rounded-full text-white font-semibold"
              style={{ background: color }}
            >
              {customer.length > 20 ? customer.slice(0, 18) + "…" : customer}
            </span>
          )}
          {/* Health dot */}
          <div className="flex items-center gap-1.5 shrink-0">
            <div
              className="w-2.5 h-2.5 rounded-full"
              style={{ background: HEALTH_COLORS[health.overall] }}
              title={HEALTH_LABELS[health.overall]}
            />
            <span className="text-[10px] font-semibold" style={{ color: HEALTH_COLORS[health.overall] }}>
              {HEALTH_LABELS[health.overall]}
            </span>
          </div>
        </div>

        {/* Timeline bar */}
        <div className="px-4 pb-2">
          <div className="relative h-2 rounded-full overflow-hidden" style={{ background: "hsl(var(--muted))" }}>
            <div
              className="absolute left-0 top-0 h-full rounded-full transition-all"
              style={{ width: `${pct}%`, background: "var(--pfg-yellow)" }}
            />
            {/* Today marker */}
            {pct > 0 && pct < 100 && (
              <div
                className="absolute top-[-2px] w-0.5 h-3 rounded"
                style={{ left: `${pct}%`, background: "var(--pfg-navy)" }}
              />
            )}
          </div>
          <div className="flex justify-between mt-1">
            <span className="text-[10px]" style={{ color: "var(--pfg-steel)" }}>
              {project.startDate || "—"}
            </span>
            <span className="text-[10px] font-medium" style={{ color: "var(--pfg-steel)" }}>
              {pct}% complete
            </span>
            <span className="text-[10px]" style={{ color: "var(--pfg-steel)" }}>
              {project.endDate || "—"}
            </span>
          </div>
        </div>

        {/* Stats row */}
        <div className="px-4 pb-2 flex items-center gap-4 text-[11px]" style={{ color: "var(--pfg-steel)" }}>
          <span className="flex items-center gap-1">
            <Users className="w-3 h-3" />
            <span className="font-semibold text-pfg-navy">{filledCount}</span>/{totalSlotQty || project.headcount || 0}
          </span>
          <span className="flex items-center gap-1">
            <Clock className="w-3 h-3" />
            {shiftLabel}
          </span>
          {days !== null && (
            <span className="flex items-center gap-1">
              <Activity className="w-3 h-3" />
              {days > 0 ? `${days}d remaining` : days === 0 ? "Ends today" : "Ended"}
            </span>
          )}
        </div>

        {/* Flag chips */}
        {health.flags.length > 0 && (
          <div className="px-4 pb-3 flex flex-wrap gap-1">
            {health.flags.map((flag) => (
              <span
                key={flag}
                className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full"
                style={{
                  background: flag.includes("unfilled") ? "var(--red-bg)" : "var(--amber-bg)",
                  color: flag.includes("unfilled") ? "var(--red)" : "var(--amber)",
                }}
              >
                <AlertTriangle className="w-2.5 h-2.5" />
                {flag}
              </span>
            ))}
          </div>
        )}
      </div>
    </Link>
  );
}

// ─── Create Project Modal ────────────────────────────────────────

function CreateProjectModal({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({
    code: "",
    name: "",
    status: "active" as "active" | "potential",
    customer: "",
    location: "",
    siteName: "",
    equipmentType: "",
    startDate: "",
    endDate: "",
    shift: "Day" as "Day" | "Night" | "Day/Night",
    contractType: "",
    notes: "",
  });

  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.code.trim() || !form.name.trim()) {
      toast({ title: "Project code and name are required", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const project = await apiRequest("POST", "/api/projects", {
        code: form.code.trim().toUpperCase(),
        name: form.name.trim(),
        status: form.status,
        customer: form.customer || null,
        location: form.location || null,
        siteName: form.siteName || null,
        equipmentType: form.equipmentType || null,
        startDate: form.startDate || null,
        endDate: form.endDate || null,
        shift: form.shift,
        contractType: form.contractType || null,
        notes: form.notes || null,
      });
      const created = await project.json();
      await queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
      toast({ title: `Project ${created.code} created` });
      onClose();
      navigate(`/projects/${created.code}`);
    } catch (err: any) {
      toast({ title: "Failed to create project", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  const inputCls = "w-full rounded-lg border text-[13px] px-3 py-2 outline-none focus:ring-2 focus:ring-pfg-navy/30 bg-white";
  const labelCls = "block text-[11px] font-semibold uppercase tracking-wide mb-1" ;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.45)" }}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <div>
            <h2 className="text-[16px] font-bold text-pfg-navy font-display">New Project</h2>
            <p className="text-[12px] mt-0.5" style={{ color: "var(--pfg-steel)" }}>Create a confirmed project or capacity planning entry</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 transition">
            <X className="w-4 h-4" style={{ color: "var(--pfg-steel)" }} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="overflow-y-auto flex-1 px-6 py-5 space-y-5">

          {/* Status toggle */}
          <div>
            <p className={labelCls} style={{ color: "var(--pfg-steel)" }}>Project Type</p>
            <div className="flex gap-2">
              {(["active", "potential"] as const).map(s => (
                <button
                  key={s}
                  type="button"
                  onClick={() => set("status", s)}
                  className="flex-1 py-2 rounded-lg text-[12px] font-semibold border transition"
                  style={form.status === s ? {
                    background: s === "active" ? "var(--pfg-navy)" : "var(--amber-bg)",
                    color: s === "active" ? "#fff" : "var(--amber)",
                    borderColor: s === "active" ? "var(--pfg-navy)" : "var(--amber)",
                  } : { background: "transparent", color: "var(--pfg-steel)", borderColor: "hsl(var(--border))" }}
                >
                  {s === "active" ? "✓ Confirmed Project" : "⟳ Capacity Planning"}
                </button>
              ))}
            </div>
            <p className="text-[11px] mt-1.5" style={{ color: "var(--pfg-steel)" }}>
              {form.status === "active"
                ? "A live, confirmed project that will appear in the Active section."
                : "A forecast/pipeline project for capacity planning. Appears in the Planning section."}
            </p>
          </div>

          {/* Code + Name */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelCls} style={{ color: "var(--pfg-steel)" }}>Project Code *</label>
              <input
                className={inputCls}
                placeholder="e.g. GNT-001"
                value={form.code}
                onChange={e => set("code", e.target.value)}
                required
                style={{ borderColor: "hsl(var(--border))" }}
              />
            </div>
            <div>
              <label className={labelCls} style={{ color: "var(--pfg-steel)" }}>Project Name *</label>
              <input
                className={inputCls}
                placeholder="e.g. Tynagh GT Major Inspection"
                value={form.name}
                onChange={e => set("name", e.target.value)}
                required
                style={{ borderColor: "hsl(var(--border))" }}
              />
            </div>
          </div>

          {/* Customer + Location */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelCls} style={{ color: "var(--pfg-steel)" }}>Customer / OEM</label>
              <select
                className={inputCls}
                value={form.customer}
                onChange={e => set("customer", e.target.value)}
                style={{ borderColor: "hsl(var(--border))" }}
              >
                <option value="">— Select OEM —</option>
                {OEM_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls} style={{ color: "var(--pfg-steel)" }}>Location</label>
              <input
                className={inputCls}
                placeholder="e.g. Tynagh, Ireland"
                value={form.location}
                onChange={e => set("location", e.target.value)}
                style={{ borderColor: "hsl(var(--border))" }}
              />
            </div>
          </div>

          {/* Site Name + Equipment */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelCls} style={{ color: "var(--pfg-steel)" }}>Site Name</label>
              <input
                className={inputCls}
                placeholder="e.g. Tynagh Energy"
                value={form.siteName}
                onChange={e => set("siteName", e.target.value)}
                style={{ borderColor: "hsl(var(--border))" }}
              />
            </div>
            <div>
              <label className={labelCls} style={{ color: "var(--pfg-steel)" }}>Equipment Type</label>
              <select
                className={inputCls}
                value={form.equipmentType}
                onChange={e => set("equipmentType", e.target.value)}
                style={{ borderColor: "hsl(var(--border))" }}
              >
                <option value="">— Select —</option>
                {EQUIPMENT_TYPES.map(et => <option key={et.value} value={et.value}>{et.label}</option>)}
              </select>
            </div>
          </div>

          {/* Dates */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelCls} style={{ color: "var(--pfg-steel)" }}>Start Date</label>
              <input
                type="date"
                className={inputCls}
                value={form.startDate}
                onChange={e => set("startDate", e.target.value)}
                style={{ borderColor: "hsl(var(--border))" }}
              />
            </div>
            <div>
              <label className={labelCls} style={{ color: "var(--pfg-steel)" }}>End Date</label>
              <input
                type="date"
                className={inputCls}
                value={form.endDate}
                onChange={e => set("endDate", e.target.value)}
                style={{ borderColor: "hsl(var(--border))" }}
              />
            </div>
          </div>

          {/* Shift + Contract Type */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelCls} style={{ color: "var(--pfg-steel)" }}>Shift</label>
              <select
                className={inputCls}
                value={form.shift}
                onChange={e => set("shift", e.target.value)}
                style={{ borderColor: "hsl(var(--border))" }}
              >
                <option value="Day">Day</option>
                <option value="Night">Night</option>
                <option value="Day/Night">Day / Night</option>
              </select>
            </div>
            <div>
              <label className={labelCls} style={{ color: "var(--pfg-steel)" }}>Contract Type</label>
              <select
                className={inputCls}
                value={form.contractType}
                onChange={e => set("contractType", e.target.value)}
                style={{ borderColor: "hsl(var(--border))" }}
              >
                <option value="">— Select —</option>
                <option value="Lump Sum">Lump Sum</option>
                <option value="Reimbursable">Reimbursable</option>
                <option value="Time & Materials">Time &amp; Materials</option>
                <option value="Framework">Framework</option>
              </select>
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className={labelCls} style={{ color: "var(--pfg-steel)" }}>Notes</label>
            <textarea
              className={inputCls}
              rows={2}
              placeholder="Any additional context..."
              value={form.notes}
              onChange={e => set("notes", e.target.value)}
              style={{ borderColor: "hsl(var(--border))", resize: "vertical" }}
            />
          </div>
        </form>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t bg-gray-50 rounded-b-2xl">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-[13px] font-medium border hover:bg-gray-100 transition"
            style={{ borderColor: "hsl(var(--border))", color: "var(--pfg-steel)" }}
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit as any}
            disabled={saving}
            className="px-5 py-2 rounded-lg text-[13px] font-semibold text-white transition disabled:opacity-50"
            style={{ background: "var(--pfg-navy)" }}
          >
            {saving ? "Creating…" : `Create ${form.status === "potential" ? "Planning Entry" : "Project"}`}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ───────────────────────────────────────────────────

export default function ProjectHub() {
  const { data, isLoading } = useDashboardData();
  const [showCompleted, setShowCompleted] = useState(false);
  const [showCreate, setShowCreate] = useState(false);

  const projects = data?.projects || [];
  const roleSlots = data?.roleSlots || [];
  const rawAssignments = data?.assignments || [];

  // Parse assignments to get projectId etc
  const assignments: DashboardAssignment[] = rawAssignments;

  const { active, planning, completed } = useMemo(() => {
    const today = new Date().toISOString().split("T")[0];
    const active: DashboardProject[] = [];
    const planning: DashboardProject[] = [];
    const completed: DashboardProject[] = [];

    for (const p of projects) {
      const status = p.status || "active";
      if (status === "completed" || status === "cancelled") {
        completed.push(p);
      } else if (status === "potential") {
        planning.push(p);
      } else if (status === "active" && p.endDate && p.endDate < today) {
        completed.push(p);
      } else {
        active.push(p);
      }
    }

    // Sort active by end date (soonest first)
    active.sort((a, b) => (a.endDate || "").localeCompare(b.endDate || ""));
    planning.sort((a, b) => (a.startDate || "").localeCompare(b.startDate || ""));
    completed.sort((a, b) => (b.endDate || "").localeCompare(a.endDate || ""));

    return { active, planning, completed };
  }, [projects]);

  if (isLoading) {
    return (
      <div className="space-y-4 animate-pulse">
        <div className="h-8 w-48 rounded-lg" style={{ background: "hsl(var(--muted))" }} />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-40 rounded-xl" style={{ background: "hsl(var(--muted))" }} />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {showCreate && <CreateProjectModal onClose={() => setShowCreate(false)} />}

      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-pfg-navy font-display">Project Hub</h1>
          <p className="text-[13px] mt-0.5" style={{ color: "var(--pfg-steel)" }}>
            {active.length} active · {planning.length} planning · {completed.length} completed
          </p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-[13px] font-semibold text-white transition hover:opacity-90"
          style={{ background: "var(--pfg-navy)" }}
          data-testid="button-create-project"
        >
          <Plus className="w-4 h-4" />
          New Project
        </button>
      </div>

      {/* ACTIVE section */}
      {active.length > 0 && (
        <section>
          <h2 className="text-[13px] font-bold uppercase tracking-wide mb-3 flex items-center gap-2" style={{ color: "var(--pfg-steel)" }}>
            <div className="w-2 h-2 rounded-full" style={{ background: "var(--green)" }} />
            Active Projects
            <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full" style={{ background: "var(--green-bg)", color: "var(--green)" }}>
              {active.length}
            </span>
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {active.map((p) => (
              <ProjectCard
                key={p.id}
                project={p}
                roleSlots={roleSlots}
                assignments={assignments}
              />
            ))}
          </div>
        </section>
      )}

      {/* PLANNING section */}
      {planning.length > 0 && (
        <section>
          <h2 className="text-[13px] font-bold uppercase tracking-wide mb-3 flex items-center gap-2" style={{ color: "var(--pfg-steel)" }}>
            <div className="w-2 h-2 rounded-full" style={{ background: "var(--amber)" }} />
            Planning
            <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full" style={{ background: "var(--amber-bg)", color: "var(--amber)" }}>
              {planning.length}
            </span>
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {planning.map((p) => (
              <ProjectCard
                key={p.id}
                project={p}
                roleSlots={roleSlots}
                assignments={assignments}
                compact
              />
            ))}
          </div>
        </section>
      )}

      {/* COMPLETED section */}
      {completed.length > 0 && (
        <section>
          <button
            onClick={() => setShowCompleted(!showCompleted)}
            className="text-[13px] font-bold uppercase tracking-wide mb-3 flex items-center gap-2 hover:opacity-80 transition"
            style={{ color: "var(--pfg-steel)" }}
          >
            <div className="w-2 h-2 rounded-full" style={{ background: "#9ca3af" }} />
            Completed / Cancelled
            <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full" style={{ background: "hsl(var(--muted))", color: "var(--pfg-steel)" }}>
              {completed.length}
            </span>
            {showCompleted ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>
          {showCompleted && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 opacity-75">
              {completed.map((p) => (
                <ProjectCard
                  key={p.id}
                  project={p}
                  roleSlots={roleSlots}
                  assignments={assignments}
                  compact
                />
              ))}
            </div>
          )}
        </section>
      )}

      {/* Empty state */}
      {projects.length === 0 && (
        <div className="text-center py-20">
          <div className="text-[48px] mb-3 opacity-30">📋</div>
          <div className="text-lg font-semibold text-pfg-navy font-display">No projects yet</div>
          <p className="text-[13px] mt-1 mb-4" style={{ color: "var(--pfg-steel)" }}>
            Get started by creating your first project.
          </p>
          <button
            onClick={() => setShowCreate(true)}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-[13px] font-semibold text-white transition hover:opacity-90"
            style={{ background: "var(--pfg-navy)" }}
          >
            <Plus className="w-4 h-4" />
            Create First Project
          </button>
        </div>
      )}
    </div>
  );
}
