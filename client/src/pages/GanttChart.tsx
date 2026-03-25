import { useMemo } from "react";
import { useDashboardData, type DashboardProject } from "@/hooks/use-dashboard-data";
import { getProjectColor } from "@/lib/constants";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, Cell, Legend } from "recharts";

const FTE_BASELINE = 54;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const CURRENT_YEAR = 2026;

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

export default function GanttChart() {
  const { data, isLoading } = useDashboardData();

  const ganttData = useMemo(() => {
    if (!data) return null;

    const { workers, projects } = data;
    const activeProjects = projects.filter((p) => p.status === "active");

    // Compute project rows
    const projectRows = activeProjects.map((p) => {
      const startMonth = dateToMonthIndex(p.startDate);
      const endMonth = dateToMonthIndex(p.endDate);
      const color = getProjectColor(p.code);

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
      };
    });

    // Summary stats
    const totalPositions = projectRows.reduce((sum, r) => sum + r.headcount, 0);

    // Demand curve: weekly headcount based on individual worker assignment overlaps
    // Weeks: Mon Jan 5 2026 through Mon Dec 28 2026
    const weeklyDemand: { week: number; label: string; count: number }[] = [];
    const firstMonday = new Date(CURRENT_YEAR, 0, 5); // Jan 5, 2026 is a Monday
    const totalWeeks = 52;

    // Collect all assignments from all workers
    const allAssignments = workers.flatMap((w) =>
      w.assignments.map((a) => ({
        startDate: a.startDate ? new Date(a.startDate) : null,
        endDate: a.endDate ? new Date(a.endDate) : null,
      }))
    );

    for (let w = 0; w < totalWeeks; w++) {
      const weekStart = new Date(firstMonday.getTime() + w * 7 * 24 * 60 * 60 * 1000);
      const weekEnd = new Date(weekStart.getTime() + 6 * 24 * 60 * 60 * 1000); // Sunday
      const weekMonth = MONTHS[weekStart.getMonth()];
      const weekDay = weekStart.getDate();

      // Count how many individual assignments overlap with this week
      let count = 0;
      for (const a of allAssignments) {
        if (!a.startDate || !a.endDate) continue;
        // Assignment overlaps with week if it starts before week ends AND ends after week starts
        if (a.startDate <= weekEnd && a.endDate >= weekStart) {
          count++;
        }
      }

      weeklyDemand.push({
        week: w,
        label: `${weekMonth} ${weekDay}`,
        count,
      });
    }

    const peakDemand = Math.max(...weeklyDemand.map((w) => w.count), 0);

    return {
      projectRows,
      activeCount: activeProjects.length,
      totalPositions,
      peakDemand,
      weeklyDemand,
    };
  }, [data]);

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
              {ganttData.projectRows.map((row) => (
                <tr
                  key={row.project.id}
                  className="group"
                  data-testid={`gantt-row-${row.project.code}`}
                >
                  <td
                    className="px-4 py-1 text-xs font-semibold text-pfg-navy whitespace-nowrap sticky left-0 z-[1]"
                    style={{
                      background: "hsl(var(--card))",
                      borderBottom: "1px solid hsl(var(--border))",
                      borderRight: "1px solid hsl(var(--border))",
                    }}
                  >
                    <div className="flex items-center gap-2">
                      <div className="w-1 h-5 rounded-full" style={{ background: row.color }} />
                      <span>{row.project.code}</span>
                      <span className="text-[11px] font-normal" style={{ color: "var(--pfg-steel)" }}>
                        {row.project.location || ""}
                      </span>
                    </div>
                  </td>
                  <td
                    className="text-center text-xs font-bold tabular-nums text-pfg-navy"
                    style={{ borderBottom: "1px solid hsl(var(--border))" }}
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
                          <div
                            className="absolute top-1 bottom-1 cursor-pointer transition-opacity hover:opacity-80"
                            style={{
                              background: row.color,
                              left: isStart ? "4px" : 0,
                              right: isEnd ? "4px" : 0,
                              borderRadius: isStart && isEnd ? 3 : isStart ? "3px 0 0 3px" : isEnd ? "0 3px 3px 0" : 0,
                            }}
                            title={`${row.project.code} — ${row.project.name} (${row.project.startDate} → ${row.project.endDate})`}
                          />
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
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Demand Curve */}
      <div
        className="rounded-xl border overflow-hidden"
        style={{ background: "hsl(var(--card))", borderColor: "hsl(var(--card-border))", boxShadow: "var(--shadow-sm)" }}
        data-testid="demand-curve"
      >
        <div className="px-5 py-4 border-b flex items-center justify-between" style={{ borderColor: "hsl(var(--border))" }}>
          <h3 className="text-[15px] font-bold text-pfg-navy font-display">Demand Curve — Weekly Headcount</h3>
          <div className="flex gap-4 text-[11px]" style={{ color: "var(--pfg-steel)" }}>
            <div className="flex items-center gap-1.5">
              <div className="w-2.5 h-2.5 rounded-sm" style={{ background: "rgba(99,117,140,0.75)" }} />
              Within FTE
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-2.5 h-2.5 rounded-sm" style={{ background: "rgba(185,28,28,0.75)" }} />
              Over FTE
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-6 border-t-2 border-dashed" style={{ borderColor: "var(--red)" }} />
              FTE Baseline ({FTE_BASELINE})
            </div>
          </div>
        </div>

        <div className="p-5">
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={ganttData.weeklyDemand} margin={{ top: 10, right: 10, bottom: 0, left: 0 }}>
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
                }}
                labelStyle={{ color: "#fff", fontWeight: 600 }}
                formatter={(value: number) => [value, "Headcount"]}
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
              <ReferenceLine
                x={ganttData.weeklyDemand[todayWeek]?.label}
                stroke="var(--red)"
                strokeWidth={2}
                label={{ value: "Today", position: "top", fill: "var(--red)", fontSize: 10, fontWeight: 700 }}
              />
              <Bar dataKey="count" radius={[2, 2, 0, 0]} maxBarSize={18}>
                {ganttData.weeklyDemand.map((entry, idx) => (
                  <Cell
                    key={idx}
                    fill={entry.count > FTE_BASELINE ? "rgba(185,28,28,0.75)" : "rgba(99,117,140,0.75)"}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
