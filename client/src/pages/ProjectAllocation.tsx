import { useState, useMemo } from "react";
import { useDashboardData, type DashboardWorker, type DashboardProject, type DashboardAssignment } from "@/hooks/use-dashboard-data";
import { OEM_BRAND_COLORS, PROJECT_CUSTOMER, OEM_OPTIONS, EQUIPMENT_TYPES, PROJECT_ROLES, calcUtilisation } from "@/lib/constants";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Plus, X, ExternalLink, Trash2, Undo2, Search, ChevronDown, ChevronUp, Check, Loader2 } from "lucide-react";
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
function ModalOverlay({ children, onClose, testId }: { children: React.ReactNode; onClose: () => void; testId: string }) {
  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center"
      style={{ background: "rgba(27,42,74,0.5)", backdropFilter: "blur(2px)" }}
      onClick={onClose}
      data-testid={testId}
    >
      <div
        className="rounded-xl overflow-hidden w-[900px] max-w-[95vw] max-h-[90vh] flex flex-col"
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
  project: DashboardProject;
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

// ─── Project Card ──────────────────────────────────────────────────

function ProjectCard({ card, onClick }: { card: ProjectCardData; onClick: () => void }) {
  const customer = card.project.customer || PROJECT_CUSTOMER[card.project.code] || "";
  const color = customer ? (OEM_BRAND_COLORS[customer] || "#64748B") : "#64748B";

  return (
    <div
      className="rounded-xl border overflow-hidden cursor-pointer transition-shadow hover:shadow-md"
      style={{ background: "hsl(var(--card))", borderColor: "hsl(var(--card-border))", boxShadow: "var(--shadow-sm)" }}
      onClick={onClick}
      data-testid={`project-card-${card.project.code}`}
    >
      <div className="px-5 py-4 flex items-center justify-between font-display" style={{ background: color, color: "#fff" }}>
        <div>
          <div className="text-sm font-bold">{card.project.code} — {card.project.name}</div>
          {card.project.location && <div className="text-[11px] opacity-80 mt-0.5">{card.project.location}</div>}
        </div>
        <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full" style={{ background: "rgba(255,255,255,0.2)" }}>
          {card.members.length}
        </span>
      </div>

      <div>
        {card.members.length === 0 ? (
          <div className="px-5 py-6 text-center text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>No team members assigned</div>
        ) : (
          card.members.map((m) => (
            <div key={m.assignment.id} className="flex items-center justify-between px-5 py-2.5 text-[13px] transition-colors hover:bg-[hsl(var(--muted))]" style={{ borderBottom: "1px solid hsl(var(--border))" }}>
              <div>
                <div className="font-medium text-pfg-navy">{m.worker.name}</div>
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

  // Step 2: Role slots
  const [roleSlots, setRoleSlots] = useState<RoleSlotDraft[]>([]);
  const [nextKey, setNextKey] = useState(1);
  const [roleSlotsInitialised, setRoleSlotsInitialised] = useState(false);

  // Step 3: Assignments — Map<slotKey, workerId[]>
  const [slotAssignments, setSlotAssignments] = useState<Record<number, number[]>>({});

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

  // Check date overlap
  function datesOverlap(aStart: string, aEnd: string, bStart: string | null, bEnd: string | null): boolean {
    if (!bStart || !bEnd) return false;
    return aStart <= bEnd && aEnd >= bStart;
  }

  // Available workers for a given slot
  function getAvailableWorkers(slot: RoleSlotDraft): DashboardWorker[] {
    const currentSlotWorkers = slotAssignments[slot.key] ?? [];
    const oemMatch = oem && equipmentType ? `${oem} - ${equipmentType}` : null;

    return allWorkers
      .filter((w) => {
        // Already assigned to this slot
        if (currentSlotWorkers.includes(w.id)) return false;
        // Already assigned to another slot in this wizard
        if (allAssignedWorkerIds.has(w.id) && !currentSlotWorkers.includes(w.id)) return false;
        // Check existing assignment date overlaps
        for (const a of w.assignments) {
          if (datesOverlap(slot.startDate, slot.endDate, a.startDate, a.endDate)) return false;
        }
        return true;
      })
      .sort((a, b) => {
        // FTE before Temp
        const statusOrder = (s: string) => (s === "FTE" ? 0 : 1);
        const sd = statusOrder(a.status) - statusOrder(b.status);
        if (sd !== 0) return sd;
        // OEM match first
        if (oemMatch) {
          const aMatch = a.oemExperience.includes(oemMatch) ? 0 : 1;
          const bMatch = b.oemExperience.includes(oemMatch) ? 0 : 1;
          if (aMatch !== bMatch) return aMatch - bMatch;
        }
        // Lowest utilisation
        const aUtil = calcUtilisation(a.assignments).pct;
        const bUtil = calcUtilisation(b.assignments).pct;
        return aUtil - bUtil;
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
      const projRes = await apiRequest("POST", "/api/projects", {
        code: code.trim().toUpperCase(),
        name: projectName.trim(),
        customer: customer.trim() || oem || null,
        location: location.trim() || null,
        equipmentType: equipmentType || null,
        startDate: startDate || null,
        endDate: endDate || null,
        shift: shift || null,
        headcount: headcount || null,
        notes: notes.trim() || null,
        status: "active",
      });
      const project = await projRes.json();

      // 2. Create role slots and collect their server IDs
      const slotIdMap: Record<number, number> = {}; // key -> server id
      for (const slot of roleSlots) {
        const slotRes = await apiRequest("POST", "/api/role-slots", {
          projectId: project.id,
          role: slot.role,
          startDate: slot.startDate,
          endDate: slot.endDate,
          quantity: slot.quantity,
          shift: slot.shift,
        });
        const created = await slotRes.json();
        slotIdMap[slot.key] = created.id;
      }

      // 3. Create assignments
      for (const slot of roleSlots) {
        const workerIds = slotAssignments[slot.key] ?? [];
        const serverId = slotIdMap[slot.key];
        const durationDays = slot.startDate && slot.endDate
          ? Math.max(1, Math.ceil((new Date(slot.endDate).getTime() - new Date(slot.startDate).getTime()) / 86400000))
          : null;
        for (const wid of workerIds) {
          await apiRequest("POST", "/api/assignments", {
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
        }
      }

      // 4. Invalidate cache
      await queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
      onClose();
    } catch (e: any) {
      setError(e.message || "Failed to create project");
    } finally {
      setSaving(false);
    }
  };

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
            <FormGroup label="Headcount *">
              <input type="number" min={1} max={100} className={inputCls} style={inputStyle} value={headcount} onChange={(e) => setHeadcount(parseInt(e.target.value) || 6)} data-testid="input-headcount" />
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
              const available = getAvailableWorkers(slot);
              const oemMatch = oem && equipmentType ? `${oem} - ${equipmentType}` : null;
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
                              <span className="font-semibold text-pfg-navy">{worker.name}</span>
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

                  {/* Available workers */}
                  {assigned.length < slot.quantity && (
                    <div className="px-4 py-2">
                      <div className="text-[11px] font-semibold uppercase tracking-wide mb-2" style={{ color: "var(--pfg-steel)" }}>
                        Available ({available.length})
                      </div>
                      <div className="max-h-[200px] overflow-y-auto space-y-0.5">
                        {available.length === 0 ? (
                          <div className="text-center py-4 text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>No available workers without date conflicts</div>
                        ) : (
                          available.map((w) => {
                            const util = calcUtilisation(w.assignments);
                            const hasOemMatch = oemMatch ? w.oemExperience.includes(oemMatch) : false;
                            return (
                              <div
                                key={w.id}
                                className="flex items-center gap-3 px-3 py-2 rounded-lg border cursor-pointer transition-colors hover:border-[var(--pfg-yellow)] hover:bg-[hsl(var(--accent))]"
                                style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--card))" }}
                                onClick={() => assignWorkerToSlot(slot.key, w.id)}
                                data-testid={`available-${slot.key}-${w.id}`}
                              >
                                <div className="flex-1 min-w-0">
                                  <div className="text-[13px] font-semibold text-pfg-navy">{w.name}</div>
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
                                  <Plus className="w-4 h-4" style={{ color: "var(--pfg-yellow)" }} />
                                </div>
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
          </div>
        )}

        {/* Step 5: Create */}
        {step === 5 && (
          <div className="text-center py-8 space-y-4">
            <div className="text-sm font-bold text-pfg-navy font-display">Ready to create project?</div>
            <div className="text-[13px]" style={{ color: "var(--pfg-steel)" }}>
              This will create <strong>{code.toUpperCase()}</strong> with {roleSlots.length} role slot{roleSlots.length !== 1 ? "s" : ""} and {filledPositions} assignment{filledPositions !== 1 ? "s" : ""}.
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
// EDIT PROJECT MODAL (remove/undo members, add person, save)
// ═══════════════════════════════════════════════════════════════════

function EditProjectModal({
  card,
  allWorkers,
  onClose,
}: {
  card: ProjectCardData;
  allWorkers: DashboardWorker[];
  onClose: () => void;
}) {
  const customer = card.project.customer || PROJECT_CUSTOMER[card.project.code] || "";
  const color = customer ? (OEM_BRAND_COLORS[customer] || "#64748B") : "#64748B";

  // Track removals and additions locally
  const [removedIds, setRemovedIds] = useState<Set<number>>(new Set());
  const [additions, setAdditions] = useState<{ workerId: number; task: string; shift: string }[]>([]);
  const [showAddPanel, setShowAddPanel] = useState(false);
  const [addSearch, setAddSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  const handleAddWorker = (workerId: number) => {
    if (additions.some((a) => a.workerId === workerId)) return;
    setAdditions((prev) => [...prev, { workerId, task: "", shift: "Day" }]);
  };

  const handleRemoveAddition = (workerId: number) => {
    setAdditions((prev) => prev.filter((a) => a.workerId !== workerId));
  };

  // Workers available to add: not on this project already (unless removed), and not already in additions
  const currentMemberWorkerIds = new Set(
    card.members.filter((m) => !removedIds.has(m.assignment.id)).map((m) => m.worker.id)
  );
  const additionWorkerIds = new Set(additions.map((a) => a.workerId));

  const availableToAdd = useMemo(() => {
    return allWorkers.filter((w) => {
      if (currentMemberWorkerIds.has(w.id) && !removedIds.has(
        card.members.find((m) => m.worker.id === w.id)?.assignment.id ?? -1
      )) return false;
      if (additionWorkerIds.has(w.id)) return false;
      if (addSearch) {
        const q = addSearch.toLowerCase();
        if (!w.name.toLowerCase().includes(q) && !w.role.toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [allWorkers, currentMemberWorkerIds, additionWorkerIds, addSearch, removedIds]);

  const hasChanges = removedIds.size > 0 || additions.length > 0;

  const activeCount = card.members.filter((m) => !removedIds.has(m.assignment.id)).length + additions.length;

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      // Process removals
      for (const id of Array.from(removedIds)) {
        await apiRequest("DELETE", `/api/assignments/${id}`);
      }

      // Process additions
      for (const add of additions) {
        await apiRequest("POST", "/api/assignments", {
          workerId: add.workerId,
          projectId: card.project.id,
          task: add.task || null,
          shift: add.shift,
          startDate: card.project.startDate,
          endDate: card.project.endDate,
          status: "active",
        });
      }

      await queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
      onClose();
    } catch (e: any) {
      setError(e.message || "Failed to save changes");
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalOverlay onClose={onClose} testId="edit-project-modal">
      {/* Header */}
      <div className="px-6 py-5 flex items-center justify-between" style={{ background: color, color: "#fff" }}>
        <div>
          <div className="font-display text-lg font-bold">{card.project.code} — {card.project.name}</div>
          <div className="text-xs opacity-80 mt-0.5">
            {card.project.location} · {card.project.customer} · {card.project.equipmentType || "—"}
          </div>
        </div>
        <button onClick={onClose} className="text-white/60 hover:text-white p-1" data-testid="edit-modal-close">
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Body */}
      <div className="p-6 overflow-y-auto flex-1">
        {/* Current Team */}
        <div className="mb-5">
          <div className="flex items-center justify-between mb-3">
            <div className="text-sm font-bold text-pfg-navy font-display flex items-center gap-2">
              Team Members
              <span className="text-xs font-semibold px-2 py-0.5 rounded-full" style={{ background: "hsl(var(--accent))", color: "#8B6E00" }}>
                {activeCount}
              </span>
            </div>
          </div>

          <div className="space-y-1">
            {card.members.map((m) => {
              const isRemoved = removedIds.has(m.assignment.id);
              return (
                <div
                  key={m.assignment.id}
                  className="flex items-center gap-3 px-3.5 py-2.5 rounded-lg border transition-colors"
                  style={{
                    borderColor: "hsl(var(--border))",
                    opacity: isRemoved ? 0.45 : 1,
                    background: isRemoved ? "hsl(var(--muted))" : undefined,
                    textDecoration: isRemoved ? "line-through" : undefined,
                  }}
                  data-testid={`member-row-${m.assignment.id}`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-semibold text-pfg-navy">{m.worker.name}</div>
                    <div className="text-[11px] mt-0.5" style={{ color: "var(--pfg-steel)" }}>
                      {m.assignment.task || m.worker.role} · {m.assignment.startDate || "—"} → {m.assignment.endDate || "—"}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <ShiftBadge shift={m.assignment.shift} />
                    <StatusBadge status={m.worker.status} />
                    {isRemoved ? (
                      <button
                        onClick={() => handleUndo(m.assignment.id)}
                        className="ml-1 p-1 rounded hover:bg-[var(--green-bg)]"
                        title="Undo removal"
                        data-testid={`undo-remove-${m.assignment.id}`}
                      >
                        <Undo2 className="w-3.5 h-3.5" style={{ color: "var(--green)" }} />
                      </button>
                    ) : (
                      <button
                        onClick={() => handleRemove(m.assignment.id)}
                        className="ml-1 p-1 rounded hover:bg-[var(--red-bg)]"
                        title="Remove from project"
                        data-testid={`remove-member-${m.assignment.id}`}
                      >
                        <X className="w-3.5 h-3.5" style={{ color: "var(--red)" }} />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}

            {/* Newly added workers */}
            {additions.map((add) => {
              const worker = allWorkers.find((w) => w.id === add.workerId);
              if (!worker) return null;
              return (
                <div
                  key={`add-${add.workerId}`}
                  className="flex items-center gap-3 px-3.5 py-2.5 rounded-lg border"
                  style={{ borderColor: "var(--green)", background: "var(--green-bg)" }}
                  data-testid={`addition-row-${add.workerId}`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-semibold text-pfg-navy">{worker.name}</div>
                    <div className="text-[11px] mt-0.5" style={{ color: "var(--pfg-steel)" }}>
                      {worker.role} · New addition
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <StatusBadge status={worker.status} />
                    <button
                      onClick={() => handleRemoveAddition(add.workerId)}
                      className="ml-1 p-1 rounded hover:bg-[var(--red-bg)]"
                      data-testid={`remove-addition-${add.workerId}`}
                    >
                      <X className="w-3.5 h-3.5" style={{ color: "var(--red)" }} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Add Person Panel */}
        <div>
          <button
            onClick={() => setShowAddPanel(!showAddPanel)}
            className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border mb-3"
            style={{ borderColor: "var(--pfg-yellow)", color: "var(--pfg-navy)" }}
            data-testid="toggle-add-panel"
          >
            {showAddPanel ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            Add Person
          </button>

          {showAddPanel && (
            <div className="rounded-lg border p-3" style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--muted))" }}>
              <div className="relative mb-3">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5" style={{ color: "hsl(var(--muted-foreground))" }} />
                <input
                  type="text"
                  placeholder="Search available workers..."
                  value={addSearch}
                  onChange={(e) => setAddSearch(e.target.value)}
                  className="w-full pl-8 pr-3 py-2 text-[13px] rounded-lg border"
                  style={inputStyle}
                  data-testid="add-person-search"
                />
              </div>

              <div className="max-h-[250px] overflow-y-auto space-y-0.5">
                {availableToAdd.length === 0 ? (
                  <div className="text-center py-6 text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>
                    No available workers found
                  </div>
                ) : (
                  availableToAdd.map((w) => (
                    <div
                      key={w.id}
                      className="flex items-center gap-3 px-3 py-2 rounded-lg border cursor-pointer transition-colors hover:border-[var(--pfg-yellow)] hover:bg-[hsl(var(--accent))]"
                      style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--card))" }}
                      onClick={() => handleAddWorker(w.id)}
                      data-testid={`add-worker-${w.id}`}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="text-[13px] font-semibold text-pfg-navy">{w.name}</div>
                        <div className="text-[11px]" style={{ color: "var(--pfg-steel)" }}>{w.role} · {w.nationality || "—"}</div>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <StatusBadge status={w.status} />
                        <Plus className="w-4 h-4" style={{ color: "var(--pfg-yellow)" }} />
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>

        {error && (
          <div className="mt-4 text-sm font-medium px-3 py-2 rounded-lg" style={{ background: "var(--red-bg)", color: "var(--red)" }}>
            {error}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="px-6 py-4 border-t flex items-center justify-end gap-2" style={{ borderColor: "hsl(var(--border))" }}>
        <button
          onClick={onClose}
          className="px-4 py-2 text-[13px] font-medium rounded-lg border"
          style={{ borderColor: "hsl(var(--border))" }}
          data-testid="edit-cancel"
        >
          Cancel
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

  if (isLoading || !data) return <LoadingSkeleton />;

  const { workers, projects } = data;

  const projectCards: ProjectCardData[] = projects
    .filter((p) => p.status === "active")
    .map((project) => {
      const members: ProjectCardData["members"] = [];
      for (const w of workers) {
        for (const a of w.assignments) {
          if (a.projectId === project.id && a.status === "active") {
            members.push({ worker: w, assignment: a });
          }
        }
      }
      return { project, members };
    })
    .sort((a, b) => b.members.length - a.members.length);

  const assignedWorkerIds = new Set(
    workers.filter((w) => w.assignments.some((a) => a.status === "active")).map((w) => w.id)
  );
  const availableWorkers = workers.filter((w) => !assignedWorkerIds.has(w.id));

  const selectedCard = projectCards.find((c) => c.project.code === selectedProject);

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h2 className="font-display text-lg font-bold text-pfg-navy">Project Allocation</h2>
          <p className="text-xs mt-0.5" style={{ color: "var(--pfg-steel)" }}>
            {projectCards.length} active projects · {availableWorkers.length} available
          </p>
        </div>
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

      {/* Project Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 mb-4">
        {projectCards.map((card) => (
          <ProjectCard
            key={card.project.id}
            card={card}
            onClick={() => setSelectedProject(card.project.code)}
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
