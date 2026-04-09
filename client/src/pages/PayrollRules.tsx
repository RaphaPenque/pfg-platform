import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/context/AuthContext";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { COST_CENTRES } from "@/lib/constants";
import { Plus, Pencil, Trash2, X, Check, ChevronDown, Save } from "lucide-react";

interface PayrollRule {
  id: number;
  costCentre: string;
  countryCode: string;
  countryName: string;
  weeklyOtThresholdHours: number | null;
  annualOtThresholdHours: number | null;
  nightShiftStart: string | null;
  nightShiftEnd: string | null;
  trackSundayHours: boolean;
  standbyDayHours: number;
  notes: string | null;
  updatedAt: string;
}

const FLAG: Record<string, string> = {
  HR: "🇭🇷", ES: "🇪🇸", PT: "🇵🇹", GB: "🇬🇧", IE: "🇮🇪",
  NL: "🇳🇱", BA: "🇧🇦", MA: "🇲🇦", SA: "🇸🇦", AE: "🇦🇪",
  RS: "🇷🇸", SI: "🇸🇮", MK: "🇲🇰",
};

const COUNTRY_CODES = [
  { code: "HR", name: "Croatia" },
  { code: "ES", name: "Spain" },
  { code: "PT", name: "Portugal" },
  { code: "GB", name: "United Kingdom" },
  { code: "IE", name: "Ireland" },
  { code: "NL", name: "Netherlands" },
  { code: "BA", name: "Bosnia & Herzegovina" },
  { code: "MA", name: "Morocco" },
  { code: "SA", name: "Saudi Arabia" },
  { code: "AE", name: "UAE" },
  { code: "RS", name: "Serbia" },
  { code: "SI", name: "Slovenia" },
  { code: "MK", name: "North Macedonia" },
];

const inputCls = "w-full px-3 py-2 text-[13px] rounded-lg border focus:outline-none focus:border-[var(--pfg-yellow)] focus:shadow-[0_0_0_3px_rgba(245,189,0,0.15)]";
const inputStyle: React.CSSProperties = { borderColor: "hsl(var(--border))", background: "hsl(var(--card))", color: "hsl(var(--foreground))" };

const EMPTY_FORM = {
  costCentre: "",
  countryCode: "HR",
  countryName: "Croatia",
  weeklyOtThresholdHours: "" as string | number,
  annualOtThresholdHours: "" as string | number,
  nightShiftStart: "",
  nightShiftEnd: "",
  trackSundayHours: false,
  standbyDayHours: 8,
  notes: "",
};

