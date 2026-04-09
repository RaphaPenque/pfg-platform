import { useState, useMemo, useRef, useEffect, Fragment } from "react";
import { useAuth } from "@/context/AuthContext";
import { useDashboardData, type DashboardWorker, type DashboardAssignment } from "@/hooks/use-dashboard-data";
import { OEM_BRAND_COLORS, CERT_DEFS, calcUtilisation, PROJECT_ROLES, COST_CENTRES, ENGLISH_LEVELS, ROLE_HIERARCHY, getHighestRole, EQUIPMENT_TYPES, OEM_OPTIONS, cleanName } from "@/lib/constants";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Search, ChevronDown, ChevronUp, Info, Upload, Download, ArrowUpDown, Pencil, Plus, X, Check, Loader2, User, FileText, Trash2 } from "lucide-react";
import { downloadCSV } from "@/lib/csv-export";
import { downloadSqepPdf } from "@/lib/sqep-pdf";

// ─── Helpers ───
const inputCls = "px-3 py-2 text-[13px] rounded-lg border focus:outline-none focus:border-[var(--pfg-yellow)] focus:shadow-[0_0_0_3px_rgba(245,189,0,0.15)]";
const inputStyle: React.CSSProperties = { borderColor: "hsl(var(--border))", background: "hsl(var(--card))" };

function parseRoles(worker: DashboardWorker): string[] {
  if (worker.roles) {
    try { return JSON.parse(worker.roles); } catch { /* fallback */ }
  }
  return worker.role ? [worker.role] : [];
}

