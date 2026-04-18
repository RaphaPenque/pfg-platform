// OEM brand colours
export const OEM_BRAND_COLORS: Record<string, string> = {
  'Arabelle Solutions': '#FE5716',
  'GE Vernova': '#005E60',
  'Mitsubishi Power': '#E60012',
  'Siemens Energy': '#009999',
  'Sulzer': '#1D59AF',
  'Alstom': '#0066CC',
  'Ansaldo Energia': '#003399',
  'Doosan Skoda': '#004C99',
  'Elliot Ebara': '#336699',
  'Solar': '#CC6600',
  'NOMAC': '#63758C',
  'NMES': '#63758C',
  'Fosap Logistics': '#63758C',
  'Geman': '#005E60',
};

// Project code to customer mapping
export const PROJECT_CUSTOMER: Record<string, string> = {
  'TRNS': 'Arabelle Solutions', 'OSKSHM': 'Arabelle Solutions', 'OLKL1': 'Arabelle Solutions',
  'OLKL2': 'Arabelle Solutions', 'SZWL': 'Arabelle Solutions', 'HYSHM': 'Arabelle Solutions',
  'GNT': 'GE Vernova', 'GRTY': 'GE Vernova',
  'SALT': 'Mitsubishi Power', 'GIL': 'Mitsubishi Power', 'DHC': 'Mitsubishi Power',
  'TRNZN': 'Sulzer', 'SVRN': 'Siemens Energy',
  'NMES': 'NMES', 'NOMAC': 'NOMAC', 'FSAP': 'Fosap Logistics', 'GMKD': 'Geman',
};

export function getProjectColor(code: string): string {
  const customer = PROJECT_CUSTOMER[code];
  return customer ? (OEM_BRAND_COLORS[customer] || '#64748B') : '#64748B';
}

export function getProjectColorFromProject(project: { customer?: string | null; code: string }): string {
  const source = project.customer || PROJECT_CUSTOMER[project.code] || "";
  return source ? (OEM_BRAND_COLORS[source] || "#64748B") : "#64748B";
}

// Certificate definitions
export const CERT_DEFS = [
  { name: 'Trade Diploma', alwaysGreen: true, completionOnly: true, noTradeAlt: 'Work Experience' },
  { name: 'Working at Height' },
  { name: 'Working in Confined Spaces (Medium Risk)' },
  { name: 'Manual Handling' },
  { name: 'Safety Passport UK (CCNSG)' },
  { name: 'Safety Passport IRL (SOLAS)' },
  { name: 'Safety Passport BV (VCA)' },
  { name: 'Nuclear Clearance UK (CTC)' },
  { name: 'Nuclear Clearance FIN' },
  { name: 'Nuclear Clearance SWE' },
  { name: 'First Aid Responder' },
  { name: 'HYTORC Bolt Torquing & Tensioning' },
  { name: 'ITH Bolt Tensioning' },
  { name: 'Fork Lift License' },
  { name: 'Mobile Elevating Work Platform (MEWP)' },
  { name: "Driver's License" },
  // Technical / OEM tool certs
  { name: 'Riverhawk Hydraulic Tensioning' },
  { name: 'Strobator' },
  { name: 'Crane Operator' },
  { name: 'Rigging & Slinging' },
  { name: 'Safety Harness' },
  { name: 'Welding' },
  { name: 'Appointed Person (Lifting)' },
  { name: 'Managing Safely (IOSH)' },
];

// OEM options for dropdowns
export const OEM_OPTIONS = [
  'GE Vernova', 'Mitsubishi Power', 'Arabelle Solutions', 'Siemens Energy',
  'Alstom', 'Ansaldo Energia', 'Doosan Skoda', 'Elliot Ebara', 'Solar',
];

// Project role options (for role slot planning)
export const PROJECT_ROLES = [
  'Superintendent',
  'Foreman',
  'Lead Technician',
  'Technician 2',
  'Technician 1',
  'Rigger',
  'Crane Driver',
  'HSE Officer',
  'Welder',
  'I&C Technician',
  'Electrician',
  'Apprentice',
];

// Equipment type options
export const EQUIPMENT_TYPES = [
  { value: 'GT', label: 'GT (Gas Turbine)' },
  { value: 'ST', label: 'ST (Steam Turbine)' },
  { value: 'STV', label: 'STV (Steam Turbine Valve)' },
  { value: 'GEN', label: 'GEN (Generator)' },
  { value: 'COMP', label: 'COMP (Compressor)' },
];

// Cost Centres (FTE only)
export const COST_CENTRES = [
  'Powerforce Maintenance UK Limited',
  'Powerforce Global S.L',
  'Powerforce Maintenance B.V',
  'Powerforce Arabia for Operations and Maintenance Company',
  'Powerforce MENA Industrial Maintenance Services',
  'Powerforce Maintenance d.o.o.',
  'POWERFORCE MANUTENÇÃO INDUSTRIAL, UNIPESSOAL LDA',
  'Powerforce Maintenance Services Morocco',
];

// Role hierarchy (highest first)
export const ROLE_HIERARCHY = [
  'Superintendent',
  'Foreman',
  'Lead Technician',
  'Technician 2',
  'Technician 1',
  'Rigger',
  'Crane Driver',
  'HSE Officer',
  'Welder',
  'I&C Technician',
  'Electrician',
  'Apprentice',
];

