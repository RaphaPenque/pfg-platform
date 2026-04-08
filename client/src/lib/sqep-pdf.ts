import jsPDF from "jspdf";
import JSZip from "jszip";
import type { DashboardWorker, DashboardAssignment } from "@/hooks/use-dashboard-data";
import { CERT_DEFS } from "@/lib/constants";

// ─── Logo loader (cached — loads logo-gold-mark.png, gold on transparent) ────
const _logoCache: Record<string, string | null> = {};
async function loadDataUrl(path: string): Promise<string | null> {
  if (path in _logoCache) return _logoCache[path];
  try {
    const res = await fetch(path);
    const blob = await res.blob();
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => { _logoCache[path] = reader.result as string; resolve(_logoCache[path]); };
      reader.onerror = () => { _logoCache[path] = null; resolve(null); };
      reader.readAsDataURL(blob);
    });
  } catch { _logoCache[path] = null; return null; }
}

// ─── Clean worker name (strip suffixes like "(PFG SP)", "(PFG CO CTC)" etc) ──
function cleanName(name: string): string {
  return name.replace(/\s*\([^)]*\)\s*$/g, "").trim();
}

// ─── Legacy alias kept for Customer Pack logo loader ─────────────────────────
const getLogoDataUrl = () => loadDataUrl("/logo-gold-mark.png");

// PFG brand colors
const NAVY = "#1A1D23";
const YELLOW = "#F5BD00";
const STEEL = "#63758C";
const WHITE = "#FFFFFF";
const LIGHT_BG = "#F4F5F7";

const SQEP_HEADER_H = 32;

function drawSqepHeader(doc: jsPDF, logoUrl: string | null, subtitle: string) {
  const pageW = doc.internal.pageSize.getWidth();
  doc.setFillColor(26, 29, 35);
  doc.rect(0, 0, pageW, SQEP_HEADER_H, "F");
  doc.setFillColor(245, 189, 0);
  doc.rect(0, SQEP_HEADER_H, pageW, 2, "F");
  if (logoUrl) {
    // Logo is 662x208 px — scale to fit header height (~22mm tall)
    doc.addImage(logoUrl, "PNG", 10, 5, 55, 55 * (208 / 662));
  } else {
    doc.setFont("helvetica", "bold"); doc.setFontSize(13);
    doc.setTextColor(245, 189, 0);
    doc.text("Powerforce Global", 14, 15);
  }
  doc.setFont("helvetica", "normal"); doc.setFontSize(8);
  doc.setTextColor(180, 180, 180);
  doc.text(subtitle, logoUrl ? 70 : 14, 22);
  doc.setFontSize(7);
  doc.text(new Date().toLocaleDateString("en-GB"), pageW - 14, 22, { align: "right" });
}

function drawSqepFooter(doc: jsPDF, label: string) {
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  doc.setFillColor(26, 29, 35);
  doc.rect(0, pageH - 10, pageW, 10, "F");
  doc.setFontSize(7); doc.setFont("helvetica", "normal");
  doc.setTextColor(150, 150, 150);
  doc.text("Confidential — PowerForce Global SQEP Pack", 14, pageH - 3.5);
  doc.text(label, pageW - 14, pageH - 3.5, { align: "right" });
}

// Keep legacy aliases so Customer Pack header still works
const drawHeader = (doc: jsPDF, title: string) => drawSqepHeader(doc, null, title);
const drawFooter = (doc: jsPDF, n: number) => drawSqepFooter(doc, `Page ${n}`);

function calcAge(dob: string | null): string {
  if (!dob) return "—";
  const birth = new Date(dob);
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const m = today.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
  return String(age);
}

