import { useState, useMemo } from "react";
import { useDashboardData } from "@/hooks/use-dashboard-data";
import { getProjectColor, getProjectColorFromProject, OEM_BRAND_COLORS, PROJECT_CUSTOMER, cleanName } from "@/lib/constants";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip } from "recharts";
import { Check } from "lucide-react";

const FTE_BASELINE = 54;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const CURRENT_YEAR = 2026;

type ProjectStatus = "active" | "potential" | "completed" | "cancelled";

function LoadingSkeleton() {
  return (
    <div className="space-y-4 animate-pulse">
      <div className="grid grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-24 rounded-xl" style={{ background: "hsl(var(--muted))" }} />
        ))}
      </div>
      <div className="h-96 rounded-xl" style={{ background: "hsl(var(--muted))" }} />
      <div className="h-64 rounded-xl" style={{ background: "hsl(var(--muted))" }} />
    </div>
  );
}

// Parse date to month index (0-11)
function dateToMonthIndex(dateStr: string | null): number | null {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return null;
  return d.getMonth();
}

function dateToWeekIndex(dateStr: string): number {
  const d = new Date(dateStr);
  const firstMonday = new Date(CURRENT_YEAR, 0, 5); // Jan 5, 2026
  return Math.floor((d.getTime() - firstMonday.getTime()) / (7 * 24 * 60 * 60 * 1000));
}

const STATUS_FILTERS: { key: ProjectStatus; label: string; defaultOn: boolean }[] = [
  { key: "active", label: "Active", defaultOn: true },
  { key: "potential", label: "Potential", defaultOn: true },
  { key: "completed", label: "Completed", defaultOn: false },
  { key: "cancelled", label: "Cancelled", defaultOn: false },
];