export function getHighestRole(roles: string[]): string {
  if (!roles || roles.length === 0) return '';
  for (const r of ROLE_HIERARCHY) {
    if (roles.includes(r)) return r;
  }
  return roles[0]; // fallback
}

// English proficiency levels
export const ENGLISH_LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2', 'TBC'];

// Utilisation calculation: 187 working days baseline, 2 days mob/demob per assignment
// Uses actualDaysWorked (timesheet-confirmed) when available, falls back to planned duration
export function calcUtilisation(assignments: any[]): { days: number; pct: number; confirmed: boolean } {
  if (!assignments || assignments.length === 0) return { days: 0, pct: 0, confirmed: false };
  const hasActual = assignments.some((a: any) => a.actualDaysWorked != null);
  const rawDays = assignments.reduce((sum: number, a: any) => {
    return sum + (a.actualDaysWorked != null ? a.actualDaysWorked : (a.duration || 0));
  }, 0);
  const mobDemob = assignments.length * 2;
  const effectiveDays = Math.max(0, rawDays - mobDemob);
  return { days: effectiveDays, pct: Math.round(effectiveDays / 187 * 100), confirmed: hasActual };
}
// Auto-deploy test Wed Apr  8 16:53:59 UTC 2026

// ─── Slot sort: Day shift before Night shift, then by ROLE_HIERARCHY rank ───
const SHIFT_ORDER: Record<string, number> = { Day: 0, Night: 1 };
// ─── Strip internal name suffixes e.g. "(PFG SP)", "(PO)", "(CTC)" for display ───
export function cleanName(name: string): string {
  return name.replace(/\s*\([^)]*\)\s*$/g, "").trim();
}

// ─── Peak concurrent headcount ───────────────────────────────────────────────
// Returns the maximum number of concurrent role slots on any single day.
// This is the correct headcount — NOT the sum of all slot quantities.
export function calcPeakHeadcount(slots: { quantity: number; startDate?: string | null; endDate?: string | null }[]): number {
  const dated = slots.filter(s => s.startDate && s.endDate);
  if (dated.length === 0) return slots.reduce((sum, s) => sum + (s.quantity || 0), 0);

  // Collect all unique dates
  const allDates = new Set<string>();
  dated.forEach(s => {
    const start = new Date(s.startDate!);
    const end = new Date(s.endDate!);
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      allDates.add(d.toISOString().split('T')[0]);
    }
  });

  let peak = 0;
  allDates.forEach(dateStr => {
    const concurrent = dated
      .filter(s => s.startDate! <= dateStr && s.endDate! >= dateStr)
      .reduce((sum, s) => sum + (s.quantity || 0), 0);
    if (concurrent > peak) peak = concurrent;
  });
  return peak || slots.reduce((sum, s) => sum + (s.quantity || 0), 0);
}

export function sortSlots<T extends { role: string; shift?: string }>(slots: T[]): T[] {
  return [...slots].sort((a, b) => {
    const shiftA = SHIFT_ORDER[a.shift ?? 'Day'] ?? 0;
    const shiftB = SHIFT_ORDER[b.shift ?? 'Day'] ?? 0;
    if (shiftA !== shiftB) return shiftA - shiftB;
    const roleA = ROLE_HIERARCHY.indexOf(a.role);
    const roleB = ROLE_HIERARCHY.indexOf(b.role);
    const rankA = roleA === -1 ? 99 : roleA;
    const rankB = roleB === -1 ? 99 : roleB;
    return rankA - rankB;
  });
}

// ── Availability Helpers ──────────────────────────────────────────────────

type Period = { startDate: string; endDate: string };

/** Returns true if the assignment is active on a given date, using slot periods if available */
export function workerOnSiteOnDate(
  assignment: { startDate?: string | null; endDate?: string | null },
  date: string,
  slotPeriods?: Period[]
): boolean {
  // Assignment dates are ground truth — always check them first.
  // Slot periods can be stale (set to a future window that doesn't match when the
  // worker actually mobilised). Only fall back to slot periods if the assignment
  // itself has no start/end dates at all.
  const s = assignment.startDate;
  const e = assignment.endDate;
  if (s || e) {
    // Use assignment dates
    if (s && date < s) return false;
    if (e && date > e) return false;
    return true;
  }
  // No assignment dates — fall back to slot periods if available
  if (slotPeriods && slotPeriods.length > 0) {
    return slotPeriods.some(p => p.startDate <= date && p.endDate >= date);
  }
  return true;
}

/** Returns true if the assignment is active today. Pass slotPeriods for period-aware check. */
export function isCurrentlyActive(
  assignment: { startDate?: string | null; endDate?: string | null },
  slotPeriods?: Period[]
): boolean {
  const today = new Date().toISOString().split('T')[0];
  return workerOnSiteOnDate(assignment, today, slotPeriods);
}

/**
 * Returns a numbered display label for a slot when multiple slots share the same role.
 * e.g. 3 x "Technician 2" slots → "Technician 2 (1)", "Technician 2 (2)", "Technician 2 (3)"
 * Single slot of a role → just "Technician 2"
 */
export function slotLabel(slot: { id: number; role: string; shift?: string | null }, allSlots: { id: number; role: string; shift?: string | null }[]): string {
  const sameRole = allSlots.filter(s => s.role === slot.role && s.shift === slot.shift);
  if (sameRole.length <= 1) return slot.role;
  const idx = sameRole.findIndex(s => s.id === slot.id);
  return `${slot.role} (${idx + 1})`;
}