export async function generateSqepPdf(worker: DashboardWorker): Promise<jsPDF> {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const today = new Date().toISOString().split("T")[0];
  const logoUrl = await loadDataUrl("/logo-gold-mark.png");
  const name = cleanName(worker.name);
  const totalPages = 3; // updated below if overflow

  // ─── Shared section title helper ───────────────────────────────────────────
  function sectionTitle(label: string, atY: number) {
    doc.setFont("helvetica", "bold"); doc.setFontSize(9);
    doc.setTextColor(26, 29, 35);
    doc.text(label.toUpperCase(), 14, atY);
    doc.setDrawColor(245, 189, 0); doc.setLineWidth(0.5);
    doc.line(14, atY + 1.5, pageW - 14, atY + 1.5);
  }

  function tableHeader(cols: {label:string;x:number}[], atY: number) {
    doc.setFillColor(26, 29, 35);
    doc.rect(14, atY - 4, pageW - 28, 8, "F");
    doc.setFont("helvetica", "bold"); doc.setFontSize(7);
    doc.setTextColor(255, 255, 255);
    cols.forEach(c => doc.text(c.label.toUpperCase(), c.x, atY));
  }

  // ═══ PAGE 1: Profile Summary ═══════════════════════════════════════════════════
  drawSqepHeader(doc, logoUrl, "SQEP Personnel Pack");

  let y = SQEP_HEADER_H + 12;

  // Initials circle
  const initials = name.split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2);
  doc.setFillColor(26, 29, 35);
  doc.circle(pageW / 2, y + 14, 14, "F");
  doc.setFont("helvetica", "bold"); doc.setFontSize(14);
  doc.setTextColor(245, 189, 0);
  doc.text(initials, pageW / 2, y + 19, { align: "center" });
  y += 34;

  // Name + role
  doc.setFont("helvetica", "bold"); doc.setFontSize(18);
  doc.setTextColor(26, 29, 35);
  doc.text(name, pageW / 2, y, { align: "center" });
  y += 7;
  doc.setFont("helvetica", "normal"); doc.setFontSize(11);
  doc.setTextColor(99, 117, 140);
  doc.text(worker.role, pageW / 2, y, { align: "center" });
  y += 5;
  doc.setDrawColor(245, 189, 0); doc.setLineWidth(0.7);
  doc.line(pageW / 2 - 25, y, pageW / 2 + 25, y);
  y += 10;

  // Info grid (2 cols x 3 rows)
  const age = worker.dateOfBirth ? calcAge(worker.dateOfBirth) : worker.age || "—";
  const fields = [
    ["Nationality",          worker.nationality || "—"],
    ["Status",               worker.status || "—"],
    ["Date Joined",          worker.joined || "—"],
    ["English Proficiency",  worker.englishLevel || "—"],
    ["Technical Level",      worker.techLevel || "—"],
    ["Cost Centre",          worker.costCentre || "—"],
  ];
  const gPad = 6;
  const gW = (pageW - 28 - gPad) / 2;
  const gX = [14, 14 + gW + gPad];

  // Grid background
  doc.setFillColor(244, 245, 247);
  doc.roundedRect(14, y - 4, pageW - 28, Math.ceil(fields.length / 2) * 16 + 4, 2, 2, "F");

  for (let i = 0; i < fields.length; i++) {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const fx = gX[col] + 4;
    const fy = y + row * 16;
    doc.setFont("helvetica", "bold"); doc.setFontSize(7);
    doc.setTextColor(99, 117, 140);
    doc.text(fields[i][0].toUpperCase(), fx, fy);
    doc.setFont("helvetica", "normal"); doc.setFontSize(10);
    doc.setTextColor(26, 29, 35);
    doc.text(fields[i][1], fx, fy + 6);
  }
  y += Math.ceil(fields.length / 2) * 16 + 8;

  // OEM Experience
  if (worker.oemExperience.length > 0) {
    sectionTitle("OEM Experience", y);
    y += 8;
    let oemX = 14;
    for (const oem of worker.oemExperience) {
      const label = oem.split(" - ")[0];
      const tw = doc.getTextWidth(label) + 8;
      if (oemX + tw > pageW - 14) { oemX = 14; y += 9; }
      doc.setFillColor(244, 245, 247);
      doc.roundedRect(oemX, y - 4, tw, 7, 1.5, 1.5, "F");
      doc.setFont("helvetica", "bold"); doc.setFontSize(8);
      doc.setTextColor(26, 29, 35);
      doc.text(label, oemX + 4, y + 1);
      oemX += tw + 3;
    }
    y += 12;
  }

  // Current / active assignments
  const activeAssignments = worker.assignments.filter(a =>
    a.status === "active" || a.status === "flagged"
  );
  if (activeAssignments.length > 0) {
    sectionTitle("Current Assignment" + (activeAssignments.length > 1 ? "s" : ""), y);
    y += 8;
    const aCols = [
      { label: "Project",  x: 14 },
      { label: "Role",     x: 90 },
      { label: "Shift",    x: 130 },
      { label: "Dates",    x: 152 },
      { label: "Location", x: 185 },
    ];
    tableHeader(aCols, y);
    y += 6;
    doc.setFont("helvetica", "normal"); doc.setFontSize(8);
    for (let i = 0; i < activeAssignments.length; i++) {
      const a = activeAssignments[i];
      if (i % 2 === 1) {
        doc.setFillColor(250, 250, 252);
        doc.rect(14, y - 3.5, pageW - 28, 7, "F");
      }
      doc.setTextColor(26, 29, 35);
      doc.text(truncate(`${a.projectCode} — ${a.projectName}`, 36), aCols[0].x, y);
      doc.text(truncate(a.role || a.task || worker.role, 18), aCols[1].x, y);
      doc.text(a.shift || "—", aCols[2].x, y);
      doc.text(`${a.startDate || "—"} → ${a.endDate || "—"}`, aCols[3].x, y);
      doc.setTextColor(99, 117, 140);
      doc.text(truncate((a as any).location || "—", 18), aCols[4].x, y);
      y += 7;
    }
  }

  drawSqepFooter(doc, `Page 1 of ${doc.getNumberOfPages() + 2}`);

  // ═══ PAGE 2: Work Experience ═══════════════════════════════════════════════════
  doc.addPage();
  drawSqepHeader(doc, logoUrl, `Work Experience — ${name}`);

  const pastAssignments = worker.assignments
    .filter(a => a.startDate && a.startDate <= today)
    .sort((a, b) => (b.startDate || "").localeCompare(a.startDate || "")); // most recent first

  y = SQEP_HEADER_H + 12;

  const wCols = [
    { label: "Site / Project",  x: 14,  w: 42 },
    { label: "Start",           x: 56,  w: 20 },
    { label: "End",             x: 76,  w: 20 },
    { label: "Role",            x: 96,  w: 24 },
    { label: "OEM",             x: 120, w: 24 },
    { label: "Equip.",          x: 144, w: 16 },
    { label: "Scope of Work",   x: 160, w: 36 },
  ];

  if (pastAssignments.length === 0) {
    doc.setFont("helvetica", "normal"); doc.setFontSize(10);
    doc.setTextColor(99, 117, 140);
    doc.text("No work experience recorded.", 14, y);
  } else {
    tableHeader(wCols, y);
    y += 6;
    doc.setFont("helvetica", "normal"); doc.setFontSize(7.5);
    for (let i = 0; i < pastAssignments.length; i++) {
      const a = pastAssignments[i];
      if (y > pageH - 18) {
        drawSqepFooter(doc, `Page ${doc.getNumberOfPages()}`);
        doc.addPage();
        drawSqepHeader(doc, logoUrl, `Work Experience — ${name} (cont.)`);
        y = SQEP_HEADER_H + 12;
        tableHeader(wCols, y); y += 6;
        doc.setFont("helvetica", "normal"); doc.setFontSize(7.5);
      }
      if (i % 2 === 1) {
        doc.setFillColor(250, 250, 252);
        doc.rect(14, y - 3, pageW - 28, 6.5, "F");
      }
      doc.setTextColor(26, 29, 35);
      doc.text(truncate(`${a.projectName} (${a.projectCode})`, 30), wCols[0].x, y);
      doc.text(a.startDate || "—", wCols[1].x, y);
      doc.text(a.endDate || "—", wCols[2].x, y);
      doc.text(truncate(a.role || a.task || worker.role, 16), wCols[3].x, y);
      doc.setTextColor(99, 117, 140);
      doc.text(truncate(a.customer || "—", 16), wCols[4].x, y);
      doc.text(a.equipmentType || "—", wCols[5].x, y);
      doc.setTextColor(26, 29, 35);
      doc.text(truncate(a.task || a.role || "—", 28), wCols[6].x, y);
      y += 6.5;
    }
  }
  drawSqepFooter(doc, `Page ${doc.getNumberOfPages()}`);

  // ═══ PAGE 3: Qualifications & Certificates ════════════════════════════════════
  doc.addPage();
  drawSqepHeader(doc, logoUrl, `Qualifications & Certificates — ${name}`);
  y = SQEP_HEADER_H + 12;

  // Section A: Certificate checklist
  sectionTitle("Certificate Checklist", y);
  y += 8;

  const cCols = [
    { label: "Certificate",  x: 14 },
    { label: "Status",       x: 115 },
    { label: "Expiry",       x: 148 },
    { label: "Notes",        x: 174 },
  ];
  tableHeader(cCols, y); y += 6;

  // Get worker's actual documents for cross-referencing
  const workerDocs = (worker as any).documents as Array<{
    type: string; name: string; fileName: string | null;
    filePath: string | null; expiryDate: string | null;
    issuedDate: string | null; status: string | null;
  }> | undefined || [];

  doc.setFontSize(8);
  for (let i = 0; i < CERT_DEFS.length; i++) {
    const cert = CERT_DEFS[i];
    if (y > pageH - 18) {
      drawSqepFooter(doc, `Page ${doc.getNumberOfPages()}`);
      doc.addPage();
      drawSqepHeader(doc, logoUrl, `Certificates — ${name} (cont.)`);
      y = SQEP_HEADER_H + 12;
      tableHeader(cCols, y); y += 6;
      doc.setFontSize(8);
    }
    if (i % 2 === 1) {
      doc.setFillColor(250, 250, 252);
      doc.rect(14, y - 3, pageW - 28, 6.5, "F");
    }
    // Match against uploaded docs
    const matchedDoc = workerDocs.find(d =>
      d.name.toLowerCase().includes(cert.name.toLowerCase().substring(0, 12)) ||
      cert.name.toLowerCase().includes(d.name.toLowerCase().substring(0, 12))
    );
    const hasDoc = !!matchedDoc;
    const isExpired = matchedDoc?.expiryDate ? matchedDoc.expiryDate < today : false;
    const isExpiring = matchedDoc?.expiryDate
      ? matchedDoc.expiryDate >= today && matchedDoc.expiryDate <= new Date(Date.now() + 90*24*60*60*1000).toISOString().split("T")[0]
      : false;

    // Status dot
    if (hasDoc && !isExpired)   doc.setFillColor(34, 197, 94);   // green
    else if (isExpiring)        doc.setFillColor(245, 158, 11);  // amber
    else if (isExpired)         doc.setFillColor(239, 68, 68);   // red
    else                        doc.setFillColor(200, 200, 200); // grey
    doc.circle(cCols[0].x + 2, y - 1, 1.5, "F");

    let certName = cert.name;
    if ((cert as any).noTradeAlt) certName += ` / ${(cert as any).noTradeAlt}`;

    doc.setFont("helvetica", "normal"); doc.setTextColor(26, 29, 35);
    doc.text(truncate(certName, 50), cCols[0].x + 7, y);

    doc.setFont("helvetica", "bold");
    if (hasDoc && !isExpired)   doc.setTextColor(34, 197, 94);
    else if (isExpiring)        doc.setTextColor(245, 158, 11);
    else if (isExpired)         doc.setTextColor(239, 68, 68);
    else                        doc.setTextColor(180, 180, 180);
    doc.text(hasDoc ? (isExpired ? "Expired" : isExpiring ? "Expiring" : "Valid") : "—", cCols[1].x, y);

    doc.setFont("helvetica", "normal"); doc.setTextColor(99, 117, 140);
    doc.text(matchedDoc?.expiryDate || "—", cCols[2].x, y);
    doc.text(truncate(matchedDoc?.status || "", 16), cCols[3].x, y);

    y += 6.5;
  }

  // Section B: Uploaded documents
  if (workerDocs.length > 0) {
    y += 6;
    if (y > pageH - 40) {
      drawSqepFooter(doc, `Page ${doc.getNumberOfPages()}`);
      doc.addPage();
      drawSqepHeader(doc, logoUrl, `Uploaded Documents — ${name}`);
      y = SQEP_HEADER_H + 12;
    }
    sectionTitle("Uploaded Documents", y);
    y += 8;
    const dCols = [
      { label: "Type / Name",  x: 14 },
      { label: "File",         x: 90 },
      { label: "Issued",       x: 140 },
      { label: "Expiry",       x: 163 },
      { label: "Status",       x: 186 },
    ];
    tableHeader(dCols, y); y += 6;
    doc.setFont("helvetica", "normal"); doc.setFontSize(7.5);
    for (let i = 0; i < workerDocs.length; i++) {
      const d = workerDocs[i];
      if (i % 2 === 1) {
        doc.setFillColor(250, 250, 252);
        doc.rect(14, y - 3, pageW - 28, 6.5, "F");
      }
      const isExp = d.expiryDate ? d.expiryDate < today : false;
      const isExpiring2 = d.expiryDate ? d.expiryDate >= today && d.expiryDate <= new Date(Date.now()+90*24*60*60*1000).toISOString().split("T")[0] : false;
      doc.setTextColor(26, 29, 35);
      doc.text(truncate(d.name, 36), dCols[0].x, y);
      doc.setTextColor(99, 117, 140);
      doc.text(truncate(d.fileName || "—", 28), dCols[1].x, y);
      doc.setTextColor(26, 29, 35);
      doc.text(d.issuedDate || "—", dCols[2].x, y);
      doc.text(d.expiryDate || "—", dCols[3].x, y);
      if (isExp)       doc.setTextColor(239, 68, 68);
      else if (isExpiring2) doc.setTextColor(245, 158, 11);
      else             doc.setTextColor(34, 197, 94);
      doc.setFont("helvetica", "bold");
      doc.text(isExp ? "Expired" : isExpiring2 ? "Expiring" : "Valid", dCols[4].x, y);
      doc.setFont("helvetica", "normal");
      y += 6.5;
    }
    y += 4;
    doc.setFontSize(7); doc.setTextColor(150,150,150);
    doc.text("Certificate originals are included in the attached ZIP file.", 14, y);
  }

  drawSqepFooter(doc, `Page ${doc.getNumberOfPages()}`);
  return doc;
}

