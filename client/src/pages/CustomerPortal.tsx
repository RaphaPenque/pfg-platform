import { useMemo } from "react";
import { useDashboardData, type DashboardWorker, type DashboardProject, type DashboardRoleSlot, type DashboardAssignment } from "@/hooks/use-dashboard-data";
import { OEM_BRAND_COLORS, PROJECT_CUSTOMER, sortSlots } from "@/lib/constants";
import { downloadSqepPdf, downloadCustomerPack } from "@/lib/sqep-pdf";
import { Download, FileDown, Info } from "lucide-react";

// ─── Weekly timeline helpers ───────────────────────────────────────

interface WeekColumn {
  label: string;
  startDay: Date;
  endDay: Date;
}

const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function buildWeekColumns(startDate: string, endDate: string): WeekColumn[] {
  const start = new Date(startDate);
  start.setDate(start.getDate() - 1); // 1 day before project start
  const end = new Date(endDate);

  const cols: WeekColumn[] = [];
  const d = new Date(start);
  // Align to Monday
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

// ─── Loading skeleton ──────────────────────────────────────────────

function LoadingSkeleton() {
  return (
    <div className="min-h-screen" style={{ background: "hsl(var(--background))" }}>
      <div className="h-16 bg-pfg-navy" />
      <div className="max-w-[1400px] mx-auto px-6 py-8 space-y-6 animate-pulse">
        <div className="h-32 rounded-xl" style={{ background: "hsl(var(--muted))" }} />
        <div className="h-64 rounded-xl" style={{ background: "hsl(var(--muted))" }} />
        <div className="h-96 rounded-xl" style={{ background: "hsl(var(--muted))" }} />
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

// ═══════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════

export default function CustomerPortal({ params }: { params: { projectCode: string } }) {
  const { data, isLoading } = useDashboardData();

  const portalData = useMemo(() => {
    if (!data) return null;
    const { workers, projects, roleSlots } = data;

    const project = projects.find((p) => p.code === params.projectCode);
    if (!project) return null;

    const customer = project.customer || PROJECT_CUSTOMER[project.code] || "";
    const color = customer ? (OEM_BRAND_COLORS[customer] || "#64748B") : "#64748B";

    // Get role slots for this project
    const projectRoleSlots = roleSlots.filter((s) => s.projectId === project.id);

    // Get team members (workers assigned to this project)
    const teamMembers: { worker: DashboardWorker; assignment: DashboardAssignment }[] = [];
    for (const w of workers) {
      for (const a of w.assignments) {
        if (a.projectId === project.id && (a.status === "active" || a.status === "flagged")) {
          teamMembers.push({ worker: w, assignment: a });
        }
      }
    }

    // Deduplicate team members (same workerId + startDate + endDate)
    const seen = new Set<string>();
    const uniqueTeamMembers = teamMembers.filter((m) => {
      const key = `${m.worker.id}-${m.assignment.startDate}-${m.assignment.endDate}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // Build histogram rows: for each role slot (quantity N), create N rows
    // Match by assignment.roleSlotId === slot.id
    const histogramRows: HistogramRow[] = projectRoleSlots.flatMap((slot) => {
      const slotAssignments = uniqueTeamMembers.filter((m) => m.assignment.roleSlotId === slot.id);

      const rows: HistogramRow[] = [];
      // Filled rows
      for (const m of slotAssignments) {
        rows.push({ slot, assignedWorker: m.worker, assignment: m.assignment, filled: true });
      }
      // Unfilled rows (up to slot.quantity)
      const unfilled = Math.max(0, slot.quantity - slotAssignments.length);
      for (let i = 0; i < unfilled; i++) {
        rows.push({ slot, assignedWorker: null, assignment: null, filled: false });
      }
      return rows;
    });

    // Fallback for assignments that don't have a matching role slot
    if (histogramRows.length === 0 && uniqueTeamMembers.length > 0) {
      for (const m of uniqueTeamMembers) {
        histogramRows.push({
          slot: { id: 0, projectId: project.id, role: m.assignment.task || m.worker.role, startDate: m.assignment.startDate || "", endDate: m.assignment.endDate || "", quantity: 1, shift: m.assignment.shift || "Day", projectCode: project.code, projectName: project.name },
          assignedWorker: m.worker,
          assignment: m.assignment,
          filled: true,
        });
      }
    }

    // Sort histogram rows: Day shift first, then Night; within each shift by role hierarchy
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

    // Build weekly columns
    const weekColumns = (project.startDate && project.endDate)
      ? buildWeekColumns(project.startDate, project.endDate)
      : [];

    return { project, customer, color, teamMembers: uniqueTeamMembers, histogramRows, weekColumns, projectRoleSlots };
  }, [data, params.projectCode]);

  if (isLoading || !data) return <LoadingSkeleton />;

  if (!portalData) {
    return (
      <div className="min-h-screen" style={{ background: "hsl(var(--background))" }}>
        <header className="bg-pfg-navy text-white px-6 h-16 flex items-center" style={{ boxShadow: "0 2px 8px rgba(0,0,0,0.3)" }}>
          <img src="./logo-gold.png" alt="Powerforce Global" className="h-8" />
          <span className="text-xs font-medium tracking-[0.12em] uppercase text-white/50 ml-4">Customer Portal</span>
        </header>
        <div className="flex items-center justify-center py-32">
          <div className="text-center">
            <h2 className="font-display text-xl font-bold text-pfg-navy mb-2">Project Not Found</h2>
            <p className="text-sm" style={{ color: "var(--pfg-steel)" }}>
              No project found with code "{params.projectCode}"
            </p>
          </div>
        </div>
      </div>
    );
  }

  const { project, customer, color, teamMembers, histogramRows, weekColumns, projectRoleSlots } = portalData;
  const today = new Date();

  return (
    <div className="min-h-screen" style={{ background: "hsl(var(--background))" }}>
      {/* PFG Branded Header */}
      <header
        className="bg-pfg-navy text-white px-6 h-16 flex items-center justify-between sticky top-0 z-50"
        style={{ boxShadow: "0 2px 8px rgba(0,0,0,0.3)" }}
      >
        <div className="flex items-center gap-4">
          <img src="./logo-gold.png" alt="Powerforce Global" className="h-8" />
          <span className="text-xs font-medium tracking-[0.12em] uppercase text-white/50 ml-1">
            Customer Portal
          </span>
        </div>
        <button
          onClick={() => portalData && downloadCustomerPack(portalData.project, portalData.teamMembers, portalData.customer)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold transition-opacity hover:opacity-90"
          style={{ background: "rgba(245,189,0,0.9)", color: "#1A1D23" }}
          data-testid="download-all-btn"
        >
          <Download className="w-3.5 h-3.5" />
          Download Customer Pack
        </button>
      </header>

      <div className="max-w-[1400px] mx-auto px-6 py-6">
        {/* Project Info Section */}
        <div
          className="rounded-xl border overflow-hidden mb-6"
          style={{ background: "hsl(var(--card))", borderColor: "hsl(var(--card-border))", boxShadow: "var(--shadow-sm)" }}
          data-testid="project-info"
        >
          <div className="px-6 py-5 flex items-center justify-between" style={{ background: color, color: "#fff" }}>
            <div>
              <h1 className="font-display text-xl font-bold">{project.code} — {project.name}</h1>
              <p className="text-sm opacity-80 mt-0.5">{customer}</p>
            </div>
            <div className="text-right text-xs opacity-80">
              <div>{teamMembers.length} team members</div>
              <div>{project.status}</div>
            </div>
          </div>
          <div className="px-6 py-4 grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
            {[
              ["Customer", customer || "—"],
              ["OEM", customer || "—"],
              ["Location", project.location || "—"],
              ["Equipment", project.equipmentType || "—"],
              ["Start Date", project.startDate || "—"],
              ["End Date", project.endDate || "—"],
            ].map(([label, value]) => (
              <div key={label}>
                <div className="text-[10px] font-semibold uppercase tracking-wide mb-1" style={{ color: "hsl(var(--muted-foreground))" }}>
                  {label}
                </div>
                <div className="text-[13px] font-medium text-pfg-navy">{value}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Project Histogram — Weekly Gantt */}
        <div
          className="rounded-xl border overflow-hidden mb-6"
          style={{ background: "hsl(var(--card))", borderColor: "hsl(var(--card-border))", boxShadow: "var(--shadow-sm)" }}
          data-testid="project-histogram"
        >
          <div className="px-5 py-4 border-b flex items-center justify-between" style={{ borderColor: "hsl(var(--border))" }}>
            <h3 className="text-[15px] font-bold text-pfg-navy font-display">Project Histogram</h3>
            <div className="flex gap-4 text-[11px]" style={{ color: "var(--pfg-steel)" }}>
              <div className="flex items-center gap-1.5">
                <div className="w-2.5 h-2.5 rounded-sm" style={{ background: color }} />
                Filled
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-2.5 h-2.5 rounded-sm border-2 border-dashed" style={{ borderColor: color, background: "transparent" }} />
                Unfilled
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-0.5 h-3" style={{ background: "var(--red)" }} />
                Today
              </div>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full" style={{ borderCollapse: "collapse", minWidth: Math.max(800, 280 + 60 + weekColumns.length * 48) }}>
              <thead>
                <tr>
                  <th
                    className="text-left text-[10px] font-semibold uppercase tracking-wide px-4 py-1.5 sticky left-0 z-[3]"
                    style={{ background: "hsl(var(--muted))", color: "hsl(var(--muted-foreground))", minWidth: 260, borderBottom: "1px solid hsl(var(--border))" }}
                  >
                    Role / Person
                  </th>
                  <th
                    className="text-center text-[10px] font-semibold uppercase tracking-wide px-2 py-1.5"
                    style={{ background: "hsl(var(--muted))", color: "hsl(var(--muted-foreground))", minWidth: 52, borderBottom: "1px solid hsl(var(--border))" }}
                  >
                    Shift
                  </th>
                  {weekColumns.map((col, i) => (
                    <th
                      key={i}
                      className="text-center text-[9px] font-semibold uppercase tracking-wide px-0 py-1.5"
                      style={{
                        background: "hsl(var(--muted))",
                        color: "hsl(var(--muted-foreground))",
                        borderBottom: "1px solid hsl(var(--border))",
                        borderLeft: "1px solid hsl(var(--border))",
                        minWidth: 48,
                      }}
                    >
                      {col.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {histogramRows.length === 0 ? (
                  <tr>
                    <td colSpan={2 + weekColumns.length} className="text-center py-12 text-sm" style={{ color: "hsl(var(--muted-foreground))" }}>
                      No role slots or assignments defined
                    </td>
                  </tr>
                ) : (
                  histogramRows.map((row, idx) => {
                    const barStart = row.filled && row.assignment?.startDate ? row.assignment.startDate : row.slot.startDate;
                    const barEnd = row.filled && row.assignment?.endDate ? row.assignment.endDate : row.slot.endDate;
                    const barStartDate = new Date(barStart);
                    const barEndDate = new Date(barEnd);
                    const shift = row.slot.shift || "Day";
                    const roleName = row.slot.role;
                    // Shift group header: show when this row starts a new shift group
                    const prevShift = idx > 0 ? (histogramRows[idx - 1].slot.shift || "Day") : null;
                    const showShiftHeader = prevShift !== null && shift !== prevShift;
                    const personName = row.assignedWorker?.name || null;
                    const isFilled = row.filled;

                    return (
                      <>
                        {/* Day / Night shift group divider */}
                        {(idx === 0 || showShiftHeader) && (
                          <tr key={`shift-header-${shift}-${idx}`} data-testid={`shift-group-${shift}`}>
                            <td
                              colSpan={2 + weekColumns.length}
                              className="px-4 py-1 text-[10px] font-bold uppercase tracking-widest sticky left-0"
                              style={{
                                background: shift === "Night" ? "#1A1D23" : "hsl(var(--muted))",
                                color: shift === "Night" ? "#F5BD00" : "hsl(var(--muted-foreground))",
                                borderBottom: "1px solid hsl(var(--border))",
                                borderTop: idx !== 0 ? "2px solid hsl(var(--border))" : undefined,
                              }}
                            >
                              {shift === "Night" ? "🌙 Night Shift" : "☀️ Day Shift"}
                            </td>
                          </tr>
                        )}
                        <tr key={idx} data-testid={`histogram-row-${idx}`}>
                        <td
                          className="px-4 py-1 text-xs whitespace-nowrap sticky left-0 z-[1]"
                          style={{
                            background: "hsl(var(--card))",
                            borderBottom: "1px solid hsl(var(--border))",
                            borderRight: "1px solid hsl(var(--border))",
                          }}
                        >
                          <div className="flex items-center gap-2">
                            <div className="w-1 h-5 rounded-full" style={{ background: color, opacity: isFilled ? 1 : 0.3 }} />
                            <div>
                              <div className="font-semibold text-pfg-navy">{roleName}</div>
                              {personName ? (
                                <div className="text-[11px] font-normal" style={{ color: "var(--pfg-steel)" }}>
                                  {personName}
                                </div>
                              ) : (
                                <div className="text-[11px] font-normal italic" style={{ color: "var(--amber)" }}>
                                  Unfilled
                                </div>
                              )}
                            </div>
                          </div>
                        </td>
                        <td
                          className="text-center text-[11px]"
                          style={{ borderBottom: "1px solid hsl(var(--border))" }}
                        >
                          <span className={`badge ${shift === "Night" ? "badge-navy" : "badge-accent"}`}>
                            {shift}
                          </span>
                        </td>
                        {weekColumns.map((col, colIdx) => {
                          // Does the bar overlap this week column?
                          const colStartMs = col.startDay.getTime();
                          const colEndMs = col.endDay.getTime();
                          const barStartMs = barStartDate.getTime();
                          const barEndMs = barEndDate.getTime();
                          const overlaps = barStartMs <= colEndMs && barEndMs >= colStartMs;

                          // Today marker
                          const todayMs = today.getTime();
                          const isToday = todayMs >= colStartMs && todayMs <= colEndMs;
                          const todayFrac = isToday ? dateToColumnFraction(today, col.startDay, col.endDay) : 0;

                          // Bar position within this column
                          let left = 0;
                          let right = 0;
                          if (overlaps) {
                            if (barStartMs > colStartMs) {
                              left = dateToColumnFraction(barStartDate, col.startDay, col.endDay);
                            }
                            if (barEndMs < colEndMs) {
                              right = 1 - dateToColumnFraction(barEndDate, col.startDay, col.endDay);
                            }
                          }

                          const isBarStart = overlaps && barStartMs >= colStartMs && barStartMs <= colEndMs;
                          const isBarEnd = overlaps && barEndMs >= colStartMs && barEndMs <= colEndMs;

                          return (
                            <td
                              key={colIdx}
                              className="relative"
                              style={{
                                borderBottom: "1px solid hsl(var(--border))",
                                borderLeft: "1px solid hsl(var(--border))",
                                height: 32,
                                padding: "4px 0",
                              }}
                            >
                              {overlaps && (
                                <div
                                  className="absolute top-1 bottom-1"
                                  style={{
                                    background: isFilled ? color : "transparent",
                                    border: isFilled ? "none" : `2px dashed ${color}`,
                                    opacity: isFilled ? 0.85 : 0.5,
                                    left: `${left * 100}%`,
                                    right: `${right * 100}%`,
                                    borderRadius:
                                      isBarStart && isBarEnd ? 3 :
                                      isBarStart ? "3px 0 0 3px" :
                                      isBarEnd ? "0 3px 3px 0" : 0,
                                  }}
                                  title={`${roleName} — ${personName || "Unfilled"} (${barStart} → ${barEnd})`}
                                />
                              )}
                              {isToday && (
                                <div
                                  className="absolute top-0 bottom-0 w-0.5 z-[5]"
                                  style={{ background: "var(--red)", left: `${todayFrac * 100}%` }}
                                />
                              )}
                            </td>
                          );
                        })}
                        </tr>
                      </>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Team Table */}
        <div
          className="rounded-xl border overflow-hidden"
          style={{ background: "hsl(var(--card))", borderColor: "hsl(var(--card-border))", boxShadow: "var(--shadow-sm)" }}
          data-testid="team-table"
        >
          <div className="px-5 py-4 border-b flex items-center justify-between" style={{ borderColor: "hsl(var(--border))" }}>
            <h3 className="text-[15px] font-bold text-pfg-navy font-display">
              Team Members
              <span className="ml-2 text-xs font-semibold px-2 py-0.5 rounded-full" style={{ background: "hsl(var(--accent))", color: "#8B6E00" }}>
                {teamMembers.length}
              </span>
            </h3>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-[13px]" style={{ borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  {["Name", "Role", "Slot", "OEM Experience", "Shift", "Start Date", "End Date", "Status", ""].map((h) => (
                    <th
                      key={h}
                      className="text-left px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wide"
                      style={{ background: "hsl(var(--muted))", color: "hsl(var(--muted-foreground))", borderBottom: "1px solid hsl(var(--border))" }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {teamMembers.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="text-center py-12" style={{ color: "hsl(var(--muted-foreground))" }}>
                      No team members assigned
                    </td>
                  </tr>
                ) : (
                  // Sort team table: same order as histogram (Day first, then Night; by role rank)
                  [...teamMembers].sort((a, b) => {
                    const SHIFT_ORDER: Record<string, number> = { Day: 0, Night: 1 };
                    const ROLE_ORDER = ["Superintendent","Foreman","Lead Technician","Technician 2","Technician 1","Rigger","Crane Driver","HSE Officer","Welder","I&C Technician","Electrician","Apprentice"];
                    const slotA = projectRoleSlots.find(s => s.id === a.assignment.roleSlotId);
                    const slotB = projectRoleSlots.find(s => s.id === b.assignment.roleSlotId);
                    const shiftA = SHIFT_ORDER[slotA?.shift ?? a.assignment.shift ?? "Day"] ?? 0;
                    const shiftB = SHIFT_ORDER[slotB?.shift ?? b.assignment.shift ?? "Day"] ?? 0;
                    if (shiftA !== shiftB) return shiftA - shiftB;
                    const roleA = ROLE_ORDER.indexOf(slotA?.role ?? a.assignment.task ?? a.worker.role);
                    const roleB = ROLE_ORDER.indexOf(slotB?.role ?? b.assignment.task ?? b.worker.role);
                    return (roleA === -1 ? 99 : roleA) - (roleB === -1 ? 99 : roleB);
                  }).map((m) => {
                    // Find which role slot this assignment belongs to
                    const matchedSlot = projectRoleSlots.find((s) => s.id === m.assignment.roleSlotId);

                    return (
                      <tr
                        key={m.assignment.id}
                        className="border-t"
                        style={{ borderColor: "hsl(var(--border))" }}
                        data-testid={`team-row-${m.assignment.id}`}
                      >
                        <td className="px-4 py-2.5 font-semibold text-pfg-navy">{m.worker.name}</td>
                        <td className="px-4 py-2.5">{m.assignment.task || m.worker.role}</td>
                        <td className="px-4 py-2.5 text-[11px]" style={{ color: "var(--pfg-steel)" }}>
                          {matchedSlot ? (
                            <span>{matchedSlot.role} ({matchedSlot.startDate} → {matchedSlot.endDate})</span>
                          ) : (
                            <span style={{ color: "hsl(var(--muted-foreground))" }}>—</span>
                          )}
                        </td>
                        <td className="px-4 py-2.5">
                          <div className="flex flex-wrap gap-1">
                            {m.worker.oemExperience.length > 0 ? (
                              m.worker.oemExperience.map((oem) => {
                                const name = oem.split(" - ")[0];
                                const bg = OEM_BRAND_COLORS[name] || "#64748B";
                                return (
                                  <span
                                    key={oem}
                                    className="text-[10px] font-semibold px-1.5 py-0.5 rounded"
                                    style={{ background: bg + "18", color: bg, border: `1px solid ${bg}30` }}
                                  >
                                    {name}
                                  </span>
                                );
                              })
                            ) : (
                              <span className="text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>—</span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-2.5">
                          {m.assignment.shift ? (
                            <span className={`badge ${m.assignment.shift === "Night" ? "badge-navy" : "badge-accent"}`}>
                              {m.assignment.shift}
                            </span>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="px-4 py-2.5 tabular-nums">{m.assignment.startDate || "—"}</td>
                        <td className="px-4 py-2.5 tabular-nums">{m.assignment.endDate || "—"}</td>
                        <td className="px-4 py-2.5">
                          <span className={`badge ${m.worker.status === "FTE" ? "badge-navy" : "badge-grey"}`}>
                            {m.worker.status}
                          </span>
                        </td>
                        <td className="px-4 py-2.5">
                          <button
                            onClick={() => downloadSqepPdf(m.worker)}
                            className="flex items-center gap-1 text-xs font-semibold px-2.5 py-1.5 rounded-lg border transition-colors hover:bg-[hsl(var(--accent))]"
                            style={{ borderColor: "hsl(var(--border))", color: "var(--pfg-navy)" }}
                            data-testid={`sqep-download-${m.worker.id}`}
                          >
                            <FileDown className="w-3.5 h-3.5" />
                            SQEP Pack
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Footer */}
        <footer className="text-center py-8 text-xs text-pfg-steel">
          &copy; 2026 PowerForce Global &middot; Customer Portal &middot; Confidential
        </footer>
      </div>
    </div>
  );
}
