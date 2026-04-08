import { useState, useMemo, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { useDashboardData, type DashboardWorker, type DashboardProject, type DashboardAssignment, type DashboardRoleSlot } from "@/hooks/use-dashboard-data";
import { OEM_BRAND_COLORS, PROJECT_CUSTOMER, OEM_OPTIONS, EQUIPMENT_TYPES, PROJECT_ROLES, COST_CENTRES, CERT_DEFS, calcUtilisation } from "@/lib/constants";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Plus, X, ExternalLink, Trash2, Undo2, Search, ChevronDown, ChevronUp, Check, Loader2, CheckCircle2, XCircle, Sparkles, RotateCcw, AlertTriangle, Download, Info, Mail, Save } from "lucide-react";
import { downloadCSV } from "@/lib/csv-export";
import { Link } from "wouter";

// ─── Shared small components ───────────────────────────────────────

function ShiftBadge({ shift }: { shift: string | null }) {
  if (!shift) return null;
  return <span className={`badge ${shift === "Night" ? "badge-navy" : "badge-accent"}`}>{shift}</span>;
}

function StatusBadge({ status }: { status: string }) {
  return <span className={`badge ${status === "FTE" ? "badge-navy" : "badge-grey"}`}>{status}</span>;
}

function LoadingSkeleton() {
  return (
    <div className="space-y-4 animate-pulse">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-64 rounded-xl" style={{ background: "hsl(var(--muted))" }} />
        ))}
      </div>
    </div>
  );
}

// Modal overlay wrapper
function ModalOverlay({ children, onClose, testId, wide }: { children: React.ReactNode; onClose: () => void; testId: string; wide?: boolean }) {
  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center"
      style={{ background: "rgba(27,42,74,0.5)", backdropFilter: "blur(2px)" }}
      onClick={onClose}
      data-testid={testId}
    >
      <div
        className={`rounded-xl overflow-hidden ${wide ? "w-[1040px]" : "w-[900px]"} max-w-[95vw] max-h-[90vh] flex flex-col`}
        style={{ background: "hsl(var(--card))", boxShadow: "0 20px 60px rgba(27,42,74,0.3)" }}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}

// Form field wrappers
function FormGroup({ label, children, full }: { label: string; children: React.ReactNode; full?: boolean }) {
  return (
    <div className={`flex flex-col gap-1 ${full ? "col-span-2" : ""}`}>
      <label className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--pfg-steel)" }}>{label}</label>
      {children}
    </div>
  );
}

const inputCls = "px-3 py-2 text-[13px] rounded-lg border focus:outline-none focus:border-[var(--pfg-yellow)] focus:shadow-[0_0_0_3px_rgba(245,189,0,0.15)]";
const inputStyle = { borderColor: "hsl(var(--border))", background: "hsl(var(--card))" };

// ─── Types ─────────────────────────────────────────────────────────

interface ProjectCardData {
  project: DashboardProject & { roleSlots?: DashboardRoleSlot[] };
  members: { worker: DashboardWorker; assignment: DashboardAssignment }[];
}

interface RoleSlotDraft {
  key: number;
  role: string;
  startDate: string;
  endDate: string;
  quantity: number;
  shift: string;
}

type ProjectStatus = "active" | "potential" | "completed" | "cancelled";

// ─── Confirm Dialog ──────────────────────────────────────────────

function ConfirmDialog({
  title,
  message,
  confirmLabel,
  confirmColor,
  onConfirm,
  onCancel,
}: {
  title: string;
  message: string;
  confirmLabel: string;
  confirmColor: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-[300] flex items-center justify-center"
      style={{ background: "rgba(27,42,74,0.6)", backdropFilter: "blur(2px)" }}
      onClick={onCancel}
    >
      <div
        className="rounded-xl overflow-hidden w-[420px] max-w-[90vw]"
        style={{ background: "hsl(var(--card))", boxShadow: "0 20px 60px rgba(27,42,74,0.3)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-5">
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle className="w-5 h-5" style={{ color: confirmColor }} />
            <h3 className="font-display font-bold text-pfg-navy">{title}</h3>
          </div>
          <p className="text-[13px]" style={{ color: "var(--pfg-steel)" }}>{message}</p>
        </div>
        <div className="px-6 py-4 border-t flex justify-end gap-2" style={{ borderColor: "hsl(var(--border))" }}>
          <button
            onClick={onCancel}
            className="px-4 py-2 text-[13px] font-medium rounded-lg border"
            style={{ borderColor: "hsl(var(--border))" }}
            data-testid="confirm-cancel"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="px-4 py-2 text-[13px] font-semibold rounded-lg text-white"
            style={{ background: confirmColor }}
            data-testid="confirm-action"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Project Status Filter Toggles ──────────────────────────────

const STATUS_FILTERS: { key: ProjectStatus; label: string; defaultOn: boolean }[] = [
  { key: "active", label: "Active", defaultOn: true },
  { key: "potential", label: "Potential", defaultOn: true },
  { key: "completed", label: "Completed", defaultOn: false },
  { key: "cancelled", label: "Cancelled", defaultOn: false },
];

function StatusFilterBar({
  activeFilters,
  onToggle,
}: {
  activeFilters: Set<ProjectStatus>;
  onToggle: (s: ProjectStatus) => void;
}) {
  return (
    <div className="flex gap-2 mb-4" data-testid="status-filter-bar">
      {STATUS_FILTERS.map((sf) => {
        const isOn = activeFilters.has(sf.key);
        return (
          <button
            key={sf.key}
            onClick={() => onToggle(sf.key)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold border transition-colors"
            style={{
              borderColor: isOn ? "var(--pfg-yellow)" : "hsl(var(--border))",
              background: isOn ? "hsl(var(--accent))" : "transparent",
              color: isOn ? "var(--pfg-navy)" : "hsl(var(--muted-foreground))",
            }}
            data-testid={`filter-${sf.key}`}
          >
            {isOn && <Check className="w-3 h-3" />}
            {sf.label}
          </button>
        );
      })}
    </div>
  );
}

// ─── Project Card ──────────────────────────────────────────────────

function ProjectCard({ card, onClick, effectiveStatus }: { card: ProjectCardData; onClick: () => void; effectiveStatus?: ProjectStatus }) {
  const customer = card.project.customer || PROJECT_CUSTOMER[card.project.code] || "";
  const color = customer ? (OEM_BRAND_COLORS[customer] || "#64748B") : "#64748B";
  const status = effectiveStatus || (card.project.status || "active") as ProjectStatus;

  const isPotential = status === "potential";
  const isCompleted = status === "completed";
  const isCancelled = status === "cancelled";
  const isInactive = isCompleted || isCancelled;

  return (
    <div
      className="rounded-xl border overflow-hidden cursor-pointer transition-shadow hover:shadow-md"
      style={{
        background: "hsl(var(--card))",
        borderColor: isPotential ? "var(--pfg-yellow)" : "hsl(var(--card-border))",
        borderStyle: isPotential ? "dashed" : "solid",
        borderWidth: isPotential ? "2px" : "1px",
        boxShadow: "var(--shadow-sm)",
        opacity: isInactive ? 0.6 : 1,
      }}
      onClick={onClick}
      data-testid={`project-card-${card.project.code}`}
    >
      <div
        className="px-5 py-4 flex items-center justify-between font-display"
        style={{
          background: isInactive ? "#94a3b8" : isPotential ? `${color}B3` : color,
          color: "#fff",
        }}
      >
        <div>
          <div className="text-sm font-bold" style={{ textDecoration: isCancelled ? "line-through" : undefined }}>
            {card.project.code} — {card.project.name}
          </div>
          {card.project.location && <div className="text-[11px] opacity-80 mt-0.5">{card.project.location}</div>}
        </div>
        <div className="flex items-center gap-2">
          {isPotential && (
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: "rgba(255,255,255,0.3)", color: "#fff" }} data-testid={`badge-potential-${card.project.code}`}>
              POTENTIAL
            </span>
          )}
          {isCompleted && (
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: "rgba(255,255,255,0.3)", color: "#fff" }} data-testid={`badge-completed-${card.project.code}`}>
              COMPLETED
            </span>
          )}
          {isCancelled && (
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: "rgba(255,255,255,0.3)", color: "#fff" }} data-testid={`badge-cancelled-${card.project.code}`}>
              CANCELLED
            </span>
          )}
          {card.members.length > 0 && (() => {
            const fteCount = card.members.filter(m => m.worker.status === "FTE").length;
            const ftePct = Math.round((fteCount / card.members.length) * 100);
            const fteBg = ftePct >= 60 ? "var(--green, #16a34a)" : ftePct >= 50 ? "var(--amber, #D97706)" : "var(--red, #dc2626)";
            return (
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: fteBg, color: "#fff" }} data-testid={`fte-pct-${card.project.code}`}>
                {ftePct}% FTE
              </span>
            );
          })()}
          <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full" style={{ background: "rgba(255,255,255,0.2)" }}>
            {card.members.length}
          </span>
        </div>
      </div>

      <div>
        {card.members.length === 0 ? (
          <div className="px-5 py-6 text-center text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>No team members assigned</div>
        ) : (
          card.members.map((m) => (
            <div key={m.assignment.id} className="flex items-center justify-between px-5 py-2.5 text-[13px] transition-colors hover:bg-[hsl(var(--muted))]" style={{ borderBottom: "1px solid hsl(var(--border))" }}>
              <div>
                <div className="font-medium text-pfg-navy">{m.worker.name}{m.worker.driversLicenseUploaded ? <span className="inline-flex items-center justify-center w-4 h-4 rounded-full text-[8px] font-bold ml-1 shrink-0" style={{ background: "#1A1D23", color: "#F5BD00" }} title="Has Driver's Licence">D</span> : null}</div>
                {m.assignment.task && <div className="text-[11px] mt-0.5 truncate max-w-[260px]" style={{ color: "var(--pfg-steel)" }}>{m.assignment.task}</div>}
              </div>
              <div className="flex items-center gap-1.5">
                <ShiftBadge shift={m.assignment.shift} />
                <StatusBadge status={m.worker.status} />
              </div>
            </div>
          ))
        )}
      </div>

      <div className="px-5 py-2.5 flex justify-end" style={{ borderTop: "1px solid hsl(var(--border))" }}>
        <Link href={`/portal/${card.project.code}`} onClick={(e: React.MouseEvent) => e.stopPropagation()} data-testid={`share-customer-${card.project.code}`}>
          <span className="flex items-center gap-1 text-[11px] font-semibold hover:underline" style={{ color: "var(--pfg-steel)" }}>
            <ExternalLink className="w-3 h-3" />
            Share with Customer
          </span>
        </Link>
      </div>
    </div>
  );
}

// ─── Available Pool Card ───────────────────────────────────────────

