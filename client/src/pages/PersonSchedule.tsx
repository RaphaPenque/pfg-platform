import { useState, useMemo } from "react";
import { useDashboardData, type DashboardWorker } from "@/hooks/use-dashboard-data";
import { getProjectColor, calcUtilisation } from "@/lib/constants";
import { Search } from "lucide-react";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const CURRENT_YEAR = 2026;

function LoadingSkeleton() {
  return (
    <div className="space-y-4 animate-pulse">
      <div className="h-14 rounded-xl" style={{ background: "hsl(var(--muted))" }} />
      <div className="h-[500px] rounded-xl" style={{ background: "hsl(var(--muted))" }} />
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

export default function PersonSchedule() {
  const { data, isLoading } = useDashboardData();
  const [search, setSearch] = useState("");
  const [projectFilter, setProjectFilter] = useState("");

  const workers = data?.workers ?? [];
  const projects = data?.projects ?? [];

  // Get unique project codes for filter
  const projectCodes = useMemo(() => Array.from(new Set(projects.map((p) => p.code))).sort(), [projects]);

  // Sort: FTEs first alphabetically, then Temps alphabetically
  const sortedWorkers = useMemo(() => {
    let filtered = workers;

    if (search) {
      const q = search.toLowerCase();
      filtered = filtered.filter((w) => w.name.toLowerCase().includes(q));
    }

    if (projectFilter) {
      filtered = filtered.filter((w) =>
        w.assignments.some((a) => a.projectCode === projectFilter)
      );
    }

    return [...filtered].sort((a, b) => {
      if (a.status !== b.status) return a.status === "FTE" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }, [workers, search, projectFilter]);

  if (isLoading || !data) return <LoadingSkeleton />;

  const today = new Date();
  const todayMonth = today.getMonth();
  const todayDayFrac = today.getDate() / new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();

  return (
    <div>
      {/* Filter Bar */}
      <div
        className="rounded-xl border p-4 mb-4 flex items-center gap-3 flex-wrap"
        style={{ background: "hsl(var(--card))", borderColor: "hsl(var(--card-border))", boxShadow: "var(--shadow-sm)" }}
        data-testid="schedule-filter-bar"
      >
        <div className="relative">
          <Search
            className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5"
            style={{ color: "hsl(var(--muted-foreground))" }}
          />
          <input
            type="text"
            data-testid="schedule-search"
            placeholder="Search by name..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8 pr-3 py-2 text-[13px] rounded-lg border w-[260px]"
            style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--card))" }}
          />
        </div>
        <select
          data-testid="schedule-project-filter"
          value={projectFilter}
          onChange={(e) => setProjectFilter(e.target.value)}
          className="py-2 px-2.5 text-[13px] rounded-lg border min-w-[160px]"
          style={{
            borderColor: "hsl(var(--border))",
            background: "hsl(var(--card))",
            appearance: "auto",
          }}
        >
          <option value="">All Projects</option>
          {projectCodes.map((code) => (
            <option key={code} value={code}>{code}</option>
          ))}
        </select>
        <div className="ml-auto text-[13px]" style={{ color: "var(--pfg-steel)" }}>
          <strong className="text-pfg-navy">{sortedWorkers.length}</strong> people
        </div>
      </div>

      {/* Schedule Table */}
      <div
        className="rounded-xl border overflow-hidden"
        style={{ background: "hsl(var(--card))", borderColor: "hsl(var(--card-border))", boxShadow: "var(--shadow-sm)" }}
        data-testid="schedule-table"
      >
        <div className="overflow-x-auto">
          <table className="w-full" style={{ borderCollapse: "collapse", minWidth: 1400 }}>
            <thead>
              <tr>
                <th
                  className="text-left text-[10px] font-semibold uppercase tracking-wide px-4 py-1.5 sticky left-0 z-[3]"
                  style={{
                    background: "hsl(var(--muted))",
                    color: "hsl(var(--muted-foreground))",
                    minWidth: 260,
                    borderBottom: "1px solid hsl(var(--border))",
                  }}
                >
                  Person
                </th>
                <th
                  className="text-center text-[10px] font-semibold uppercase tracking-wide px-2 py-1.5"
                  style={{
                    background: "hsl(var(--muted))",
                    color: "hsl(var(--muted-foreground))",
                    minWidth: 60,
                    borderBottom: "1px solid hsl(var(--border))",
                  }}
                >
                  Status
                </th>
                <th
                  className="text-center text-[10px] font-semibold uppercase tracking-wide px-2 py-1.5"
                  style={{
                    background: "hsl(var(--muted))",
                    color: "hsl(var(--muted-foreground))",
                    minWidth: 80,
                    borderBottom: "1px solid hsl(var(--border))",
                  }}
                >
                  Util
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
              {sortedWorkers.length === 0 ? (
                <tr>
                  <td colSpan={15} className="text-center py-16" style={{ color: "hsl(var(--muted-foreground))" }}>
                    No results found
                  </td>
                </tr>
              ) : (
                sortedWorkers.map((worker) => (
                  <PersonRow key={worker.id} worker={worker} todayMonth={todayMonth} todayDayFrac={todayDayFrac} />
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function PersonRow({
  worker,
  todayMonth,
  todayDayFrac,
}: {
  worker: DashboardWorker;
  todayMonth: number;
  todayDayFrac: number;
}) {
  const util = calcUtilisation(worker.assignments);
  const utilColor = util.pct >= 80 ? "var(--green)" : util.pct >= 50 ? "var(--amber)" : "var(--red)";

  // Build assignment bars per month
  const assignmentBars = worker.assignments.map((a) => {
    const startMonth = dateToMonthIndex(a.startDate);
    const endMonth = dateToMonthIndex(a.endDate);
    const color = getProjectColor(a.projectCode);
    const startFrac = a.startDate ? dateToDayFraction(a.startDate) : 0;
    const endFrac = a.endDate ? dateToDayFraction(a.endDate) : 1;

    return {
      assignment: a,
      startMonth: startMonth ?? 0,
      endMonth: endMonth ?? 11,
      startFrac,
      endFrac,
      color,
    };
  });

  return (
    <tr
      className="group"
      data-testid={`schedule-row-${worker.id}`}
    >
      {/* Name cell - sticky */}
      <td
        className="px-4 py-0.5 text-xs font-medium text-pfg-navy whitespace-nowrap sticky left-0 z-[1]"
        style={{
          background: "hsl(var(--card))",
          borderBottom: "1px solid hsl(var(--border))",
          borderRight: "1px solid hsl(var(--border))",
        }}
      >
        {worker.name}
      </td>

      {/* Status */}
      <td
        className="text-center"
        style={{ borderBottom: "1px solid hsl(var(--border))" }}
      >
        <span className={`badge ${worker.status === "FTE" ? "badge-navy" : "badge-grey"}`}>
          {worker.status}
        </span>
      </td>

      {/* Utilisation */}
      <td
        className="text-center px-2"
        style={{ borderBottom: "1px solid hsl(var(--border))" }}
      >
        <div className="flex items-center gap-1.5 justify-center">
          <div className="w-10 h-1.5 rounded-full overflow-hidden" style={{ background: "hsl(var(--muted))" }}>
            <div
              className="h-full rounded-full"
              style={{ width: `${Math.min(util.pct, 100)}%`, background: utilColor }}
            />
          </div>
          <span className="text-[10px] font-semibold tabular-nums">{util.pct}%</span>
        </div>
      </td>

      {/* Month cells */}
      {MONTHS.map((_, monthIdx) => {
        const isToday = monthIdx === todayMonth;

        // Find assignments that span this month
        const barsInMonth = assignmentBars.filter(
          (b) => monthIdx >= b.startMonth && monthIdx <= b.endMonth
        );

        return (
          <td
            key={monthIdx}
            className="relative"
            style={{
              borderBottom: "1px solid hsl(var(--border))",
              borderLeft: "1px solid hsl(var(--border))",
              height: 28,
              padding: "2px 1px",
            }}
          >
            {barsInMonth.map((bar, bIdx) => {
              const isStart = monthIdx === bar.startMonth;
              const isEnd = monthIdx === bar.endMonth;
              const left = isStart ? `${bar.startFrac * 100}%` : "0";
              const right = isEnd ? `${(1 - bar.endFrac) * 100}%` : "0";

              return (
                <div
                  key={bIdx}
                  className="absolute top-0.5 bottom-0.5 cursor-pointer transition-opacity hover:opacity-80 group/bar"
                  style={{
                    background: bar.color,
                    left,
                    right,
                    borderRadius:
                      isStart && isEnd ? 2 : isStart ? "2px 0 0 2px" : isEnd ? "0 2px 2px 0" : 0,
                    zIndex: 2,
                  }}
                >
                  {/* Tooltip */}
                  <div
                    className="hidden group-hover/bar:block absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 px-3 py-2 rounded-lg text-[11px] whitespace-nowrap z-[100] pointer-events-none"
                    style={{
                      background: "var(--pfg-navy)",
                      color: "#fff",
                      boxShadow: "var(--shadow-md)",
                    }}
                  >
                    <div className="font-semibold">{bar.assignment.projectCode} — {bar.assignment.projectName}</div>
                    <div className="opacity-80 mt-0.5">
                      {bar.assignment.task || "—"} · {bar.assignment.startDate} → {bar.assignment.endDate}
                    </div>
                  </div>
                </div>
              );
            })}

            {/* Today line */}
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
}