function calcAge(dob: string | null): string {
  if (!dob) return "—";
  const birth = new Date(dob);
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const m = today.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
  return String(age);
}

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
  label, options, selected, onChange, testId,
}: {
  label: string; options: string[]; selected: string[]; onChange: (v: string[]) => void; testId: string;
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
    onChange(selected.includes(val) ? selected.filter((s) => s !== val) : [...selected, val]);
  };

  const display = selected.length === 0 ? `All ${label}` : selected.length === 1 ? selected[0] : `${selected.length} selected`;

  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: "hsl(var(--muted-foreground))" }}>{label}</span>
      <div className="relative" ref={ref}>
        <button type="button" data-testid={testId} onClick={() => setOpen(!open)}
          className="flex items-center gap-1 text-[13px] min-w-[130px] px-2.5 py-2 rounded-lg border cursor-pointer truncate"
          style={{ borderColor: open ? "var(--pfg-yellow)" : "hsl(var(--border))", boxShadow: open ? "0 0 0 3px rgba(245,189,0,0.15)" : "none", background: "hsl(var(--card))" }}>
          <span className="truncate flex-1 text-left">{display}</span>
          <ChevronDown className="w-3.5 h-3.5 shrink-0" style={{ color: "hsl(var(--muted-foreground))" }} />
        </button>
        {open && (
          <div className="absolute top-full mt-1 left-0 z-50 min-w-[200px] max-h-60 overflow-y-auto rounded-lg border p-1"
            style={{ background: "hsl(var(--card))", borderColor: "hsl(var(--border))", boxShadow: "var(--shadow-md)" }}>
            {options.map((opt) => (
              <label key={opt} className="flex items-center gap-2 px-3 py-1.5 text-[13px] cursor-pointer rounded hover:bg-black/5">
                <input type="checkbox" checked={selected.includes(opt)} onChange={() => toggle(opt)} className="accent-[var(--pfg-yellow)]" />
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
  { bg: "#DBEAFE", text: "#1D4ED8" }, { bg: "#D1FAE5", text: "#065F46" }, { bg: "#FEF3C7", text: "#92400E" },
  { bg: "#FCE7F3", text: "#9D174D" }, { bg: "#EDE9FE", text: "#5B21B6" }, { bg: "#FEE2E2", text: "#991B1B" },
  { bg: "#E0F2FE", text: "#075985" }, { bg: "#F0FDF4", text: "#14532D" }, { bg: "#FFF7ED", text: "#9A3412" },
  { bg: "#FAF5FF", text: "#6B21A8" }, { bg: "#F1F5F9", text: "#334155" }, { bg: "#ECFDF5", text: "#047857" },
];

function OemPill({ oem, index }: { oem: string; index: number }) {
  const c = OEM_PILL_COLORS[index % OEM_PILL_COLORS.length];
  return <span className="oem-pill" style={{ background: c.bg, color: c.text }}>{oem}</span>;
}

function StatusBadge({ status }: { status: string }) {
  const cls = status === "FTE" ? "badge-navy" : "badge-grey";
  return <span className={`badge ${cls}`}>{status}</span>;
}

function EnglishBadge({ level }: { level: string | null }) {
  if (!level) return <span className="text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>—</span>;
  const l = level.toUpperCase();
  const cls = l >= "B2" ? "badge-green" : l >= "B1" ? "badge-amber" : l === "TBC" ? "badge-grey" : "badge-amber";
  return <span className={`badge ${cls}`}>{level}</span>;
}

// ─── Score bar ───
function ScoreBar({ label, value, max }: { label: string; value: number | null; max?: number }) {
  const v = value ?? 0;
  const m = max ?? 5;
  const color = v >= 4 ? "var(--green)" : v >= 3 ? "var(--amber)" : "var(--red)";
  return (
    <div className="flex items-center gap-2">
      <span className="text-[11px] w-24 text-right" style={{ color: "var(--pfg-steel)" }}>{label}</span>
      <div className="w-16 h-1.5 rounded-full overflow-hidden" style={{ background: "hsl(var(--muted))" }}>
        <div className="h-full rounded-full" style={{ width: `${Math.min((v / m) * 100, 100)}%`, background: color }} />
      </div>
      <span className="text-xs font-semibold tabular-nums" style={{ minWidth: 20 }}>{v > 0 ? v.toFixed(1) : "—"}</span>
    </div>
  );
}

// ─── Modal overlay ───
function ModalOverlay({ children, onClose, testId, wide }: { children: React.ReactNode; onClose: () => void; testId: string; wide?: boolean }) {
  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center"
      style={{ background: "rgba(27,42,74,0.5)", backdropFilter: "blur(2px)" }}
      onClick={onClose} data-testid={testId}>
      <div className={`rounded-xl overflow-hidden ${wide ? 'w-[1050px]' : 'w-[900px]'} max-w-[95vw] max-h-[90vh] flex flex-col`}
        style={{ background: "hsl(var(--card))", boxShadow: "0 20px 60px rgba(27,42,74,0.3)" }}
        onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}

function FormGroup({ label, children, full }: { label: string; children: React.ReactNode; full?: boolean }) {
  return (
    <div className={`flex flex-col gap-1 ${full ? "col-span-2" : ""}`}>
      <label className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--pfg-steel)" }}>{label}</label>
      {children}
    </div>
  );
}

// ─── File upload drop zone ───
function FileDropZone({ label, onFile, currentFile, accept, testId }: {
  label: string; onFile: (f: File) => void; currentFile?: string | null; accept?: string; testId: string;
}) {
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files.length > 0) onFile(e.dataTransfer.files[0]);
  };

  return (
    <div
      className="border-2 border-dashed rounded-lg p-4 text-center cursor-pointer transition-colors"
      style={{
        borderColor: dragOver ? "var(--pfg-yellow)" : "hsl(var(--border))",
        background: dragOver ? "rgba(245,189,0,0.05)" : "hsl(var(--background))",
      }}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
      onClick={() => fileRef.current?.click()}
      data-testid={testId}
    >
      <input ref={fileRef} type="file" className="hidden" accept={accept}
        onChange={(e) => { if (e.target.files?.[0]) onFile(e.target.files[0]); }} />
      <Upload className="w-5 h-5 mx-auto mb-1" style={{ color: "hsl(var(--muted-foreground))" }} />
      <div className="text-xs font-medium" style={{ color: "hsl(var(--muted-foreground))" }}>
        {currentFile ? "File selected — click to replace" : `Drop ${label} here or click to upload`}
      </div>
      {currentFile && (
        <div className="text-[11px] mt-1 font-semibold" style={{ color: "var(--green)" }}>Uploaded</div>
      )}
    </div>
  );
}

// ─── Cert status dot logic ───
function getCertStatus(certDef: typeof CERT_DEFS[0], uploaded: boolean, expiryDate?: string | null): { color: string; label: string } {
  if (certDef.name === "Trade Diploma") {
    // Trade Diploma always green if we reach here with uploaded, show "Work Experience" alternative handled elsewhere
    return uploaded ? { color: "var(--green)", label: "Valid" } : { color: "var(--green)", label: "Work Experience" };
  }
  if (!uploaded) return { color: "var(--red)", label: "Not uploaded" };
  if (!expiryDate) return { color: "var(--green)", label: "Uploaded" };
  const now = new Date();
  const expiry = new Date(expiryDate);
  if (expiry < now) return { color: "var(--red)", label: "Expired" };
  const fourMonths = new Date();
  fourMonths.setMonth(fourMonths.getMonth() + 4);
  if (expiry < fourMonths) return { color: "var(--amber)", label: "Expiring" };
  return { color: "var(--green)", label: "Valid" };
}

// ───────────────────────────────────────────────────────────────
// ADD WORKER MODAL
// ───────────────────────────────────────────────────────────────
function AddWorkerModal({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState("");
  const [role, setRole] = useState(PROJECT_ROLES[3]); // Technician 2
  const [status, setStatus] = useState("FTE");
  const [costCentre, setCostCentre] = useState("");
  const [nationality, setNationality] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    if (!name.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await apiRequest("POST", "/api/workers", {
        name: name.trim(),
        role,
        status,
        costCentre: status === "FTE" ? costCentre || null : null,
        nationality: nationality.trim() || null,
        roles: JSON.stringify([role]),
      });
      await queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
      onClose();
    } catch (e: any) {
      setError(e.message || "Failed to create worker");
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalOverlay onClose={onClose} testId="add-worker-modal">
      <div className="px-6 py-5 flex items-center justify-between border-b" style={{ borderColor: "hsl(var(--border))" }}>
        <h2 className="font-display text-lg font-bold text-pfg-navy">Add New Worker</h2>
        <button onClick={onClose} className="p-1 hover:bg-black/5 rounded" data-testid="add-worker-close"><X className="w-5 h-5" style={{ color: "var(--pfg-steel)" }} /></button>
      </div>
      <div className="p-6">
        <div className="grid grid-cols-2 gap-4">
          <FormGroup label="Full Name *">
            <input className={inputCls} style={inputStyle} value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" data-testid="input-worker-name" />
          </FormGroup>
          <FormGroup label="Primary Role *">
            <select className={inputCls} style={inputStyle} value={role} onChange={(e) => setRole(e.target.value)} data-testid="input-worker-role">
              {PROJECT_ROLES.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </FormGroup>
          <FormGroup label="Status *">
            <select className={inputCls} style={inputStyle} value={status} onChange={(e) => setStatus(e.target.value)} data-testid="input-worker-status">
              <option value="FTE">FTE</option>
              <option value="Temp">Temp</option>
            </select>
          </FormGroup>
          {status === "FTE" && (
            <FormGroup label="Cost Centre">
              <select className={inputCls} style={inputStyle} value={costCentre} onChange={(e) => setCostCentre(e.target.value)} data-testid="input-worker-cost-centre">
                <option value="">Select...</option>
                {COST_CENTRES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </FormGroup>
          )}
          <FormGroup label="Nationality">
            <input className={inputCls} style={inputStyle} value={nationality} onChange={(e) => setNationality(e.target.value)} placeholder="e.g. Irish" data-testid="input-worker-nationality" />
          </FormGroup>
        </div>
        {error && <div className="mt-3 text-sm text-red-600">{error}</div>}
      </div>
      <div className="px-6 py-4 flex items-center justify-end gap-3 border-t" style={{ borderColor: "hsl(var(--border))" }}>
        <button onClick={onClose} className="text-sm font-medium px-4 py-2 rounded-lg" style={{ color: "var(--pfg-steel)" }} data-testid="add-worker-cancel">Cancel</button>
        <button onClick={handleSave} disabled={!name.trim() || saving}
          className="text-sm font-bold px-5 py-2 rounded-lg disabled:opacity-40"
          style={{ background: "var(--pfg-yellow)", color: "var(--pfg-navy)" }}
          data-testid="add-worker-save">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : "Add Worker"}
        </button>
      </div>
    </ModalOverlay>
  );
}

// ───────────────────────────────────────────────────────────────
// EDIT WIZARD MODAL (4 steps)
// ───────────────────────────────────────────────────────────────

interface ManualExperience {
  id: number;
  siteName: string;
  startDate: string;
  endDate: string;
  role: string;
  oem: string;
  equipment: string;
  scope: string;
}

function EditWizardModal({ worker, onClose }: { worker: DashboardWorker; onClose: () => void }) {
  const [step, setStep] = useState(1);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Step 1: Profile
  const [name, setName] = useState(worker.name);
  const [selectedRoles, setSelectedRoles] = useState<string[]>(parseRoles(worker));
  const [dob, setDob] = useState(worker.dateOfBirth || "");
  const [status, setStatus] = useState(worker.status);
  const [costCentre, setCostCentre] = useState(worker.costCentre || "");
  const [englishLevel, setEnglishLevel] = useState(worker.englishLevel || "");
  const [joined, setJoined] = useState(worker.joined || "");
  const [nationality, setNationality] = useState(worker.nationality || "");
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [passportFile, setPassportFile] = useState<File | null>(null);
  const [hasExistingPhoto] = useState(!!worker.profilePhotoPath);
  const [hasExistingPassport] = useState(!!worker.passportPath);
  // Contact info
  const [personalEmail, setPersonalEmail] = useState(worker.personalEmail || "");
  const [workEmail, setWorkEmail] = useState(worker.workEmail || "");
  const [phone, setPhone] = useState(worker.phone || "");
  const [phoneSecondary, setPhoneSecondary] = useState(worker.phoneSecondary || "");
  const [address, setAddress] = useState(worker.address || "");
  // Field kit / logistics
  const [coverallSize, setCoverallSize] = useState(worker.coverallSize || "");
  const [bootSize, setBootSize] = useState(worker.bootSize || "");
  const [localAirport, setLocalAirport] = useState(worker.localAirport || "");

  // Step 2: Certs
  const [certData, setCertData] = useState<Record<string, { completionDate: string; validityDate: string; file: File | null; uploaded: boolean }>>(() => {
    const init: Record<string, { completionDate: string; validityDate: string; file: File | null; uploaded: boolean }> = {};
    // Pre-populate from worker's existing documents
    const existingDocs: Record<string, any> = {};
    if ((worker as any).documents) {
      for (const doc of (worker as any).documents) {
        existingDocs[doc.type] = doc;
      }
    }
    CERT_DEFS.forEach(cert => {
      const certType = "cert_" + cert.name.toLowerCase().replace(/[^a-z0-9]/g, "_");
      const existing = existingDocs[certType];
      init[cert.name] = {
        completionDate: existing?.issuedDate || "",
        validityDate: existing?.expiryDate || "",
        file: null,
        uploaded: !!existing?.filePath,
      };
    });
    return init;
  });

  // Step 3: Work experience
  const [manualExp, setManualExp] = useState<ManualExperience[]>([]);
  const [nextExpId, setNextExpId] = useState(1);

  // Step 4: Review
  const [experienceScore, setExperienceScore] = useState(worker.experienceScore ?? 0);
  const [technicalScore, setTechnicalScore] = useState(worker.technicalScore ?? 0);
  const [attitudeScore, setAttitudeScore] = useState(worker.attitudeScore ?? 0);
  const [measuringSkills, setMeasuringSkills] = useState(worker.measuringSkills || "TBC");
  const [comments, setComments] = useState(worker.comments || "");

  // Driver's license
  const [driversLicense, setDriversLicense] = useState(worker.driversLicense || "");
  const [dlFile, setDlFile] = useState<File | null>(null);
  const [dlUploaded] = useState(!!worker.driversLicenseUploaded);

  // Role multi-select toggle
  const toggleRole = (role: string) => {
    setSelectedRoles(prev => prev.includes(role) ? prev.filter(r => r !== role) : [...prev, role]);
  };

  // Historical assignments (startDate <= today)
  const today = new Date().toISOString().split("T")[0];
  const historicalAssignments = worker.assignments.filter(a => a.startDate && a.startDate <= today);

  const addManualExp = () => {
    setManualExp(prev => [...prev, {
      id: nextExpId, siteName: "", startDate: "", endDate: "", role: "", oem: "", equipment: "", scope: "",
    }]);
    setNextExpId(n => n + 1);
  };

  const updateManualExp = (id: number, field: keyof ManualExperience, value: string) => {
    setManualExp(prev => prev.map(e => e.id === id ? { ...e, [field]: value } : e));
  };

  const removeManualExp = (id: number) => {
    setManualExp(prev => prev.filter(e => e.id !== id));
  };

  // Upload helper
  async function uploadFile(file: File, type: string) {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("type", type);
    const API_BASE = "__PORT_5000__".startsWith("__") ? "" : "__PORT_5000__";
    const res = await fetch(`${API_BASE}/api/workers/${worker.id}/upload`, {
      method: "POST",
      body: formData,
    });
    if (!res.ok) throw new Error("Upload failed");
    return res.json();
  }

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      // Upload files first
      if (photoFile) await uploadFile(photoFile, "photo");
      if (passportFile) await uploadFile(passportFile, "passport");
      if (dlFile) await uploadFile(dlFile, "drivers_license");

      // Upload cert files and save cert dates
      for (const certName of Object.keys(certData)) {
        const cd = certData[certName];
        const certType = "cert_" + certName.toLowerCase().replace(/[^a-z0-9]/g, "_");
        // Only save if there's a file, or dates were entered
        if (cd.file || cd.completionDate || cd.validityDate || cd.uploaded) {
          if (cd.file) await uploadFile(cd.file, certType);
          // Save/update the document record with dates
          await apiRequest("PUT", `/api/workers/${worker.id}/documents`, {
            type: certType,
            name: certName,
            issuedDate: cd.completionDate || null,
            expiryDate: cd.validityDate || null,
          });
        }
      }

      // Build the primary role from highest of selected
      const primaryRole = selectedRoles.length > 0 ? getHighestRole(selectedRoles) : worker.role;

      // PATCH worker
      await apiRequest("PATCH", `/api/workers/${worker.id}`, {
        name: name.trim() || worker.name,
        role: primaryRole,
        roles: JSON.stringify(selectedRoles),
        status,
        costCentre: status === "FTE" ? costCentre || null : null,
        dateOfBirth: dob || null,
        age: dob ? calcAge(dob) : worker.age,
        joined: joined || null,
        englishLevel: englishLevel || null,
        nationality: nationality || null,
        experienceScore,
        technicalScore,
        attitudeScore,
        measuringSkills: measuringSkills || null,
        comments: comments || null,
        driversLicense: driversLicense || null,
        driversLicenseUploaded: (dlFile || dlUploaded) ? 1 : 0,
        personalEmail: personalEmail || null,
        workEmail: workEmail || null,
        phone: phone || null,
        phoneSecondary: phoneSecondary || null,
        address: address || null,
        coverallSize: coverallSize || null,
        bootSize: bootSize || null,
        localAirport: localAirport || null,
      });

      await queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
      onClose();
    } catch (e: any) {
      setError(e.message || "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const stepLabels = ["Profile", "Qualifications & Certificates", "Work Experience", "Review"];

  return (
    <ModalOverlay onClose={onClose} testId="edit-wizard-modal" wide>
      {/* Header */}
      <div className="px-6 py-4 flex items-center justify-between border-b" style={{ borderColor: "hsl(var(--border))" }}>
        <h2 className="font-display text-lg font-bold text-pfg-navy">Edit Worker — {cleanName(worker.name)}</h2>
        <button onClick={onClose} className="p-1 hover:bg-black/5 rounded" data-testid="edit-wizard-close"><X className="w-5 h-5" style={{ color: "var(--pfg-steel)" }} /></button>
      </div>

      {/* Step indicator */}
      <div className="flex gap-0">
        {stepLabels.map((label, i) => {
          const n = i + 1;
          const isActive = step === n;
          const isDone = step > n;
          return (
            <div key={n} className="flex-1 text-center py-2.5 text-xs font-semibold border-b-[3px]"
              style={{
                color: isDone ? "var(--green)" : isActive ? "#8B6E00" : "hsl(var(--muted-foreground))",
                borderColor: isDone ? "var(--green)" : isActive ? "var(--pfg-yellow)" : "hsl(var(--border))",
                background: isDone ? "var(--green-bg)" : isActive ? "hsl(var(--accent))" : "hsl(var(--muted))",
              }}>
              <span className="inline-flex items-center justify-center w-5 h-5 rounded-full text-[11px] font-bold mr-1.5"
                style={{
                  background: isDone ? "var(--green)" : isActive ? "var(--pfg-yellow)" : "hsl(var(--border))",
                  color: isDone ? "#fff" : isActive ? "var(--pfg-navy)" : "hsl(var(--muted-foreground))",
                }}>
                {isDone ? "✓" : n}
              </span>
              {label}
            </div>
          );
        })}
      </div>

      {/* Body */}
      <div className="p-6 overflow-y-auto flex-1" style={{ maxHeight: "60vh" }}>
        {/* STEP 1: Profile */}
        {step === 1 && (
          <div className="grid grid-cols-2 gap-4">
            <FormGroup label="Full Name *">
              <input className={inputCls} style={inputStyle} value={name} onChange={(e) => setName(e.target.value)} data-testid="edit-name" />
            </FormGroup>
            <FormGroup label="Status">
              <select className={inputCls} style={inputStyle} value={status} onChange={(e) => setStatus(e.target.value)} data-testid="edit-status">
                <option value="FTE">FTE</option>
                <option value="Temp">Temp</option>
              </select>
            </FormGroup>

            {status === "FTE" ? (
              <FormGroup label="Cost Centre">
                <select className={inputCls} style={inputStyle} value={costCentre} onChange={(e) => setCostCentre(e.target.value)} data-testid="edit-cost-centre">
                  <option value="">Select...</option>
                  {COST_CENTRES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </FormGroup>
            ) : (
              <FormGroup label="Nationality">
                <input className={inputCls} style={inputStyle} value={nationality} onChange={(e) => setNationality(e.target.value)} data-testid="edit-nationality" />
              </FormGroup>
            )}

            {status === "FTE" && (
              <FormGroup label="Nationality">
                <input className={inputCls} style={inputStyle} value={nationality} onChange={(e) => setNationality(e.target.value)} data-testid="edit-nationality" />
              </FormGroup>
            )}

            <FormGroup label="Job Title (Multi-select)" full>
              <div className="flex flex-wrap gap-1.5 p-2 rounded-lg border min-h-[40px]" style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--background))" }}>
                {PROJECT_ROLES.map(r => (
                  <button key={r} type="button" onClick={() => toggleRole(r)}
                    className="text-xs px-2.5 py-1 rounded-full font-medium transition-colors"
                    style={{
                      background: selectedRoles.includes(r) ? "var(--pfg-yellow)" : "hsl(var(--muted))",
                      color: selectedRoles.includes(r) ? "var(--pfg-navy)" : "hsl(var(--muted-foreground))",
                    }}
                    data-testid={`edit-role-${r.replace(/\s+/g, "-")}`}>
                    {r}
                  </button>
                ))}
              </div>
            </FormGroup>

            <FormGroup label="Date of Birth">
              <input type="date" className={inputCls} style={inputStyle} value={dob} onChange={(e) => setDob(e.target.value)} data-testid="edit-dob" />
            </FormGroup>

            <FormGroup label="English Proficiency">
              <select className={inputCls} style={inputStyle} value={englishLevel} onChange={(e) => setEnglishLevel(e.target.value)} data-testid="edit-english">
                <option value="">Select...</option>
                {ENGLISH_LEVELS.map(l => <option key={l} value={l}>{l}</option>)}
              </select>
            </FormGroup>
            <FormGroup label="Date Joined">
              <input type="date" className={inputCls} style={inputStyle} value={joined} onChange={(e) => setJoined(e.target.value)} data-testid="edit-joined" />
            </FormGroup>

            <FormGroup label="Passport Copy">
              <FileDropZone label="passport" onFile={setPassportFile} currentFile={passportFile?.name || (hasExistingPassport ? "existing" : null)} accept=".pdf,.jpg,.jpeg,.png" testId="edit-passport-upload" />
            </FormGroup>
            <FormGroup label="Profile Photo">
              <FileDropZone label="photo" onFile={setPhotoFile} currentFile={photoFile?.name || (hasExistingPhoto ? "existing" : null)} accept=".jpg,.jpeg,.png" testId="edit-photo-upload" />
            </FormGroup>

            {/* Contact Information */}
            <div className="col-span-2 mt-2 mb-1">
              <div className="text-[11px] font-bold uppercase tracking-wide" style={{ color: "var(--pfg-steel)" }}>Contact Information</div>
              <div className="border-b mt-1" style={{ borderColor: "hsl(var(--border))" }} />
            </div>
            <FormGroup label="Personal Email">
              <input type="email" className={inputCls} style={inputStyle} value={personalEmail} onChange={(e) => setPersonalEmail(e.target.value)} placeholder="personal@email.com" data-testid="edit-personal-email" />
            </FormGroup>
            <FormGroup label="Work Email">
              <input type="email" className={inputCls} style={inputStyle} value={workEmail} onChange={(e) => setWorkEmail(e.target.value)} placeholder="name@powerforce.global" data-testid="edit-work-email" />
            </FormGroup>
            <FormGroup label="Phone (Primary)">
              <input type="tel" className={inputCls} style={inputStyle} value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+44 7700 900000" data-testid="edit-phone" />
            </FormGroup>
            <FormGroup label="Phone (Secondary)">
              <input type="tel" className={inputCls} style={inputStyle} value={phoneSecondary} onChange={(e) => setPhoneSecondary(e.target.value)} placeholder="+44 7700 900001" data-testid="edit-phone-secondary" />
            </FormGroup>
            <FormGroup label="Address" full>
              <input className={inputCls} style={inputStyle} value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Home address" data-testid="edit-address" />
            </FormGroup>

            {/* Field Kit & Logistics */}
            <div className="col-span-2 mt-2 mb-1">
              <div className="text-[11px] font-bold uppercase tracking-wide" style={{ color: "var(--pfg-steel)" }}>Field Kit &amp; Logistics</div>
              <div className="border-b mt-1" style={{ borderColor: "hsl(var(--border))" }} />
            </div>
            <FormGroup label="Coverall Size">
              <select className={inputCls} style={inputStyle} value={coverallSize} onChange={(e) => setCoverallSize(e.target.value)} data-testid="edit-coverall-size">
                <option value="">Select...</option>
                {["XS", "S", "M", "L", "XL", "XXL", "XXXL"].map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </FormGroup>
            <FormGroup label="Boot Size (EU)">
              <input className={inputCls} style={inputStyle} value={bootSize} onChange={(e) => setBootSize(e.target.value)} placeholder="42" data-testid="edit-boot-size" />
            </FormGroup>
            <FormGroup label="Local Airport">
              <input className={inputCls} style={inputStyle} value={localAirport} onChange={(e) => setLocalAirport(e.target.value)} placeholder="e.g. LHR, MAD, LIS, OPO" data-testid="edit-local-airport" />
            </FormGroup>
          </div>
        )}

        {/* STEP 2: Qualifications & Certificates */}
        {step === 2 && (
          <div className="rounded-lg border overflow-hidden" style={{ background: "hsl(var(--card))", borderColor: "hsl(var(--border))" }}>
            <table className="w-full text-[13px]">
              <thead>
                <tr style={{ background: "hsl(var(--muted))" }}>
                  <th className="text-left px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wide w-8" style={{ color: "hsl(var(--muted-foreground))" }}></th>
                  <th className="text-left px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wide" style={{ color: "hsl(var(--muted-foreground))" }}>Certificate</th>
                  <th className="text-left px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wide w-[140px]" style={{ color: "hsl(var(--muted-foreground))" }}>Completion Date</th>
                  <th className="text-left px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wide w-[140px]" style={{ color: "hsl(var(--muted-foreground))" }}>Expiry Date</th>
                  <th className="text-left px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wide w-[200px]" style={{ color: "hsl(var(--muted-foreground))" }}>Upload</th>
                  <th className="text-left px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wide w-[100px]" style={{ color: "hsl(var(--muted-foreground))" }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {CERT_DEFS.map((cert) => {
                  const cd = certData[cert.name];
                  const isUploaded = cd.uploaded || !!cd.file;
                  const status = getCertStatus(cert, isUploaded, cd.validityDate);
                  const isDriversLicense = cert.name === "Driver's License";

                  return (
                    <tr key={cert.name} className="border-t" style={{ borderColor: "hsl(var(--border))" }}>
                      <td className="px-4 py-2.5">
                        <span style={{ color: status.color, fontSize: 14 }}>{isUploaded || (cert as any).alwaysGreen ? "●" : "○"}</span>
                      </td>
                      <td className="px-4 py-2.5 font-medium">
                        {cert.name}
                        {(cert as any).noTradeAlt && !isUploaded && (
                          <span className="italic text-xs ml-1" style={{ color: "hsl(var(--muted-foreground))" }}>/ {(cert as any).noTradeAlt}</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5">
                        <input type="date" value={isDriversLicense ? "" : cd.completionDate}
                          onChange={(e) => {
                            if (isDriversLicense) return;
                            setCertData(prev => ({ ...prev, [cert.name]: { ...prev[cert.name], completionDate: e.target.value } }));
                          }}
                          disabled={isDriversLicense}
                          className="text-xs px-2 py-1 border rounded w-full disabled:opacity-40"
                          style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--background))" }}
                          data-testid={`cert-completion-${cert.name}`} />
                      </td>
                      <td className="px-4 py-2.5">
                        {(cert as any).completionOnly ? (
                          <span className="text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>N/A</span>
                        ) : isDriversLicense ? (
                          <input type="date" value={driversLicense}
                            onChange={(e) => setDriversLicense(e.target.value)}
                            className="text-xs px-2 py-1 border rounded w-full"
                            style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--background))" }}
                            data-testid="cert-validity-drivers-license" />
                        ) : (
                          <input type="date" value={cd.validityDate}
                            onChange={(e) => setCertData(prev => ({ ...prev, [cert.name]: { ...prev[cert.name], validityDate: e.target.value } }))}
                            className="text-xs px-2 py-1 border rounded w-full"
                            style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--background))" }}
                            data-testid={`cert-validity-${cert.name}`} />
                        )}
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="border border-dashed rounded p-2 text-center cursor-pointer" style={{ borderColor: "hsl(var(--border))" }}
                          onClick={() => {
                            const input = document.createElement("input");
                            input.type = "file";
                            input.accept = ".pdf,.jpg,.jpeg,.png";
                            input.onchange = () => {
                              if (input.files?.[0]) {
                                if (isDriversLicense) {
                                  setDlFile(input.files[0]);
                                }
                                setCertData(prev => ({ ...prev, [cert.name]: { ...prev[cert.name], file: input.files![0], uploaded: true } }));
                              }
                            };
                            input.click();
                          }}
                          data-testid={`cert-upload-${cert.name}`}>
                          <Upload className="w-3.5 h-3.5 mx-auto" style={{ color: "hsl(var(--muted-foreground))" }} />
                          <span className="text-[10px]" style={{ color: "hsl(var(--muted-foreground))" }}>
                            {cd.file ? cd.file.name : "Click to upload"}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-2.5">
                        <span className="text-xs font-semibold" style={{ color: status.color }}>{status.label}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* STEP 3: Work Experience */}
        {step === 3 && (
          <div>
            <div className="text-sm font-bold text-pfg-navy font-display mb-3">Work History</div>
            <div className="rounded-lg border overflow-hidden mb-4" style={{ background: "hsl(var(--card))", borderColor: "hsl(var(--border))" }}>
              <table className="w-full text-[12px]">
                <thead>
                  <tr style={{ background: "hsl(var(--muted))" }}>
                    {["Site / Project", "Start", "End", "Role", "OEM", "Equipment", "Scope"].map(h => (
                      <th key={h} className="text-left px-3 py-2.5 text-[10px] font-semibold uppercase tracking-wide" style={{ color: "hsl(var(--muted-foreground))" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {historicalAssignments.length === 0 && manualExp.length === 0 ? (
                    <tr><td colSpan={7} className="px-4 py-6 text-center text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>No work experience recorded</td></tr>
                  ) : (
                    <>
                      {historicalAssignments.map(a => (
                        <tr key={a.id} className="border-t" style={{ borderColor: "hsl(var(--border))" }}>
                          <td className="px-3 py-2 font-medium">{a.projectName} ({a.projectCode})</td>
                          <td className="px-3 py-2 tabular-nums">{a.startDate || "—"}</td>
                          <td className="px-3 py-2 tabular-nums">{a.endDate || "—"}</td>
                          <td className="px-3 py-2">{a.role || a.task || worker.role}</td>
                          <td className="px-3 py-2">{a.customer || "—"}</td>
                          <td className="px-3 py-2">{a.equipmentType || "—"}</td>
                          <td className="px-3 py-2">{a.task || "—"}</td>
                        </tr>
                      ))}
                      {manualExp.map(exp => (
                        <tr key={`m-${exp.id}`} className="border-t" style={{ borderColor: "hsl(var(--border))", background: "rgba(245,189,0,0.03)" }}>
                          <td className="px-3 py-1.5">
                            <input className="text-xs px-2 py-1 border rounded w-full" style={inputStyle} value={exp.siteName} onChange={(e) => updateManualExp(exp.id, "siteName", e.target.value)} placeholder="Site name" data-testid={`exp-site-${exp.id}`} />
                          </td>
                          <td className="px-3 py-1.5">
                            <input type="date" className="text-xs px-1.5 py-1 border rounded w-full" style={inputStyle} value={exp.startDate} onChange={(e) => updateManualExp(exp.id, "startDate", e.target.value)} data-testid={`exp-start-${exp.id}`} />
                          </td>
                          <td className="px-3 py-1.5">
                            <input type="date" className="text-xs px-1.5 py-1 border rounded w-full" style={inputStyle} value={exp.endDate} onChange={(e) => updateManualExp(exp.id, "endDate", e.target.value)} data-testid={`exp-end-${exp.id}`} />
                          </td>
                          <td className="px-3 py-1.5">
                            <select className="text-xs px-1.5 py-1 border rounded w-full" style={inputStyle} value={exp.role} onChange={(e) => updateManualExp(exp.id, "role", e.target.value)} data-testid={`exp-role-${exp.id}`}>
                              <option value="">Select...</option>
                              {PROJECT_ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                            </select>
                          </td>
                          <td className="px-3 py-1.5">
                            <select className="text-xs px-1.5 py-1 border rounded w-full" style={inputStyle} value={exp.oem} onChange={(e) => updateManualExp(exp.id, "oem", e.target.value)} data-testid={`exp-oem-${exp.id}`}>
                              <option value="">Select...</option>
                              {OEM_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                            </select>
                          </td>
                          <td className="px-3 py-1.5">
                            <select className="text-xs px-1.5 py-1 border rounded w-full" style={inputStyle} value={exp.equipment} onChange={(e) => updateManualExp(exp.id, "equipment", e.target.value)} data-testid={`exp-equip-${exp.id}`}>
                              <option value="">Select...</option>
                              {EQUIPMENT_TYPES.map(et => <option key={et.value} value={et.value}>{et.label}</option>)}
                            </select>
                          </td>
                          <td className="px-3 py-1.5 flex items-center gap-1">
                            <input className="text-xs px-2 py-1 border rounded flex-1" style={inputStyle} value={exp.scope} onChange={(e) => updateManualExp(exp.id, "scope", e.target.value)} placeholder="Scope" data-testid={`exp-scope-${exp.id}`} />
                            <button onClick={() => removeManualExp(exp.id)} className="p-1 text-red-400 hover:text-red-600" data-testid={`exp-remove-${exp.id}`}>
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </>
                  )}
                </tbody>
              </table>
            </div>
            <button onClick={addManualExp} className="flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg border"
              style={{ borderColor: "var(--pfg-yellow)", color: "#8B6E00" }} data-testid="add-previous-experience">
              <Plus className="w-3.5 h-3.5" /> Add Previous Experience
            </button>
          </div>
        )}

        {/* STEP 4: Review */}
        {step === 4 && (
          <div className="grid grid-cols-2 gap-4">
            <FormGroup label="Experience (years)">
              <input type="number" min={0} max={50} step={0.5} className={inputCls} style={inputStyle}
                value={experienceScore} onChange={(e) => setExperienceScore(parseFloat(e.target.value) || 0)}
                data-testid="edit-experience-score" />
            </FormGroup>
            <FormGroup label="Technical Score (out of 5)">
              <input type="number" min={0} max={5} step={0.5} className={inputCls} style={inputStyle}
                value={technicalScore} onChange={(e) => setTechnicalScore(parseFloat(e.target.value) || 0)}
                data-testid="edit-technical-score" />
            </FormGroup>
            <FormGroup label="Attitude Score (out of 5)">
              <input type="number" min={0} max={5} step={0.5} className={inputCls} style={inputStyle}
                value={attitudeScore} onChange={(e) => setAttitudeScore(parseFloat(e.target.value) || 0)}
                data-testid="edit-attitude-score" />
            </FormGroup>
            <FormGroup label="Measuring Skills">
              <select className={inputCls} style={inputStyle} value={measuringSkills} onChange={(e) => setMeasuringSkills(e.target.value)} data-testid="edit-measuring">
                <option value="Yes">Yes</option>
                <option value="No">No</option>
                <option value="TBC">TBC</option>
              </select>
            </FormGroup>
            <FormGroup label="Comments" full>
              <textarea className={`${inputCls} resize-y min-h-[100px]`} style={inputStyle}
                value={comments} onChange={(e) => setComments(e.target.value)}
                placeholder="Free text summary of this worker..."
                data-testid="edit-comments" />
            </FormGroup>
          </div>
        )}

        {error && <div className="mt-3 text-sm text-red-600">{error}</div>}
      </div>

      {/* Footer */}
      <div className="px-6 py-4 flex items-center justify-between border-t" style={{ borderColor: "hsl(var(--border))" }}>
        <button onClick={() => step > 1 ? setStep(step - 1) : onClose()}
          className="text-sm font-medium px-4 py-2 rounded-lg" style={{ color: "var(--pfg-steel)" }}
          data-testid="edit-wizard-back">
          {step === 1 ? "Cancel" : "← Back"}
        </button>
        <div className="flex items-center gap-3">
          {step < 4 ? (
            <button onClick={() => setStep(step + 1)}
              className="text-sm font-bold px-5 py-2 rounded-lg"
              style={{ background: "var(--pfg-yellow)", color: "var(--pfg-navy)" }}
              data-testid="edit-wizard-next">
              Next →
            </button>
          ) : (
            <button onClick={handleSave} disabled={saving}
              className="text-sm font-bold px-5 py-2 rounded-lg disabled:opacity-50 flex items-center gap-2"
              style={{ background: "var(--pfg-yellow)", color: "var(--pfg-navy)" }}
              data-testid="edit-wizard-save">
              {saving ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving...</> : "Save Changes"}
            </button>
          )}
        </div>
      </div>
    </ModalOverlay>
  );
}

// ───────────────────────────────────────────────────────────────
// READ-ONLY CERTIFICATES TAB
// ───────────────────────────────────────────────────────────────
function CertificatesTab({ worker }: { worker: DashboardWorker }) {
  // Read-only view of certs
  return (
    <div className="rounded-lg border overflow-hidden" style={{ background: "hsl(var(--card))", borderColor: "hsl(var(--border))" }}>
      <table className="w-full text-[13px]">
        <thead>
          <tr style={{ background: "hsl(var(--muted))" }}>
            <th className="text-left px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wide w-8" style={{ color: "hsl(var(--muted-foreground))" }}></th>
            <th className="text-left px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wide" style={{ color: "hsl(var(--muted-foreground))" }}>Certificate</th>
            <th className="text-left px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wide w-[150px]" style={{ color: "hsl(var(--muted-foreground))" }}>Status</th>
          </tr>
        </thead>
        <tbody>
          {CERT_DEFS.map(cert => {
            // For now, show basic status. In production, this would read from documents.
            const isTrade = cert.name === "Trade Diploma";
            const statusInfo = isTrade
              ? { color: "var(--green)", label: "Valid" }
              : { color: "hsl(var(--muted-foreground))", label: "—" };

            return (
              <tr key={cert.name} className="border-t" style={{ borderColor: "hsl(var(--border))" }}>
                <td className="px-4 py-2.5">
                  <span style={{ color: statusInfo.color, fontSize: 14 }}>{isTrade ? "●" : "○"}</span>
                </td>
                <td className="px-4 py-2.5 font-medium">
                  {cert.name}
                  {(cert as any).noTradeAlt && (
                    <span className="italic text-xs ml-1" style={{ color: "hsl(var(--muted-foreground))" }}>/ {(cert as any).noTradeAlt}</span>
                  )}
                </td>
                <td className="px-4 py-2.5">
                  <span className="text-xs font-semibold" style={{ color: statusInfo.color }}>{statusInfo.label}</span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ───────────────────────────────────────────────────────────────
// WORKER DETAIL (expanded card with Summary + tabs)
// ───────────────────────────────────────────────────────────────
function WorkerDetail({ worker }: { worker: DashboardWorker }) {
  const { user: authUser } = useAuth();
  const canDelete = authUser?.role === "admin" || authUser?.role === "resource_manager";
  const [tab, setTab] = useState<"summary" | "certs" | "experience">("summary");
  const [showEditWizard, setShowEditWizard] = useState(false);
  const [deleteState, setDeleteState] = useState<"idle" | "confirming" | "deleting" | "error">("idle");
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [sqepDownloading, setSqepDownloading] = useState(false);
  const util = calcUtilisation(worker.assignments);
  const workerRoles = parseRoles(worker);
  const age = worker.dateOfBirth ? calcAge(worker.dateOfBirth) : (worker.age || "—");

  const handleDelete = async () => {
    setDeleteState("deleting");
    setDeleteError(null);
    try {
      await apiRequest("DELETE", `/api/workers/${worker.id}`);
      await queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
    } catch (e: any) {
      // Parse 409 response for active assignments
      let msg = e.message || "Failed to delete";
      try {
        if (msg.includes("409")) {
          const body = JSON.parse(msg.split(": ").slice(1).join(": "));
          msg = `Cannot delete — ${cleanName(worker.name)} is currently assigned to ${body.projects.join(", ")}. Remove them from all projects first.`;
        }
      } catch { /* use original message */ }
      setDeleteError(msg);
      setDeleteState("error");
    }
  };

  return (
    <div style={{ background: "hsl(var(--muted))" }}>
      {/* Header with Edit button */}
      <div className="flex items-center justify-between px-5 pt-3">
        <div className="flex border-b-0 gap-0">
          {(["summary", "certs", "experience"] as const).map((t) => (
            <button key={t} data-testid={`worker-tab-${t}`} onClick={() => setTab(t)}
              className={`px-5 py-2.5 text-xs font-semibold border-b-2 transition-all ${tab === t ? "text-pfg-navy border-[var(--pfg-yellow)]" : "border-transparent hover:text-pfg-navy"}`}
              style={{ color: tab === t ? "var(--pfg-navy)" : "var(--pfg-steel)" }}>
              {t === "summary" ? "Summary" : t === "certs" ? "Qualifications & Certificates" : "Work Experience"}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowEditWizard(true)}
            className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors hover:bg-white/80"
            style={{ background: "hsl(var(--card))", color: "var(--pfg-navy)", border: "1px solid hsl(var(--border))" }}
            data-testid={`edit-worker-${worker.id}`}>
            <Pencil className="w-3.5 h-3.5" /> Edit Profile
          </button>
          {canDelete && deleteState === "idle" && (
            <button onClick={() => setDeleteState("confirming")}
              className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors hover:bg-red-50"
              style={{ background: "hsl(var(--card))", color: "var(--red)", border: "1px solid var(--red)" }}
              data-testid={`delete-worker-${worker.id}`}>
              <Trash2 className="w-3.5 h-3.5" /> Delete Profile
            </button>
          )}
          {canDelete && deleteState === "confirming" && (
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs" style={{ borderColor: "var(--red)", background: "var(--red-bg)" }}>
              <span style={{ color: "var(--red)" }}>Delete {cleanName(worker.name)}? This cannot be undone.</span>
              <button onClick={handleDelete} className="font-bold px-2 py-0.5 rounded text-white" style={{ background: "var(--red)" }} data-testid={`confirm-delete-${worker.id}`}>Delete</button>
              <button onClick={() => setDeleteState("idle")} className="font-medium px-2 py-0.5 rounded" style={{ color: "var(--pfg-steel)" }} data-testid={`cancel-delete-${worker.id}`}>Cancel</button>
            </div>
          )}
          {canDelete && deleteState === "deleting" && (
            <span className="flex items-center gap-1.5 text-xs" style={{ color: "var(--pfg-steel)" }}>
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> Deleting...
            </span>
          )}
        </div>
      </div>

      {deleteError && (
        <div className="mx-5 mt-2 px-3 py-2 rounded-lg text-xs font-medium" style={{ background: "var(--red-bg)", color: "var(--red)" }} data-testid="delete-error">
          {deleteError}
        </div>
      )}

      <div className="border-t" style={{ borderColor: "hsl(var(--border))" }} />

      {/* Tab content */}
      <div className="p-5">
        {tab === "summary" && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* LEFT: Profile */}
            <div className="rounded-lg border p-4" style={{ background: "hsl(var(--card))", borderColor: "hsl(var(--border))" }}>
              <div className="text-xs font-bold uppercase tracking-wide mb-3 pb-2 border-b text-pfg-navy" style={{ borderColor: "hsl(var(--border))" }}>
                Profile
              </div>
              <div className="flex items-center gap-3 mb-3">
                {worker.profilePhotoPath ? (
                  <img src={worker.profilePhotoPath} alt={cleanName(worker.name)} className="w-14 h-14 rounded-full object-cover border-2" style={{ borderColor: "hsl(var(--border))" }} />
                ) : (
                  <div className="w-14 h-14 rounded-full flex items-center justify-center text-lg font-bold" style={{ background: "hsl(var(--muted))", color: "var(--pfg-steel)" }}>
                    {cleanName(worker.name).split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase()}
                  </div>
                )}
                <div>
                  <div className="text-base font-bold text-pfg-navy">{cleanName(worker.name)}</div>
                  <div className="text-xs" style={{ color: "var(--pfg-steel)" }}>{workerRoles.length > 0 ? getHighestRole(workerRoles) : worker.role}</div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                {[
                  ["Status", <StatusBadge key="s" status={worker.status} />],
                  ["Age", age],
                  ["Joined", worker.joined || "—"],
                  ["English", <EnglishBadge key="e" level={worker.englishLevel} />],
                  ...(worker.status === "FTE" && worker.costCentre ? [["Cost Centre", worker.costCentre]] : []),
                  ...(worker.driversLicense || worker.driversLicenseUploaded ? [["Driver's License", <span key="dl" className="badge badge-green">Yes</span>]] : []),
                  ...(worker.coverallSize ? [["Coverall", worker.coverallSize]] : []),
                  ...(worker.bootSize ? [["Boots", `EU ${worker.bootSize}`]] : []),
                  ...(worker.localAirport ? [["Airport", worker.localAirport]] : []),
                ].map(([label, val], idx) => (
                  <div key={idx} className="flex flex-col gap-0.5">
                    <span className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: "hsl(var(--muted-foreground))" }}>{label as string}</span>
                    <span className="text-[13px] font-medium">{val as any}</span>
                  </div>
                ))}
              </div>

              {/* Contact Info */}
              {(worker.phone || worker.personalEmail || worker.workEmail) && (
                <>
                  <div className="text-[10px] font-bold uppercase tracking-wide mt-3 pt-3 border-t" style={{ color: "var(--pfg-navy)", borderColor: "hsl(var(--border))" }}>
                    Contact
                  </div>
                  <div className="space-y-1.5 mt-1.5">
                    {worker.phone && (
                      <div className="flex items-center gap-2">
                        <span className="text-[13px]">{worker.phone}</span>
                        <a href={`https://wa.me/${worker.phone.replace(/[^0-9]/g, "")}`} target="_blank" rel="noopener noreferrer"
                          className="inline-flex items-center justify-center w-5 h-5 rounded-full hover:opacity-80 transition-opacity" style={{ background: "#25D366" }}
                          title="Message on WhatsApp" data-testid={`whatsapp-${worker.id}`}>
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="white"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
                        </a>
                      </div>
                    )}
                    {worker.phoneSecondary && (
                      <div className="flex items-center gap-2">
                        <span className="text-[13px]">{worker.phoneSecondary}</span>
                        <span className="text-[10px]" style={{ color: "hsl(var(--muted-foreground))" }}>secondary</span>
                      </div>
                    )}
                    {worker.personalEmail && (
                      <a href={`mailto:${worker.personalEmail}`} className="text-[13px] hover:underline block" style={{ color: "var(--pfg-steel)" }}>{worker.personalEmail}</a>
                    )}
                    {worker.workEmail && (
                      <a href={`mailto:${worker.workEmail}`} className="text-[13px] hover:underline block" style={{ color: "var(--pfg-steel)" }}>{worker.workEmail}</a>
                    )}
                  </div>
                </>
              )}
            </div>

            {/* MIDDLE: Scores + OEM */}
            <div className="rounded-lg border p-4" style={{ background: "hsl(var(--card))", borderColor: "hsl(var(--border))" }}>
              <div className="text-xs font-bold uppercase tracking-wide mb-3 pb-2 border-b text-pfg-navy" style={{ borderColor: "hsl(var(--border))" }}>
                Scores
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <span className="text-[11px] w-24 text-right" style={{ color: "var(--pfg-steel)" }}>Experience</span>
                  <span className="text-sm font-bold tabular-nums">{worker.experienceScore ? `${worker.experienceScore} yrs` : "—"}</span>
                </div>
                <ScoreBar label="Technical" value={worker.technicalScore} />
                <ScoreBar label="Attitude" value={worker.attitudeScore} />
              </div>
              <div className="flex items-center gap-2 mt-2">
                <span className="text-[11px] w-24 text-right" style={{ color: "var(--pfg-steel)" }}>Measuring</span>
                <span className="text-xs font-semibold">{worker.measuringSkills || "—"}</span>
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

            {/* RIGHT: Comments + Utilisation */}
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
                  <div className="h-full rounded-full" style={{
                    width: `${Math.min(util.pct, 100)}%`,
                    background: util.pct >= 80 ? "var(--green)" : util.pct >= 50 ? "var(--amber)" : "var(--red)",
                  }} />
                </div>
                <span className="text-sm font-bold tabular-nums">{util.days}d {util.pct}%</span>
              </div>
            </div>
          </div>
        )}

        {tab === "certs" && <CertificatesTab worker={worker} />}

        {tab === "experience" && (
          <div>
            <div className="rounded-lg border overflow-hidden" style={{ background: "hsl(var(--card))", borderColor: "hsl(var(--border))" }}>
              <table className="w-full text-[12px]">
                <thead>
                  <tr style={{ background: "hsl(var(--muted))" }}>
                    {["Site / Project", "Start Date", "End Date", "Role", "OEM", "Equipment", "Scope of Work"].map(h => (
                      <th key={h} className="text-left px-3 py-2.5 text-[10px] font-semibold uppercase tracking-wide" style={{ color: "hsl(var(--muted-foreground))" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {worker.assignments.length === 0 ? (
                    <tr><td colSpan={7} className="px-4 py-8 text-center" style={{ color: "hsl(var(--muted-foreground))" }}>No work experience recorded</td></tr>
                  ) : (
                    worker.assignments
                      .filter(a => a.startDate && a.startDate <= new Date().toISOString().split("T")[0])
                      .map(a => (
                        <tr key={a.id} className="border-t hover:bg-[hsl(var(--accent))]" style={{ borderColor: "hsl(var(--border))" }}>
                          <td className="px-3 py-2 font-medium">{a.projectName} ({a.projectCode})</td>
                          <td className="px-3 py-2 tabular-nums">{a.startDate || "—"}</td>
                          <td className="px-3 py-2 tabular-nums">{a.endDate || "—"}</td>
                          <td className="px-3 py-2">{a.role || a.task || worker.role}</td>
                          <td className="px-3 py-2">{a.customer || "—"}</td>
                          <td className="px-3 py-2">{a.equipmentType || "—"}</td>
                          <td className="px-3 py-2">{a.task || "—"}</td>
                        </tr>
                      ))
                  )}
                </tbody>
              </table>
            </div>
            <div className="mt-3 flex justify-end">
              <button
                disabled={sqepDownloading}
                onClick={async () => {
                  setSqepDownloading(true);
                  try {
                    // Fetch documents for this worker so certs page is complete
                    const docs = await apiRequest("GET", `/api/workers/${worker.id}/documents`)
                      .then((r: any) => r.json()).catch(() => []);
                    const enrichedWorker = { ...worker, documents: docs };
                    await downloadSqepPdf(enrichedWorker as any);
                  } finally {
                    setSqepDownloading(false);
                  }
                }}
                className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border transition-colors hover:bg-[hsl(var(--accent))] disabled:opacity-50 disabled:cursor-not-allowed"
                style={{ borderColor: "hsl(var(--border))", color: "var(--pfg-navy)" }}
                data-testid="download-sqep"
              >
                {sqepDownloading
                  ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Preparing PDF…</>
                  : <><Download className="w-3.5 h-3.5" /> Download SQEP Pack</>}
              </button>
            </div>
          </div>
        )}
      </div>

      {showEditWizard && <EditWizardModal worker={worker} onClose={() => setShowEditWizard(false)} />}
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
type SortKey = "name" | "role" | "status" | "englishLevel" | "costCentre" | "measuringSkills" | "utilisation";
type SortDir = "asc" | "desc";

export default function WorkforceTable() {
  const { user: authUser } = useAuth();
  const canAddWorker = authUser?.role === "admin" || authUser?.role === "resource_manager";
  const { data, isLoading } = useDashboardData();
  const [search, setSearch] = useState("");
  const [filterRole, setFilterRole] = useState<string[]>([]);
  const [filterStatus, setFilterStatus] = useState<string[]>([]);
  const [filterCostCentre, setFilterCostCentre] = useState<string[]>([]);
  const [filterEnglish, setFilterEnglish] = useState<string[]>([]);
  const [filterOem, setFilterOem] = useState<string[]>([]);
  const [filterAssigned, setFilterAssigned] = useState<string[]>([]);
  const [filterCert, setFilterCert] = useState<string[]>([]);
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [showAddWorker, setShowAddWorker] = useState(false);

  const workers = data?.workers ?? [];

  // Derive unique filter options
  const roles = useMemo(() => Array.from(new Set(workers.map(w => w.role))).sort(), [workers]);
  const statuses = useMemo(() => Array.from(new Set(workers.map(w => w.status))).sort(), [workers]);
  const costCentreOptions = useMemo(() => {
    const fteCentres = Array.from(new Set(workers.filter(w => w.status === "FTE" && w.costCentre).map(w => w.costCentre!))).sort();
    return [...fteCentres, "Temp"];
  }, [workers]);
  const englishLevels = useMemo(() => Array.from(new Set(workers.map(w => w.englishLevel).filter(Boolean) as string[])).sort(), [workers]);
  const allOems = useMemo(() => Array.from(new Set(workers.flatMap(w => w.oemExperience.map(o => o.split(" - ")[0])))).sort(), [workers]);
  const assignedOptions = ["Assigned", "Available"];
  const certOptions = useMemo(() => CERT_DEFS.map(c => c.name), []);

  // Filter
  const filtered = useMemo(() => {
    return workers.filter(w => {
      if (search && !w.name.toLowerCase().includes(search.toLowerCase())) return false;
      if (filterRole.length > 0 && !filterRole.includes(w.role)) return false;
      if (filterStatus.length > 0 && !filterStatus.includes(w.status)) return false;
      if (filterCostCentre.length > 0) {
        const wCostCentre = w.status === "FTE" ? (w.costCentre || "") : "Temp";
        if (!filterCostCentre.includes(wCostCentre)) return false;
      }
      if (filterEnglish.length > 0 && !filterEnglish.includes(w.englishLevel || "")) return false;
      if (filterOem.length > 0) {
        const workerOems = w.oemExperience.map(o => o.split(" - ")[0]);
        if (!filterOem.some(o => workerOems.includes(o))) return false;
      }
      if (filterAssigned.length > 0) {
        const hasActive = w.assignments.some(a => a.status === "active" || a.status === "flagged" || a.status === "confirmed" || a.status === "pending_confirmation");
        if (filterAssigned.includes("Assigned") && !hasActive) return false;
        if (filterAssigned.includes("Available") && hasActive) return false;
      }
      if (filterCert.length > 0) {
        const today = new Date().toISOString().split("T")[0];
        const docs = (w as any).documents as Array<{ type: string; expiryDate: string | null }> | undefined;
        if (!docs) return false;
        const hasAll = filterCert.every(certName => {
          const certType = "cert_" + certName.toLowerCase().replace(/[^a-z0-9]/g, "_");
          return docs.some(d => d.type === certType && (!d.expiryDate || d.expiryDate >= today));
        });
        if (!hasAll) return false;
      }
      return true;
    });
  }, [workers, search, filterRole, filterStatus, filterCostCentre, filterEnglish, filterOem, filterAssigned, filterCert]);

  // Sort
  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      const dir = sortDir === "asc" ? 1 : -1;
      if (sortKey === "utilisation") {
        return (calcUtilisation(a.assignments).pct - calcUtilisation(b.assignments).pct) * dir;
      }
      if (sortKey === "costCentre") {
        const av = a.status === "FTE" ? (a.costCentre || "") : "Temp";
        const bv = b.status === "FTE" ? (b.costCentre || "") : "Temp";
        return av.localeCompare(bv) * dir;
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
  const totalFte = workers.filter(w => w.status === "FTE").length;
  const totalTemp = workers.filter(w => w.status === "Temp").length;
  const isAssigned = (a: DashboardAssignment) => a.status === "active" || a.status === "flagged" || a.status === "confirmed" || a.status === "pending_confirmation";
  const fteWithActive = workers.filter(w => w.status === "FTE" && w.assignments.some(isAssigned)).length;
  const fteUtilPct = totalFte > 0 ? Math.round((fteWithActive / totalFte) * 100) : 0;
  const availFte = workers.filter(w => w.status === "FTE" && !w.assignments.some(isAssigned)).length;
  const availTemp = workers.filter(w => w.status === "Temp" && !w.assignments.some(isAssigned)).length;

  const ccCounts = workers.reduce<Record<string, number>>((acc, w) => {
    const cc = w.status === "FTE" ? (w.costCentre || "Unassigned") : "Temp";
    acc[cc] = (acc[cc] || 0) + 1;
    return acc;
  }, {});
  const topCostCentres = Object.entries(ccCounts).sort((a, b) => b[1] - a[1]).slice(0, 5);

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
        <div className="rounded-xl border p-5" style={{ background: "hsl(var(--card))", borderColor: "hsl(var(--card-border))", boxShadow: "var(--shadow-sm)" }}>
          <div className="text-[11px] font-semibold uppercase tracking-wide mb-2" style={{ color: "hsl(var(--muted-foreground))" }}>Total Headcount</div>
          <div className="text-[28px] font-bold tabular-nums font-display text-pfg-navy leading-tight">{workers.length}</div>
          <div className="text-xs mt-1.5" style={{ color: "var(--pfg-steel)" }}><span className="font-semibold">{totalFte}</span> FTE · <span className="font-semibold">{totalTemp}</span> Temp</div>
        </div>
        <div className="rounded-xl border p-5" style={{ background: "hsl(var(--card))", borderColor: "hsl(var(--card-border))", boxShadow: "var(--shadow-sm)" }}>
          <div className="text-[11px] font-semibold uppercase tracking-wide mb-2 flex items-center gap-1" style={{ color: "hsl(var(--muted-foreground))" }}>
            FTE Utilisation
            <span className="inline-flex items-center justify-center w-4 h-4 rounded-full text-[10px] font-bold cursor-help" style={{ background: "hsl(var(--border))", color: "var(--pfg-steel)" }} title="Percentage of FTE workers currently assigned to active projects">?</span>
          </div>
          <div className="text-[28px] font-bold tabular-nums font-display text-pfg-navy leading-tight">{fteUtilPct}%</div>
          <div className="text-xs mt-1.5" style={{ color: "var(--pfg-steel)" }}><span className="font-semibold">{fteWithActive}</span> of {totalFte} FTE assigned</div>
        </div>
        <div className="rounded-xl border p-5" style={{ background: "hsl(var(--card))", borderColor: "hsl(var(--card-border))", boxShadow: "var(--shadow-sm)" }}>
          <div className="text-[11px] font-semibold uppercase tracking-wide mb-2" style={{ color: "hsl(var(--muted-foreground))" }}>Available Now</div>
          <div className="text-[28px] font-bold tabular-nums font-display leading-tight" style={{ color: availFte > 0 ? "var(--red)" : "var(--green)" }}>{availFte}</div>
          <div className="text-xs mt-1.5" style={{ color: "var(--pfg-steel)" }}>FTE · <span className="font-semibold">{availTemp}</span> Temps available</div>
        </div>
        <div className="rounded-xl border p-5" style={{ background: "hsl(var(--card))", borderColor: "hsl(var(--card-border))", boxShadow: "var(--shadow-sm)" }}>
          <div className="text-[11px] font-semibold uppercase tracking-wide mb-2" style={{ color: "hsl(var(--muted-foreground))" }}>Cost Centre Distribution</div>
          <div className="space-y-1">
            {topCostCentres.map(([name, count]) => (
              <div key={name} className="flex items-center justify-between text-xs gap-2">
                <span className="truncate" style={{ color: "var(--pfg-steel)", maxWidth: 180 }} title={name}>{name}</span>
                <span className="font-semibold tabular-nums shrink-0">{count}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="rounded-xl border p-5" style={{ background: "hsl(var(--card))", borderColor: "hsl(var(--card-border))", boxShadow: "var(--shadow-sm)" }}>
          <div className="text-[11px] font-semibold uppercase tracking-wide mb-2" style={{ color: "hsl(var(--muted-foreground))" }}>Role Distribution</div>
          <div className="space-y-1">
            {roleList.map(([name, count]) => (
              <div key={name} className="flex items-center gap-2 text-[11px]">
                <span className="w-[120px] text-right truncate shrink-0" style={{ color: "var(--pfg-steel)" }}>{name}</span>
                <div className="flex-1 h-3.5 rounded" style={{ background: "hsl(var(--muted))" }}>
                  <div className="h-full rounded" style={{ width: `${(count / maxRoleCount) * 100}%`, background: "var(--pfg-yellow)", transition: "width 0.4s" }} />
                </div>
                <span className="w-6 font-semibold tabular-nums text-right">{count}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="rounded-xl border p-4 mb-4" style={{ background: "hsl(var(--card))", borderColor: "hsl(var(--card-border))", boxShadow: "var(--shadow-sm)" }} data-testid="filter-bar">
        <div className="flex items-end gap-2.5 flex-wrap">
          <div className="flex flex-col gap-1">
            <span className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: "hsl(var(--muted-foreground))" }}>Search</span>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5" style={{ color: "hsl(var(--muted-foreground))" }} />
              <input type="text" data-testid="search-input" placeholder="Search by name..." value={search} onChange={(e) => setSearch(e.target.value)}
                className="pl-8 pr-3 py-2 text-[13px] rounded-lg border w-[200px]" style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--card))" }} />
            </div>
          </div>

          <MultiSelect label="Role" options={roles} selected={filterRole} onChange={setFilterRole} testId="filter-role" />
          <MultiSelect label="Status" options={statuses} selected={filterStatus} onChange={setFilterStatus} testId="filter-status" />
          <MultiSelect label="Cost Centre" options={costCentreOptions} selected={filterCostCentre} onChange={setFilterCostCentre} testId="filter-cost-centre" />
          <MultiSelect label="English" options={englishLevels} selected={filterEnglish} onChange={setFilterEnglish} testId="filter-english" />
          <MultiSelect label="OEM Experience" options={allOems} selected={filterOem} onChange={setFilterOem} testId="filter-oem" />
          <MultiSelect label="Assigned" options={assignedOptions} selected={filterAssigned} onChange={setFilterAssigned} testId="filter-assigned" />
          <MultiSelect label="Certificates" options={certOptions} selected={filterCert} onChange={setFilterCert} testId="filter-cert" />

          {/* Export CSV button */}
          <button
            onClick={() => {
              const rows = sorted.map(w => {
                const util = calcUtilisation(w.assignments);
                const today = new Date().toISOString().split("T")[0];
                const activeAssignment = w.assignments.find(a =>
                  (a.status === "active" || a.status === "flagged" || a.status === "confirmed" || a.status === "pending_confirmation") &&
                  a.startDate && a.endDate &&
                  a.startDate <= today && a.endDate >= today
                );
                const availabilityLabel = w.status === "FTE" ? "Available" : "Potentially Available";
                const assignmentLabel = activeAssignment
                  ? activeAssignment.status === "pending_confirmation"
                    ? `Pending Confirmation — ${activeAssignment.projectName}`
                    : `${activeAssignment.projectCode} — ${activeAssignment.projectName}`
                  : availabilityLabel;
                return {
                  Name: w.name,
                  Role: w.role,
                  Status: w.status,
                  "Cost Centre": w.status === "FTE" ? (w.costCentre || "") : "Temp",
                  "English Level": w.englishLevel || "",
                  "Measuring Skills": w.measuringSkills || "",
                  "OEM Experience": w.oemExperience.map(o => o.split(" - ")[0]).join("; "),
                  "Utilisation %": util.pct,
                  "Current Assignment": assignmentLabel,
                };
              });
              downloadCSV(rows, `pfg-workforce-${new Date().toISOString().split("T")[0]}.csv`);
            }}
            className="flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg border transition-colors hover:bg-[hsl(var(--accent))] ml-2"
            style={{ borderColor: "hsl(var(--border))", color: "var(--pfg-navy)" }}
            data-testid="export-csv-btn"
          >
            <Download className="w-3.5 h-3.5" /> Export CSV
          </button>

          {/* Add Worker button — admin and resource_manager only */}
          {canAddWorker && (
            <button onClick={() => setShowAddWorker(true)}
              className="flex items-center gap-1.5 text-xs font-bold px-4 py-2 rounded-lg ml-2"
              style={{ background: "var(--pfg-yellow)", color: "var(--pfg-navy)" }}
              data-testid="add-worker-button">
              <Plus className="w-3.5 h-3.5" /> Add Worker
            </button>
          )}

          <div className="ml-auto text-[13px]" style={{ color: "var(--pfg-steel)" }}>
            <strong className="text-pfg-navy">{sorted.length}</strong> of {workers.length}
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="rounded-xl border overflow-hidden" style={{ background: "hsl(var(--card))", borderColor: "hsl(var(--card-border))", boxShadow: "var(--shadow-sm)" }}>
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]" style={{ borderCollapse: "collapse" }}>
            <thead>
              <tr>
                {([
                  ["name", "Name"], ["role", "Role"], ["status", "Status"],
                  ["costCentre", "Cost Centre"], ["englishLevel", "English"], ["measuringSkills", "Measuring"],
                ] as [SortKey, string][]).map(([key, label]) => (
                  <th key={key} onClick={() => handleSort(key)}
                    className="text-left px-2.5 py-2.5 text-[11px] font-semibold uppercase tracking-wide cursor-pointer select-none whitespace-nowrap"
                    style={{ background: "hsl(var(--muted))", color: "hsl(var(--muted-foreground))", borderBottom: "1px solid hsl(var(--border))" }}
                    data-testid={`sort-${key}`}>
                    {label}<SortIcon col={key} />
                  </th>
                ))}
                <th className="text-left px-2.5 py-2.5 text-[11px] font-semibold uppercase tracking-wide whitespace-nowrap"
                  style={{ background: "hsl(var(--muted))", color: "hsl(var(--muted-foreground))", borderBottom: "1px solid hsl(var(--border))" }}>
                  OEM Experience
                </th>
                <th onClick={() => handleSort("utilisation")}
                  className="text-left px-2.5 py-2.5 text-[11px] font-semibold uppercase tracking-wide cursor-pointer select-none whitespace-nowrap"
                  style={{ background: "hsl(var(--muted))", color: "hsl(var(--muted-foreground))", borderBottom: "1px solid hsl(var(--border))" }}
                  data-testid="sort-utilisation">
                  Utilisation<SortIcon col={"utilisation"} />
                </th>
                <th className="text-left px-2.5 py-2.5 text-[11px] font-semibold uppercase tracking-wide whitespace-nowrap"
                  style={{ background: "hsl(var(--muted))", color: "hsl(var(--muted-foreground))", borderBottom: "1px solid hsl(var(--border))" }}>
                  Current Assignment
                </th>
                <th className="text-left px-2.5 py-2.5 text-[11px] font-semibold uppercase tracking-wide whitespace-nowrap"
                  style={{ background: "hsl(var(--muted))", color: "hsl(var(--muted-foreground))", borderBottom: "1px solid hsl(var(--border))" }}>
                  Shift
                </th>
              </tr>
            </thead>
            <tbody>
              {sorted.length === 0 ? (
                <tr>
                  <td colSpan={10} className="text-center py-16" style={{ color: "hsl(var(--muted-foreground))" }}>
                    <Search className="w-8 h-8 mx-auto mb-2 opacity-40" />
                    <h3 className="text-base font-semibold mb-1" style={{ color: "var(--pfg-navy)" }}>No results found</h3>
                    <p className="text-xs">Try adjusting your filters</p>
                  </td>
                </tr>
              ) : (
                sorted.map(w => {
                  const isExpanded = expandedId === w.id;
                  const today = new Date().toISOString().split("T")[0];
                const activeAssignment = w.assignments.find(a =>
                  (a.status === "active" || a.status === "flagged" || a.status === "confirmed" || a.status === "pending_confirmation") &&
                  a.startDate && a.endDate &&
                  a.startDate <= today && a.endDate >= today
                );
                const availabilityLabel = w.status === "FTE" ? "Available" : "Potentially Available";
                  const hasFlagged = w.assignments.some(a => a.status === "flagged");
                  const isPendingConfirmation = activeAssignment?.status === "pending_confirmation";
                  return (
                    <Fragment key={w.id}>
                      <tr data-testid={`worker-row-${w.id}`} onClick={() => setExpandedId(isExpanded ? null : w.id)}
                        className="cursor-pointer transition-colors"
                        style={{ borderBottom: isExpanded ? "none" : "1px solid hsl(var(--border))", background: isExpanded ? "hsl(var(--accent))" : undefined }}
                        onMouseEnter={(e) => { if (!isExpanded) (e.currentTarget.style.background = "hsl(var(--accent))"); }}
                        onMouseLeave={(e) => { if (!isExpanded) (e.currentTarget.style.background = ""); }}>
                        <td className="px-2.5 py-2.5 font-semibold whitespace-nowrap text-pfg-navy">
                          {cleanName(w.name)}
                          {w.driversLicenseUploaded ? <span className="inline-flex items-center justify-center w-4 h-4 rounded-full text-[8px] font-bold ml-1 shrink-0" style={{ background: "#1A1D23", color: "#F5BD00" }} title="Has Driver's Licence">D</span> : null}
                        </td>
                        <td className="px-2.5 py-2.5">{w.role}</td>
                        <td className="px-2.5 py-2.5"><StatusBadge status={w.status} /></td>
                        <td className="px-2.5 py-2.5">
                          <span className="block truncate max-w-[180px]" title={w.status === "FTE" ? (w.costCentre || "—") : "Temp"}>
                            {w.status === "FTE" ? (w.costCentre || "—") : "Temp"}
                          </span>
                        </td>
                        <td className="px-2.5 py-2.5"><EnglishBadge level={w.englishLevel} /></td>
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
                            isPendingConfirmation ? (
                              <span className="text-xs font-medium" style={{ color: "var(--amber, #D97706)" }}>
                                Pending Confirmation &mdash; {activeAssignment.projectName}
                              </span>
                            ) : (
                              <span className="text-xs font-medium">
                                {hasFlagged && <span style={{ color: "var(--red, #dc2626)" }} title="Flagged for review" data-testid={`flagged-badge-${w.id}`}>&#9888;&#xFE0F; </span>}
                                {activeAssignment.projectCode} — {activeAssignment.projectName}
                              </span>
                            )
                          ) : (
                            <span className={`badge ${w.status === "FTE" ? "badge-green" : "badge-accent"}`}>{availabilityLabel}</span>
                          )}
                        </td>
                        <td className="px-2.5 py-2.5">
                          {activeAssignment?.shift ? (
                            <span className={`badge ${activeAssignment.shift === "Night" ? "badge-navy" : "badge-accent"}`}>{activeAssignment.shift}</span>
                          ) : (
                            <span className="text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>—</span>
                          )}
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr><td colSpan={10} className="p-0"><WorkerDetail worker={w} /></td></tr>
                      )}
                    </Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modals */}
      {showAddWorker && <AddWorkerModal onClose={() => setShowAddWorker(false)} />}
    </div>
  );
}