function truncate(text: string, maxLen: number): string {
  return text.length > maxLen ? text.slice(0, maxLen - 1) + "…" : text;
}

export async function downloadSqepPdf(worker: DashboardWorker) {
  const doc = await generateSqepPdf(worker);
  const safeName = cleanName(worker.name).replace(/\s+/g, "_").replace(/[^a-zA-Z0-9_-]/g, "");
  doc.save(`SQEP_${safeName}_${new Date().toISOString().split("T")[0]}.pdf`);
}

// ─── Role sort order for roster (mirrors portal) ────────────────────────────────
const ROSTER_ROLE_ORDER = ["Superintendent","Foreman","Lead Technician","Technician 2","Technician 1","Rigger","Crane Driver","HSE Officer","Welder","I&C Technician","Electrician","Apprentice"];
const ROSTER_SHIFT_ORDER: Record<string,number> = { Day: 0, Night: 1 };

function sortRosterMembers(members: { worker: DashboardWorker; assignment: DashboardAssignment }[]) {
  return [...members].sort((a, b) => {
    const shA = ROSTER_SHIFT_ORDER[a.assignment.shift ?? "Day"] ?? 0;
    const shB = ROSTER_SHIFT_ORDER[b.assignment.shift ?? "Day"] ?? 0;
    if (shA !== shB) return shA - shB;
    const rA = ROSTER_ROLE_ORDER.indexOf(a.assignment.task || a.worker.role);
    const rB = ROSTER_ROLE_ORDER.indexOf(b.assignment.task || b.worker.role);
    return (rA === -1 ? 99 : rA) - (rB === -1 ? 99 : rB);
  });
}

