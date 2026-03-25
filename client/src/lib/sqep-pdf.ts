import jsPDF from "jspdf";
import type { DashboardWorker, DashboardAssignment } from "@/hooks/use-dashboard-data";
import { CERT_DEFS } from "@/lib/constants";

// PFG brand colors
const NAVY = "#1A1D23";
const YELLOW = "#F5BD00";
const STEEL = "#63758C";
const WHITE = "#FFFFFF";
const LIGHT_BG = "#F4F5F7";

function drawHeader(doc: jsPDF, title: string) {
  const pageW = doc.internal.pageSize.getWidth();
  // Navy header band
  doc.setFillColor(26, 29, 35); // NAVY
  doc.rect(0, 0, pageW, 28, "F");
  // Yellow accent line
  doc.setFillColor(245, 189, 0); // YELLOW
  doc.rect(0, 28, pageW, 2, "F");
  // Title text
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.setTextColor(255, 255, 255);
  doc.text("POWERFORCE GLOBAL", 15, 12);
  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(200, 200, 200);
  doc.text(title, 15, 20);
  // Date
  doc.setFontSize(8);
  doc.text(new Date().toLocaleDateString("en-GB"), pageW - 15, 20, { align: "right" });
}

function drawFooter(doc: jsPDF, pageNum: number) {
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  doc.setFillColor(26, 29, 35);
  doc.rect(0, pageH - 12, pageW, 12, "F");
  doc.setFontSize(7);
  doc.setTextColor(150, 150, 150);
  doc.text("Confidential — PowerForce Global SQEP Pack", 15, pageH - 4);
  doc.text(`Page ${pageNum}`, pageW - 15, pageH - 4, { align: "right" });
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

export function generateSqepPdf(worker: DashboardWorker): jsPDF {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const today = new Date().toISOString().split("T")[0];

  // ═══════════════════════════════════════════════════════
  // PAGE 1: Cover Profile
  // ═══════════════════════════════════════════════════════
  drawHeader(doc, "SQEP Personnel Pack");

  let y = 42;

  // Profile circle with initials
  const initials = worker.name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
  doc.setFillColor(26, 29, 35);
  doc.circle(pageW / 2, y + 18, 18, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.setTextColor(245, 189, 0);
  doc.text(initials, pageW / 2, y + 24, { align: "center" });

  y += 44;

  // Name
  doc.setFont("helvetica", "bold");
  doc.setFontSize(20);
  doc.setTextColor(26, 29, 35);
  doc.text(worker.name, pageW / 2, y, { align: "center" });
  y += 8;

  // Role
  doc.setFont("helvetica", "normal");
  doc.setFontSize(12);
  doc.setTextColor(99, 117, 140);
  doc.text(worker.role, pageW / 2, y, { align: "center" });
  y += 14;

  // Divider
  doc.setDrawColor(245, 189, 0);
  doc.setLineWidth(0.8);
  doc.line(pageW / 2 - 30, y, pageW / 2 + 30, y);
  y += 12;

  // Info grid
  const age = worker.dateOfBirth ? calcAge(worker.dateOfBirth) : worker.age || "—";
  const fields = [
    ["Age", age],
    ["Status", worker.status || "—"],
    ["Date Joined", worker.joined || "—"],
    ["English Proficiency", worker.englishLevel || "—"],
    ["Nationality", worker.nationality || "—"],
    ["Technical Level", worker.techLevel || "—"],
  ];

  const colWidth = 80;
  const startX = (pageW - colWidth * 2) / 2;

  for (let i = 0; i < fields.length; i++) {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const x = startX + col * colWidth;
    const fy = y + row * 18;

    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(99, 117, 140);
    doc.text(fields[i][0].toUpperCase(), x, fy);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(11);
    doc.setTextColor(26, 29, 35);
    doc.text(fields[i][1], x, fy + 6);
  }

  y += Math.ceil(fields.length / 2) * 18 + 10;

  // OEM Experience section
  if (worker.oemExperience.length > 0) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(99, 117, 140);
    doc.text("OEM EXPERIENCE", startX, y);
    y += 7;

    let oemX = startX;
    for (const oem of worker.oemExperience) {
      const name = oem.split(" - ")[0];
      const textWidth = doc.getTextWidth(name) + 8;

      if (oemX + textWidth > pageW - 15) {
        oemX = startX;
        y += 9;
      }

      // Badge background
      doc.setFillColor(244, 245, 247);
      doc.roundedRect(oemX, y - 4, textWidth, 7, 1.5, 1.5, "F");
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8);
      doc.setTextColor(26, 29, 35);
      doc.text(name, oemX + 4, y + 1);
      oemX += textWidth + 3;
    }
  }

  drawFooter(doc, 1);

  // ═══════════════════════════════════════════════════════
  // PAGE 2: Work Experience
  // ═══════════════════════════════════════════════════════
  doc.addPage();
  drawHeader(doc, "Work Experience — " + worker.name);

  const historicalAssignments = worker.assignments.filter(
    (a) => a.startDate && a.startDate <= today
  );

  y = 40;

  if (historicalAssignments.length === 0) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(11);
    doc.setTextColor(99, 117, 140);
    doc.text("No work experience recorded.", 15, y);
  } else {
    // Table header
    const cols = [
      { label: "Site / Project", x: 15, w: 45 },
      { label: "Start", x: 60, w: 22 },
      { label: "End", x: 82, w: 22 },
      { label: "Role", x: 104, w: 30 },
      { label: "OEM", x: 134, w: 28 },
      { label: "Equipment", x: 162, w: 22 },
    ];

    doc.setFillColor(244, 245, 247);
    doc.rect(15, y - 4, pageW - 30, 8, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7);
    doc.setTextColor(99, 117, 140);
    cols.forEach((col) => {
      doc.text(col.label.toUpperCase(), col.x, y);
    });

    y += 6;

    // Table rows
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);

    for (const a of historicalAssignments) {
      if (y > 270) {
        drawFooter(doc, doc.getNumberOfPages());
        doc.addPage();
        drawHeader(doc, "Work Experience — " + worker.name + " (cont.)");
        y = 40;
      }

      // Zebra striping
      const rowIdx = historicalAssignments.indexOf(a);
      if (rowIdx % 2 === 1) {
        doc.setFillColor(250, 250, 252);
        doc.rect(15, y - 3.5, pageW - 30, 7, "F");
      }

      doc.setTextColor(26, 29, 35);
      doc.text(truncate(`${a.projectName} (${a.projectCode})`, 32), cols[0].x, y);
      doc.text(a.startDate || "—", cols[1].x, y);
      doc.text(a.endDate || "—", cols[2].x, y);
      doc.text(truncate(a.role || a.task || worker.role, 20), cols[3].x, y);
      doc.text(truncate(a.customer || "—", 18), cols[4].x, y);
      doc.text(a.equipmentType || "—", cols[5].x, y);

      y += 7;
    }
  }

  drawFooter(doc, 2);

  // ═══════════════════════════════════════════════════════
  // PAGE 3: Qualifications & Certificates
  // ═══════════════════════════════════════════════════════
  doc.addPage();
  drawHeader(doc, "Qualifications & Certificates — " + worker.name);

  y = 40;

  const certCols = [
    { label: "Certificate", x: 15, w: 80 },
    { label: "Status", x: 110, w: 30 },
    { label: "Notes", x: 145, w: 40 },
  ];

  doc.setFillColor(244, 245, 247);
  doc.rect(15, y - 4, pageW - 30, 8, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7);
  doc.setTextColor(99, 117, 140);
  certCols.forEach((col) => {
    doc.text(col.label.toUpperCase(), col.x, y);
  });

  y += 6;

  doc.setFontSize(8);

  for (let i = 0; i < CERT_DEFS.length; i++) {
    const cert = CERT_DEFS[i];

    if (y > 270) {
      drawFooter(doc, doc.getNumberOfPages());
      doc.addPage();
      drawHeader(doc, "Qualifications & Certificates — " + worker.name + " (cont.)");
      y = 40;
    }

    // Zebra
    if (i % 2 === 1) {
      doc.setFillColor(250, 250, 252);
      doc.rect(15, y - 3.5, pageW - 30, 7, "F");
    }

    // Status indicator dot
    const isTrade = cert.name === "Trade Diploma";
    if (isTrade) {
      doc.setFillColor(34, 197, 94); // green
    } else {
      doc.setFillColor(200, 200, 200); // grey
    }
    doc.circle(certCols[0].x + 2, y - 1, 1.5, "F");

    doc.setTextColor(26, 29, 35);
    doc.setFont("helvetica", "normal");
    let certName = cert.name;
    if ((cert as any).noTradeAlt) {
      certName += ` / ${(cert as any).noTradeAlt}`;
    }
    doc.text(truncate(certName, 52), certCols[0].x + 7, y);

    doc.setFont("helvetica", "bold");
    doc.setTextColor(isTrade ? 34 : 150, isTrade ? 197 : 150, isTrade ? 94 : 150);
    doc.text(isTrade ? "Valid" : "—", certCols[1].x, y);

    doc.setTextColor(150, 150, 150);
    doc.setFont("helvetica", "normal");
    doc.text(
      isTrade ? (cert.completionOnly ? "Completion only" : "") : "",
      certCols[2].x,
      y
    );

    y += 7;
  }

  drawFooter(doc, 3);

  return doc;
}

