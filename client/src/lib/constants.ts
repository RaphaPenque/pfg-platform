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
export function calcUtilisation(assignments: any[]): { days: number; pct: number } {
  if (!assignments || assignments.length === 0) return { days: 0, pct: 0 };
  const rawDays = assignments.reduce((sum: number, a: any) => sum + (a.duration || 0), 0);
  const mobDemob = assignments.length * 2;
  const effectiveDays = Math.max(0, rawDays - mobDemob);
  return { days: effectiveDays, pct: Math.round(effectiveDays / 187 * 100) };
}