export async function generateProjectOverviewPdf(
  project: { code: string; name: string; customer: string | null; location: string | null; equipmentType: string | null; startDate: string | null; endDate: string | null; shift: string | null; headcount: number | null; status: string | null },
  teamMembers: { worker: DashboardWorker; assignment: DashboardAssignment }[],
  customerName: string
): Promise<jsPDF> {
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const logoUrl = await getLogoDataUrl();

  // ─── Helper: draw page header ───────────────────────────────────────────────
const HEADER_H = 36;
  function drawPageHeader(subtitle: string) {
    doc.setFillColor(26, 29, 35);
    doc.rect(0, 0, pageW, HEADER_H, "F");
    doc.setFillColor(245, 189, 0);
    doc.rect(0, HEADER_H, pageW, 2.5, "F");
    // Logo image (or fallback text)
    if (logoUrl) {
      doc.addImage(logoUrl, "PNG", 12, 6, 48, 22);
    } else {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(14);
      doc.setTextColor(245, 189, 0);
      doc.text("POWERFORCE GLOBAL", 15, 18);
    }
    // Subtitle + date on the right
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(200, 200, 200);
    doc.text(subtitle, logoUrl ? 68 : 15, 26);
    doc.setFontSize(8);
    doc.text(new Date().toLocaleDateString("en-GB"), pageW - 15, 26, { align: "right" });
  }

  // ─── Helper: draw page footer ───────────────────────────────────────────────
  function drawPageFooter() {
    doc.setFillColor(26, 29, 35);
    doc.rect(0, pageH - 10, pageW, 10, "F");
    doc.setFontSize(7);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(150, 150, 150);
    doc.text("Confidential — PowerForce Global Customer Pack", 15, pageH - 4);
    doc.text(`Page ${doc.getNumberOfPages()}`, pageW - 15, pageH - 4, { align: "right" });
  }

  // ═══ PAGE 1: Project Overview ═══
  drawPageHeader("Customer Pack — Project Overview");
  let y = HEADER_H + 14; // well below header + yellow bar

  // Project title
  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.setTextColor(26, 29, 35);
  doc.text(`${project.code} — ${project.name}`, 15, y);
  y += 8;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  doc.setTextColor(99, 117, 140);
  doc.text(customerName || "—", 15, y);
  y += 12;

  // Project details grid
  const detailFields = [
    ["Customer", customerName || "—"],
    ["Location", project.location || "—"],
    ["Equipment", project.equipmentType || "—"],
    ["Shift Pattern", project.shift || "—"],
    ["Start Date", project.startDate || "—"],
    ["End Date", project.endDate || "—"],
    ["Headcount", String(project.headcount || teamMembers.length)],
    ["Team Assigned", String(teamMembers.length)],
  ];

  doc.setFillColor(244, 245, 247);
  doc.roundedRect(15, y - 4, pageW - 30, 28, 2, 2, "F");

  const detailColW = (pageW - 30) / 4;
  for (let i = 0; i < detailFields.length; i++) {
    const col = i % 4;
    const row = Math.floor(i / 4);
    const dx = 20 + col * detailColW;
    const dy = y + row * 14;

    doc.setFont("helvetica", "bold");
    doc.setFontSize(7);
    doc.setTextColor(99, 117, 140);
    doc.text(detailFields[i][0].toUpperCase(), dx, dy);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(26, 29, 35);
    doc.text(detailFields[i][1], dx, dy + 5);
  }

  y += 36;

  // Team Roster table
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.setTextColor(26, 29, 35);
  doc.text("Team Roster", 15, y);
  y += 8;

  // Table header
  const rosterCols = [
    { label: "Name", x: 15, w: 60 },
    { label: "Role", x: 75, w: 40 },
    { label: "Shift", x: 115, w: 20 },
    { label: "Start Date", x: 135, w: 28 },
    { label: "End Date", x: 163, w: 28 },
    { label: "OEM Experience", x: 191, w: 80 },
  ];

  // ─── Draw table header row ───────────────────────────────────────────────
  function drawTableHeader(atY: number) {
    doc.setFillColor(26, 29, 35);
    doc.rect(15, atY - 4, pageW - 30, 8, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7);
    doc.setTextColor(255, 255, 255);
    rosterCols.forEach((col) => doc.text(col.label.toUpperCase(), col.x, atY));
  }

  // Sort all assignments: Day first then Night, then by role hierarchy
  const sortedMembers = sortRosterMembers(teamMembers);

  drawTableHeader(y);
  y += 6;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);

  let prevShift: string | null = null;

  for (let i = 0; i < sortedMembers.length; i++) {
    const m = sortedMembers[i];
    const rowShift = m.assignment.shift || "Day";

    // Page break
    if (y > pageH - 18) {
      drawPageFooter();
      doc.addPage("landscape");
      drawPageHeader(`Team Roster — ${project.code} (cont.)`);
      y = HEADER_H + 14;
      prevShift = null; // reset shift group on new page
      drawTableHeader(y);
      y += 6;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
    }

    // Shift group divider row
    if (rowShift !== prevShift) {
      if (y > HEADER_H + 20) y += 1; // small gap before divider
      doc.setFillColor(rowShift === "Night" ? 26 : 244, rowShift === "Night" ? 29 : 245, rowShift === "Night" ? 35 : 247);
      doc.rect(15, y - 3, pageW - 30, 6, "F");
      doc.setFont("helvetica", "bold");
      doc.setFontSize(7);
      doc.setTextColor(rowShift === "Night" ? 245 : 99, rowShift === "Night" ? 189 : 117, rowShift === "Night" ? 0 : 140);
      doc.text((rowShift === "Night" ? "● Night Shift" : "○ Day Shift").toUpperCase(), 20, y + 0.5);
      y += 7;
      prevShift = rowShift;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
    }

    // Zebra striping (within group)
    if (i % 2 === 1) {
      doc.setFillColor(250, 250, 252);
      doc.rect(15, y - 3.5, pageW - 30, 7, "F");
    }

    const roleLabel = m.assignment.task || m.assignment.role || m.worker.role;
    const oemText = m.worker.oemExperience.map((o: string) => o.split(" - ")[0]).join(", ");

    doc.setTextColor(26, 29, 35);
    doc.setFont("helvetica", "bold");
    doc.text(truncate(m.worker.name, 36), rosterCols[0].x, y);
    doc.setFont("helvetica", "normal");
    doc.text(truncate(roleLabel, 24), rosterCols[1].x, y);
    doc.text(rowShift, rosterCols[2].x, y);
    doc.text(m.assignment.startDate || "—", rosterCols[3].x, y);
    doc.text(m.assignment.endDate || "—", rosterCols[4].x, y);
    doc.setFontSize(7);
    doc.setTextColor(99, 117, 140);
    doc.text(truncate(oemText || "—", 50), rosterCols[5].x, y);
    doc.setFontSize(8);

    y += 7;
  }

  drawPageFooter();
  return doc;
}

