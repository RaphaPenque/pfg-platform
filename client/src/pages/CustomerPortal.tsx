import { useMemo } from "react";
import { useDashboardData, type DashboardWorker, type DashboardProject, type DashboardRoleSlot, type DashboardAssignment } from "@/hooks/use-dashboard-data";
import { OEM_BRAND_COLORS, PROJECT_CUSTOMER } from "@/lib/constants";
import { downloadSqepPdf, downloadAllSqepPdfs } from "@/lib/sqep-pdf";
import { Download, FileDown, Info } from "lucide-react";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

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

function dateToMonthIndex(dateStr: string | null): number | null {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return null;
  return d.getMonth();
}

function dateToDayFraction(dateStr: string): number {
  const d = new Date(dateStr);
  const daysInMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  return (d.getDate() - 1) / daysInMonth;
}

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
        if (a.projectId === project.id && a.status === "active") {
          teamMembers.push({ worker: w, assignment: a });
        }
      }
    }

    // Build histogram rows: one per role slot, matched with assigned worker
    const histogramRows = projectRoleSlots.map((slot) => {
      // Find the assigned worker for this slot, matching by role and shift
      const match = teamMembers.find((m) => {
        const assignmentRole = m.assignment.task || m.worker.role;
        return (
          assignmentRole.toLowerCase().includes(slot.role.toLowerCase()) &&
          (!m.assignment.shift || m.assignment.shift === slot.shift)
        );
      });
      return { slot, assignedWorker: match?.worker || null, assignment: match?.assignment || null };
    });

    // If there are no role slots, fall back to showing assignments directly
    const fallbackRows = teamMembers.map((m) => ({
      slot: null as DashboardRoleSlot | null,
      assignedWorker: m.worker,
      assignment: m.assignment,
    }));

    const rows = histogramRows.length > 0 ? histogramRows : fallbackRows;

    return { project, customer, color, teamMembers, rows, projectRoleSlots };
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

  const { project, customer, color, teamMembers, rows } = portalData;
  const today = new Date();
  const todayMonth = today.getMonth();
  const todayDayFrac = today.getDate() / new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();

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
          onClick={() => portalData && downloadAllSqepPdfs(portalData.teamMembers, params.projectCode)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold transition-opacity hover:opacity-90"
          style={{ background: "rgba(245,189,0,0.9)", color: "#1A1D23" }}
          data-testid="download-all-btn"
        >
          <Download className="w-3.5 h-3.5" />
          Download All SQEP
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

        {/* Project Histogram — Role Slot Gantt */}
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
            <table className="w-full" style={{ borderCollapse: "collapse", minWidth: 1100 }}>
              <thead>
                <tr>
                  <th
                    className="text-left text-[10px] font-semibold uppercase tracking-wide px-4 py-1.5 sticky left-0 z-[3]"
                    style={{ background: "hsl(var(--muted))", color: "hsl(var(--muted-foreground))", minWidth: 280, borderBottom: "1px solid hsl(var(--border))" }}
                  >
                    Role / Person
                  </th>
                  <th
                    className="text-center text-[10px] font-semibold uppercase tracking-wide px-2 py-1.5"
                    style={{ background: "hsl(var(--muted))", color: "hsl(var(--muted-foreground))", minWidth: 60, borderBottom: "1px solid hsl(var(--border))" }}
                  >
                    Shift
                  </th>
                  {MONTHS.map((m) => (
                    <th
                      key={m}
                      className="text-center text-[10px] font-semibold uppercase tracking-wide px-1 py-1.5"
                      style={{
                        background: "hsl(var(--muted))",
                        color: "hsl(var(--muted-foreground))",
                        borderBottom: "1px solid hsl(var(--border))",
                        borderLeft: "1px solid hsl(var(--border))",
                      }}
                    >
                      {m}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={14} className="text-center py-12 text-sm" style={{ color: "hsl(var(--muted-foreground))" }}>
                      No role slots or assignments defined
                    </td>
                  </tr>
                ) : (
                  rows.map((row, idx) => {
                    const startDate = row.slot?.startDate || row.assignment?.startDate;
                    const endDate = row.slot?.endDate || row.assignment?.endDate;
                    const startMonth = dateToMonthIndex(startDate || null);
                    const endMonth = dateToMonthIndex(endDate || null);
                    const shift = row.slot?.shift || row.assignment?.shift || "—";
                    const roleName = row.slot?.role || row.assignment?.task || row.assignedWorker?.role || "—";
                    const personName = row.assignedWorker?.name || null;
                    const isFilled = !!row.assignedWorker;
                    const startFrac = startDate ? dateToDayFraction(startDate) : 0;
                    const endFrac = endDate ? dateToDayFraction(endDate) : 1;

                    return (
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
                        {MONTHS.map((_, monthIdx) => {
                          const isInRange =
                            startMonth !== null && endMonth !== null &&
                            monthIdx >= startMonth && monthIdx <= endMonth;
                          const isStart = monthIdx === startMonth;
                          const isEnd = monthIdx === endMonth;
                          const isToday = monthIdx === todayMonth;

                          return (
                            <td
                              key={monthIdx}
                              className="relative"
                              style={{
                                borderBottom: "1px solid hsl(var(--border))",
                                borderLeft: "1px solid hsl(var(--border))",
                                height: 32,
                                padding: "4px 0",
                              }}
                            >
                              {isInRange && (
                                <div
                                  className="absolute top-1 bottom-1"
                                  style={{
                                    background: isFilled ? color : "transparent",
                                    border: isFilled ? "none" : `2px dashed ${color}`,
                                    opacity: isFilled ? 0.85 : 0.5,
                                    left: isStart ? `${startFrac * 100}%` : 0,
                                    right: isEnd ? `${(1 - endFrac) * 100}%` : 0,
                                    borderRadius:
                                      isStart && isEnd ? 3 : isStart ? "3px 0 0 3px" : isEnd ? "0 3px 3px 0" : 0,
                                  }}
                                  title={`${roleName} — ${personName || "Unfilled"} (${startDate} → ${endDate})`}
                                />
                              )}
                              {isToday && (
                                <div
                                  className="absolute top-0 bottom-0 w-0.5 z-[5]"
                                  style={{ background: "var(--red)", left: `${todayDayFrac * 100}%` }}
                                />
                              )}
                            </td>
                          );
                        })}
                      </tr>
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
                  {["Name", "Role", "OEM Experience", "Shift", "Start Date", "End Date", "Status", ""].map((h) => (
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
                    <td colSpan={8} className="text-center py-12" style={{ color: "hsl(var(--muted-foreground))" }}>
                      No team members assigned
                    </td>
                  </tr>
                ) : (
                  teamMembers.map((m) => (
                    <tr
                      key={m.assignment.id}
                      className="border-t"
                      style={{ borderColor: "hsl(var(--border))" }}
                      data-testid={`team-row-${m.worker.id}`}
                    >
                      <td className="px-4 py-2.5 font-semibold text-pfg-navy">{m.worker.name}</td>
                      <td className="px-4 py-2.5">{m.assignment.task || m.worker.role}</td>
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
                  ))
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