export default function PayrollRules() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<PayrollRule | null>(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [saving, setSaving] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);

  const { data: rules = [], isLoading } = useQuery<PayrollRule[]>({
    queryKey: ["/api/payroll-rules"],
    queryFn: () => apiRequest("GET", "/api/payroll-rules").then((r: any) => r.json()),
  });

  const isAdmin = user?.role === "admin";

  function openNew() {
    setEditing(null);
    setForm({ ...EMPTY_FORM });
    setShowForm(true);
  }

  function openEdit(rule: PayrollRule) {
    setEditing(rule);
    setForm({
      costCentre: rule.costCentre,
      countryCode: rule.countryCode,
      countryName: rule.countryName,
      weeklyOtThresholdHours: rule.weeklyOtThresholdHours ?? "",
      annualOtThresholdHours: rule.annualOtThresholdHours ?? "",
      nightShiftStart: rule.nightShiftStart ?? "",
      nightShiftEnd: rule.nightShiftEnd ?? "",
      trackSundayHours: rule.trackSundayHours,
      standbyDayHours: rule.standbyDayHours,
      notes: rule.notes ?? "",
    });
    setShowForm(true);
  }

  async function handleSave() {
    if (!form.costCentre || !form.countryCode || !form.countryName) {
      toast({ title: "Required fields missing", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const payload = {
        costCentre: form.costCentre,
        countryCode: form.countryCode,
        countryName: form.countryName,
        weeklyOtThresholdHours: form.weeklyOtThresholdHours !== "" ? Number(form.weeklyOtThresholdHours) : null,
        annualOtThresholdHours: form.annualOtThresholdHours !== "" ? Number(form.annualOtThresholdHours) : null,
        nightShiftStart: form.nightShiftStart || null,
        nightShiftEnd: form.nightShiftEnd || null,
        trackSundayHours: form.trackSundayHours,
        standbyDayHours: Number(form.standbyDayHours) || 8,
        notes: form.notes || null,
      };
      await apiRequest("PUT", "/api/payroll-rules", payload);
      await queryClient.invalidateQueries({ queryKey: ["/api/payroll-rules"] });
      toast({ title: editing ? "Rule updated" : "Rule created" });
      setShowForm(false);
    } catch (e: any) {
      toast({ title: "Save failed", description: e.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: number) {
    try {
      await apiRequest("DELETE", `/api/payroll-rules/${id}`);
      await queryClient.invalidateQueries({ queryKey: ["/api/payroll-rules"] });
      toast({ title: "Rule deleted" });
      setDeleteConfirm(null);
    } catch (e: any) {
      toast({ title: "Delete failed", description: e.message, variant: "destructive" });
    }
  }

  function setCountry(code: string) {
    const c = COUNTRY_CODES.find(x => x.code === code);
    setForm(f => ({ ...f, countryCode: code, countryName: c?.name ?? code }));
  }

  return (
    <div className="p-6 max-w-5xl mx-auto">
      {/* Page header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-pfg-navy">Payroll Rules</h1>
          <p className="text-sm mt-0.5" style={{ color: "var(--pfg-steel)" }}>
            Configure country-specific payroll calculation rules by Cost Centre. Applied automatically when timesheets are processed.
          </p>
        </div>
        {isAdmin && (
          <button
            onClick={openNew}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-[13px] font-semibold"
            style={{ background: "var(--pfg-yellow)", color: "#1A1D23" }}
            data-testid="add-rule-btn"
          >
            <Plus className="w-4 h-4" /> Add Rule Set
          </button>
        )}
      </div>

      {/* Rules grid */}
      {isLoading ? (
        <div className="text-sm" style={{ color: "var(--pfg-steel)" }}>Loading…</div>
      ) : rules.length === 0 ? (
        <div className="rounded-xl border p-8 text-center" style={{ borderColor: "hsl(var(--border))" }}>
          <p className="text-sm" style={{ color: "var(--pfg-steel)" }}>No payroll rule sets configured yet.</p>
        </div>
      ) : (
        <div className="grid gap-4">
          {rules.map((rule) => (
            <div
              key={rule.id}
              className="rounded-xl border p-5"
              style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--card))" }}
              data-testid={`rule-card-${rule.id}`}
            >
              {/* Rule header */}
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-3">
                  <span className="text-3xl">{FLAG[rule.countryCode] || "🌍"}</span>
                  <div>
                    <div className="font-bold text-pfg-navy text-base">{rule.countryName}</div>
                    <div className="text-[12px] mt-0.5" style={{ color: "var(--pfg-steel)" }}>{rule.costCentre}</div>
                  </div>
                </div>
                {isAdmin && (
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => openEdit(rule)}
                      className="p-1.5 rounded-lg hover:bg-[hsl(var(--accent))] transition-colors"
                      title="Edit"
                      data-testid={`edit-rule-${rule.id}`}
                    >
                      <Pencil className="w-4 h-4" style={{ color: "var(--pfg-steel)" }} />
                    </button>
                    {deleteConfirm === rule.id ? (
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs" style={{ color: "var(--red)" }}>Delete?</span>
                        <button onClick={() => handleDelete(rule.id)} className="p-1 rounded text-white text-xs font-bold px-2" style={{ background: "var(--red)" }}>Yes</button>
                        <button onClick={() => setDeleteConfirm(null)} className="p-1 rounded text-xs px-2" style={{ background: "hsl(var(--muted))" }}>No</button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setDeleteConfirm(rule.id)}
                        className="p-1.5 rounded-lg hover:bg-[hsl(var(--accent))] transition-colors"
                        title="Delete"
                        data-testid={`delete-rule-${rule.id}`}
                      >
                        <Trash2 className="w-4 h-4" style={{ color: "var(--pfg-steel)" }} />
                      </button>
                    )}
                  </div>
                )}
              </div>

              {/* Rule pills */}
              <div className="flex flex-wrap gap-2">
                {rule.weeklyOtThresholdHours != null && (
                  <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-full"
                    style={{ background: "rgba(245,189,0,0.12)", color: "#1A1D23", border: "1px solid rgba(245,189,0,0.4)" }}>
                    ⏱ OT above {rule.weeklyOtThresholdHours}hrs/week
                  </span>
                )}
                {rule.annualOtThresholdHours != null && (
                  <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-full"
                    style={{ background: "rgba(245,189,0,0.12)", color: "#1A1D23", border: "1px solid rgba(245,189,0,0.4)" }}>
                    📅 OT above {rule.annualOtThresholdHours.toLocaleString()}hrs/year
                  </span>
                )}
                {rule.nightShiftStart && rule.nightShiftEnd && (
                  <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-full"
                    style={{ background: "rgba(26,29,35,0.08)", color: "#1A1D23", border: "1px solid rgba(26,29,35,0.15)" }}>
                    🌙 Night shift {rule.nightShiftStart}–{rule.nightShiftEnd}
                  </span>
                )}
                {rule.trackSundayHours && (
                  <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-full"
                    style={{ background: "rgba(26,29,35,0.08)", color: "#1A1D23", border: "1px solid rgba(26,29,35,0.15)" }}>
                    📆 Sunday hours tracked
                  </span>
                )}
                <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-full"
                  style={{ background: "hsl(var(--muted))", color: "var(--pfg-steel)", border: "1px solid hsl(var(--border))" }}>
                  STD = {rule.standbyDayHours}hrs/day
                </span>
              </div>

              {rule.notes && (
                <p className="text-[11px] mt-3 italic" style={{ color: "var(--pfg-steel)" }}>{rule.notes}</p>
              )}
              <p className="text-[10px] mt-2" style={{ color: "var(--pfg-steel)" }}>
                Last updated {new Date(rule.updatedAt).toLocaleDateString("en-GB")}
              </p>
            </div>
          ))}
        </div>
      )}

      {/* Form modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.5)" }}>
          <div className="rounded-2xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden" style={{ background: "hsl(var(--card))" }}>
            {/* Modal header */}
            <div className="px-6 py-4 flex items-center justify-between border-b" style={{ borderColor: "hsl(var(--border))" }}>
              <h2 className="font-bold text-pfg-navy text-base">{editing ? "Edit Rule Set" : "New Rule Set"}</h2>
              <button onClick={() => setShowForm(false)} className="p-1 rounded hover:bg-black/5">
                <X className="w-5 h-5" style={{ color: "var(--pfg-steel)" }} />
              </button>
            </div>

            <div className="px-6 py-5 space-y-4 max-h-[70vh] overflow-y-auto">

              {/* Cost Centre */}
              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wide mb-1" style={{ color: "var(--pfg-steel)" }}>Cost Centre *</label>
                <select className={inputCls} style={inputStyle} value={form.costCentre}
                  onChange={e => setForm(f => ({ ...f, costCentre: e.target.value }))}
                  data-testid="rule-cost-centre">
                  <option value="">Select cost centre…</option>
                  {COST_CENTRES.map(cc => <option key={cc} value={cc}>{cc}</option>)}
                </select>
              </div>

              {/* Country */}
              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wide mb-1" style={{ color: "var(--pfg-steel)" }}>Country *</label>
                <select className={inputCls} style={inputStyle} value={form.countryCode}
                  onChange={e => setCountry(e.target.value)}
                  data-testid="rule-country">
                  {COUNTRY_CODES.map(c => <option key={c.code} value={c.code}>{FLAG[c.code]} {c.name}</option>)}
                </select>
              </div>

              {/* OT rules */}
              <div className="rounded-lg border p-4 space-y-3" style={{ borderColor: "hsl(var(--border))" }}>
                <p className="text-[11px] font-bold uppercase tracking-wide" style={{ color: "var(--pfg-steel)" }}>Overtime Rules</p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] mb-1" style={{ color: "var(--pfg-steel)" }}>Weekly OT threshold (hrs)</label>
                    <input type="number" min={0} max={168} placeholder="e.g. 40"
                      className={inputCls} style={inputStyle}
                      value={form.weeklyOtThresholdHours}
                      onChange={e => setForm(f => ({ ...f, weeklyOtThresholdHours: e.target.value }))}
                      data-testid="rule-weekly-ot" />
                    <p className="text-[10px] mt-0.5" style={{ color: "var(--pfg-steel)" }}>Leave blank if not applicable</p>
                  </div>
                  <div>
                    <label className="block text-[11px] mb-1" style={{ color: "var(--pfg-steel)" }}>Annual OT threshold (hrs)</label>
                    <input type="number" min={0} placeholder="e.g. 1600"
                      className={inputCls} style={inputStyle}
                      value={form.annualOtThresholdHours}
                      onChange={e => setForm(f => ({ ...f, annualOtThresholdHours: e.target.value }))}
                      data-testid="rule-annual-ot" />
                    <p className="text-[10px] mt-0.5" style={{ color: "var(--pfg-steel)" }}>Leave blank if not applicable</p>
                  </div>
                </div>
              </div>

              {/* Night shift */}
              <div className="rounded-lg border p-4 space-y-3" style={{ borderColor: "hsl(var(--border))" }}>
                <p className="text-[11px] font-bold uppercase tracking-wide" style={{ color: "var(--pfg-steel)" }}>Night Shift Tracking</p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] mb-1" style={{ color: "var(--pfg-steel)" }}>Night shift start</label>
                    <input type="time" className={inputCls} style={inputStyle}
                      value={form.nightShiftStart}
                      onChange={e => setForm(f => ({ ...f, nightShiftStart: e.target.value }))}
                      data-testid="rule-night-start" />
                  </div>
                  <div>
                    <label className="block text-[11px] mb-1" style={{ color: "var(--pfg-steel)" }}>Night shift end</label>
                    <input type="time" className={inputCls} style={inputStyle}
                      value={form.nightShiftEnd}
                      onChange={e => setForm(f => ({ ...f, nightShiftEnd: e.target.value }))}
                      data-testid="rule-night-end" />
                  </div>
                </div>
                <p className="text-[10px]" style={{ color: "var(--pfg-steel)" }}>Leave blank to disable night shift tracking for this Cost Centre</p>
              </div>

              {/* Sunday + Standby */}
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-lg border p-4" style={{ borderColor: "hsl(var(--border))" }}>
                  <p className="text-[11px] font-bold uppercase tracking-wide mb-2" style={{ color: "var(--pfg-steel)" }}>Sunday Hours</p>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={form.trackSundayHours}
                      onChange={e => setForm(f => ({ ...f, trackSundayHours: e.target.checked }))}
                      data-testid="rule-sunday" />
                    <span className="text-[12px]" style={{ color: "hsl(var(--foreground))" }}>Track Sunday hours separately</span>
                  </label>
                </div>
                <div className="rounded-lg border p-4" style={{ borderColor: "hsl(var(--border))" }}>
                  <p className="text-[11px] font-bold uppercase tracking-wide mb-2" style={{ color: "var(--pfg-steel)" }}>Standby Day Rate</p>
                  <div className="flex items-center gap-2">
                    <input type="number" min={1} max={24}
                      className={`${inputCls} w-20`} style={inputStyle}
                      value={form.standbyDayHours}
                      onChange={e => setForm(f => ({ ...f, standbyDayHours: Number(e.target.value) }))}
                      data-testid="rule-standby" />
                    <span className="text-[12px]" style={{ color: "var(--pfg-steel)" }}>hrs/day</span>
                  </div>
                </div>
              </div>

              {/* Notes */}
              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wide mb-1" style={{ color: "var(--pfg-steel)" }}>Notes</label>
                <textarea rows={2} className={inputCls} style={inputStyle}
                  placeholder="e.g. Croatian Labour Law reference…"
                  value={form.notes}
                  onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                  data-testid="rule-notes" />
              </div>
            </div>

            {/* Modal footer */}
            <div className="px-6 py-4 flex justify-end gap-2 border-t" style={{ borderColor: "hsl(var(--border))" }}>
              <button onClick={() => setShowForm(false)}
                className="px-4 py-2 rounded-lg text-[13px]"
                style={{ background: "hsl(var(--muted))", color: "var(--pfg-steel)" }}>
                Cancel
              </button>
              <button onClick={handleSave} disabled={saving}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-[13px] font-semibold disabled:opacity-50"
                style={{ background: "var(--pfg-yellow)", color: "#1A1D23" }}
                data-testid="save-rule-btn">
                {saving ? <><span className="animate-spin">⏳</span> Saving…</> : <><Save className="w-4 h-4" /> Save Rule Set</>}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
