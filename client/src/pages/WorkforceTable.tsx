import { useState, useMemo, useRef, useEffect, Fragment } from "react";
import { useDashboardData, type DashboardWorker, type DashboardAssignment } from "@/hooks/use-dashboard-data";
import { OEM_BRAND_COLORS, CERT_DEFS, calcUtilisation } from "@/lib/constants";
import { Search, ChevronDown, ChevronUp, Info, Upload, Download, ArrowUpDown } from "lucide-react";

// ─── Loading skeleton ───
function LoadingSkeleton() {
  return (
    <div className="space-y-4 animate-pulse">
      <div className="grid grid-cols-5 gap-4">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-28 rounded-xl" style={{ background: "hsl(var(--muted))" }} />
        ))}
      </div>
      <div className="h-16 rounded-xl" style={{ background: "hsl(var(--muted))" }} />
      <div className="h-96 rounded-xl" style={{ background: "hsl(var(--muted))" }} />
    </div>
  );
}

// ─── Multi-select dropdown ───
function MultiSelect({
  label,
  options,
  selected,
  onChange,
  testId,
}: {
  label: string;
  options: string[];
  selected: string[];
  onChange: (v: string[]) => void;
  testId: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const toggle = (val: string) => {
    onChange(
      selected.includes(val) ? selected.filter((s) => s !== val) : [...selected, val]
    );
  };

  const display =
    selected.length === 0
      ? `All ${label}`
      : selected.length === 1
        ? selected[0]
        : `${selected.length} selected`;

  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: "hsl(var(--muted-foreground))" }}>
        {label}
      </span>
      <div className="relative" ref={ref}>
        <button
          type="button"
          data-testid={testId}
          onClick={() => setOpen(!open)}
          className="flex items-center gap-1 text-[13px] min-w-[130px] px-2.5 py-2 rounded-lg border cursor-pointer truncate"
          style={{
            borderColor: open ? "var(--pfg-yellow)" : "hsl(var(--border))",
            boxShadow: open ? "0 0 0 3px rgba(245,189,0,0.15)" : "none",
            background: "hsl(var(--card))",
          }}
        >
          <span className="truncate flex-1 text-left">{display}</span>
          <ChevronDown className="w-3.5 h-3.5 shrink-0" style={{ color: "hsl(var(--muted-foreground))" }} />
        </button>
        {open && (
          <div
            className="absolute top-full mt-1 left-0 z-50 min-w-[200px] max-h-60 overflow-y-auto rounded-lg border p-1"
            style={{ background: "hsl(var(--card))", borderColor: "hsl(var(--border))", boxShadow: "var(--shadow-md)" }}
          >
            {options.map((opt) => (
              <label
                key={opt}
                className="flex items-center gap-2 px-3 py-1.5 text-[13px] cursor-pointer rounded hover:bg-black/5"
              >
                <input
                  type="checkbox"
                  checked={selected.includes(opt)}
                  onChange={() => toggle(opt)}
                  className="accent-[var(--pfg-yellow)]"
                />
                {opt}
              </label>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── OEM pill colours ───
const OEM_PILL_COLORS = [
  { bg: "#DBEAFE", text: "#1D4ED8" },
  { bg: "#D1FAE5", text: "#065F46" },
  { bg: "#FEF3C7", text: "#92400E" },
  { bg: "#FCE7F3", text: "#9D174D" },
  { bg: "#EDE9FE", text: "#5B21B6" },
  { bg: "#FEE2E2", text: "#991B1B" },
  { bg: "#E0F2FE", text: "#075985" },
  { bg: "#F0FDF4", text: "#14532D" },
  { bg: "#FFF7ED", text: "#9A3412" },
  { bg: "#FAF5FF", text: "#6B21A8" },
  { bg: "#F1F5F9", text: "#334155" },
  { bg: "#ECFDF5", text: "#047857" },
];

function OemPill({ oem, index }: { oem: string; index: number }) {
  const c = OEM_PILL_COLORS[index % OEM_PILL_COLORS.length];
  return (
    <span className="oem-pill" style={{ background: c.bg, color: c.text }}>
      {oem}
    </span>
  );
}

// ─── Status badge ───
function StatusBadge({ status }: { status: string }) {
  const cls = status === "FTE" ? "badge-navy" : "badge-grey";
  return <span className={`badge ${cls}`}>{status}</span>;
}

// ─── English badge ───
function EnglishBadge({ level }: { level: string | null }) {
  if (!level) return <span className="text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>—</span>;
  const l = level.toUpperCase();
  const cls =
    l >= "B2" ? "badge-green" : l >= "B1" ? "badge-amber" : l === "TBC" ? "badge-grey" : "badge-amber";
  return <span className={`badge ${cls}`}>{level}</span>;
}

// ─── Tech level badge ───
function TechBadge({ level }: { level: string | null }) {
  if (!level) return <span className="text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>—</span>;
  const cls =
    level === "Tech 3" ? "badge-green" : level === "Tech 2" ? "badge-amber" : "badge-accent";
  return <span className={`badge ${cls}`}>{level}</span>;
}

// ─── Score bar ───
function ScoreBar({ label, value }: { label: string; value: number | null }) {
  const v = value ?? 0;
  const color = v >= 4 ? "var(--green)" : v >= 3 ? "var(--amber)" : "var(--red)";
  return (
    <div className="flex items-center gap-2">
      <span className="text-[11px] w-24 text-right" style={{ color: "var(--pfg-steel)" }}>{label}</span>
      <div className="w-16 h-1.5 rounded-full overflow-hidden" style={{ background: "hsl(var(--muted))" }}>
        <div className="h-full rounded-full" style={{ width: `${(v / 5) * 100}%`, background: color }} />
      </div>
      <span className="text-xs font-semibold tabular-nums" style={{ minWidth: 20 }}>{v > 0 ? v.toFixed(1) : "—"}</span>
    </div>
  );
}

// ─── Worker detail expanded row ───
// ─── Certificates Tab with inline editing ───
function CertificatesTab({ worker }: { worker: DashboardWorker }) {
  const [certs, setCerts] = useState<Record<string, { completionDate: string; validityDate: string }>>({});
  const [saving, setSaving] = useState<string | null>(null);

  function getCertData(certName: string) {
    return certs[certName] || { completionDate: '', validityDate: '' };
  }

  function updateCert(certName: string, field: 'completionDate' | 'validityDate', value: string) {
    setCerts(prev => ({
      ...prev,
      [certName]: { ...getCertData(certName), [field]: value }
    }));
  }

  function getStatus(cert: typeof CERT_DEFS[0]) {
    const data = getCertData(cert.name);
    if (!data.completionDate) return { label: 'Not uploaded', color: 'hsl(var(--muted-foreground))' };
    if (cert.alwaysGreen) return { label: 'Valid', color: 'var(--green)' };
    if (!data.validityDate) return { label: 'Date set', color: 'var(--amber)' };
    const today = new Date().toISOString().split('T')[0];
    if (data.validityDate < today) return { label: 'Expired', color: 'var(--red)' };
    // Warn if expiring within 30 days
    const thirtyDays = new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0];
    if (data.validityDate < thirtyDays) return { label: 'Expiring soon', color: 'var(--amber)' };
    return { label: 'Valid', color: 'var(--green)' };
  }

  async function saveCert(certName: string) {
    setSaving(certName);
    const data = getCertData(certName);
    try {
      await fetch('/api/documents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workerId: worker.id,
          type: 'certificate',
          name: certName,
          issuedDate: data.completionDate || null,
          expiryDate: data.validityDate || null,
          status: getStatus({ name: certName } as any).label === 'Expired' ? 'expired' : 'valid',
          uploadedAt: new Date().toISOString(),
        }),
      });
    } catch (e) {
      // Silent fail in demo
    }
    setSaving(null);
  }

  return (
    <div className="rounded-lg border overflow-hidden" style={{ background: 'hsl(var(--card))', borderColor: 'hsl(var(--border))' }}>
      <table className="w-full text-[13px]">
        <thead>
          <tr style={{ background: 'hsl(var(--muted))' }}>
            <th className="text-left px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wide" style={{ color: 'hsl(var(--muted-foreground))' }}>Certificate</th>
            <th className="text-left px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wide w-[150px]" style={{ color: 'hsl(var(--muted-foreground))' }}>Completion Date</th>
            <th className="text-left px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wide w-[150px]" style={{ color: 'hsl(var(--muted-foreground))' }}>Validity Date</th>
            <th className="text-left px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wide w-[110px]" style={{ color: 'hsl(var(--muted-foreground))' }}>Status</th>
            <th className="px-4 py-2.5 w-[80px]"></th>
          </tr>
        </thead>
        <tbody>
          {CERT_DEFS.map((cert) => {
            const data = getCertData(cert.name);
            const status = getStatus(cert);
            const hasData = !!data.completionDate;

            return (
              <tr key={cert.name} className="border-t hover:bg-black/[0.02] transition-colors" style={{ borderColor: 'hsl(var(--border))' }}>
                <td className="px-4 py-2.5 font-medium">
                  <div className="flex items-center gap-2">
                    <span style={{ color: status.color, fontSize: 14 }}>{hasData ? '●' : '○'}</span>
                    <span>{cert.name}</span>
                    {cert.noTradeAlt && !hasData && (
                      <span className="italic text-xs" style={{ color: 'hsl(var(--muted-foreground))' }}>/ {cert.noTradeAlt}</span>
                    )}
                  </div>
                </td>
                <td className="px-4 py-2.5">
                  <input
                    type="date"
                    value={data.completionDate}
                    onChange={(e) => updateCert(cert.name, 'completionDate', e.target.value)}
                    className="text-xs px-2 py-1 border rounded w-full"
                    style={{ borderColor: 'hsl(var(--border))', background: 'hsl(var(--background))' }}
                    data-testid={`cert-completion-${cert.name}`}
                  />
                </td>
                <td className="px-4 py-2.5">
                  {cert.completionOnly ? (
                    <span className="text-xs" style={{ color: 'hsl(var(--muted-foreground))' }}>N/A</span>
                  ) : (
                    <input
                      type="date"
                      value={data.validityDate}
                      onChange={(e) => updateCert(cert.name, 'validityDate', e.target.value)}
                      className="text-xs px-2 py-1 border rounded w-full"
                      style={{ borderColor: 'hsl(var(--border))', background: 'hsl(var(--background))' }}
                      data-testid={`cert-validity-${cert.name}`}
                    />
                  )}
                </td>
                <td className="px-4 py-2.5">
                  <span className="text-xs font-semibold" style={{ color: status.color }}>{status.label}</span>
                </td>
                <td className="px-4 py-2.5">
                  {hasData && (
                    <button
                      onClick={() => saveCert(cert.name)}
                      disabled={saving === cert.name}
                      className="flex items-center gap-1 text-xs font-medium px-2 py-1 rounded transition-colors"
                      style={{ color: 'var(--pfg-yellow-dark, #D4A300)', background: saving === cert.name ? 'hsl(var(--muted))' : 'transparent' }}
                      data-testid={`cert-save-${cert.name}`}
                    >
                      {saving === cert.name ? 'Saving...' : '✓ Save'}
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function WorkerDetail({ worker }: { worker: DashboardWorker }) {
  const [tab, setTab] = useState<"summary" | "certs" | "experience">("summary");
  const util = calcUtilisation(worker.assignments);

  // Current assignment
  const activeAssignment = worker.assignments.find((a) => a.status === "active");

  return (
    <div style={{ background: "hsl(var(--muted))" }}>
      {/* Tabs */}
      <div className="flex border-b" style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--card))" }}>
        {(["summary", "certs", "experience"] as const).map((t) => (
          <button
            key={t}
            data-testid={`worker-tab-${t}`}
            onClick={() => setTab(t)}
            className={`px-5 py-2.5 text-xs font-semibold border-b-2 transition-all ${
              tab === t
                ? "text-pfg-navy border-[var(--pfg-yellow)]"
                : "border-transparent hover:text-pfg-navy"
            }`}
            style={{ color: tab === t ? "var(--pfg-navy)" : "var(--pfg-steel)" }}
          >
            {t === "summary" ? "Summary" : t === "certs" ? "Qualifications & Certificates" : "Work Experience"}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="p-5">
        {tab === "summary" && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Profile grid */}
            <div className="rounded-lg border p-4" style={{ background: "hsl(var(--card))", borderColor: "hsl(var(--border))" }}>
              <div className="text-xs font-bold uppercase tracking-wide mb-3 pb-2 border-b text-pfg-navy" style={{ borderColor: "hsl(var(--border))" }}>
                Profile
              </div>
              <div className="grid grid-cols-2 gap-2">
                {[
                  ["Status", worker.status],
                  ["Age", worker.age || "—"],
                  ["Joined", worker.joined || "—"],
                  ["Country Code", worker.countryCode || "—"],
                  ["CTC", worker.ctc || "—"],
                  ["Measuring", worker.measuringSkills || "—"],
                ].map(([label, val]) => (
                  <div key={label} className="flex flex-col gap-0.5">
                    <span className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: "hsl(var(--muted-foreground))" }}>
                      {label}
                    </span>
                    <span className="text-[13px] font-medium">{val}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Scores + OEM */}
            <div className="rounded-lg border p-4" style={{ background: "hsl(var(--card))", borderColor: "hsl(var(--border))" }}>
              <div className="text-xs font-bold uppercase tracking-wide mb-3 pb-2 border-b text-pfg-navy" style={{ borderColor: "hsl(var(--border))" }}>
                Scores
              </div>
              <div className="space-y-2">
                <ScoreBar label="Experience" value={worker.experienceScore} />
                <ScoreBar label="Technical" value={worker.technicalScore} />
                <ScoreBar label="Attitude" value={worker.attitudeScore} />
              </div>
              <div className="text-xs font-bold uppercase tracking-wide mt-4 mb-2 pt-3 border-t" style={{ color: "var(--pfg-navy)", borderColor: "hsl(var(--border))" }}>
                OEM Experience
              </div>
              <div className="flex flex-wrap gap-1">
                {worker.oemExperience.length > 0 ? (
                  worker.oemExperience.map((oem, i) => <OemPill key={oem} oem={oem} index={i} />)
                ) : (
                  <span className="text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>None recorded</span>
                )}
              </div>
            </div>

            {/* Comments + Utilisation */}
            <div className="rounded-lg border p-4" style={{ background: "hsl(var(--card))", borderColor: "hsl(var(--border))" }}>
              <div className="text-xs font-bold uppercase tracking-wide mb-3 pb-2 border-b text-pfg-navy" style={{ borderColor: "hsl(var(--border))" }}>
                Comments
              </div>
              <p className="text-[13px] leading-relaxed" style={{ color: "var(--pfg-steel)" }}>
                {worker.comments || "No comments"}
              </p>
              <div className="text-xs font-bold uppercase tracking-wide mt-4 mb-2 pt-3 border-t" style={{ color: "var(--pfg-navy)", borderColor: "hsl(var(--border))" }}>
                Utilisation
              </div>
              <div className="flex items-center gap-3">
                <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: "hsl(var(--muted))" }}>
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${Math.min(util.pct, 100)}%`,
                      background: util.pct >= 80 ? "var(--green)" : util.pct >= 50 ? "var(--amber)" : "var(--red)",
                    }}
                  />
                </div>
                <span className="text-sm font-bold tabular-nums">{util.days}d {util.pct}%</span>
              </div>
            </div>
          </div>
        )}

        {tab === "certs" && (
          <CertificatesTab worker={worker} />
        )}

        {tab === "experience" && (
          <div>
            <div className="rounded-lg border overflow-hidden" style={{ background: "hsl(var(--card))", borderColor: "hsl(var(--border))" }}>
              <table className="w-full text-[12px]">
                <thead>
                  <tr style={{ background: "hsl(var(--muted))" }}>
                    {["Site / Project", "Start Date", "End Date", "Role", "OEM", "Equipment", "Scope of Work"].map((h) => (
                      <th key={h} className="text-left px-3 py-2.5 text-[10px] font-semibold uppercase tracking-wide" style={{ color: "hsl(var(--muted-foreground))" }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {worker.assignments.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-8 text-center" style={{ color: "hsl(var(--muted-foreground))" }}>
                        No work experience recorded
                      </td>
                    </tr>
                  ) : (
                    worker.assignments.map((a) => {
                      // Derive equipment from OEM experience or project
                      const oemEntry = worker.oemExperience.find((o) => o.includes(a.customer));
                      const equipment = oemEntry ? oemEntry.split(" - ")[1] || "—" : "—";
                      return (
                        <tr key={a.id} className="border-t hover:bg-[hsl(var(--accent))]" style={{ borderColor: "hsl(var(--border))" }}>
                          <td className="px-3 py-2 font-medium">{a.projectName} ({a.projectCode})</td>
                          <td className="px-3 py-2 tabular-nums">{a.startDate || "—"}</td>
                          <td className="px-3 py-2 tabular-nums">{a.endDate || "—"}</td>
                          <td className="px-3 py-2">{a.task || worker.role}</td>
                          <td className="px-3 py-2">{a.customer || "—"}</td>
                          <td className="px-3 py-2">{equipment}</td>
                          <td className="px-3 py-2">{a.task || "—"}</td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
            <div className="mt-3 flex justify-end">
              <button
                disabled
                className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border opacity-40 cursor-not-allowed"
                data-testid="download-sqep"
              >
                <Download className="w-3.5 h-3.5" />
                Download SQEP Pack
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Utilisation progress bar ───
function UtilBar({ assignments }: { assignments: DashboardAssignment[] }) {
  const util = calcUtilisation(assignments);
  const color = util.pct >= 80 ? "var(--green)" : util.pct >= 50 ? "var(--amber)" : "var(--red)";
  return (
    <div className="flex items-center gap-2 min-w-[120px]">
      <div className="w-14 h-1.5 rounded-full overflow-hidden" style={{ background: "hsl(var(--muted))" }}>
        <div className="h-full rounded-full" style={{ width: `${Math.min(util.pct, 100)}%`, background: color }} />
      </div>
      <span className="text-[11px] font-semibold tabular-nums whitespace-nowrap">{util.days}d {util.pct}%</span>
    </div>
  );
}

// ─── Sort types ───
type SortKey = "name" | "role" | "status" | "nationality" | "englishLevel" | "techLevel" | "measuringSkills" | "utilisation";
type SortDir = "asc" | "desc";

export default function WorkforceTable() {
  const { data, isLoading } = useDashboardData();
  const [search, setSearch] = useState("");
  const [filterRole, setFilterRole] = useState<string[]>([]);
  const [filterStatus, setFilterStatus] = useState<string[]>([]);
  const [filterNat, setFilterNat] = useState<string[]>([]);
  const [filterTech, setFilterTech] = useState<string[]>([]);
  const [filterEnglish, setFilterEnglish] = useState<string[]>([]);
  const [filterOem, setFilterOem] = useState<string[]>([]);
  const [filterAssigned, setFilterAssigned] = useState<string[]>([]);
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const workers = data?.workers ?? [];

  // Derive unique filter options
  const roles = useMemo(() => Array.from(new Set(workers.map((w) => w.role))).sort(), [workers]);
  const statuses = useMemo(() => Array.from(new Set(workers.map((w) => w.status))).sort(), [workers]);
  const nationalities = useMemo(() => Array.from(new Set(workers.map((w) => w.nationality).filter(Boolean) as string[])).sort(), [workers]);
  const techLevels = useMemo(() => Array.from(new Set(workers.map((w) => w.techLevel).filter(Boolean) as string[])).sort(), [workers]);
  const englishLevels = useMemo(() => Array.from(new Set(workers.map((w) => w.englishLevel).filter(Boolean) as string[])).sort(), [workers]);
  const allOems = useMemo(() => Array.from(new Set(workers.flatMap((w) => w.oemExperience.map((o) => o.split(" - ")[0])))).sort(), [workers]);
  const assignedOptions = ["Assigned", "Available"];

  // Filter
  const filtered = useMemo(() => {
    return workers.filter((w) => {
      if (search && !w.name.toLowerCase().includes(search.toLowerCase())) return false;
      if (filterRole.length > 0 && !filterRole.includes(w.role)) return false;
      if (filterStatus.length > 0 && !filterStatus.includes(w.status)) return false;
      if (filterNat.length > 0 && !filterNat.includes(w.nationality || "")) return false;
      if (filterTech.length > 0 && !filterTech.includes(w.techLevel || "")) return false;
      if (filterEnglish.length > 0 && !filterEnglish.includes(w.englishLevel || "")) return false;
      if (filterOem.length > 0) {
        const workerOems = w.oemExperience.map((o) => o.split(" - ")[0]);
        if (!filterOem.some((o) => workerOems.includes(o))) return false;
      }
      if (filterAssigned.length > 0) {
        const hasActive = w.assignments.some((a) => a.status === "active");
        if (filterAssigned.includes("Assigned") && !hasActive) return false;
        if (filterAssigned.includes("Available") && hasActive) return false;
      }
      return true;
    });
  }, [workers, search, filterRole, filterStatus, filterNat, filterTech, filterEnglish, filterOem, filterAssigned]);

  // Sort
  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      const dir = sortDir === "asc" ? 1 : -1;
      if (sortKey === "utilisation") {
        return (calcUtilisation(a.assignments).pct - calcUtilisation(b.assignments).pct) * dir;
      }
      const av = (a[sortKey] as string) || "";
      const bv = (b[sortKey] as string) || "";
      return av.localeCompare(bv) * dir;
    });
  }, [filtered, sortKey, sortDir]);

  if (isLoading || !data) return <LoadingSkeleton />;

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  // Summary stats
  const totalFte = workers.filter((w) => w.status === "FTE").length;
  const totalTemp = workers.filter((w) => w.status === "Temp").length;
  const fteWithActive = workers.filter(
    (w) => w.status === "FTE" && w.assignments.some((a) => a.status === "active")
  ).length;
  const fteUtilPct = totalFte > 0 ? Math.round((fteWithActive / totalFte) * 100) : 0;
  const availFte = workers.filter(
    (w) => w.status === "FTE" && !w.assignments.some((a) => a.status === "active")
  ).length;
  const availTemp = workers.filter(
    (w) => w.status === "Temp" && !w.assignments.some((a) => a.status === "active")
  ).length;

  // Nationality counts
  const natCounts = workers.reduce<Record<string, number>>((acc, w) => {
    if (w.nationality) acc[w.nationality] = (acc[w.nationality] || 0) + 1;
    return acc;
  }, {});
  const topNats = Object.entries(natCounts).sort((a, b) => b[1] - a[1]).slice(0, 5);

  // Role counts
  const roleCounts = workers.reduce<Record<string, number>>((acc, w) => {
    acc[w.role] = (acc[w.role] || 0) + 1;
    return acc;
  }, {});
  const roleList = Object.entries(roleCounts).sort((a, b) => b[1] - a[1]);
  const maxRoleCount = Math.max(...roleList.map(([, c]) => c), 1);

  const SortIcon = ({ col }: { col: SortKey }) => (
    <span className="inline-block ml-1 text-[10px] opacity-40">
      {sortKey === col ? (sortDir === "asc" ? "▲" : "▼") : "⇅"}
    </span>
  );

  return (
    <div>
      {/* Summary Cards */}
      <div className="grid grid-cols-5 gap-4 mb-5" data-testid="summary-cards">
        {/* Total Headcount */}
        <div className="rounded-xl border p-5" style={{ background: "hsl(var(--card))", borderColor: "hsl(var(--card-border))", boxShadow: "var(--shadow-sm)" }}>
          <div className="text-[11px] font-semibold uppercase tracking-wide mb-2" style={{ color: "hsl(var(--muted-foreground))" }}>
            Total Headcount
          </div>
          <div className="text-[28px] font-bold tabular-nums font-display text-pfg-navy leading-tight">
            {workers.length}
          </div>
          <div className="text-xs mt-1.5" style={{ color: "var(--pfg-steel)" }}>
            <span className="font-semibold">{totalFte}</span> FTE · <span className="font-semibold">{totalTemp}</span> Temp
          </div>
        </div>

        {/* FTE Utilisation */}
        <div className="rounded-xl border p-5" style={{ background: "hsl(var(--card))", borderColor: "hsl(var(--card-border))", boxShadow: "var(--shadow-sm)" }}>
          <div className="text-[11px] font-semibold uppercase tracking-wide mb-2 flex items-center gap-1" style={{ color: "hsl(var(--muted-foreground))" }}>
            FTE Utilisation
            <span
              className="inline-flex items-center justify-center w-4 h-4 rounded-full text-[10px] font-bold cursor-help"
              style={{ background: "hsl(var(--border))", color: "var(--pfg-steel)" }}
              title="Percentage of FTE workers currently assigned to active projects"
            >
              ?
            </span>
          </div>
          <div className="text-[28px] font-bold tabular-nums font-display text-pfg-navy leading-tight">
            {fteUtilPct}%
          </div>
          <div className="text-xs mt-1.5" style={{ color: "var(--pfg-steel)" }}>
            <span className="font-semibold">{fteWithActive}</span> of {totalFte} FTE assigned
          </div>
        </div>

        {/* Available Now */}
        <div className="rounded-xl border p-5" style={{ background: "hsl(var(--card))", borderColor: "hsl(var(--card-border))", boxShadow: "var(--shadow-sm)" }}>
          <div className="text-[11px] font-semibold uppercase tracking-wide mb-2" style={{ color: "hsl(var(--muted-foreground))" }}>
            Available Now
          </div>
          <div className="text-[28px] font-bold tabular-nums font-display leading-tight" style={{ color: availFte > 0 ? "var(--red)" : "var(--green)" }}>
            {availFte}
          </div>
          <div className="text-xs mt-1.5" style={{ color: "var(--pfg-steel)" }}>
            FTE · <span className="font-semibold">{availTemp}</span> Temps available
          </div>
        </div>

        {/* Top Nationalities */}
        <div className="rounded-xl border p-5" style={{ background: "hsl(var(--card))", borderColor: "hsl(var(--card-border))", boxShadow: "var(--shadow-sm)" }}>
          <div className="text-[11px] font-semibold uppercase tracking-wide mb-2" style={{ color: "hsl(var(--muted-foreground))" }}>
            Top Nationalities
          </div>
          <div className="space-y-1">
            {topNats.map(([name, count]) => (
              <div key={name} className="flex items-center justify-between text-xs">
                <span style={{ color: "var(--pfg-steel)" }}>{name}</span>
                <span className="font-semibold tabular-nums">{count}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Role Distribution */}
        <div className="rounded-xl border p-5" style={{ background: "hsl(var(--card))", borderColor: "hsl(var(--card-border))", boxShadow: "var(--shadow-sm)" }}>
          <div className="text-[11px] font-semibold uppercase tracking-wide mb-2" style={{ color: "hsl(var(--muted-foreground))" }}>
            Role Distribution
          </div>
          <div className="space-y-1">
            {roleList.map(([name, count]) => (
              <div key={name} className="flex items-center gap-2 text-[11px]">
                <span className="w-[120px] text-right truncate shrink-0" style={{ color: "var(--pfg-steel)" }}>{name}</span>
                <div className="flex-1 h-3.5 rounded" style={{ background: "hsl(var(--muted))" }}>
                  <div
                    className="h-full rounded"
                    style={{ width: `${(count / maxRoleCount) * 100}%`, background: "var(--pfg-yellow)", transition: "width 0.4s" }}
                  />
                </div>
                <span className="w-6 font-semibold tabular-nums text-right">{count}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Filter Bar */}
      <div
        className="rounded-xl border p-4 mb-4"
        style={{ background: "hsl(var(--card))", borderColor: "hsl(var(--card-border))", boxShadow: "var(--shadow-sm)" }}
        data-testid="filter-bar"
      >
        <div className="flex items-end gap-2.5 flex-wrap">
          {/* Search */}
          <div className="flex flex-col gap-1">
            <span className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: "hsl(var(--muted-foreground))" }}>
              Search
            </span>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5" style={{ color: "hsl(var(--muted-foreground))" }} />
              <input
                type="text"
                data-testid="search-input"
                placeholder="Search by name..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8 pr-3 py-2 text-[13px] rounded-lg border w-[200px]"
                style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--card))" }}
              />
            </div>
          </div>

          <MultiSelect label="Role" options={roles} selected={filterRole} onChange={setFilterRole} testId="filter-role" />
          <MultiSelect label="Status" options={statuses} selected={filterStatus} onChange={setFilterStatus} testId="filter-status" />
          <MultiSelect label="Nationality" options={nationalities} selected={filterNat} onChange={setFilterNat} testId="filter-nationality" />
          <MultiSelect label="Tech Level" options={techLevels} selected={filterTech} onChange={setFilterTech} testId="filter-tech" />
          <MultiSelect label="English" options={englishLevels} selected={filterEnglish} onChange={setFilterEnglish} testId="filter-english" />
          <MultiSelect label="OEM Experience" options={allOems} selected={filterOem} onChange={setFilterOem} testId="filter-oem" />
          <MultiSelect label="Assigned" options={assignedOptions} selected={filterAssigned} onChange={setFilterAssigned} testId="filter-assigned" />

          {/* Result count */}
          <div className="ml-auto text-[13px]" style={{ color: "var(--pfg-steel)" }}>
            <strong className="text-pfg-navy">{sorted.length}</strong> of {workers.length}
          </div>
        </div>
      </div>

      {/* Table */}
      <div
        className="rounded-xl border overflow-hidden"
        style={{ background: "hsl(var(--card))", borderColor: "hsl(var(--card-border))", boxShadow: "var(--shadow-sm)" }}
      >
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]" style={{ borderCollapse: "collapse" }}>
            <thead>
              <tr>
                {([
                  ["name", "Name"],
                  ["role", "Role"],
                  ["status", "Status"],
                  ["nationality", "Nationality"],
                  ["englishLevel", "English"],
                  ["techLevel", "Tech Level"],
                  ["measuringSkills", "Measuring"],
                ] as [SortKey, string][]).map(([key, label]) => (
                  <th
                    key={key}
                    onClick={() => handleSort(key)}
                    className="text-left px-2.5 py-2.5 text-[11px] font-semibold uppercase tracking-wide cursor-pointer select-none whitespace-nowrap"
                    style={{ background: "hsl(var(--muted))", color: "hsl(var(--muted-foreground))", borderBottom: "1px solid hsl(var(--border))" }}
                    data-testid={`sort-${key}`}
                  >
                    {label}
                    <SortIcon col={key} />
                  </th>
                ))}
                <th
                  className="text-left px-2.5 py-2.5 text-[11px] font-semibold uppercase tracking-wide whitespace-nowrap"
                  style={{ background: "hsl(var(--muted))", color: "hsl(var(--muted-foreground))", borderBottom: "1px solid hsl(var(--border))" }}
                >
                  OEM Experience
                </th>
                <th
                  onClick={() => handleSort("utilisation")}
                  className="text-left px-2.5 py-2.5 text-[11px] font-semibold uppercase tracking-wide cursor-pointer select-none whitespace-nowrap"
                  style={{ background: "hsl(var(--muted))", color: "hsl(var(--muted-foreground))", borderBottom: "1px solid hsl(var(--border))" }}
                  data-testid="sort-utilisation"
                >
                  Utilisation
                  <SortIcon col={"utilisation"} />
                </th>
                <th
                  className="text-left px-2.5 py-2.5 text-[11px] font-semibold uppercase tracking-wide whitespace-nowrap"
                  style={{ background: "hsl(var(--muted))", color: "hsl(var(--muted-foreground))", borderBottom: "1px solid hsl(var(--border))" }}
                >
                  Current Assignment
                </th>
                <th
                  className="text-left px-2.5 py-2.5 text-[11px] font-semibold uppercase tracking-wide whitespace-nowrap"
                  style={{ background: "hsl(var(--muted))", color: "hsl(var(--muted-foreground))", borderBottom: "1px solid hsl(var(--border))" }}
                >
                  Shift
                </th>
              </tr>
            </thead>
            <tbody>
              {sorted.length === 0 ? (
                <tr>
                  <td colSpan={12} className="text-center py-16" style={{ color: "hsl(var(--muted-foreground))" }}>
                    <Search className="w-8 h-8 mx-auto mb-2 opacity-40" />
                    <h3 className="text-base font-semibold mb-1" style={{ color: "var(--pfg-navy)" }}>No results found</h3>
                    <p className="text-xs">Try adjusting your filters</p>
                  </td>
                </tr>
              ) : (
                sorted.map((w) => {
                  const isExpanded = expandedId === w.id;
                  const activeAssignment = w.assignments.find((a) => a.status === "active");
                  return (
                    <Fragment key={w.id}>
                      <tr
                        data-testid={`worker-row-${w.id}`}
                        onClick={() => setExpandedId(isExpanded ? null : w.id)}
                        className="cursor-pointer transition-colors"
                        style={{
                          borderBottom: isExpanded ? "none" : "1px solid hsl(var(--border))",
                          background: isExpanded ? "hsl(var(--accent))" : undefined,
                        }}
                        onMouseEnter={(e) => { if (!isExpanded) (e.currentTarget.style.background = "hsl(var(--accent))") }}
                        onMouseLeave={(e) => { if (!isExpanded) (e.currentTarget.style.background = "") }}
                      >
                        <td className="px-2.5 py-2.5 font-semibold whitespace-nowrap text-pfg-navy">{w.name}</td>
                        <td className="px-2.5 py-2.5">{w.role}</td>
                        <td className="px-2.5 py-2.5"><StatusBadge status={w.status} /></td>
                        <td className="px-2.5 py-2.5">{w.nationality || "—"}</td>
                        <td className="px-2.5 py-2.5"><EnglishBadge level={w.englishLevel} /></td>
                        <td className="px-2.5 py-2.5"><TechBadge level={w.techLevel} /></td>
                        <td className="px-2.5 py-2.5">{w.measuringSkills || "—"}</td>
                        <td className="px-2.5 py-2.5">
                          <div className="flex flex-wrap gap-1">
                            {w.oemExperience.length > 0 ? (
                              w.oemExperience.map((oem, i) => <OemPill key={oem} oem={oem} index={i} />)
                            ) : (
                              <span className="text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>—</span>
                            )}
                          </div>
                        </td>
                        <td className="px-2.5 py-2.5"><UtilBar assignments={w.assignments} /></td>
                        <td className="px-2.5 py-2.5 whitespace-nowrap">
                          {activeAssignment ? (
                            <span className="text-xs font-medium">{activeAssignment.projectCode} — {activeAssignment.projectName}</span>
                          ) : (
                            <span className="badge badge-green">Available</span>
                          )}
                        </td>
                        <td className="px-2.5 py-2.5">
                          {activeAssignment?.shift ? (
                            <span className={`badge ${activeAssignment.shift === "Night" ? "badge-navy" : "badge-accent"}`}>
                              {activeAssignment.shift}
                            </span>
                          ) : (
                            <span className="text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>—</span>
                          )}
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr>
                          <td colSpan={12} className="p-0">
                            <WorkerDetail worker={w} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