function AvailablePoolCard({ workers }: { workers: DashboardWorker[] }) {
  return (
    <div className="rounded-xl border overflow-hidden" style={{ background: "hsl(var(--card))", borderColor: "hsl(var(--card-border))", boxShadow: "var(--shadow-sm)" }} data-testid="available-pool-card">
      <div className="px-5 py-4 flex items-center justify-between font-display" style={{ background: "#6B7280", color: "#fff" }}>
        <div className="text-sm font-bold">Available Pool</div>
        <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full" style={{ background: "rgba(255,255,255,0.2)" }}>{workers.length}</span>
      </div>
      <div>
        {workers.length === 0 ? (
          <div className="px-5 py-6 text-center text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>All workers are assigned</div>
        ) : (
          workers.map((w) => (
            <div key={w.id} className="flex items-center justify-between px-5 py-2.5 text-[13px] transition-colors hover:bg-[hsl(var(--muted))]" style={{ borderBottom: "1px solid hsl(var(--border))" }}>
              <div>
                <div className="font-medium text-pfg-navy">{w.name}</div>
                <div className="text-[11px] mt-0.5" style={{ color: "var(--pfg-steel)" }}>{w.role}</div>
              </div>
              <StatusBadge status={w.status} />
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ─── Shared availability helpers ──────────────────────────────────

function datesOverlap(aStart: string, aEnd: string, bStart: string | null, bEnd: string | null): boolean {
  if (!bStart || !bEnd) return false;
  return aStart <= bEnd && aEnd >= bStart;
}

function workerIsAvailable(
  worker: DashboardWorker,
  slotStart: string,
  slotEnd: string,
  excludeProjectId?: number,
  excludeAssignmentId?: number,
): boolean {
  for (const a of worker.assignments) {
    if (a.status !== "active" && a.status !== "flagged") continue;
    if (excludeAssignmentId && a.id === excludeAssignmentId) continue;
    if (excludeProjectId && a.projectId === excludeProjectId) continue;
    if (datesOverlap(slotStart, slotEnd, a.startDate, a.endDate)) return false;
  }
  return true;
}

// ═══════════════════════════════════════════════════════════════════
// ADD NEW PROJECT MODAL (5 steps)
// ═══════════════════════════════════════════════════════════════════

function AddProjectModal({ onClose }: { onClose: () => void }) {
  const { data: dashData } = useDashboardData();
  const allWorkers = dashData?.workers ?? [];

  const [step, setStep] = useState(1);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Step 1: Project details
  const [code, setCode] = useState("");
  const [projectName, setProjectName] = useState("");
  const [customer, setCustomer] = useState("");
  const [oem, setOem] = useState("");
  const [location, setLocation] = useState("");
  const [equipmentType, setEquipmentType] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [shift, setShift] = useState("Day");
  const [headcount, setHeadcount] = useState(6);
  const [notes, setNotes] = useState("");
  const [createAsStatus, setCreateAsStatus] = useState<"active" | "potential">("active");

  // Step 2: Role slots
  const [roleSlots, setRoleSlots] = useState<RoleSlotDraft[]>([]);
  const [nextKey, setNextKey] = useState(1);
  const [roleSlotsInitialised, setRoleSlotsInitialised] = useState(false);

  // Step 3: Assignments — Map<slotKey, workerId[]>
  const [slotAssignments, setSlotAssignments] = useState<Record<number, number[]>>({});
  // Step 3: Search/filter per slot
  const [slotSearch, setSlotSearch] = useState<Record<number, string>>({});
  const [slotFteOnly, setSlotFteOnly] = useState<Record<number, boolean>>({});
  const [slotRoleFilter, setSlotRoleFilter] = useState<Record<number, string>>({});
  const [slotCostCentreFilter, setSlotCostCentreFilter] = useState<Record<number, string>>({});
  const [slotOemFilter, setSlotOemFilter] = useState<Record<number, string>>({});
  const [slotCertFilter, setSlotCertFilter] = useState<Record<number, string>>({});
  const [expandedWorkers, setExpandedWorkers] = useState<Set<number>>(new Set());

  const addRoleSlot = () => {
    setRoleSlots((prev) => [
      ...prev,
      { key: nextKey, role: "Technician 2", startDate, endDate, quantity: 1, shift: "Day" },
    ]);
    setNextKey((k) => k + 1);
  };

  const updateSlot = (key: number, field: keyof RoleSlotDraft, value: string | number) => {
    setRoleSlots((prev) => prev.map((s) => (s.key === key ? { ...s, [field]: value } : s)));
  };

  const removeSlot = (key: number) => {
    setRoleSlots((prev) => prev.filter((s) => s.key !== key));
    setSlotAssignments((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const canProceedStep1 = code.trim() && projectName.trim() && startDate && endDate;
  const totalSlots = roleSlots.reduce((sum, s) => sum + s.quantity, 0);

  // --- helpers for Step 3: Assign Staff ---

  // All worker ids already assigned in ANY slot
  const allAssignedWorkerIds = useMemo(() => {
    const ids = new Set<number>();
    for (const key of Object.keys(slotAssignments)) {
      for (const wid of slotAssignments[Number(key)]) {
        ids.add(wid);
      }
    }
    return ids;
  }, [slotAssignments]);

  // Available workers for a given slot (base list, no search/FTE filter)
  function getAvailableWorkersBase(slot: RoleSlotDraft): DashboardWorker[] {
    const currentSlotWorkers = slotAssignments[slot.key] ?? [];

    return allWorkers
      .filter((w) => {
        // Already assigned to this slot
        if (currentSlotWorkers.includes(w.id)) return false;
        // Already assigned to another slot in this wizard
        if (allAssignedWorkerIds.has(w.id) && !currentSlotWorkers.includes(w.id)) return false;
        // Check existing assignment date overlaps
        if (!workerIsAvailable(w, slot.startDate, slot.endDate)) return false;
        return true;
      });
  }

  // Role hierarchy for matching priority
  const ROLE_HIERARCHY = ["Superintendent","Foreman","Lead Technician","Technician 2","Technician 1","Rigger","Crane Driver","HSE Officer","Welder","I&C Technician","Electrician","Apprentice"];

  // Available workers for a given slot (with all filters applied, then sorted)
  function getAvailableWorkers(slot: RoleSlotDraft): { filtered: DashboardWorker[]; total: number } {
    const base = getAvailableWorkersBase(slot);
    const total = base.length;
    const searchTerm = (slotSearch[slot.key] || "").toLowerCase();
    const fteOnly = slotFteOnly[slot.key] || false;
    const roleFilter = slotRoleFilter[slot.key] || "";
    const costCentreFilter = slotCostCentreFilter[slot.key] || "";
    const oemFilter = slotOemFilter[slot.key] || "";
    const certFilter = slotCertFilter[slot.key] || "";
    const oemMatch = oem && equipmentType ? `${oem} - ${equipmentType}` : null;

    const filtered = base
      .filter((w) => {
        if (searchTerm && !w.name.toLowerCase().includes(searchTerm)) return false;
        if (fteOnly && w.status !== "FTE") return false;
        if (roleFilter && w.role !== roleFilter) return false;
        if (costCentreFilter) {
          if (costCentreFilter === "Temp" && w.status !== "Temp") return false;
          if (costCentreFilter !== "Temp" && w.costCentre !== costCentreFilter) return false;
        }
        if (oemFilter && !w.oemExperience.some(exp => exp.toLowerCase().includes(oemFilter.toLowerCase()))) return false;
        if (certFilter) {
          const certType = "cert_" + certFilter.toLowerCase().replace(/[^a-z0-9]/g, "_");
          const hasCert = (w as any).documents?.some((d: any) => d.type === certType && d.filePath);
          if (!hasCert) return false;
        }
        return true;
      })
      .sort((a, b) => {
        // 1. FTE before Temp
        const statusOrder = (s: string) => (s === "FTE" ? 0 : 1);
        const sd = statusOrder(a.status) - statusOrder(b.status);
        if (sd !== 0) return sd;
        // 2. Role match: exact match first, then higher role that can cover, then others
        const roleMatchScore = (w: DashboardWorker) => {
          if (w.role === slot.role) return 0; // exact match
          const workerRank = ROLE_HIERARCHY.indexOf(w.role);
          const slotRank = ROLE_HIERARCHY.indexOf(slot.role);
          if (workerRank !== -1 && slotRank !== -1 && workerRank <= slotRank) return 1; // senior can cover
          return 2; // no match
        };
        const rm = roleMatchScore(a) - roleMatchScore(b);
        if (rm !== 0) return rm;
        // 3. OEM match
        if (oemMatch) {
          const aMatch = a.oemExperience.includes(oemMatch) ? 0 : 1;
          const bMatch = b.oemExperience.includes(oemMatch) ? 0 : 1;
          if (aMatch !== bMatch) return aMatch - bMatch;
        }
        // 4. Lowest utilisation
        const aUtil = calcUtilisation(a.assignments).pct;
        const bUtil = calcUtilisation(b.assignments).pct;
        return aUtil - bUtil;
      });

    return { filtered, total };
  }

  function toggleExpandedWorker(wid: number) {
    setExpandedWorkers(prev => {
      const next = new Set(prev);
      if (next.has(wid)) next.delete(wid); else next.add(wid);
      return next;
    });
  }

  function assignWorkerToSlot(slotKey: number, workerId: number) {
    setSlotAssignments((prev) => ({
      ...prev,
      [slotKey]: [...(prev[slotKey] ?? []), workerId],
    }));
  }

  function unassignWorkerFromSlot(slotKey: number, workerId: number) {
    setSlotAssignments((prev) => ({
      ...prev,
      [slotKey]: (prev[slotKey] ?? []).filter((id) => id !== workerId),
    }));
  }

  // Summary counts
  const totalPositions = totalSlots;
  const filledPositions = Object.values(slotAssignments).reduce((sum, ids) => sum + ids.length, 0);

  const handleSubmit = async () => {
    setSaving(true);
    setError(null);
    try {
      // 1. Create the project
      const project = await apiRequest("POST", "/api/projects", {
        code: code.trim().toUpperCase(),
        name: projectName.trim(),
        customer: customer.trim() || oem || null,
        location: location.trim() || null,
        equipmentType: equipmentType || null,
        startDate: startDate || null,
        endDate: endDate || null,
        shift: shift || null,
        headcount: (roleSlots.length > 0 ? totalSlots : headcount) || null,
        notes: notes.trim() || null,
        status: createAsStatus,
      });

      // 2. Create role slots and collect their server IDs
      const slotIdMap: Record<number, number> = {}; // key -> server id
      for (const slot of roleSlots) {
        const created = await apiRequest("POST", "/api/role-slots", {
          projectId: project.id,
          role: slot.role,
          startDate: slot.startDate,
          endDate: slot.endDate,
          quantity: slot.quantity,
          shift: slot.shift,
        });
        slotIdMap[slot.key] = created.id;
      }

      // 3. Create assignments and collect IDs for temp notification
      const createdAssignmentIds: number[] = [];
      const tempWorkerIds = new Set(assignedTemps.filter(t => t.worker.personalEmail).map(t => t.worker.id));
      for (const slot of roleSlots) {
        const workerIds = slotAssignments[slot.key] ?? [];
        const serverId = slotIdMap[slot.key];
        const durationDays = slot.startDate && slot.endDate
          ? Math.max(1, Math.ceil((new Date(slot.endDate).getTime() - new Date(slot.startDate).getTime()) / 86400000))
          : null;
        for (const wid of workerIds) {
          const created = await apiRequest("POST", "/api/assignments", {
            workerId: wid,
            projectId: project.id,
            roleSlotId: serverId ?? null,
            role: slot.role,
            shift: slot.shift,
            startDate: slot.startDate,
            endDate: slot.endDate,
            duration: durationDays,
            status: "active",
          });
          if (tempWorkerIds.has(wid)) createdAssignmentIds.push(created.id);
        }
      }

      // 4. Notify temps (if user previewed the email panel)
      if (showEmailPreview && createdAssignmentIds.length > 0) {
        try {
          await apiRequest("POST", "/api/projects/notify-temps", {
            projectId: project.id,
            assignmentIds: createdAssignmentIds,
          });
        } catch { /* notification failure shouldn't block project creation */ }
      }

      // 5. Invalidate cache
      await queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
      onClose();
    } catch (e: any) {
      setError(e.message || "Failed to create project");
    } finally {
      setSaving(false);
    }
  };

  // Email temps state (Step 4)
  const [showEmailPreview, setShowEmailPreview] = useState(false);

  // Compute temps assigned in wizard
  const assignedTemps = useMemo(() => {
    const temps: { worker: DashboardWorker; slotKey: number; slot: RoleSlotDraft }[] = [];
    for (const slot of roleSlots) {
      const workerIds = slotAssignments[slot.key] ?? [];
      for (const wid of workerIds) {
        const w = allWorkers.find((x) => x.id === wid);
        if (w && w.status === "Temp") temps.push({ worker: w, slotKey: slot.key, slot });
      }
    }
    return temps;
  }, [roleSlots, slotAssignments, allWorkers]);

  const tempsWithEmail = assignedTemps.filter((t) => t.worker.personalEmail);
  const tempsNoEmail = assignedTemps.filter((t) => !t.worker.personalEmail);

  const stepLabels = ["Project Details", "Role Planning", "Assign Staff", "Summary", "Create"];

  // Determine if Next is disabled for current step
  const isNextDisabled = (): boolean => {
    if (step === 1) return !canProceedStep1;
    if (step === 2) return roleSlots.length === 0;
    return false;
  };

  return (
    <ModalOverlay onClose={onClose} testId="add-project-modal">
      {/* Header */}
      <div className="px-6 py-5 flex items-center justify-between border-b" style={{ borderColor: "hsl(var(--border))" }}>
        <h2 className="font-display text-lg font-bold text-pfg-navy">Add New Project</h2>
        <button onClick={onClose} className="p-1 hover:bg-black/5 rounded" data-testid="add-project-close"><X className="w-5 h-5" style={{ color: "var(--pfg-steel)" }} /></button>
      </div>

      {/* Steps indicator */}
      <div className="flex gap-0">
        {stepLabels.map((label, i) => {
          const n = i + 1;
          const isActive = step === n;
          const isDone = step > n;
          return (
            <div
              key={n}
              className="flex-1 text-center py-2.5 text-xs font-semibold border-b-[3px]"
              style={{
                color: isDone ? "var(--green)" : isActive ? "#8B6E00" : "hsl(var(--muted-foreground))",
                borderColor: isDone ? "var(--green)" : isActive ? "var(--pfg-yellow)" : "hsl(var(--border))",
                background: isDone ? "var(--green-bg)" : isActive ? "hsl(var(--accent))" : "hsl(var(--muted))",
              }}
            >
              <span
                className="inline-flex items-center justify-center w-5 h-5 rounded-full text-[11px] font-bold mr-1.5"
                style={{
                  background: isDone ? "var(--green)" : isActive ? "var(--pfg-yellow)" : "hsl(var(--border))",
                  color: isDone ? "#fff" : isActive ? "var(--pfg-navy)" : "hsl(var(--muted-foreground))",
                }}
              >
                {isDone ? "\u2713" : n}
              </span>
              {label}
            </div>
          );
        })}
      </div>

      {/* Body */}
      <div className="p-6 overflow-y-auto flex-1">
        {/* Step 1: Project Details */}
        {step === 1 && (
          <div className="space-y-4">
            {/* Active / Potential toggle */}
            <div className="flex gap-3 mb-2" data-testid="create-status-toggle">
              <label
                className="flex items-center gap-2 px-4 py-2.5 rounded-lg border cursor-pointer transition-colors"
                style={{
                  borderColor: createAsStatus === "active" ? "var(--pfg-yellow)" : "hsl(var(--border))",
                  background: createAsStatus === "active" ? "hsl(var(--accent))" : "transparent",
                }}
              >
                <input
                  type="radio"
                  name="createStatus"
                  value="active"
                  checked={createAsStatus === "active"}
                  onChange={() => setCreateAsStatus("active")}
                  className="sr-only"
                  data-testid="radio-active"
                />
                <div
                  className="w-4 h-4 rounded-full border-2 flex items-center justify-center"
                  style={{ borderColor: createAsStatus === "active" ? "var(--pfg-yellow)" : "hsl(var(--border))" }}
                >
                  {createAsStatus === "active" && <div className="w-2 h-2 rounded-full" style={{ background: "var(--pfg-yellow)" }} />}
                </div>
                <span className="text-[13px] font-semibold text-pfg-navy">Create as Active Project</span>
              </label>
              <label
                className="flex items-center gap-2 px-4 py-2.5 rounded-lg border cursor-pointer transition-colors"
                style={{
                  borderColor: createAsStatus === "potential" ? "var(--pfg-yellow)" : "hsl(var(--border))",
                  background: createAsStatus === "potential" ? "hsl(var(--accent))" : "transparent",
                  borderStyle: createAsStatus === "potential" ? "dashed" : "solid",
                }}
              >
                <input
                  type="radio"
                  name="createStatus"
                  value="potential"
                  checked={createAsStatus === "potential"}
                  onChange={() => setCreateAsStatus("potential")}
                  className="sr-only"
                  data-testid="radio-potential"
                />
                <div
                  className="w-4 h-4 rounded-full border-2 flex items-center justify-center"
                  style={{ borderColor: createAsStatus === "potential" ? "var(--pfg-yellow)" : "hsl(var(--border))" }}
                >
                  {createAsStatus === "potential" && <div className="w-2 h-2 rounded-full" style={{ background: "var(--pfg-yellow)" }} />}
                </div>
                <span className="text-[13px] font-semibold text-pfg-navy">Create as Potential Project</span>
              </label>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <FormGroup label="Project Code *">
                <input className={inputCls} style={inputStyle} value={code} onChange={(e) => setCode(e.target.value)} placeholder="e.g. TRNS" data-testid="input-code" />
              </FormGroup>
              <FormGroup label="Customer">
                <input className={inputCls} style={inputStyle} value={customer} onChange={(e) => setCustomer(e.target.value)} placeholder="Customer name" data-testid="input-customer" />
              </FormGroup>
              <FormGroup label="OEM">
                <select className={inputCls} style={inputStyle} value={oem} onChange={(e) => setOem(e.target.value)} data-testid="input-oem">
                  <option value="">Select OEM...</option>
                  {OEM_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              </FormGroup>
              <FormGroup label="Project Name *">
                <input className={inputCls} style={inputStyle} value={projectName} onChange={(e) => setProjectName(e.target.value)} placeholder="Full project name" data-testid="input-name" />
              </FormGroup>
              <FormGroup label="Location">
                <input className={inputCls} style={inputStyle} value={location} onChange={(e) => setLocation(e.target.value)} placeholder="e.g. Torness, UK" data-testid="input-location" />
              </FormGroup>
              <FormGroup label="Equipment Type">
                <select className={inputCls} style={inputStyle} value={equipmentType} onChange={(e) => setEquipmentType(e.target.value)} data-testid="input-equipment">
                  <option value="">Select...</option>
                  {EQUIPMENT_TYPES.map((et) => <option key={et.value} value={et.value}>{et.label}</option>)}
                </select>
              </FormGroup>
              <FormGroup label="Start Date *">
                <input type="date" className={inputCls} style={inputStyle} value={startDate} onChange={(e) => setStartDate(e.target.value)} data-testid="input-start" />
              </FormGroup>
              <FormGroup label="End Date *">
                <input type="date" className={inputCls} style={inputStyle} value={endDate} onChange={(e) => setEndDate(e.target.value)} data-testid="input-end" />
              </FormGroup>
              <FormGroup label="Headcount">
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg border text-[13px] font-semibold" style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--muted))" }}>
                  <span>{roleSlots.length > 0 ? totalSlots : headcount}</span>
                  {roleSlots.length > 0 && <span className="text-[11px] font-normal" style={{ color: "hsl(var(--muted-foreground))" }}>calculated from role slots</span>}
                </div>
              </FormGroup>
              <FormGroup label="Shift Pattern">
                <select className={inputCls} style={inputStyle} value={shift} onChange={(e) => setShift(e.target.value)} data-testid="input-shift">
                  <option value="Day">Day</option>
                  <option value="Night">Night</option>
                  <option value="Day + Night">Day + Night</option>
                </select>
              </FormGroup>
              <FormGroup label="Notes" full>
                <textarea className={`${inputCls} resize-y min-h-[60px]`} style={inputStyle} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional notes..." data-testid="input-notes" />
              </FormGroup>
            </div>
          </div>
        )}

        {/* Step 2: Role Planning */}
        {step === 2 && (
          <div>
            <div className="flex items-center justify-between mb-4">
              <div className="text-sm font-bold text-pfg-navy font-display flex items-center gap-2">
                Role Slots
                <span className="text-xs font-semibold px-2 py-0.5 rounded-full" style={{ background: "hsl(var(--accent))", color: "#8B6E00" }}>
                  {totalSlots}
                </span>
              </div>
              <button
                onClick={addRoleSlot}
                className="flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-lg border"
                style={{ borderColor: "var(--pfg-yellow)", color: "var(--pfg-yellow)" }}
                data-testid="add-role-slot"
              >
                <Plus className="w-3.5 h-3.5" />
                Add Role
              </button>
            </div>

            {roleSlots.length === 0 ? (
              <div className="text-center py-10 text-sm" style={{ color: "hsl(var(--muted-foreground))" }}>
                No role slots yet. Click "Add Role" to start planning.
              </div>
            ) : (
              <div className="rounded-lg border overflow-hidden" style={{ borderColor: "hsl(var(--border))" }}>
                <table className="w-full text-[13px]" style={{ borderCollapse: "collapse" }}>
                  <thead>
                    <tr>
                      {["Role", "Start Date", "End Date", "Qty", "Shift", ""].map((h) => (
                        <th key={h} className="text-left px-3 py-2 text-[10px] font-semibold uppercase tracking-wide" style={{ background: "hsl(var(--muted))", color: "hsl(var(--muted-foreground))", borderBottom: "1px solid hsl(var(--border))" }}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {roleSlots.map((slot) => (
                      <tr key={slot.key} style={{ borderBottom: "1px solid hsl(var(--border))" }}>
                        <td className="px-3 py-1.5">
                          <select className="text-[13px] px-2 py-1 rounded border w-full" style={inputStyle} value={slot.role} onChange={(e) => updateSlot(slot.key, "role", e.target.value)} data-testid={`slot-role-${slot.key}`}>
                            {PROJECT_ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                          </select>
                        </td>
                        <td className="px-3 py-1.5">
                          <input type="date" className="text-[13px] px-2 py-1 rounded border" style={inputStyle} value={slot.startDate} onChange={(e) => updateSlot(slot.key, "startDate", e.target.value)} data-testid={`slot-start-${slot.key}`} />
                        </td>
                        <td className="px-3 py-1.5">
                          <input type="date" className="text-[13px] px-2 py-1 rounded border" style={inputStyle} value={slot.endDate} onChange={(e) => updateSlot(slot.key, "endDate", e.target.value)} data-testid={`slot-end-${slot.key}`} />
                        </td>
                        <td className="px-3 py-1.5">
                          <input type="number" min={1} max={50} className="text-[13px] px-2 py-1 rounded border w-16 tabular-nums" style={inputStyle} value={slot.quantity} onChange={(e) => updateSlot(slot.key, "quantity", parseInt(e.target.value) || 1)} data-testid={`slot-qty-${slot.key}`} />
                        </td>
                        <td className="px-3 py-1.5">
                          <select className="text-[13px] px-2 py-1 rounded border" style={inputStyle} value={slot.shift} onChange={(e) => updateSlot(slot.key, "shift", e.target.value)} data-testid={`slot-shift-${slot.key}`}>
                            <option value="Day">Day</option>
                            <option value="Night">Night</option>
                          </select>
                        </td>
                        <td className="px-3 py-1.5 text-center">
                          <button onClick={() => removeSlot(slot.key)} className="p-1 rounded hover:bg-[var(--red-bg)]" data-testid={`slot-delete-${slot.key}`}>
                            <Trash2 className="w-3.5 h-3.5" style={{ color: "var(--red)" }} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Step 3: Assign Staff */}
        {step === 3 && (
          <div className="space-y-6">
            {roleSlots.map((slot) => {
              const assigned = slotAssignments[slot.key] ?? [];
              const { filtered: available, total: totalAvailable } = getAvailableWorkers(slot);
              const oemMatch = oem && equipmentType ? `${oem} - ${equipmentType}` : null;
              const isFteOnly = slotFteOnly[slot.key] || false;
              const searchVal = slotSearch[slot.key] || "";
              return (
                <div key={slot.key} className="rounded-lg border" style={{ borderColor: "hsl(var(--border))" }}>
                  {/* Slot header */}
                  <div className="px-4 py-3 text-[13px] font-semibold" style={{ background: "hsl(var(--muted))", borderBottom: "1px solid hsl(var(--border))" }}>
                    <span className="text-pfg-navy">{slot.role}</span>
                    <span className="mx-1.5" style={{ color: "var(--pfg-steel)" }}>&mdash;</span>
                    <span style={{ color: "var(--pfg-steel)" }}>{slot.shift} shift</span>
                    <span className="mx-1.5" style={{ color: "var(--pfg-steel)" }}>&mdash;</span>
                    <span style={{ color: "var(--pfg-steel)" }}>{slot.startDate} to {slot.endDate}</span>
                    <span className="ml-2 text-xs font-semibold px-2 py-0.5 rounded-full" style={{ background: assigned.length >= slot.quantity ? "var(--green-bg)" : "hsl(var(--accent))", color: assigned.length >= slot.quantity ? "var(--green)" : "#8B6E00" }}>
                      {assigned.length}/{slot.quantity}
                    </span>
                  </div>

                  {/* Assigned workers */}
                  {assigned.length > 0 && (
                    <div className="px-4 py-2 space-y-1">
                      {assigned.map((wid) => {
                        const worker = allWorkers.find((w) => w.id === wid);
                        if (!worker) return null;
                        return (
                          <div
                            key={wid}
                            className="flex items-center gap-3 px-3 py-2 rounded-lg border text-[13px]"
                            style={{ borderColor: "var(--green)", background: "var(--green-bg)" }}
                            data-testid={`assigned-${slot.key}-${wid}`}
                          >
                            <div className="flex-1 min-w-0">
                              <span className="font-semibold text-pfg-navy">{worker.name}{worker.driversLicenseUploaded ? <span className="inline-flex items-center justify-center w-4 h-4 rounded-full text-[8px] font-bold ml-1 shrink-0" style={{ background: "#1A1D23", color: "#F5BD00" }} title="Has Driver's Licence">D</span> : null}</span>
                              <span className="ml-2 text-[11px]" style={{ color: "var(--pfg-steel)" }}>{worker.role}</span>
                            </div>
                            <div className="flex items-center gap-1.5 shrink-0">
                              <StatusBadge status={worker.status} />
                              <button
                                onClick={() => unassignWorkerFromSlot(slot.key, wid)}
                                className="p-1 rounded hover:bg-[var(--red-bg)]"
                                data-testid={`unassign-${slot.key}-${wid}`}
                              >
                                <X className="w-3.5 h-3.5" style={{ color: "var(--red)" }} />
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Available workers with search/filter */}
                  {assigned.length < slot.quantity && (
                    <div className="px-4 py-2">
                      {/* Search + filter bar */}
                      <div className="space-y-1.5 mb-2">
                        <div className="flex items-center gap-2">
                          <div className="relative flex-1">
                            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5" style={{ color: "hsl(var(--muted-foreground))" }} />
                            <input type="text" placeholder="Search by name..."
                              value={searchVal}
                              onChange={(e) => setSlotSearch(prev => ({ ...prev, [slot.key]: e.target.value }))}
                              className="w-full pl-8 pr-3 py-1.5 text-[12px] rounded-lg border" style={inputStyle}
                              data-testid={`slot-search-${slot.key}`} />
                          </div>
                          <span className="text-[11px] font-medium shrink-0" style={{ color: "var(--pfg-steel)" }}>
                            {available.length} of {totalAvailable}
                          </span>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {/* FTE/Temp filter */}
                          <select className="text-[11px] px-2 py-1 rounded-lg border" style={{ ...inputStyle, maxWidth: "90px" }}
                            value={isFteOnly ? "FTE" : ""}
                            onChange={(e) => setSlotFteOnly(prev => ({ ...prev, [slot.key]: e.target.value === "FTE" }))}
                            data-testid={`slot-filter-status-${slot.key}`}>
                            <option value="">All</option>
                            <option value="FTE">FTE</option>
                          </select>
                          {/* Job Title filter */}
                          <select className="text-[11px] px-2 py-1 rounded-lg border" style={{ ...inputStyle, maxWidth: "130px" }}
                            value={slotRoleFilter[slot.key] || ""}
                            onChange={(e) => setSlotRoleFilter(prev => ({ ...prev, [slot.key]: e.target.value }))}
                            data-testid={`slot-filter-role-${slot.key}`}>
                            <option value="">All Roles</option>
                            {PROJECT_ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                          </select>
                          {/* Cost Centre filter */}
                          <select className="text-[11px] px-2 py-1 rounded-lg border" style={{ ...inputStyle, maxWidth: "130px" }}
                            value={slotCostCentreFilter[slot.key] || ""}
                            onChange={(e) => setSlotCostCentreFilter(prev => ({ ...prev, [slot.key]: e.target.value }))}
                            data-testid={`slot-filter-cc-${slot.key}`}>
                            <option value="">All Entities</option>
                            {COST_CENTRES.map(c => <option key={c} value={c}>{c.split(" ").slice(0,2).join(" ")}</option>)}
                            <option value="Temp">Temp</option>
                          </select>
                          {/* OEM filter */}
                          <select className="text-[11px] px-2 py-1 rounded-lg border" style={{ ...inputStyle, maxWidth: "120px" }}
                            value={slotOemFilter[slot.key] || ""}
                            onChange={(e) => setSlotOemFilter(prev => ({ ...prev, [slot.key]: e.target.value }))}
                            data-testid={`slot-filter-oem-${slot.key}`}>
                            <option value="">All OEMs</option>
                            {Array.from(new Set(allWorkers.flatMap(w => w.oemExperience.map(e => e.split(" - ")[0])))).sort().map(o => <option key={o} value={o}>{o}</option>)}
                          </select>
                          {/* Certificate filter */}
                          <select className="text-[11px] px-2 py-1 rounded-lg border" style={{ ...inputStyle, maxWidth: "130px" }}
                            value={slotCertFilter[slot.key] || ""}
                            onChange={(e) => setSlotCertFilter(prev => ({ ...prev, [slot.key]: e.target.value }))}
                            data-testid={`slot-filter-cert-${slot.key}`}>
                            <option value="">All Certs</option>
                            {CERT_DEFS.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
                          </select>
                        </div>
                      </div>
                      <div className="max-h-[250px] overflow-y-auto space-y-0.5">
                        {available.length === 0 ? (
                          <div className="text-center py-4 text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>No available workers{searchVal || isFteOnly ? " matching filters" : " without date conflicts"}</div>
                        ) : (
                          available.map((w) => {
                            const util = calcUtilisation(w.assignments);
                            const hasOemMatch = oemMatch ? w.oemExperience.includes(oemMatch) : false;
                            const isExpanded = expandedWorkers.has(w.id);
                            const activeAssignment = w.assignments.find(a => a.status === "active");
                            return (
                              <div key={w.id}>
                                <div
                                  className="flex items-center gap-3 px-3 py-2 rounded-lg border cursor-pointer transition-colors hover:border-[var(--pfg-yellow)] hover:bg-[hsl(var(--accent))]"
                                  style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--card))" }}
                                  data-testid={`available-${slot.key}-${w.id}`}
                                >
                                  <div className="flex-1 min-w-0" onClick={() => assignWorkerToSlot(slot.key, w.id)}>
                                    <div className="text-[13px] font-semibold text-pfg-navy">{w.name}{w.driversLicenseUploaded ? <span className="inline-flex items-center justify-center w-4 h-4 rounded-full text-[8px] font-bold ml-1 shrink-0" style={{ background: "#1A1D23", color: "#F5BD00" }} title="Has Driver's Licence">D</span> : null}</div>
                                    <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                                      <span className="text-[11px]" style={{ color: "var(--pfg-steel)" }}>{w.role}</span>
                                      {w.oemExperience.slice(0, 3).map((exp) => (
                                        <span key={exp} className={`badge text-[10px] ${exp === oemMatch ? "badge-green" : "badge-grey"}`}>{exp}</span>
                                      ))}
                                    </div>
                                  </div>
                                  <div className="flex items-center gap-2 shrink-0">
                                    <span className="text-[11px] tabular-nums font-medium" style={{ color: util.pct > 80 ? "var(--red)" : "var(--pfg-steel)" }}>{util.pct}%</span>
                                    <StatusBadge status={w.status} />
                                    {hasOemMatch && <span className="badge badge-green text-[10px]">OEM</span>}
                                    <button
                                      onClick={(e) => { e.stopPropagation(); toggleExpandedWorker(w.id); }}
                                      className="p-0.5 rounded hover:bg-black/5"
                                      data-testid={`expand-worker-${slot.key}-${w.id}`}
                                      title="Preview worker details"
                                    >
                                      {isExpanded ? <ChevronUp className="w-3.5 h-3.5" style={{ color: "var(--pfg-steel)" }} /> : <Info className="w-3.5 h-3.5" style={{ color: "var(--pfg-steel)" }} />}
                                    </button>
                                    <button
                                      onClick={(e) => { e.stopPropagation(); assignWorkerToSlot(slot.key, w.id); }}
                                      className="p-0.5"
                                      data-testid={`assign-btn-${slot.key}-${w.id}`}
                                    >
                                      <Plus className="w-4 h-4" style={{ color: "var(--pfg-yellow)" }} />
                                    </button>
                                  </div>
                                </div>
                                {/* Expanded preview panel */}
                                {isExpanded && (
                                  <div className="ml-3 mr-3 mb-1 px-3 py-2 rounded-b-lg border border-t-0 text-[12px]" style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--muted))" }} data-testid={`preview-${w.id}`}>
                                    <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                                      <div><span style={{ color: "var(--pfg-steel)" }}>Status:</span> <StatusBadge status={w.status} /></div>
                                      <div><span style={{ color: "var(--pfg-steel)" }}>English:</span> <span className="font-medium">{w.englishLevel || "\u2014"}</span></div>
                                      <div><span style={{ color: "var(--pfg-steel)" }}>Utilisation:</span> <span className="font-medium tabular-nums" style={{ color: util.pct > 80 ? "var(--red)" : undefined }}>{util.pct}%</span></div>
                                      {activeAssignment && (
                                        <div><span style={{ color: "var(--pfg-steel)" }}>Current:</span> <span className="font-medium">{activeAssignment.projectCode} &mdash; {activeAssignment.projectName}</span></div>
                                      )}
                                    </div>
                                    {w.oemExperience.length > 0 && (
                                      <div className="flex flex-wrap gap-1 mt-1.5">
                                        {w.oemExperience.map((exp) => (
                                          <span key={exp} className={`badge text-[10px] ${exp === oemMatch ? "badge-green" : "badge-grey"}`}>{exp}</span>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>
                            );
                          })
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Step 4: Summary */}
        {step === 4 && (
          <div className="space-y-4">
            <div className="rounded-lg border p-4" style={{ borderColor: "hsl(var(--border))" }}>
              <div className="text-xs font-bold uppercase tracking-wide mb-3 text-pfg-navy">Project Details</div>
              <div className="grid grid-cols-2 gap-2 text-[13px]">
                {[
                  ["Code", code.toUpperCase()],
                  ["Name", projectName],
                  ["Status", createAsStatus === "potential" ? "Potential" : "Active"],
                  ["Customer", customer || oem || "\u2014"],
                  ["OEM", oem || "\u2014"],
                  ["Location", location || "\u2014"],
                  ["Equipment", equipmentType || "\u2014"],
                  ["Dates", `${startDate || "\u2014"} \u2192 ${endDate || "\u2014"}`],
                  ["Shift", shift],
                  ["Headcount", String(headcount)],
                ].map(([label, val]) => (
                  <div key={label} className="flex gap-2">
                    <span className="font-semibold" style={{ color: "var(--pfg-steel)" }}>{label}:</span>
                    <span className="text-pfg-navy">{val}</span>
                  </div>
                ))}
              </div>
              {notes && <div className="mt-2 text-xs" style={{ color: "var(--pfg-steel)" }}>Notes: {notes}</div>}
            </div>

            <div className="rounded-lg border p-4" style={{ borderColor: "hsl(var(--border))" }}>
              <div className="flex items-center justify-between mb-3">
                <div className="text-xs font-bold uppercase tracking-wide text-pfg-navy">
                  Role Slots &amp; Assignments
                </div>
                <span className="text-xs font-semibold px-2 py-0.5 rounded-full" style={{
                  background: filledPositions === totalPositions ? "var(--green-bg)" : "hsl(var(--accent))",
                  color: filledPositions === totalPositions ? "var(--green)" : "#8B6E00",
                }}>
                  {filledPositions} of {totalPositions} positions filled
                </span>
              </div>
              {roleSlots.length === 0 ? (
                <div className="text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>No role slots defined</div>
              ) : (
                <div className="space-y-2">
                  {roleSlots.map((s) => {
                    const assigned = slotAssignments[s.key] ?? [];
                    const unfilled = s.quantity - assigned.length;
                    return (
                      <div key={s.key} className="rounded-lg border p-3" style={{ borderColor: unfilled > 0 ? "var(--amber)" : "hsl(var(--border))", background: unfilled > 0 ? "var(--amber-bg, hsl(var(--accent)))" : undefined }}>
                        <div className="flex items-center justify-between text-[13px] mb-1">
                          <span className="font-medium text-pfg-navy">{s.quantity}&times; {s.role}</span>
                          <span className="text-xs" style={{ color: "var(--pfg-steel)" }}>{s.shift} &middot; {s.startDate} &rarr; {s.endDate}</span>
                        </div>
                        {assigned.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-1">
                            {assigned.map((wid) => {
                              const w = allWorkers.find((x) => x.id === wid);
                              return w ? (
                                <span key={wid} className="badge badge-green text-[11px]">{w.name}</span>
                              ) : null;
                            })}
                          </div>
                        )}
                        {unfilled > 0 && (
                          <div className="text-[11px] mt-1 font-medium" style={{ color: "var(--amber, #D97706)" }}>
                            {unfilled} position{unfilled > 1 ? "s" : ""} unfilled
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Email Temp Workers */}
            {assignedTemps.length > 0 && (
              <div className="rounded-lg border p-4" style={{ borderColor: "hsl(var(--border))" }}>
                <div className="flex items-center justify-between mb-3">
                  <div className="text-xs font-bold uppercase tracking-wide text-pfg-navy">
                    Email Temp Workers
                  </div>
                  <button
                    onClick={() => setShowEmailPreview(!showEmailPreview)}
                    className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border"
                    style={{ borderColor: "var(--pfg-yellow)", color: "var(--pfg-navy)" }}
                    data-testid="toggle-email-preview"
                  >
                    <Mail className="w-3.5 h-3.5" />
                    {showEmailPreview ? "Hide Preview" : `Email ${tempsWithEmail.length} Temp${tempsWithEmail.length !== 1 ? "s" : ""}`}
                  </button>
                </div>
                {tempsNoEmail.length > 0 && (
                  <div className="text-[12px] font-medium px-3 py-2 rounded-lg mb-2" style={{ background: "var(--amber-bg, hsl(var(--accent)))", color: "var(--amber, #D97706)" }} data-testid="email-no-email-warning">
                    <AlertTriangle className="w-3.5 h-3.5 inline mr-1" />
                    {tempsNoEmail.length} worker{tempsNoEmail.length !== 1 ? "s have" : " has"} no email — add contact info first: {tempsNoEmail.map(t => t.worker.name).join(", ")}
                  </div>
                )}
                {showEmailPreview && (
                  <div className="space-y-1.5" data-testid="email-preview-list">
                    {tempsWithEmail.length === 0 ? (
                      <div className="text-xs text-center py-3" style={{ color: "hsl(var(--muted-foreground))" }}>No Temp workers with email to notify</div>
                    ) : (
                      tempsWithEmail.map(({ worker, slot }) => (
                        <div key={worker.id} className="flex items-center gap-3 px-3 py-2 rounded-lg border text-[12px]" style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--card))" }}>
                          <Mail className="w-3.5 h-3.5 shrink-0" style={{ color: "var(--pfg-steel)" }} />
                          <div className="flex-1 min-w-0">
                            <span className="font-semibold text-pfg-navy">{worker.name}</span>
                            <span className="ml-2" style={{ color: "var(--pfg-steel)" }}>{worker.personalEmail}</span>
                          </div>
                          <span className="text-[11px] shrink-0" style={{ color: "var(--pfg-steel)" }}>{slot.role} · {slot.startDate} → {slot.endDate}</span>
                        </div>
                      ))
                    )}
                    <div className="text-[11px] mt-1" style={{ color: "var(--pfg-steel)" }}>
                      Emails will be sent after project creation in the next step.
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Step 5: Create */}
        {step === 5 && (
          <div className="text-center py-8 space-y-4">
            <div className="text-sm font-bold text-pfg-navy font-display">Ready to create project?</div>
            <div className="text-[13px]" style={{ color: "var(--pfg-steel)" }}>
              This will create <strong>{code.toUpperCase()}</strong> as {createAsStatus === "potential" ? "a potential" : "an active"} project with {roleSlots.length} role slot{roleSlots.length !== 1 ? "s" : ""} and {filledPositions} assignment{filledPositions !== 1 ? "s" : ""}.
            </div>
            {error && <div className="text-sm font-medium px-3 py-2 rounded-lg mx-auto max-w-md" style={{ background: "var(--red-bg)", color: "var(--red)" }}>{error}</div>}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="px-6 py-4 border-t flex items-center justify-between" style={{ borderColor: "hsl(var(--border))" }}>
        <div>
          {step > 1 && (
            <button
              onClick={() => setStep(step - 1)}
              className="px-4 py-2 text-[13px] font-medium rounded-lg border"
              style={{ borderColor: "hsl(var(--border))" }}
              data-testid="step-back"
            >
              Back
            </button>
          )}
        </div>
        <div className="flex gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 text-[13px] font-medium rounded-lg border"
            style={{ borderColor: "hsl(var(--border))" }}
            data-testid="add-project-cancel"
          >
            Cancel
          </button>
          {step < 5 ? (
            <button
              onClick={() => {
                // When moving from Step 1 to Step 2, auto-populate role slots
                if (step === 1 && !roleSlotsInitialised) {
                  const count = Math.max(1, headcount || 6);
                  const slots: RoleSlotDraft[] = [];
                  for (let i = 0; i < count; i++) {
                    slots.push({
                      key: i + 1,
                      role: PROJECT_ROLES[3], // Default to Technician 2
                      startDate: startDate,
                      endDate: endDate,
                      quantity: 1,
                      shift: "Day",
                    });
                  }
                  setRoleSlots(slots);
                  setNextKey(count + 1);
                  setRoleSlotsInitialised(true);
                }
                setStep(step + 1);
              }}
              disabled={isNextDisabled()}
              className="px-4 py-2 text-[13px] font-semibold rounded-lg disabled:opacity-40"
              style={{ background: "var(--pfg-yellow)", color: "var(--pfg-navy)" }}
              data-testid="step-next"
            >
              Next
            </button>
          ) : (
            <button
              onClick={handleSubmit}
              disabled={saving}
              className="px-5 py-2 text-[13px] font-semibold rounded-lg flex items-center gap-1.5 disabled:opacity-60"
              style={{ background: "var(--pfg-yellow)", color: "var(--pfg-navy)" }}
              data-testid="create-project-submit"
            >
              {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              Create Project
            </button>
          )}
        </div>
      </div>
    </ModalOverlay>
  );
}

// ═══════════════════════════════════════════════════════════════════
// CONFLICT RESOLUTION MODAL — shown after a role slot date change
// ═══════════════════════════════════════════════════════════════════

interface ConflictItem {
  worker: DashboardWorker;
  thisAssignment: DashboardAssignment;
  otherAssignment: DashboardAssignment;
  resolution: "shorten" | "delay" | "flag" | null;
}

interface ConflictModalState {
  slotId: number;
  newStart: string;
  newEnd: string;
  projectCode: string;
  conflicts: ConflictItem[];
}

function ConflictResolutionModal({
  data,
  onResolve,
  onClose,
}: {
  data: ConflictModalState;
  onResolve: (updated: ConflictItem[]) => void;
  onClose: () => void;
}) {
  const [conflicts, setConflicts] = useState<ConflictItem[]>(data.conflicts);
  const [saving, setSaving] = useState(false);

  const allResolved = conflicts.every((c) => c.resolution !== null);

  const setResolution = (idx: number, res: "shorten" | "delay" | "flag") => {
    setConflicts((prev) => prev.map((c, i) => (i === idx ? { ...c, resolution: res } : c)));
  };

  const handleApply = async () => {
    if (!allResolved) return;
    setSaving(true);
    try {
      for (const c of conflicts) {
        if (c.resolution === "shorten") {
          // End this assignment 1 day before the other project starts
          const dayBefore = new Date(c.otherAssignment.startDate!);
          dayBefore.setDate(dayBefore.getDate() - 1);
          const newEnd = dayBefore.toISOString().split("T")[0];
          await apiRequest("PATCH", `/api/assignments/${c.thisAssignment.id}`, { startDate: data.newStart, endDate: newEnd });
        } else if (c.resolution === "delay") {
          // Delay the other project assignment to start 1 day after this slot ends
          const dayAfter = new Date(data.newEnd);
          dayAfter.setDate(dayAfter.getDate() + 1);
          const newStart = dayAfter.toISOString().split("T")[0];
          await apiRequest("PATCH", `/api/assignments/${c.otherAssignment.id}`, { startDate: newStart });
        } else if (c.resolution === "flag") {
          // Flag this assignment for review
          await apiRequest("PATCH", `/api/assignments/${c.thisAssignment.id}`, { status: "flagged" });
        }
      }
      onResolve(conflicts);
    } catch {
      /* silent */
    }
    setSaving(false);
  };

  // Helper: compute date strings for button labels
  const shortenDate = (c: ConflictItem) => {
    const d = new Date(c.otherAssignment.startDate!);
    d.setDate(d.getDate() - 1);
    return d.toISOString().split("T")[0];
  };
  const delayDate = () => {
    const d = new Date(data.newEnd);
    d.setDate(d.getDate() + 1);
    return d.toISOString().split("T")[0];
  };

  // Simple timeline bar
  const TimelineBar = ({ c }: { c: ConflictItem }) => {
    // Compute relative positions for a mini timeline
    const allDates = [data.newStart, data.newEnd, c.otherAssignment.startDate!, c.otherAssignment.endDate!].map(d => new Date(d).getTime());
    const min = Math.min(...allDates);
    const max = Math.max(...allDates);
    const range = max - min || 1;
    const pct = (d: string) => ((new Date(d).getTime() - min) / range) * 100;

    const thisLeft = pct(data.newStart);
    const thisRight = 100 - pct(data.newEnd);
    const otherLeft = pct(c.otherAssignment.startDate!);
    const otherRight = 100 - pct(c.otherAssignment.endDate!);

    // Overlap zone
    const overlapStart = Math.max(new Date(data.newStart).getTime(), new Date(c.otherAssignment.startDate!).getTime());
    const overlapEnd = Math.min(new Date(data.newEnd).getTime(), new Date(c.otherAssignment.endDate!).getTime());
    const overlapLeft = ((overlapStart - min) / range) * 100;
    const overlapRight = 100 - ((overlapEnd - min) / range) * 100;

    return (
      <div className="relative h-6 rounded" style={{ background: "hsl(var(--muted))" }} data-testid="conflict-timeline">
        {/* This project bar */}
        <div className="absolute top-0.5 h-2 rounded-sm" style={{ left: `${thisLeft}%`, right: `${thisRight}%`, background: "var(--pfg-navy, #1A1D23)" }} />
        {/* Other project bar */}
        <div className="absolute bottom-0.5 h-2 rounded-sm" style={{ left: `${otherLeft}%`, right: `${otherRight}%`, background: "var(--pfg-steel, #64748B)" }} />
        {/* Overlap zone */}
        <div className="absolute top-0 bottom-0 rounded-sm opacity-30" style={{ left: `${overlapLeft}%`, right: `${overlapRight}%`, background: "var(--red, #dc2626)" }} />
      </div>
    );
  };

  return (
    <div
      className="fixed inset-0 z-[300] flex items-center justify-center"
      style={{ background: "rgba(27,42,74,0.6)", backdropFilter: "blur(2px)" }}
      data-testid="conflict-resolution-modal"
    >
      <div
        className="rounded-xl overflow-hidden w-[640px] max-w-[95vw] max-h-[85vh] flex flex-col"
        style={{ background: "hsl(var(--card))", boxShadow: "0 20px 60px rgba(27,42,74,0.3)" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b flex items-center gap-3" style={{ borderColor: "hsl(var(--border))", background: "var(--pfg-navy, #1A1D23)" }}>
          <AlertTriangle className="w-5 h-5" style={{ color: "var(--pfg-yellow, #F5BD00)" }} />
          <div>
            <h2 className="font-display font-bold text-white text-base">Scheduling Conflicts Detected</h2>
            <p className="text-[12px] text-white/60 mt-0.5">The following workers have overlapping assignments. Choose how to resolve each one.</p>
          </div>
        </div>

        {/* Conflict cards */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
          {conflicts.map((c, idx) => (
            <div
              key={c.thisAssignment.id}
              className="rounded-lg border overflow-hidden"
              style={{
                borderColor: c.resolution ? "var(--green, #16a34a)" : "var(--amber, #D97706)",
                borderLeftWidth: 3,
                background: "hsl(var(--card))",
              }}
              data-testid={`conflict-card-${c.worker.id}`}
            >
              <div className="px-4 py-3">
                {/* Worker name + status */}
                <div className="flex items-center gap-2 mb-2">
                  <span className="font-semibold text-sm text-pfg-navy">{c.worker.name}</span>
                  <span className={`badge text-[10px] ${c.worker.status === "FTE" ? "badge-navy" : "badge-grey"}`}>{c.worker.status}</span>
                  {c.resolution && (
                    <span className="ml-auto text-[10px] font-semibold px-2 py-0.5 rounded-full text-white" style={{ background: "var(--green, #16a34a)" }} data-testid={`resolution-badge-${c.worker.id}`}>
                      {c.resolution === "shorten" ? "Shortened" : c.resolution === "delay" ? "Delayed" : "Flagged"}
                    </span>
                  )}
                </div>

                {/* Date comparison */}
                <div className="flex items-center gap-2 text-[11px] mb-2" style={{ color: "var(--pfg-steel)" }}>
                  <span className="font-semibold" style={{ color: "var(--pfg-navy)" }}>{data.projectCode}:</span>
                  <span>{data.newStart} → {data.newEnd}</span>
                  <span style={{ color: "var(--red, #dc2626)" }}>↔</span>
                  <span className="font-semibold" style={{ color: "var(--pfg-navy)" }}>{c.otherAssignment.projectCode}:</span>
                  <span>{c.otherAssignment.startDate} → {c.otherAssignment.endDate}</span>
                </div>

                {/* Timeline visual */}
                <TimelineBar c={c} />

                {/* Resolution buttons */}
                {!c.resolution && (
                  <div className="flex items-center gap-2 mt-3">
                    <button
                      onClick={() => setResolution(idx, "shorten")}
                      className="text-[11px] font-bold px-3 py-1.5 rounded-lg"
                      style={{ background: "var(--pfg-yellow, #F5BD00)", color: "var(--pfg-navy, #1A1D23)" }}
                      data-testid={`resolve-shorten-${c.worker.id}`}
                    >
                      Shorten to {shortenDate(c)}
                    </button>
                    <button
                      onClick={() => setResolution(idx, "delay")}
                      className="text-[11px] font-semibold px-3 py-1.5 rounded-lg border"
                      style={{ borderColor: "hsl(var(--border))", color: "var(--pfg-navy)" }}
                      data-testid={`resolve-delay-${c.worker.id}`}
                    >
                      Delay {c.otherAssignment.projectCode} to {delayDate()}
                    </button>
                    <button
                      onClick={() => setResolution(idx, "flag")}
                      className="text-[11px] font-medium px-3 py-1.5 rounded-lg"
                      style={{ background: "hsl(var(--muted))", color: "var(--pfg-steel)" }}
                      data-testid={`resolve-flag-${c.worker.id}`}
                    >
                      Flag for Review
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t flex items-center justify-between" style={{ borderColor: "hsl(var(--border))" }}>
          <span className="text-[12px]" style={{ color: "var(--pfg-steel)" }}>
            {conflicts.filter(c => c.resolution).length} of {conflicts.length} resolved
          </span>
          <button
            onClick={handleApply}
            disabled={!allResolved || saving}
            className="text-[13px] font-bold px-5 py-2 rounded-lg disabled:opacity-40"
            style={{ background: "var(--pfg-yellow, #F5BD00)", color: "var(--pfg-navy, #1A1D23)" }}
            data-testid="conflict-apply-btn"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : "Apply Resolutions"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// EDIT PROJECT MODAL (Tabbed: Details, Role Planning, Team)
// ═══════════════════════════════════════════════════════════════════

function EditProjectModal({
  card,
  allWorkers,
  allRoleSlots,
  onClose,
}: {
  card: ProjectCardData;
  allWorkers: DashboardWorker[];
  allRoleSlots: DashboardRoleSlot[];
  onClose: () => void;
}) {
  const { user: authUser } = useAuth();
  const canDiscard = authUser?.role === "admin" || authUser?.role === "resource_manager";
  const customer = card.project.customer || PROJECT_CUSTOMER[card.project.code] || "";
  const color = customer ? (OEM_BRAND_COLORS[customer] || "#64748B") : "#64748B";
  const today = new Date().toISOString().split("T")[0];
  const rawStatus = (card.project.status || "active") as ProjectStatus;
  const projectStatus = (rawStatus === "active" && card.project.endDate && card.project.endDate < today) ? "completed" as ProjectStatus : rawStatus;

  const [activeTab, setActiveTab] = useState<"details" | "roles" | "team">("details");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<{ title: string; message: string; label: string; color: string; action: () => void } | null>(null);

  // ── Details tab state ──
  const [editCode, setEditCode] = useState(card.project.code);
  const [editName, setEditName] = useState(card.project.name);
  const [editCustomer, setEditCustomer] = useState(card.project.customer || "");
  const [editLocation, setEditLocation] = useState(card.project.location || "");
  const [editEquipment, setEditEquipment] = useState(card.project.equipmentType || "");
  const [editStart, setEditStart] = useState(card.project.startDate || "");
  const [editEnd, setEditEnd] = useState(card.project.endDate || "");
  const [editShift, setEditShift] = useState(card.project.shift || "Day");
  const [editHeadcount, setEditHeadcount] = useState(card.project.headcount || 6);
  const [editNotes, setEditNotes] = useState(card.project.notes || "");

  // ── Lead Resource Manager ──
  const { data: resourceManagers } = useQuery<{ id: number; name: string; email: string }[]>({
    queryKey: ["/api/users/resource-managers"],
  });
  const { data: dashData } = useDashboardData();
  const initialLeadId = dashData?.projectLeads?.[card.project.id] ?? null;
  const [editLeadUserId, setEditLeadUserId] = useState<number | null>(initialLeadId);
  useEffect(() => { setEditLeadUserId(initialLeadId); }, [initialLeadId]);

  // Detect OEM from customer
  const editOem = OEM_OPTIONS.find((o) => editCustomer.includes(o)) || "";

  // ── Role Planning tab state ──
  const existingSlots = allRoleSlots.filter((s) => s.projectId === card.project.id);
  const [roleSlotEdits, setRoleSlotEdits] = useState<RoleSlotDraft[]>(
    existingSlots.map((s) => ({
      key: -(s.id), // negative keys for existing
      role: s.role,
      startDate: s.startDate,
      endDate: s.endDate,
      quantity: s.quantity,
      shift: s.shift || "Day",
    }))
  );
  const [nextRoleKey, setNextRoleKey] = useState(1);
  const [deletedSlotIds, setDeletedSlotIds] = useState<number[]>([]);
  // Headcount auto-calculated from role slot quantities
  const computedHeadcount = roleSlotEdits.reduce((sum, s) => sum + (s.quantity || 0), 0) || (card.project.headcount || 0);
  const [slotSaving, setSlotSaving] = useState<number | null>(null);
  const [slotConflicts, setSlotConflicts] = useState<Record<number, string[]>>({});
  const [conflictModalData, setConflictModalData] = useState<ConflictModalState | null>(null);
  const { toast } = useToast();

  const addEditRoleSlot = () => {
    setRoleSlotEdits((prev) => [
      ...prev,
      { key: nextRoleKey, role: "Technician 2", startDate: editStart, endDate: editEnd, quantity: 1, shift: "Day" },
    ]);
    setNextRoleKey((k) => k + 1);
  };

  // Save existing role slot changes via PATCH, auto-update clean workers, show conflict modal for others
  const saveEditSlot = async (key: number) => {
    if (key >= 0) return; // new slots saved at final save
    const slotId = Math.abs(key);
    const slot = roleSlotEdits.find(s => s.key === key);
    if (!slot) return;
    setSlotSaving(key);
    try {
      // 1. Save the role slot
      await apiRequest("PATCH", `/api/role-slots/${slotId}`, {
        role: slot.role,
        startDate: slot.startDate,
        endDate: slot.endDate,
        quantity: slot.quantity,
        shift: slot.shift,
      });

      // 2. Find all workers assigned to this slot
      const slotAssignments = card.members.filter(m => m.assignment.roleSlotId === slotId || (
        !m.assignment.roleSlotId && m.assignment.role === slot.role
      ));

      // 3. Check each worker for conflicts with OTHER project assignments
      const cleanWorkers: { member: typeof slotAssignments[0] }[] = [];
      const conflictItems: ConflictItem[] = [];

      for (const m of slotAssignments) {
        // Find this worker's full data with all assignments
        const fullWorker = allWorkers.find(w => w.id === m.worker.id);
        if (!fullWorker) continue;

        // Check for overlapping assignments on OTHER projects
        const otherConflict = fullWorker.assignments.find(a =>
          a.projectId !== card.project.id &&
          (a.status === "active" || a.status === "flagged") &&
          a.startDate && a.endDate &&
          datesOverlap(slot.startDate, slot.endDate, a.startDate, a.endDate)
        );

        if (otherConflict) {
          conflictItems.push({
            worker: fullWorker,
            thisAssignment: m.assignment,
            otherAssignment: otherConflict,
            resolution: null,
          });
        } else {
          cleanWorkers.push({ member: m });
        }
      }

      // 4. Auto-update clean workers
      let autoUpdated = 0;
      for (const { member } of cleanWorkers) {
        try {
          await apiRequest("PATCH", `/api/assignments/${member.assignment.id}`, {
            startDate: slot.startDate,
            endDate: slot.endDate,
          });
          autoUpdated++;
        } catch { /* silent */ }
      }

      // Clear old warning-style conflicts for this slot
      setSlotConflicts(prev => {
        const next = { ...prev };
        delete next[key];
        return next;
      });

      // 5. Show conflict modal or just toast
      if (conflictItems.length > 0) {
        setConflictModalData({
          slotId,
          newStart: slot.startDate,
          newEnd: slot.endDate,
          projectCode: card.project.code,
          conflicts: conflictItems,
        });
      } else {
        if (autoUpdated > 0) {
          toast({ title: "Role slot updated", description: `${autoUpdated} worker${autoUpdated === 1 ? "" : "s"} updated automatically.` });
        }
        await queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
      }
    } catch { /* silent */ }
    setSlotSaving(null);
  };

  // Handle conflict resolution modal completion
  const handleConflictResolved = async (resolved: ConflictItem[]) => {
    const shortened = resolved.filter(c => c.resolution === "shorten").length;
    const delayed = resolved.filter(c => c.resolution === "delay").length;
    const flagged = resolved.filter(c => c.resolution === "flag").length;
    setConflictModalData(null);
    await queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
    toast({
      title: "Role slot updated",
      description: `${shortened + delayed > 0 ? `${shortened + delayed} resolved manually` : ""}${flagged > 0 ? `${shortened + delayed > 0 ? ", " : ""}${flagged} flagged` : ""}.`,
    });
  };

  const updateEditSlot = (key: number, field: keyof RoleSlotDraft, value: string | number) => {
    setRoleSlotEdits((prev) => prev.map((s) => (s.key === key ? { ...s, [field]: value } : s)));
  };

  const removeEditSlot = (key: number) => {
    if (key < 0) {
      const slotId = Math.abs(key);
      setDeletedSlotIds((prev) => [...prev, slotId]);
    }
    setRoleSlotEdits((prev) => prev.filter((s) => s.key !== key));
  };

  // ── Team tab state ──
  const [removedIds, setRemovedIds] = useState<Set<number>>(new Set());
  // Role-slot-based additions: map from role slot key -> worker ids
  const [slotAdditions, setSlotAdditions] = useState<Record<number, number[]>>({});
  // Per-slot search/filter state for edit modal
  const [editSlotSearch, setEditSlotSearch] = useState<Record<number, string>>({});
  const [editSlotFteOnly, setEditSlotFteOnly] = useState<Record<number, boolean>>({});
  const [editExpandedWorkers, setEditExpandedWorkers] = useState<Set<number>>(new Set());

  const handleRemove = (assignmentId: number) => {
    setRemovedIds((prev) => new Set(prev).add(assignmentId));
  };

  const handleUndo = (assignmentId: number) => {
    setRemovedIds((prev) => {
      const next = new Set(prev);
      next.delete(assignmentId);
      return next;
    });
  };

  // Get workers assigned to a role slot (existing team members)
  const getSlotMembers = (slotKey: number) => {
    const slotId = slotKey < 0 ? Math.abs(slotKey) : undefined;
    const slot = roleSlotEdits.find(s => s.key === slotKey);
    if (!slot) return [];
    return card.members.filter(m => {
      if (slotId && m.assignment.roleSlotId === slotId) return true;
      // Legacy match by role if no roleSlotId
      if (!m.assignment.roleSlotId && slotId && m.assignment.role === slot.role) return true;
      return false;
    });
  };

  // Get unmatched members (those not associated with any current role slot)
  const unmatchedMembers = useMemo(() => {
    const slotIds = new Set(existingSlots.map(s => s.id));
    const slotRoles = new Set(roleSlotEdits.map(s => s.role));
    return card.members.filter(m => {
      if (m.assignment.roleSlotId && slotIds.has(m.assignment.roleSlotId)) return false;
      if (!m.assignment.roleSlotId && m.assignment.role && slotRoles.has(m.assignment.role)) return false;
      return true;
    });
  }, [card.members, existingSlots, roleSlotEdits]);

  // Available workers for a role slot in edit modal
  function getEditAvailableWorkers(slotKey: number): { filtered: DashboardWorker[]; total: number } {
    const slot = roleSlotEdits.find(s => s.key === slotKey);
    if (!slot) return { filtered: [], total: 0 };

    // Worker IDs already on the project (not removed)
    const projectWorkerIds = new Set(
      card.members.filter(m => !removedIds.has(m.assignment.id)).map(m => m.worker.id)
    );
    // Worker IDs added in this session across all slots
    const allAddedIds = new Set<number>();
    for (const ids of Object.values(slotAdditions)) {
      for (const id of ids) allAddedIds.add(id);
    }

    const oemMatch = editOem && editEquipment ? `${editOem} - ${editEquipment}` : null;

    const base = allWorkers.filter(w => {
      // Already added to another slot in this edit session
      if (allAddedIds.has(w.id)) return false;
      // Check date availability — excludes same-project assignments so workers
      // can be on multiple non-overlapping slots of the same project
      if (!workerIsAvailable(w, slot.startDate, slot.endDate, card.project.id)) return false;
      return true;
    });
    const total = base.length;

    const searchTerm = (editSlotSearch[slotKey] || "").toLowerCase();
    const fteOnly = editSlotFteOnly[slotKey] || false;

    const filtered = base
      .filter(w => {
        if (searchTerm && !w.name.toLowerCase().includes(searchTerm)) return false;
        if (fteOnly && w.status !== "FTE") return false;
        return true;
      })
      .sort((a, b) => {
        const statusOrder = (s: string) => (s === "FTE" ? 0 : 1);
        const sd = statusOrder(a.status) - statusOrder(b.status);
        if (sd !== 0) return sd;
        if (oemMatch) {
          const aMatch = a.oemExperience.includes(oemMatch) ? 0 : 1;
          const bMatch = b.oemExperience.includes(oemMatch) ? 0 : 1;
          if (aMatch !== bMatch) return aMatch - bMatch;
        }
        return calcUtilisation(a.assignments).pct - calcUtilisation(b.assignments).pct;
      });

    return { filtered, total };
  }

  function toggleEditExpandedWorker(wid: number) {
    setEditExpandedWorkers(prev => {
      const next = new Set(prev);
      if (next.has(wid)) next.delete(wid); else next.add(wid);
      return next;
    });
  }

  function assignWorkerToEditSlot(slotKey: number, workerId: number) {
    setSlotAdditions(prev => ({
      ...prev,
      [slotKey]: [...(prev[slotKey] ?? []), workerId],
    }));
  }

  function unassignWorkerFromEditSlot(slotKey: number, workerId: number) {
    setSlotAdditions(prev => ({
      ...prev,
      [slotKey]: (prev[slotKey] ?? []).filter(id => id !== workerId),
    }));
  }

  const activeCount = card.members.filter((m) => !removedIds.has(m.assignment.id)).length +
    Object.values(slotAdditions).reduce((sum, ids) => sum + ids.length, 0);

  // ── Track changes ──
  const detailsChanged =
    editCode !== card.project.code ||
    editName !== card.project.name ||
    editCustomer !== (card.project.customer || "") ||
    editLocation !== (card.project.location || "") ||
    editEquipment !== (card.project.equipmentType || "") ||
    editStart !== (card.project.startDate || "") ||
    editEnd !== (card.project.endDate || "") ||
    editShift !== (card.project.shift || "Day") ||
    editHeadcount !== (card.project.headcount || 6) ||
    editNotes !== (card.project.notes || "") ||
    computedHeadcount !== (card.project.headcount || 0);
  const leadChanged = editLeadUserId !== initialLeadId;

  // rolesChanged: new slots, deleted slots, OR any existing slot that differs from original
  // Use existingSlots (fresh from allRoleSlots) as the reference — always available
  const existingSlotChanged = roleSlotEdits.some(s => {
    if (s.key > 0) return false; // new slot, handled separately
    const orig = existingSlots.find(o => o.id === Math.abs(s.key));
    if (!orig) return false;
    return orig.role !== s.role || orig.startDate !== s.startDate ||
           orig.endDate !== s.endDate || orig.quantity !== s.quantity || (orig.shift || "Day") !== s.shift;
  });
  const rolesChanged = deletedSlotIds.length > 0 || roleSlotEdits.some((s) => s.key > 0) || existingSlotChanged;
  const teamChanged = removedIds.size > 0 || Object.values(slotAdditions).some(ids => ids.length > 0);
  const hasChanges = detailsChanged || leadChanged || rolesChanged || teamChanged;

  // ── Save handler ──
  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      // Save details
      if (detailsChanged) {
        await apiRequest("PATCH", `/api/projects/${card.project.id}`, {
          code: editCode.trim().toUpperCase(),
          name: editName.trim(),
          customer: editCustomer.trim() || null,
          location: editLocation.trim() || null,
          equipmentType: editEquipment || null,
          startDate: editStart || null,
          endDate: editEnd || null,
          shift: editShift || null,
          headcount: computedHeadcount || editHeadcount || null,
          notes: editNotes.trim() || null,
        });
      }

      // Save lead resource manager
      if (leadChanged) {
        await apiRequest("PUT", `/api/projects/${card.project.id}/lead`, { userId: editLeadUserId });
      }

      // Delete removed role slots
      for (const slotId of deletedSlotIds) {
        await apiRequest("DELETE", `/api/role-slots/${slotId}`);
      }

      // Create new role slots (key > 0), update changed existing slots (key < 0)
      const newSlotIdMap: Record<number, number> = {};
      for (const slot of roleSlotEdits) {
        if (slot.key > 0) {
          // New slot — create
          const created = await apiRequest("POST", "/api/role-slots", {
            projectId: card.project.id,
            role: slot.role,
            startDate: slot.startDate,
            endDate: slot.endDate,
            quantity: slot.quantity,
            shift: slot.shift,
          });
          newSlotIdMap[slot.key] = created.id;
        } else {
          // Existing slot — patch if changed
          const slotId = Math.abs(slot.key);
          const orig = existingSlots.find(o => o.id === slotId);
          if (orig && (
            orig.role !== slot.role || orig.startDate !== slot.startDate ||
            orig.endDate !== slot.endDate || orig.quantity !== slot.quantity || (orig.shift || "Day") !== slot.shift
          )) {
            await apiRequest("PATCH", `/api/role-slots/${slotId}`, {
              role: slot.role, startDate: slot.startDate,
              endDate: slot.endDate, quantity: slot.quantity, shift: slot.shift,
            });
          }
        }
      }

      // Process team removals
      for (const id of Array.from(removedIds)) {
        await apiRequest("DELETE", `/api/assignments/${id}`);
      }

      // Process team additions (role-slot-based)
      for (const slot of roleSlotEdits) {
        const addedWorkerIds = slotAdditions[slot.key] ?? [];
        if (addedWorkerIds.length === 0) continue;
        // For existing slots (key < 0), use their server ID
        const roleSlotId = slot.key < 0 ? Math.abs(slot.key) : (newSlotIdMap[slot.key] ?? null);
        const durationDays = slot.startDate && slot.endDate
          ? Math.max(1, Math.ceil((new Date(slot.endDate).getTime() - new Date(slot.startDate).getTime()) / 86400000))
          : null;
        for (const wid of addedWorkerIds) {
          await apiRequest("POST", "/api/assignments", {
            workerId: wid,
            projectId: card.project.id,
            roleSlotId,
            role: slot.role,
            shift: slot.shift,
            startDate: slot.startDate,
            endDate: slot.endDate,
            duration: durationDays,
            status: "active",
          });
        }
      }

      await queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
      onClose();
    } catch (e: any) {
      setError(e.message || "Failed to save changes");
    } finally {
      setSaving(false);
    }
  };

  // ── Status action handlers ──
  const handleStatusAction = async (action: string) => {
    setSaving(true);
    setError(null);
    try {
      if (action === "discard") {
        // Delete entirely (potential only)
        await apiRequest("DELETE", `/api/projects/${card.project.id}`);
      } else {
        const statusMap: Record<string, string> = {
          complete: "completed",
          cancel: "cancelled",
          materialise: "active",
          reactivate: "active",
        };
        await apiRequest("POST", `/api/projects/${card.project.id}/status`, {
          status: statusMap[action],
        });
      }
      await queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
      onClose();
    } catch (e: any) {
      setError(e.message || "Action failed");
    } finally {
      setSaving(false);
    }
  };

  const tabs = [
    { key: "details" as const, label: "Details" },
    { key: "roles" as const, label: "Role Planning" },
    { key: "team" as const, label: "Team" },
  ];

  const isPotential = projectStatus === "potential";
  const isActive = projectStatus === "active";
  const isCompleted = projectStatus === "completed";
  const isCancelled = projectStatus === "cancelled";
  const isInactive = isCompleted || isCancelled;

  return (
    <ModalOverlay onClose={onClose} testId="edit-project-modal" wide>
      {/* Header */}
      <div
        className="px-6 py-5 flex items-center justify-between"
        style={{
          background: isInactive ? "#94a3b8" : isPotential ? `${color}B3` : color,
          color: "#fff",
        }}
      >
        <div className="flex items-center gap-3">
          <div>
            <div className="font-display text-lg font-bold flex items-center gap-2">
              {card.project.code} — {card.project.name}
              {isPotential && (
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: "rgba(255,255,255,0.3)" }}>
                  POTENTIAL
                </span>
              )}
              {isCompleted && (
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: "rgba(255,255,255,0.3)" }}>
                  COMPLETED
                </span>
              )}
              {isCancelled && (
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: "rgba(255,255,255,0.3)" }}>
                  CANCELLED
                </span>
              )}
            </div>
            <div className="text-xs opacity-80 mt-0.5">
              {card.project.location} · {card.project.customer} · {card.project.equipmentType || "—"}
            </div>
          </div>
        </div>
        <button onClick={onClose} className="text-white/60 hover:text-white p-1" data-testid="edit-modal-close">
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Tabs */}
      <div className="flex border-b" style={{ borderColor: "hsl(var(--border))" }}>
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className="px-5 py-3 text-[13px] font-semibold border-b-[3px] transition-colors"
            style={{
              borderColor: activeTab === tab.key ? "var(--pfg-yellow)" : "transparent",
              color: activeTab === tab.key ? "var(--pfg-navy)" : "hsl(var(--muted-foreground))",
              background: activeTab === tab.key ? "hsl(var(--accent))" : "transparent",
            }}
            data-testid={`tab-${tab.key}`}
          >
            {tab.label}
            {tab.key === "team" && <span className="ml-1.5 text-[11px]">({activeCount})</span>}
          </button>
        ))}
      </div>

      {/* Body */}
      <div className="p-6 overflow-y-auto flex-1" style={{ minHeight: 300 }}>
        {/* Details Tab */}
        {activeTab === "details" && (
          <div className="grid grid-cols-2 gap-4">
            <FormGroup label="Project Code *">
              <input className={inputCls} style={inputStyle} value={editCode} onChange={(e) => setEditCode(e.target.value)} data-testid="edit-code" />
            </FormGroup>
            <FormGroup label="Customer">
              <input className={inputCls} style={inputStyle} value={editCustomer} onChange={(e) => setEditCustomer(e.target.value)} data-testid="edit-customer" />
            </FormGroup>
            <FormGroup label="Project Name *">
              <input className={inputCls} style={inputStyle} value={editName} onChange={(e) => setEditName(e.target.value)} data-testid="edit-name" />
            </FormGroup>
            <FormGroup label="Location">
              <input className={inputCls} style={inputStyle} value={editLocation} onChange={(e) => setEditLocation(e.target.value)} data-testid="edit-location" />
            </FormGroup>
            <FormGroup label="Equipment Type">
              <select className={inputCls} style={inputStyle} value={editEquipment} onChange={(e) => setEditEquipment(e.target.value)} data-testid="edit-equipment">
                <option value="">Select...</option>
                {EQUIPMENT_TYPES.map((et) => <option key={et.value} value={et.value}>{et.label}</option>)}
              </select>
            </FormGroup>
            <FormGroup label="Shift Pattern">
              <select className={inputCls} style={inputStyle} value={editShift} onChange={(e) => setEditShift(e.target.value)} data-testid="edit-shift">
                <option value="Day">Day</option>
                <option value="Night">Night</option>
                <option value="Day + Night">Day + Night</option>
              </select>
            </FormGroup>
            <FormGroup label="Start Date *">
              <input type="date" className={inputCls} style={inputStyle} value={editStart} onChange={(e) => setEditStart(e.target.value)} data-testid="edit-start" />
            </FormGroup>
            <FormGroup label="End Date *">
              <input type="date" className={inputCls} style={inputStyle} value={editEnd} onChange={(e) => setEditEnd(e.target.value)} data-testid="edit-end" />
            </FormGroup>
            <FormGroup label="Headcount">
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg border text-[13px] font-semibold" style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--muted))" }}>
                <span>{computedHeadcount}</span>
                <span className="text-[11px] font-normal" style={{ color: "hsl(var(--muted-foreground))" }}>auto-calculated from role slots</span>
              </div>
            </FormGroup>
            <FormGroup label="Status">
              <div className="px-3 py-2 text-[13px] rounded-lg border capitalize" style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--muted))", color: "var(--pfg-navy)" }}>
                {projectStatus}
              </div>
            </FormGroup>
            <FormGroup label="Notes" full>
              <textarea className={`${inputCls} resize-y min-h-[60px]`} style={inputStyle} value={editNotes} onChange={(e) => setEditNotes(e.target.value)} data-testid="edit-notes" />
            </FormGroup>
            <FormGroup label="Lead Resource Manager" full>
              <select
                className={inputCls}
                style={inputStyle}
                value={editLeadUserId ?? ""}
                onChange={(e) => setEditLeadUserId(e.target.value ? Number(e.target.value) : null)}
                data-testid="edit-lead-rm"
              >
                <option value="">None</option>
                {(resourceManagers || []).map((rm) => (
                  <option key={rm.id} value={rm.id}>{rm.name}</option>
                ))}
              </select>
            </FormGroup>
          </div>
        )}

        {/* Role Planning Tab */}
        {activeTab === "roles" && (
          <div>
            <div className="flex items-center justify-between mb-4">
              <div className="text-sm font-bold text-pfg-navy font-display flex items-center gap-2">
                Role Slots
                <span className="text-xs font-semibold px-2 py-0.5 rounded-full" style={{ background: "hsl(var(--accent))", color: "#8B6E00" }}>
                  {roleSlotEdits.reduce((s, r) => s + r.quantity, 0)}
                </span>
              </div>
              <button
                onClick={addEditRoleSlot}
                className="flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-lg border"
                style={{ borderColor: "var(--pfg-yellow)", color: "var(--pfg-yellow)" }}
                data-testid="edit-add-role-slot"
              >
                <Plus className="w-3.5 h-3.5" />
                Add Role
              </button>
            </div>

            {roleSlotEdits.length === 0 ? (
              <div className="text-center py-10 text-sm" style={{ color: "hsl(var(--muted-foreground))" }}>
                No role slots. Click "Add Role" to start planning.
              </div>
            ) : (
              <div className="rounded-lg border overflow-hidden" style={{ borderColor: "hsl(var(--border))" }}>
                <table className="w-full text-[13px]" style={{ borderCollapse: "collapse" }}>
                  <thead>
                    <tr>
                      {["Role", "Start Date", "End Date", "Qty", "Shift", ""].map((h) => (
                        <th key={h} className="text-left px-3 py-2 text-[10px] font-semibold uppercase tracking-wide" style={{ background: "hsl(var(--muted))", color: "hsl(var(--muted-foreground))", borderBottom: "1px solid hsl(var(--border))" }}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {roleSlotEdits.map((slot) => (
                      <tr key={slot.key}>
                        <td className="px-3 py-1.5" style={{ borderBottom: "1px solid hsl(var(--border))" }}>
                          <select className="text-[13px] px-2 py-1 rounded border w-full" style={inputStyle} value={slot.role} onChange={(e) => updateEditSlot(slot.key, "role", e.target.value)} data-testid={`edit-slot-role-${slot.key}`}>
                            {PROJECT_ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                          </select>
                        </td>
                        <td className="px-3 py-1.5" style={{ borderBottom: "1px solid hsl(var(--border))" }}>
                          <input type="date" className="text-[13px] px-2 py-1 rounded border" style={inputStyle} value={slot.startDate} onChange={(e) => updateEditSlot(slot.key, "startDate", e.target.value)} data-testid={`edit-slot-start-${slot.key}`} />
                        </td>
                        <td className="px-3 py-1.5" style={{ borderBottom: "1px solid hsl(var(--border))" }}>
                          <input type="date" className="text-[13px] px-2 py-1 rounded border" style={inputStyle} value={slot.endDate} onChange={(e) => updateEditSlot(slot.key, "endDate", e.target.value)} data-testid={`edit-slot-end-${slot.key}`} />
                        </td>
                        <td className="px-3 py-1.5" style={{ borderBottom: "1px solid hsl(var(--border))" }}>
                          <input type="number" min={1} max={50} className="text-[13px] px-2 py-1 rounded border w-16 tabular-nums" style={inputStyle} value={slot.quantity} onChange={(e) => updateEditSlot(slot.key, "quantity", parseInt(e.target.value) || 1)} data-testid={`edit-slot-qty-${slot.key}`} />
                        </td>
                        <td className="px-3 py-1.5" style={{ borderBottom: "1px solid hsl(var(--border))" }}>
                          <select className="text-[13px] px-2 py-1 rounded border" style={inputStyle} value={slot.shift} onChange={(e) => updateEditSlot(slot.key, "shift", e.target.value)} data-testid={`edit-slot-shift-${slot.key}`}>
                            <option value="Day">Day</option>
                            <option value="Night">Night</option>
                          </select>
                        </td>
                        <td className="px-3 py-1.5 text-center" style={{ borderBottom: "1px solid hsl(var(--border))" }}>
                          <div className="flex items-center gap-1 justify-center">
                            {slot.key < 0 && (
                              <button
                                onClick={() => saveEditSlot(slot.key)}
                                disabled={slotSaving === slot.key}
                                className="p-1 rounded hover:bg-[var(--green-bg)]"
                                title="Save changes to this role slot"
                                data-testid={`edit-slot-save-${slot.key}`}
                              >
                                {slotSaving === slot.key ? <Loader2 className="w-3.5 h-3.5 animate-spin" style={{ color: "var(--pfg-steel)" }} /> : <Save className="w-3.5 h-3.5" style={{ color: "var(--green)" }} />}
                              </button>
                            )}
                            <button onClick={() => removeEditSlot(slot.key)} className="p-1 rounded hover:bg-[var(--red-bg)]" data-testid={`edit-slot-delete-${slot.key}`}>
                              <Trash2 className="w-3.5 h-3.5" style={{ color: "var(--red)" }} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {/* Conflict warnings */}
            {Object.keys(slotConflicts).length > 0 && (
              <div className="mt-3 space-y-1">
                {Object.entries(slotConflicts).map(([key, names]) => (
                  <div key={key} className="flex items-start gap-2 text-[12px] font-medium px-3 py-2 rounded-lg" style={{ background: "var(--amber-bg, hsl(var(--accent)))", color: "var(--amber, #D97706)" }} data-testid={`slot-conflict-${key}`}>
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                    <span>Warning: {names.join(", ")} {names.length === 1 ? "is" : "are"} assigned outside these new dates. Update their assignment dates in the Team tab.</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Team Tab — Role-slot-based assignment */}
        {activeTab === "team" && (
          <div>
            <div className="flex items-center justify-between mb-4">
              <div className="text-sm font-bold text-pfg-navy font-display flex items-center gap-2">
                Team Members
                <span className="text-xs font-semibold px-2 py-0.5 rounded-full" style={{ background: "hsl(var(--accent))", color: "#8B6E00" }}>
                  {activeCount}
                </span>
              </div>
              {editEnd && card.members.some(m => !removedIds.has(m.assignment.id) && m.assignment.endDate && m.assignment.endDate < editEnd) && (
                <button
                  onClick={async () => {
                    if (!confirm(`Extend all assignments to ${editEnd}?`)) return;
                    for (const m of card.members) {
                      if (!removedIds.has(m.assignment.id) && m.assignment.endDate && m.assignment.endDate < editEnd) {
                        await apiRequest("PATCH", `/api/assignments/${m.assignment.id}`, { endDate: editEnd });
                      }
                    }
                    await queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
                  }}
                  className="text-xs font-semibold px-3 py-1.5 rounded-lg border"
                  style={{ borderColor: "var(--pfg-yellow)", color: "var(--pfg-navy)" }}
                  data-testid="extend-all-assignments">
                  Extend All to {editEnd}
                </button>
              )}
            </div>

            {roleSlotEdits.length === 0 ? (
              <div className="text-center py-8 rounded-lg border" style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--muted))" }} data-testid="no-slots-message">
                <div className="text-sm font-medium text-pfg-navy mb-1">No role slots defined</div>
                <div className="text-[12px]" style={{ color: "var(--pfg-steel)" }}>Go to the Role Planning tab to define role slots first.</div>
              </div>
            ) : (
              <div className="space-y-5">
                {roleSlotEdits.map((slot) => {
                  const slotMembers = getSlotMembers(slot.key);
                  const addedWorkerIds = slotAdditions[slot.key] ?? [];
                  const filledCount = slotMembers.filter(m => !removedIds.has(m.assignment.id)).length + addedWorkerIds.length;
                  const { filtered: available, total: totalAvailable } = getEditAvailableWorkers(slot.key);
                  const isFteOnly = editSlotFteOnly[slot.key] || false;
                  const searchVal = editSlotSearch[slot.key] || "";
                  const oemMatch = editOem && editEquipment ? `${editOem} - ${editEquipment}` : null;

                  return (
                    <div key={slot.key} className="rounded-lg border" style={{ borderColor: "hsl(var(--border))" }} data-testid={`edit-team-slot-${slot.key}`}>
                      {/* Slot header */}
                      <div className="px-4 py-3 text-[13px] font-semibold" style={{ background: "hsl(var(--muted))", borderBottom: "1px solid hsl(var(--border))" }}>
                        <span className="text-pfg-navy">{slot.role}</span>
                        <span className="mx-1.5" style={{ color: "var(--pfg-steel)" }}>&mdash;</span>
                        <span style={{ color: "var(--pfg-steel)" }}>{slot.shift} shift</span>
                        <span className="mx-1.5" style={{ color: "var(--pfg-steel)" }}>&mdash;</span>
                        <span style={{ color: "var(--pfg-steel)" }}>{slot.startDate} to {slot.endDate}</span>
                        <span className="ml-2 text-xs font-semibold px-2 py-0.5 rounded-full" style={{ background: filledCount >= slot.quantity ? "var(--green-bg)" : "hsl(var(--accent))", color: filledCount >= slot.quantity ? "var(--green)" : "#8B6E00" }}>
                          {filledCount}/{slot.quantity}
                        </span>
                      </div>

                      {/* Existing members for this slot */}
                      {slotMembers.length > 0 && (
                        <div className="px-4 py-2 space-y-1">
                          {slotMembers.map((m) => {
                            const isRemoved = removedIds.has(m.assignment.id);
                            return (
                              <div
                                key={m.assignment.id}
                                className="flex items-center gap-3 px-3 py-2 rounded-lg border transition-colors"
                                style={{
                                  borderColor: "hsl(var(--border))",
                                  opacity: isRemoved ? 0.45 : 1,
                                  background: isRemoved ? "hsl(var(--muted))" : undefined,
                                  textDecoration: isRemoved ? "line-through" : undefined,
                                }}
                                data-testid={`member-row-${m.assignment.id}`}
                              >
                                <div className="flex-1 min-w-0">
                                  <div className="text-[13px] font-semibold text-pfg-navy">{m.worker.name}{m.worker.driversLicenseUploaded ? <span className="inline-flex items-center justify-center w-4 h-4 rounded-full text-[8px] font-bold ml-1 shrink-0" style={{ background: "#1A1D23", color: "#F5BD00" }} title="Has Driver's Licence">D</span> : null}</div>
                                  <div className="flex items-center gap-2 mt-0.5">
                                    <span className="text-[11px]" style={{ color: "var(--pfg-steel)" }}>
                                      {m.assignment.role || m.worker.role} · {m.assignment.startDate || "—"} →
                                    </span>
                                    <input
                                      type="date"
                                      value={m.assignment.endDate || ""}
                                      onChange={async (e) => {
                                        try {
                                          await apiRequest("PATCH", `/api/assignments/${m.assignment.id}`, { endDate: e.target.value });
                                          await queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
                                        } catch { /* silent */ }
                                      }}
                                      className="text-[11px] px-1.5 py-0.5 border rounded"
                                      style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--background))", width: "120px" }}
                                      data-testid={`assignment-end-date-${m.assignment.id}`}
                                    />
                                    {m.assignment.endDate && editEnd && m.assignment.endDate < editEnd && (
                                      <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded" style={{ background: "var(--amber-bg, hsl(var(--accent)))", color: "var(--amber, #D97706)" }}>ends early</span>
                                    )}
                                  </div>
                                </div>
                                <div className="flex items-center gap-1.5 shrink-0">
                                  <ShiftBadge shift={m.assignment.shift} />
                                  <StatusBadge status={m.worker.status} />
                                  {isRemoved ? (
                                    <button onClick={() => handleUndo(m.assignment.id)} className="ml-1 p-1 rounded hover:bg-[var(--green-bg)]" title="Undo removal" data-testid={`undo-remove-${m.assignment.id}`}>
                                      <Undo2 className="w-3.5 h-3.5" style={{ color: "var(--green)" }} />
                                    </button>
                                  ) : (
                                    <button onClick={() => handleRemove(m.assignment.id)} className="ml-1 p-1 rounded hover:bg-[var(--red-bg)]" title="Remove from project" data-testid={`remove-member-${m.assignment.id}`}>
                                      <X className="w-3.5 h-3.5" style={{ color: "var(--red)" }} />
                                    </button>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}

                      {/* Newly added workers for this slot */}
                      {addedWorkerIds.length > 0 && (
                        <div className="px-4 py-2 space-y-1">
                          {addedWorkerIds.map((wid) => {
                            const worker = allWorkers.find(w => w.id === wid);
                            if (!worker) return null;
                            return (
                              <div key={`add-${wid}`} className="flex items-center gap-3 px-3 py-2 rounded-lg border" style={{ borderColor: "var(--green)", background: "var(--green-bg)" }} data-testid={`edit-addition-${slot.key}-${wid}`}>
                                <div className="flex-1 min-w-0">
                                  <div className="text-[13px] font-semibold text-pfg-navy">{worker.name}{worker.driversLicenseUploaded ? <span className="inline-flex items-center justify-center w-4 h-4 rounded-full text-[8px] font-bold ml-1 shrink-0" style={{ background: "#1A1D23", color: "#F5BD00" }} title="Has Driver's Licence">D</span> : null}</div>
                                  <div className="text-[11px] mt-0.5" style={{ color: "var(--pfg-steel)" }}>{worker.role} · New addition</div>
                                </div>
                                <div className="flex items-center gap-1.5 shrink-0">
                                  <StatusBadge status={worker.status} />
                                  <button onClick={() => unassignWorkerFromEditSlot(slot.key, wid)} className="ml-1 p-1 rounded hover:bg-[var(--red-bg)]" data-testid={`edit-unassign-${slot.key}-${wid}`}>
                                    <X className="w-3.5 h-3.5" style={{ color: "var(--red)" }} />
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}

                      {/* Available workers search/filter panel */}
                      {filledCount < slot.quantity && (
                        <div className="px-4 py-2">
                          <div className="flex items-center gap-2 mb-2">
                            <div className="relative flex-1">
                              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5" style={{ color: "hsl(var(--muted-foreground))" }} />
                              <input
                                type="text"
                                placeholder="Search by name..."
                                value={searchVal}
                                onChange={(e) => setEditSlotSearch(prev => ({ ...prev, [slot.key]: e.target.value }))}
                                className="w-full pl-8 pr-3 py-1.5 text-[12px] rounded-lg border"
                                style={inputStyle}
                                data-testid={`edit-slot-search-${slot.key}`}
                              />
                            </div>
                            <div className="flex items-center gap-1">
                              <button
                                onClick={() => setEditSlotFteOnly(prev => ({ ...prev, [slot.key]: false }))}
                                className="text-[11px] font-semibold px-2.5 py-1 rounded-lg border"
                                style={{
                                  borderColor: !isFteOnly ? "var(--pfg-yellow)" : "hsl(var(--border))",
                                  background: !isFteOnly ? "hsl(var(--accent))" : "transparent",
                                  color: !isFteOnly ? "var(--pfg-navy)" : "hsl(var(--muted-foreground))",
                                }}
                                data-testid={`edit-filter-all-${slot.key}`}
                              >All</button>
                              <button
                                onClick={() => setEditSlotFteOnly(prev => ({ ...prev, [slot.key]: true }))}
                                className="text-[11px] font-semibold px-2.5 py-1 rounded-lg border"
                                style={{
                                  borderColor: isFteOnly ? "var(--pfg-yellow)" : "hsl(var(--border))",
                                  background: isFteOnly ? "hsl(var(--accent))" : "transparent",
                                  color: isFteOnly ? "var(--pfg-navy)" : "hsl(var(--muted-foreground))",
                                }}
                                data-testid={`edit-filter-fte-${slot.key}`}
                              >FTE only</button>
                            </div>
                            <span className="text-[11px] font-medium shrink-0" style={{ color: "var(--pfg-steel)" }}>
                              {available.length} of {totalAvailable} workers
                            </span>
                          </div>
                          <div className="max-h-[200px] overflow-y-auto space-y-0.5">
                            {available.length === 0 ? (
                              <div className="text-center py-4 text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>No available workers{searchVal || isFteOnly ? " matching filters" : " without date conflicts"}</div>
                            ) : (
                              available.map((w) => {
                                const util = calcUtilisation(w.assignments);
                                const hasOemMatch = oemMatch ? w.oemExperience.includes(oemMatch) : false;
                                const isExpanded = editExpandedWorkers.has(w.id);
                                const activeAssignment = w.assignments.find(a => a.status === "active");
                                return (
                                  <div key={w.id}>
                                    <div
                                      className="flex items-center gap-3 px-3 py-2 rounded-lg border cursor-pointer transition-colors hover:border-[var(--pfg-yellow)] hover:bg-[hsl(var(--accent))]"
                                      style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--card))" }}
                                      data-testid={`edit-available-${slot.key}-${w.id}`}
                                    >
                                      <div className="flex-1 min-w-0" onClick={() => assignWorkerToEditSlot(slot.key, w.id)}>
                                        <div className="text-[13px] font-semibold text-pfg-navy">{w.name}{w.driversLicenseUploaded ? <span className="inline-flex items-center justify-center w-4 h-4 rounded-full text-[8px] font-bold ml-1 shrink-0" style={{ background: "#1A1D23", color: "#F5BD00" }} title="Has Driver's Licence">D</span> : null}</div>
                                        <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                                          <span className="text-[11px]" style={{ color: "var(--pfg-steel)" }}>{w.role}</span>
                                          {w.oemExperience.slice(0, 3).map((exp) => (
                                            <span key={exp} className={`badge text-[10px] ${exp === oemMatch ? "badge-green" : "badge-grey"}`}>{exp}</span>
                                          ))}
                                        </div>
                                      </div>
                                      <div className="flex items-center gap-2 shrink-0">
                                        <span className="text-[11px] tabular-nums font-medium" style={{ color: util.pct > 80 ? "var(--red)" : "var(--pfg-steel)" }}>{util.pct}%</span>
                                        <StatusBadge status={w.status} />
                                        {hasOemMatch && <span className="badge badge-green text-[10px]">OEM</span>}
                                        <button
                                          onClick={(e) => { e.stopPropagation(); toggleEditExpandedWorker(w.id); }}
                                          className="p-0.5 rounded hover:bg-black/5"
                                          data-testid={`edit-expand-${slot.key}-${w.id}`}
                                          title="Preview worker details"
                                        >
                                          {isExpanded ? <ChevronUp className="w-3.5 h-3.5" style={{ color: "var(--pfg-steel)" }} /> : <Info className="w-3.5 h-3.5" style={{ color: "var(--pfg-steel)" }} />}
                                        </button>
                                        <button
                                          onClick={(e) => { e.stopPropagation(); assignWorkerToEditSlot(slot.key, w.id); }}
                                          className="p-0.5"
                                          data-testid={`edit-assign-btn-${slot.key}-${w.id}`}
                                        >
                                          <Plus className="w-4 h-4" style={{ color: "var(--pfg-yellow)" }} />
                                        </button>
                                      </div>
                                    </div>
                                    {isExpanded && (
                                      <div className="ml-3 mr-3 mb-1 px-3 py-2 rounded-b-lg border border-t-0 text-[12px]" style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--muted))" }} data-testid={`edit-preview-${w.id}`}>
                                        <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                                          <div><span style={{ color: "var(--pfg-steel)" }}>Status:</span> <StatusBadge status={w.status} /></div>
                                          <div><span style={{ color: "var(--pfg-steel)" }}>English:</span> <span className="font-medium">{w.englishLevel || "\u2014"}</span></div>
                                          <div><span style={{ color: "var(--pfg-steel)" }}>Utilisation:</span> <span className="font-medium tabular-nums" style={{ color: util.pct > 80 ? "var(--red)" : undefined }}>{util.pct}%</span></div>
                                          {activeAssignment && (
                                            <div><span style={{ color: "var(--pfg-steel)" }}>Current:</span> <span className="font-medium">{activeAssignment.projectCode} &mdash; {activeAssignment.projectName}</span></div>
                                          )}
                                        </div>
                                        {w.oemExperience.length > 0 && (
                                          <div className="flex flex-wrap gap-1 mt-1.5">
                                            {w.oemExperience.map((exp) => (
                                              <span key={exp} className={`badge text-[10px] ${exp === oemMatch ? "badge-green" : "badge-grey"}`}>{exp}</span>
                                            ))}
                                          </div>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                );
                              })
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}

                {/* Unmatched members (no role slot) */}
                {unmatchedMembers.length > 0 && (
                  <div className="rounded-lg border" style={{ borderColor: "hsl(var(--border))" }} data-testid="unmatched-members">
                    <div className="px-4 py-3 text-[13px] font-semibold" style={{ background: "hsl(var(--muted))", borderBottom: "1px solid hsl(var(--border))" }}>
                      <span className="text-pfg-navy">Unslotted Members</span>
                      <span className="ml-2 text-xs font-semibold px-2 py-0.5 rounded-full" style={{ background: "var(--amber-bg, hsl(var(--accent)))", color: "var(--amber, #D97706)" }}>
                        {unmatchedMembers.length}
                      </span>
                    </div>
                    <div className="px-4 py-2 space-y-1">
                      {unmatchedMembers.map((m) => {
                        const isRemoved = removedIds.has(m.assignment.id);
                        return (
                          <div
                            key={m.assignment.id}
                            className="flex items-center gap-3 px-3 py-2 rounded-lg border transition-colors"
                            style={{
                              borderColor: "hsl(var(--border))",
                              opacity: isRemoved ? 0.45 : 1,
                              background: isRemoved ? "hsl(var(--muted))" : undefined,
                              textDecoration: isRemoved ? "line-through" : undefined,
                            }}
                            data-testid={`member-row-${m.assignment.id}`}
                          >
                            <div className="flex-1 min-w-0">
                              <div className="text-[13px] font-semibold text-pfg-navy">{m.worker.name}{m.worker.driversLicenseUploaded ? <span className="inline-flex items-center justify-center w-4 h-4 rounded-full text-[8px] font-bold ml-1 shrink-0" style={{ background: "#1A1D23", color: "#F5BD00" }} title="Has Driver's Licence">D</span> : null}</div>
                              <div className="flex items-center gap-2 mt-0.5">
                                <span className="text-[11px]" style={{ color: "var(--pfg-steel)" }}>{m.assignment.role || m.worker.role} · {m.assignment.startDate || "—"} → {m.assignment.endDate || "—"}</span>
                              </div>
                            </div>
                            <div className="flex items-center gap-1.5 shrink-0">
                              <ShiftBadge shift={m.assignment.shift} />
                              <StatusBadge status={m.worker.status} />
                              {isRemoved ? (
                                <button onClick={() => handleUndo(m.assignment.id)} className="ml-1 p-1 rounded hover:bg-[var(--green-bg)]" title="Undo removal" data-testid={`undo-remove-${m.assignment.id}`}>
                                  <Undo2 className="w-3.5 h-3.5" style={{ color: "var(--green)" }} />
                                </button>
                              ) : (
                                <button onClick={() => handleRemove(m.assignment.id)} className="ml-1 p-1 rounded hover:bg-[var(--red-bg)]" title="Remove from project" data-testid={`remove-member-${m.assignment.id}`}>
                                  <X className="w-3.5 h-3.5" style={{ color: "var(--red)" }} />
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {error && (
          <div className="mt-4 text-sm font-medium px-3 py-2 rounded-lg" style={{ background: "var(--red-bg)", color: "var(--red)" }}>
            {error}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="px-6 py-4 border-t flex items-center justify-between" style={{ borderColor: "hsl(var(--border))" }}>
        <div className="flex gap-2">
          {/* Status action buttons */}
          {isPotential && (
            <>
              <button
                onClick={() => setConfirmAction({
                  title: "Materialise Project",
                  message: `Convert "${card.project.code}" from potential to active? This project will become a real, active project.`,
                  label: "Materialise",
                  color: "var(--green, #16a34a)",
                  action: () => handleStatusAction("materialise"),
                })}
                disabled={saving}
                className="flex items-center gap-1.5 px-3 py-2 text-[12px] font-semibold rounded-lg text-white"
                style={{ background: "var(--green, #16a34a)" }}
                data-testid="action-materialise"
              >
                <Sparkles className="w-3.5 h-3.5" />
                Materialise
              </button>
              {canDiscard && (
                <button
                  onClick={() => setConfirmAction({
                    title: "Discard Project",
                    message: `Permanently delete "${card.project.code}"? This potential project and all its role slots and assignments will be removed. This cannot be undone.`,
                    label: "Discard",
                    color: "var(--red, #dc2626)",
                    action: () => handleStatusAction("discard"),
                  })}
                  disabled={saving}
                  className="flex items-center gap-1.5 px-3 py-2 text-[12px] font-semibold rounded-lg"
                  style={{ background: "var(--red-bg)", color: "var(--red)" }}
                  data-testid="action-discard"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Discard
                </button>
              )}
            </>
          )}
          {isActive && (
            <>
              <button
                onClick={() => setConfirmAction({
                  title: "Mark Completed",
                  message: `Mark "${card.project.code}" as completed? All assignments will remain in history.`,
                  label: "Mark Completed",
                  color: "var(--green, #16a34a)",
                  action: () => handleStatusAction("complete"),
                })}
                disabled={saving}
                className="flex items-center gap-1.5 px-3 py-2 text-[12px] font-semibold rounded-lg text-white"
                style={{ background: "var(--green, #16a34a)" }}
                data-testid="action-complete"
              >
                <CheckCircle2 className="w-3.5 h-3.5" />
                Mark Completed
              </button>
              <button
                onClick={() => setConfirmAction({
                  title: "Cancel Project",
                  message: `Cancel "${card.project.code}"? All active assignments will be marked as removed.`,
                  label: "Cancel Project",
                  color: "var(--red, #dc2626)",
                  action: () => handleStatusAction("cancel"),
                })}
                disabled={saving}
                className="flex items-center gap-1.5 px-3 py-2 text-[12px] font-semibold rounded-lg"
                style={{ background: "var(--red-bg)", color: "var(--red)" }}
                data-testid="action-cancel"
              >
                <XCircle className="w-3.5 h-3.5" />
                Cancel Project
              </button>
            </>
          )}
          {isInactive && (
            <button
              onClick={() => setConfirmAction({
                title: "Reactivate Project",
                message: `Reactivate "${card.project.code}"? It will be set back to active status.`,
                label: "Reactivate",
                color: "var(--pfg-navy, #1B2A4A)",
                action: () => handleStatusAction("reactivate"),
              })}
              disabled={saving}
              className="flex items-center gap-1.5 px-3 py-2 text-[12px] font-semibold rounded-lg text-white"
              style={{ background: "var(--pfg-navy)" }}
              data-testid="action-reactivate"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Reactivate
            </button>
          )}
        </div>

        <div className="flex gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 text-[13px] font-medium rounded-lg border"
            style={{ borderColor: "hsl(var(--border))" }}
            data-testid="edit-cancel"
          >
            Close
          </button>
          <button
            onClick={handleSave}
            disabled={!hasChanges || saving}
            className="px-5 py-2 text-[13px] font-semibold rounded-lg flex items-center gap-1.5 disabled:opacity-40"
            style={{ background: "var(--pfg-yellow)", color: "var(--pfg-navy)" }}
            data-testid="save-changes"
          >
            {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            Save Changes
          </button>
        </div>
      </div>

      {/* Confirm Dialog */}
      {confirmAction && (
        <ConfirmDialog
          title={confirmAction.title}
          message={confirmAction.message}
          confirmLabel={confirmAction.label}
          confirmColor={confirmAction.color}
          onConfirm={() => {
            confirmAction.action();
            setConfirmAction(null);
          }}
          onCancel={() => setConfirmAction(null)}
        />
      )}

      {/* Conflict Resolution Modal */}
      {conflictModalData && (
        <ConflictResolutionModal
          data={conflictModalData}
          onResolve={handleConflictResolved}
          onClose={() => setConflictModalData(null)}
        />
      )}
    </ModalOverlay>
  );
}

// ═══════════════════════════════════════════════════════════════════
// MAIN PAGE COMPONENT
// ═══════════════════════════════════════════════════════════════════

export default function ProjectAllocation() {
  const { data, isLoading } = useDashboardData();
  const [selectedProject, setSelectedProject] = useState<string | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [activeFilters, setActiveFilters] = useState<Set<ProjectStatus>>(() => new Set<ProjectStatus>(["active", "potential"]));

  const handleToggleFilter = (status: ProjectStatus) => {
    setActiveFilters((prev) => {
      const next = new Set(prev);
      if (next.has(status)) {
        next.delete(status);
      } else {
        next.add(status);
      }
      return next;
    });
  };

  if (isLoading || !data) return <LoadingSkeleton />;

  const { workers, projects, roleSlots: allRoleSlots } = data;

  const today = new Date().toISOString().split("T")[0];

  // Auto-complete: projects with endDate in the past display as "completed"
  const getEffectiveStatus = (p: DashboardProject): ProjectStatus => {
    const raw = (p.status || "active") as ProjectStatus;
    if (raw === "active" && p.endDate && p.endDate < today) return "completed";
    return raw;
  };

  const projectCards: ProjectCardData[] = projects
    .filter((p) => activeFilters.has(getEffectiveStatus(p)))
    .map((project) => {
      const members: ProjectCardData["members"] = [];
      for (const w of workers) {
        for (const a of w.assignments) {
          if (a.projectId === project.id && a.status === "active") {
            members.push({ worker: w, assignment: a });
          }
        }
      }
      // Attach the project's role slots
      const projRoleSlots = allRoleSlots.filter((rs) => rs.projectId === project.id);
      return { project: { ...project, roleSlots: projRoleSlots }, members };
    })
    .sort((a, b) => {
      // Sort: active first, then potential, then completed, then cancelled
      const statusOrder: Record<string, number> = { active: 0, potential: 1, completed: 2, cancelled: 3 };
      const aOrder = statusOrder[getEffectiveStatus(a.project)] ?? 0;
      const bOrder = statusOrder[getEffectiveStatus(b.project)] ?? 0;
      if (aOrder !== bOrder) return aOrder - bOrder;
      return b.members.length - a.members.length;
    });

  const assignedWorkerIds = new Set(
    workers.filter((w) => w.assignments.some((a) => a.status === "active")).map((w) => w.id)
  );
  const availableWorkers = workers.filter((w) => !assignedWorkerIds.has(w.id));

  const activeProjectCount = projects.filter((p) => p.status === "active").length;

  const selectedCard = projectCards.find((c) => c.project.code === selectedProject);

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h2 className="font-display text-lg font-bold text-pfg-navy">Project Allocation</h2>
          <p className="text-xs mt-0.5" style={{ color: "var(--pfg-steel)" }}>
            {activeProjectCount} active projects · {availableWorkers.length} available
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              const rows = projectCards.map(card => ({
                "Project Code": card.project.code,
                Name: card.project.name,
                Customer: card.project.customer || PROJECT_CUSTOMER[card.project.code] || "",
                Location: card.project.location || "",
                Equipment: card.project.equipmentType || "",
                "Start Date": card.project.startDate || "",
                "End Date": card.project.endDate || "",
                Headcount: card.project.headcount || "",
                Status: card.project.status || "active",
                "Team Count": card.members.length,
              }));
              downloadCSV(rows, `pfg-projects-${new Date().toISOString().split("T")[0]}.csv`);
            }}
            className="flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg border transition-colors hover:bg-[hsl(var(--accent))]"
            style={{ borderColor: "hsl(var(--border))", color: "var(--pfg-navy)" }}
            data-testid="export-csv-btn"
          >
            <Download className="w-3.5 h-3.5" /> Export CSV
          </button>
          <button
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-[13px] font-semibold"
            style={{ background: "var(--pfg-yellow)", color: "var(--pfg-navy)" }}
            onClick={() => setShowAddModal(true)}
            data-testid="add-project-btn"
          >
            <Plus className="w-4 h-4" />
            Add New Project
          </button>
        </div>
      </div>

      {/* Status Filter Toggles */}
      <StatusFilterBar activeFilters={activeFilters} onToggle={handleToggleFilter} />

      {/* Project Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 mb-4">
        {projectCards.map((card) => (
          <ProjectCard
            key={card.project.id}
            card={card}
            onClick={() => setSelectedProject(card.project.code)}
            effectiveStatus={getEffectiveStatus(card.project)}
          />
        ))}
      </div>

      {/* Available Pool */}
      <AvailablePoolCard workers={availableWorkers} />

      {/* Edit Project Modal */}
      {selectedCard && (
        <EditProjectModal
          card={selectedCard}
          allWorkers={workers}
          allRoleSlots={allRoleSlots}
          onClose={() => setSelectedProject(null)}
        />
      )}

      {/* Add New Project Modal */}
      {showAddModal && (
        <AddProjectModal onClose={() => setShowAddModal(false)} />
      )}
    </div>
  );
}