export async function downloadCustomerPack(
  project: { code: string; name: string; customer: string | null; location: string | null; equipmentType: string | null; startDate: string | null; endDate: string | null; shift: string | null; headcount: number | null; status: string | null },
  teamMembers: { worker: DashboardWorker; assignment: DashboardAssignment }[],
  customerName: string
) {
  const zip = new JSZip();
  const date = new Date().toISOString().split("T")[0];
  const projectFolder = zip.folder(`${project.code}_CustomerPack_${date}`)!;

  // 1. Project overview PDF
  const overviewDoc = await generateProjectOverviewPdf(project, teamMembers, customerName);
  const overviewBlob = overviewDoc.output("blob");
  projectFolder.file(`${project.code}_ProjectOverview.pdf`, overviewBlob);

  // 2. One folder per unique worker with their SQEP PDF + certificate files
  const seenWorkers = new Set<number>();
  for (const { worker } of teamMembers) {
    if (seenWorkers.has(worker.id)) continue;
    seenWorkers.add(worker.id);

    const safeName = worker.name.replace(/\s+/g, "_").replace(/[^a-zA-Z0-9_-]/g, "");
    const workerFolder = projectFolder.folder(safeName)!;

    // SQEP PDF
    const sqepDoc = await generateSqepPdf(worker);
    workerFolder.file(`SQEP_${safeName}.pdf`, sqepDoc.output("blob"));

    // Certificate files (from their documents)
    const docs = (worker as any).documents as Array<{ type: string; name: string; fileName: string | null; filePath: string | null; mimeType: string | null }> | undefined;
    if (docs && docs.length > 0) {
      const certsFolder = workerFolder.folder("Certificates")!;
      for (const d of docs) {
        if (!d.filePath) continue;
        try {
          // filePath is like /api/uploads/123/filename.pdf
          const res = await fetch(d.filePath, { credentials: "include" });
          if (!res.ok) continue;
          const blob = await res.blob();
          // Use a clean filename: type_name.ext
          const ext = d.fileName?.split(".").pop() || "pdf";
          const cleanName = `${d.type}_${d.name}`.replace(/[^a-zA-Z0-9_\-\.]/g, "_").substring(0, 60);
          certsFolder.file(`${cleanName}.${ext}`, blob);
        } catch { /* skip failed fetches */ }
      }
    }
  }

  // 3. Generate and trigger ZIP download
  const zipBlob = await zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 } });
  const url = URL.createObjectURL(zipBlob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${project.code}_CustomerPack_${date}.zip`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export function downloadAllSqepPdfs(
  workers: { worker: DashboardWorker; assignment: DashboardAssignment }[],
  projectCode: string
) {
  // Generate individual PDFs sequentially and download each one
  for (const { worker } of workers) {
    downloadSqepPdf(worker);
  }
}