export default function GanttChart() {
  const { data, isLoading } = useDashboardData();
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

  const ganttData = useMemo(() => {
    if (!data) return null;

    const { workers, projects } = data;
    const filteredProjects = projects.filter((p) => activeFilters.has((p.status || "active") as ProjectStatus));

    // Compute project rows
    const projectRows = filteredProjects.map((p) => {
      const startMonth = dateToMonthIndex(p.startDate);
      const endMonth = dateToMonthIndex(p.endDate);
      const color = getProjectColorFromProject(p);
      const status = (p.status || "active") as ProjectStatus;

      // Count active assignments
      const assignedCount = workers.reduce((count, w) => {
        return count + w.assignments.filter((a) => a.projectId === p.id && a.status === "active").length;
      }, 0);

      return {
        project: p,
        startMonth: startMonth ?? 0,
        endMonth: endMonth ?? 11,
        color,
        headcount: assignedCount || p.headcount || 0,
        status,
      };
    });

    // Summary stats — only count active
    const activeProjects = projects.filter((p) => p.status === "active");
    const totalPositions = projectRows
      .filter((r) => r.status === "active")
      .reduce((sum, r) => sum + r.headcount, 0);

    // Demand curve: weekly headcount grouped by customer
    const firstMonday = new Date(CURRENT_YEAR, 0, 5);
    const totalWeeks = 52;

    // Only count assignments from active projects for demand
    const activeProjectIds = new Set(activeProjects.map((p) => p.id));

    // Build a project-to-customer map
    const projectCustomerMap: Record<number, string> = {};
    for (const p of projects) {
      projectCustomerMap[p.id] = p.customer || PROJECT_CUSTOMER[p.code] || "Other";
    }

    // Collect all active assignments with customer info
    const allAssignments = workers.flatMap((w) =>
      w.assignments
        .filter((a) => activeProjectIds.has(a.projectId))
        .map((a) => ({
          startDate: a.startDate ? new Date(a.startDate) : null,
          endDate: a.endDate ? new Date(a.endDate) : null,
          customer: projectCustomerMap[a.projectId] || "Other",
        }))
    );

    // Get unique customers
    const customersSet = new Set(allAssignments.map((a) => a.customer));
    const customers = Array.from(customersSet).sort();

    const weeklyDemand: Record<string, any>[] = [];

    for (let w = 0; w < totalWeeks; w++) {
      const weekStart = new Date(firstMonday.getTime() + w * 7 * 24 * 60 * 60 * 1000);
      const weekEnd = new Date(weekStart.getTime() + 6 * 24 * 60 * 60 * 1000);
      const weekMonth = MONTHS[weekStart.getMonth()];
      const weekDay = weekStart.getDate();

      const entry: Record<string, any> = {
        week: w,
        label: `${weekMonth} ${weekDay}`,
      };

      let total = 0;
      for (const cust of customers) {
        let count = 0;
        for (const a of allAssignments) {
          if (a.customer !== cust) continue;
          if (!a.startDate || !a.endDate) continue;
          if (a.startDate <= weekEnd && a.endDate >= weekStart) {
            count++;
          }
        }
        entry[cust] = count;
        total += count;
      }
      entry._total = total;

      weeklyDemand.push(entry);
    }

    const peakDemand = Math.max(...weeklyDemand.map((w) => w._total), 0);

    return {
      projectRows,
      activeCount: activeProjects.length,
      totalPositions,
      peakDemand,
      weeklyDemand,
      customers,
    };
  }, [data, activeFilters]);

  if (isLoading || !data || !ganttData) return <LoadingSkeleton />;

  const today = new Date();
  const todayMonth = today.getMonth();
  const todayDayFraction = today.getDate() / new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
  const todayWeek = dateToWeekIndex(today.toISOString());

  return (
    <div>
      {/* Summary Cards */}
      <div className="grid grid-cols-4 gap-4 mb-5" data-testid="gantt-summary">
        {[
          { label: "Active Projects", value: ganttData.activeCount, color: "var(--pfg-navy)" },
          { label: "Total Positions", value: ganttData.totalPositions, color: "var(--pfg-navy)" },
          { label: "Peak Demand", value: ganttData.peakDemand, color: "var(--red)" },
          { label: "FTE Baseline", value: FTE_BASELINE, color: "var(--pfg-navy)" },
        ].map((card) => (
          <div
            key={card.label}
            className="rounded-xl border p-5"
            style={{ background: "hsl(var(--card))", borderColor: "hsl(var(--card-border))", boxShadow: "var(--shadow-sm)" }}
          >
            <div className="text-[11px] font-semibold uppercase tracking-wide mb-2" style={{ color: "hsl(var(--muted-foreground))" }}>
              {card.label}
            </div>
            <div className="text-[28px] font-bold tabular-nums font-display leading-tight" style={{ color: card.color }}>
              {card.value}
            </div>
          </div>
        ))}
      </div>

      {/* Status filter toggles */}
      <div className="flex gap-2 mb-4" data-testid="gantt-status-filter">
        {STATUS_FILTERS.map((sf) => {
          const isOn = activeFilters.has(sf.key);
          return (
            <button
              key={sf.key}
              onClick={() => handleToggleFilter(sf.key)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold border transition-colors"
              style={{
                borderColor: isOn ? "var(--pfg-yellow)" : "hsl(var(--border))",
                background: isOn ? "hsl(var(--accent))" : "transparent",
                color: isOn ? "var(--pfg-navy)" : "hsl(var(--muted-foreground))",
              }}
              data-testid={`gantt-filter-${sf.key}`}
            >
              {isOn && <Check className="w-3 h-3" />}
              {sf.label}
            </button>
          );
        })}
      </div>

      {/* Gantt Chart */}
      <div
        className="rounded-xl border overflow-hidden mb-4"
        style={{ background: "hsl(var(--card))", borderColor: "hsl(var(--card-border))", boxShadow: "var(--shadow-sm)" }}
        data-testid="gantt-chart"
      >
        <div className="px-5 py-4 border-b flex items-center justify-between" style={{ borderColor: "hsl(var(--border))" }}>
          <h3 className="text-[15px] font-bold text-pfg-navy font-display">Project Timeline — {CURRENT_YEAR}</h3>
          <div className="flex gap-4 text-[11px]" style={{ color: "var(--pfg-steel)" }}>
            <div className="flex items-center gap-1.5">
              <div className="w-2.5 h-2.5 rounded-sm" style={{ background: "var(--red)" }} />
              Today
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-6 h-2.5 rounded-sm border-2 border-dashed" style={{ borderColor: "#94a3b8", background: "transparent" }} />
              Potential
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full" style={{ borderCollapse: "collapse", minWidth: 1200 }}>
            <thead>
              <tr>
                <th
                  className="text-left text-[10px] font-semibold uppercase tracking-wide px-4 py-1.5 sticky left-0 z-[3]"
                  style={{ background: "hsl(var(--muted))", color: "hsl(var(--muted-foreground))", minWidth: 240, borderBottom: "1px solid hsl(var(--border))" }}
                >
                  Project
                </th>
                <th
                  className="text-center text-[10px] font-semibold uppercase tracking-wide px-2 py-1.5"
                  style={{ background: "hsl(var(--muted))", color: "hsl(var(--muted-foreground))", minWidth: 50, borderBottom: "1px solid hsl(var(--border))" }}
                >
                  HC
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
              {ganttData.projectRows.map((row) => {
                const isPotential = row.status === "potential";
                const isInactive = row.status === "completed" || row.status === "cancelled";

                return (
                  <tr
                    key={row.project.id}
                    className="group"
                    data-testid={`gantt-row-${row.project.code}`}
                  >
                    <td
                      className="px-4 py-1 text-xs font-semibold whitespace-nowrap sticky left-0 z-[1]"
                      style={{
                        background: "hsl(var(--card))",
                        borderBottom: "1px solid hsl(var(--border))",
                        borderRight: "1px solid hsl(var(--border))",
                        color: isInactive ? "hsl(var(--muted-foreground))" : "var(--pfg-navy)",
                        textDecoration: row.status === "cancelled" ? "line-through" : undefined,
                      }}
                    >
                      <div className="flex items-center gap-2">
                        <div className="w-1 h-5 rounded-full" style={{ background: isInactive ? "#94a3b8" : row.color, opacity: isPotential ? 0.6 : 1 }} />
                        <span>{row.project.code}</span>
                        <span className="text-[11px] font-normal" style={{ color: "var(--pfg-steel)" }}>
                          {row.project.location || ""}
                        </span>
                        {isPotential && (
                          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded" style={{ background: "hsl(var(--accent))", color: "#8B6E00" }}>
                            POT
                          </span>
                        )}
                        {isInactive && (
                          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded" style={{ background: "hsl(var(--muted))", color: "hsl(var(--muted-foreground))" }}>
                            {row.status === "completed" ? "DONE" : "CXL"}
                          </span>
                        )}
                      </div>
                    </td>
                    <td
                      className="text-center text-xs font-bold tabular-nums"
                      style={{
                        borderBottom: "1px solid hsl(var(--border))",
                        color: isInactive ? "hsl(var(--muted-foreground))" : "var(--pfg-navy)",
                      }}
                    >
                      {row.headcount}
                    </td>
                    {MONTHS.map((_, monthIdx) => {
                      const isInRange = monthIdx >= row.startMonth && monthIdx <= row.endMonth;
                      const isStart = monthIdx === row.startMonth;
                      const isEnd = monthIdx === row.endMonth;
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
                            isPotential ? (
                              // Dashed bar for potential projects
                              <div
                                className="absolute top-1 bottom-1 cursor-pointer transition-opacity hover:opacity-80"
                                style={{
                                  border: `2px dashed ${row.color}`,
                                  background: `${row.color}15`,
                                  left: isStart ? "4px" : 0,
                                  right: isEnd ? "4px" : 0,
                                  borderRadius: isStart && isEnd ? 3 : isStart ? "3px 0 0 3px" : isEnd ? "0 3px 3px 0" : 0,
                                }}
                                title={`${row.project.code} — ${row.project.name} (Potential) (${row.project.startDate} → ${row.project.endDate})`}
                              />
                            ) : (
                              // Solid bar for active / completed / cancelled
                              <div
                                className="absolute top-1 bottom-1 cursor-pointer transition-opacity hover:opacity-80"
                                style={{
                                  background: isInactive ? "#94a3b8" : row.color,
                                  opacity: isInactive ? 0.5 : 1,
                                  left: isStart ? "4px" : 0,
                                  right: isEnd ? "4px" : 0,
                                  borderRadius: isStart && isEnd ? 3 : isStart ? "3px 0 0 3px" : isEnd ? "0 3px 3px 0" : 0,
                                }}
                                title={`${row.project.code} — ${row.project.name} (${row.project.startDate} → ${row.project.endDate})`}
                              />
                            )
                          )}
                          {/* Today line */}
                          {isToday && (
                            <div
                              className="absolute top-0 bottom-0 w-0.5 z-[5]"
                              style={{ background: "var(--red)", left: `${todayDayFraction * 100}%` }}
                            />
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Demand Curve — Stacked Area */}
      <div
        className="rounded-xl border overflow-hidden"
        style={{ background: "hsl(var(--card))", borderColor: "hsl(var(--card-border))", boxShadow: "var(--shadow-sm)" }}
        data-testid="demand-curve"
      >
        <div className="px-5 py-4 border-b flex items-center justify-between" style={{ borderColor: "hsl(var(--border))" }}>
          <h3 className="text-[15px] font-bold text-pfg-navy font-display">Workforce Demand Curve — {CURRENT_YEAR}</h3>
          <div className="flex gap-4 text-[11px] flex-wrap" style={{ color: "var(--pfg-steel)" }}>
            {ganttData.customers.map((cust) => (
              <div key={cust} className="flex items-center gap-1.5">
                <div
                  className="w-2.5 h-2.5 rounded-sm"
                  style={{ background: OEM_BRAND_COLORS[cust] || "#64748B" }}
                />
                {cust}
              </div>
            ))}
            <div className="flex items-center gap-1.5">
              <div className="w-6 border-t-2 border-dashed" style={{ borderColor: "var(--red)" }} />
              FTE Baseline ({FTE_BASELINE})
            </div>
          </div>
        </div>

        <div className="p-5">
          <ResponsiveContainer width="100%" height={280}>
            <AreaChart data={ganttData.weeklyDemand} margin={{ top: 10, right: 10, bottom: 0, left: 0 }}>
              <defs>
                {ganttData.customers.map((cust) => {
                  const color = OEM_BRAND_COLORS[cust] || "#64748B";
                  return (
                    <linearGradient key={cust} id={`grad-${cust.replace(/\s+/g, "-")}`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={color} stopOpacity={0.6} />
                      <stop offset="95%" stopColor={color} stopOpacity={0.15} />
                    </linearGradient>
                  );
                })}
              </defs>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 9, fill: "var(--pfg-steel)" }}
                interval={3}
                tickLine={false}
              />
              <YAxis
                tick={{ fontSize: 10, fill: "var(--pfg-steel)" }}
                tickLine={false}
                axisLine={false}
                width={30}
              />
              <Tooltip
                contentStyle={{
                  background: "var(--pfg-navy)",
                  border: "none",
                  borderRadius: 8,
                  color: "#fff",
                  fontSize: 11,
                  padding: "8px 12px",
                }}
                labelStyle={{ color: "#fff", fontWeight: 600, marginBottom: 4 }}
                formatter={(value: number, name: string) => [value, name]}
                itemStyle={{ color: "#fff", fontSize: 11, padding: "1px 0" }}
              />
              <ReferenceLine
                y={FTE_BASELINE}
                stroke="var(--red)"
                strokeDasharray="6 4"
                strokeWidth={2}
                label={{
                  value: `FTE ${FTE_BASELINE}`,
                  position: "right",
                  fill: "var(--red)",
                  fontSize: 10,
                  fontWeight: 700,
                }}
              />
              {/* Today reference line */}
              {todayWeek >= 0 && todayWeek < 52 && (
                <ReferenceLine
                  x={ganttData.weeklyDemand[todayWeek]?.label}
                  stroke="var(--red)"
                  strokeWidth={2}
                  label={{ value: "Today", position: "top", fill: "var(--red)", fontSize: 10, fontWeight: 700 }}
                />
              )}
              {ganttData.customers.map((cust) => (
                <Area
                  key={cust}
                  type="monotone"
                  dataKey={cust}
                  stackId="1"
                  stroke={OEM_BRAND_COLORS[cust] || "#64748B"}
                  fill={`url(#grad-${cust.replace(/\s+/g, "-")})`}
                  strokeWidth={1.5}
                />
              ))}
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