function truncate(text: string, maxLen: number): string {
  return text.length > maxLen ? text.slice(0, maxLen - 1) + "…" : text;
}

export function downloadSqepPdf(worker: DashboardWorker) {
  const doc = generateSqepPdf(worker);
  const safeName = worker.name.replace(/\s+/g, "_").replace(/[^a-zA-Z0-9_-]/g, "");
  doc.save(`SQEP_${safeName}_${new Date().toISOString().split("T")[0]}.pdf`);
}

export function generateProjectOverviewPdf(
  project: { code: string; name: string; customer: string | null; location: string | null; equipmentType: string | null; startDate: string | null; endDate: string | null; shift: string | null; headcount: number | null; status: string | null },
  teamMembers: { worker: DashboardWorker; assignment: DashboardAssignment }[],
  customerName: string
): jsPDF {
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();

  // ═══ PAGE 1: Project Overview ═══
  // Navy header
  doc.setFillColor(26, 29, 35);
  doc.rect(0, 0, pageW, 32, "F");
  doc.setFillColor(245, 189, 0);
  doc.rect(0, 32, pageW, 2.5, "F");

  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.setTextColor(255, 255, 255);
  doc.text("POWERFORCE GLOBAL", 15, 14);
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(200, 200, 200);
  doc.text("Customer Pack — Project Overview", 15, 23);
  doc.setFontSize(8);
  doc.text(new Date().toLocaleDateString("en-GB"), pageW - 15, 23, { align: "right" });

  let y = 44;

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

  doc.setFillColor(26, 29, 35);
  doc.rect(15, y - 4, pageW - 30, 8, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7);
  doc.setTextColor(255, 255, 255);
  rosterCols.forEach((col) => doc.text(col.label.toUpperCase(), col.x, y));
  y += 6;

  // Table rows
  // Deduplicate workers (same worker may have multiple assignments)
  const seenWorkers = new Set<number>();
  const uniqueMembers = teamMembers.filter((m) => {
    if (seenWorkers.has(m.worker.id)) return false;
    seenWorkers.add(m.worker.id);
    return true;
  });

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);

  for (let i = 0; i < uniqueMembers.length; i++) {
    const m = uniqueMembers[i];

    if (y > pageH - 20) {
      // Footer
      doc.setFillColor(26, 29, 35);
      doc.rect(0, pageH - 10, pageW, 10, "F");
      doc.setFontSize(7);
      doc.setTextColor(150, 150, 150);
      doc.text("Confidential — PowerForce Global Customer Pack", 15, pageH - 4);
      doc.text(`Page ${doc.getNumberOfPages()}`, pageW - 15, pageH - 4, { align: "right" });

      doc.addPage("landscape");
      // Re-draw header
      doc.setFillColor(26, 29, 35);
      doc.rect(0, 0, pageW, 28, "F");
      doc.setFillColor(245, 189, 0);
      doc.rect(0, 28, pageW, 2, "F");
      doc.setFont("helvetica", "bold");
      doc.setFontSize(14);
      doc.setTextColor(255, 255, 255);
      doc.text("POWERFORCE GLOBAL", 15, 12);
      doc.setFontSize(9);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(200, 200, 200);
      doc.text(`Team Roster — ${project.code} (cont.)`, 15, 20);
      y = 40;

      // Re-draw table header
      doc.setFillColor(26, 29, 35);
      doc.rect(15, y - 4, pageW - 30, 8, "F");
      doc.setFont("helvetica", "bold");
      doc.setFontSize(7);
      doc.setTextColor(255, 255, 255);
      rosterCols.forEach((col) => doc.text(col.label.toUpperCase(), col.x, y));
      y += 6;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
    }

    // Zebra striping
    if (i % 2 === 1) {
      doc.setFillColor(250, 250, 252);
      doc.rect(15, y - 3.5, pageW - 30, 7, "F");
    }

    doc.setTextColor(26, 29, 35);
    doc.setFont("helvetica", "bold");
    doc.text(truncate(m.worker.name, 36), rosterCols[0].x, y);
    doc.setFont("helvetica", "normal");
    doc.text(truncate(m.assignment.role || m.assignment.task || m.worker.role, 24), rosterCols[1].x, y);
    doc.text(m.assignment.shift || "—", rosterCols[2].x, y);
    doc.text(m.assignment.startDate || "—", rosterCols[3].x, y);
    doc.text(m.assignment.endDate || "—", rosterCols[4].x, y);

    // OEM badges
    doc.setFontSize(7);
    const oemText = m.worker.oemExperience.map((o) => o.split(" - ")[0]).join(", ");
    doc.setTextColor(99, 117, 140);
    doc.text(truncate(oemText || "—", 50), rosterCols[5].x, y);
    doc.setFontSize(8);

    y += 7;
  }

  // Footer
  doc.setFillColor(26, 29, 35);
  doc.rect(0, pageH - 10, pageW, 10, "F");
  doc.setFontSize(7);
  doc.setTextColor(150, 150, 150);
  doc.text("Confidential — PowerForce Global Customer Pack", 15, pageH - 4);
  doc.text(`Page ${doc.getNumberOfPages()}`, pageW - 15, pageH - 4, { align: "right" });

  return doc;
}

export function downloadCustomerPack(
  project: { code: string; name: string; customer: string | null; location: string | null; equipmentType: string | null; startDate: string | null; endDate: string | null; shift: string | null; headcount: number | null; status: string | null },
  teamMembers: { worker: DashboardWorker; assignment: DashboardAssignment }[],
  customerName: string
) {
  // 1. Download the Project Overview PDF first
  const overviewDoc = generateProjectOverviewPdf(project, teamMembers, customerName);
  overviewDoc.save(`CustomerPack_${project.code}_Overview_${new Date().toISOString().split("T")[0]}.pdf`);

  // 2. Download individual SQEP packs
  // Deduplicate workers
  const seen = new Set<number>();
  for (const { worker } of teamMembers) {
    if (seen.has(worker.id)) continue;
    seen.add(worker.id);
    downloadSqepPdf(worker);
  }
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
