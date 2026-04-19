/**
 * Shared Playwright HTML → PDF renderer.
 * Replaces ReportLab (weekly report) and pdf-lib (timesheet) generators.
 */

import { chromium } from "playwright";
import * as fs from "fs";
import * as path from "path";

/** Render an HTML string to a PDF file saved at outPath */
export async function renderHtmlToPdf(
  html: string,
  outPath: string,
  opts: { landscape?: boolean; format?: "A4" | "Letter" } = {}
): Promise<void> {
  // Use system Chromium if available (more reliable on Render than Playwright-managed binary)
  const executablePath = (() => {
    const { execSync } = require('child_process');
    const candidates = ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome'];
    for (const p of candidates) {
      try { execSync(`test -f ${p}`, { stdio: 'pipe' }); return p; } catch { /* try next */ }
    }
    return undefined; // fall back to Playwright-managed
  })();

  const browser = await chromium.launch({
    executablePath,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
  });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle" });
    await page.pdf({
      path: outPath,
      format: opts.format ?? "A4",
      landscape: opts.landscape ?? false,
      printBackground: true,
      margin: { top: "0", right: "0", bottom: "0", left: "0" },
    });
  } finally {
    await browser.close();
  }
}

/** Read logo-gold.png and return as base64 data URI */
export function logoBase64(name: "logo-gold" | "logo-gold-mark" | "logo-white" = "logo-gold"): string {
  const p = path.join(process.cwd(), `client/public/${name}.png`);
  if (!fs.existsSync(p)) return "";
  const buf = fs.readFileSync(p);
  return `data:image/png;base64,${buf.toString("base64")}`;
}

import * as path2 from "path";
import * as os from "os";

/**
 * Generate the signed timesheet PDF using the approved HTML design.
 * Matches the design at /timesheet-pdf-design/index.html exactly.
 */
export async function generateTimesheetPdfHtml(tw: any, entries: any[], outPath: string): Promise<void> {
  const fullLogoPath = path2.join(process.cwd(), "client/public/logo-gold.png");
  const logoB64 = (() => {
    try {
      const buf = require("fs").readFileSync(fullLogoPath);
      return `data:image/png;base64,${buf.toString("base64")}`;
    } catch { return ""; }
  })();

  const workerMap = new Map<number, { name: string; role: string; shift: string; entries: any[] }>();
  for (const e of entries) {
    if (!workerMap.has(e.worker_id)) {
      workerMap.set(e.worker_id, { name: e.worker_name, role: e.worker_role, shift: e.shift, entries: [] });
    }
    workerMap.get(e.worker_id)!.entries.push(e);
  }

  const weekStart = new Date(tw.week_commencing);
  const weekDates = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart);
    d.setUTCDate(d.getUTCDate() + i);
    return d;
  });
  const dayLabels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

  function fmtDate(d: Date) {
    return `${d.getUTCDate().toString().padStart(2,"0")}/${(d.getUTCMonth()+1).toString().padStart(2,"0")}`;
  }

  function dayTypeClass(dt: string) {
    const map: Record<string,string> = {
      rest_day:"rest", absent_sick:"sick", mob:"mob", partial_mob:"mob",
      demob:"demob", partial_demob:"demob", absent_unauthorised:"sick",
    };
    return map[dt] || "";
  }
  function dayTypeLabel(dt: string) {
    const map: Record<string,string> = {
      rest_day:"Rest Day", absent_sick:"Absent — Sick",
      mob:"MOB", demob:"DEMOB", partial_mob:"MOB ½", partial_demob:"DEMOB ½",
      absent_unauthorised:"Absent", working:"",
    };
    return map[dt] ?? dt;
  }

  // Build table rows grouped by shift
  const dayWorkers = Array.from(workerMap.values()).filter(w => w.shift === "day");
  const nightWorkers = Array.from(workerMap.values()).filter(w => w.shift === "night");

  function buildRows(workers: typeof dayWorkers) {
    return workers.map((w, i) => {
      let total = 0;
      const cells = weekDates.map(date => {
        const dateStr = date.toISOString().split("T")[0];
        const entry = w.entries.find(e => String(e.entry_date).substring(0,10) === dateStr);
        if (!entry) return `<td class="c-day rest" style="text-align:center;font-size:10px;">—</td>`;
        const cls = dayTypeClass(entry.day_type);
        const label = dayTypeLabel(entry.day_type);
        const hrs = parseFloat(entry.total_hours || "0") || 0;
        total += hrs;
        if (cls) return `<td class="c-day ${cls}" style="text-align:center;font-size:10px;">${label}</td>`;
        const override = entry.is_override ? " override" : "";
        const tin = entry.time_in?.substring(0,5) || "";
        const tout = entry.time_out?.substring(0,5) || "";
        return `<td class="c-day${override}" style="text-align:center;font-size:10px;line-height:1.35;">
          <span class="tt" style="font-weight:600;color:#1a2744;display:block;">${tin}/${tout}</span>
          <span class="hr" style="color:#6B7C93;font-size:9.5px;">${hrs.toFixed(1)}h</span>
        </td>`;
      }).join("");
      const bg = i % 2 === 0 ? "#FAFBFC" : "white";
      return `<tr>
        <td style="padding:7px 6px 7px 14px;border:1px solid #E5E7EB;background:${bg};">
          <div style="font-weight:600;color:#1a2744;font-size:11px;white-space:nowrap;">${w.name}</div>
          <div style="font-size:10px;color:#6B7C93;">${w.role}</div>
          <div style="font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.04em;color:${w.shift==="night"?"#3730A3":"#B45309"};">${w.shift}</div>
        </td>
        ${cells}
        <td style="text-align:right;padding:7px 10px;border:1px solid #E5E7EB;font-weight:700;color:#1a2744;font-size:11.5px;background:${bg};">${total.toFixed(1)}h</td>
      </tr>`;
    }).join("");
  }

  const thCols = weekDates.map((d, i) => `<th class="c-day" style="text-align:center;min-width:70px;padding:8px 6px;background:#1a2744;color:#D4A017;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.03em;border-right:1px solid rgba(255,255,255,0.08);">
    <span style="display:block;">${dayLabels[i]}</span>
    <span style="display:block;font-size:9px;font-weight:400;color:rgba(255,255,255,0.5);margin-top:1px;">${fmtDate(d)}</span>
  </th>`).join("");

  const dayGrandTotal = dayWorkers.reduce((s,w) => s + w.entries.reduce((ss,e) => ss + (parseFloat(e.total_hours||"0")||0), 0), 0);
  const nightGrandTotal = nightWorkers.reduce((s,w) => s + w.entries.reduce((ss,e) => ss + (parseFloat(e.total_hours||"0")||0), 0), 0);
  const grandTotal = dayGrandTotal + nightGrandTotal;

  const approvalBlock = tw.approval_name ? `
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;font-size:11px;font-weight:600;color:#166534;">
      <span style="width:18px;height:18px;background:#16A34A;color:white;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-size:11px;flex-shrink:0;">✓</span>
      Electronic Approval Record
    </div>
    <div style="font-size:10.5px;line-height:1.7;">
      <div><span style="color:#6B7C93;font-weight:600;display:inline-block;min-width:140px;">Approved by:</span> <span style="font-weight:600;color:#1a2744;">${tw.approval_name}</span></div>
      <div><span style="color:#6B7C93;font-weight:600;display:inline-block;min-width:140px;">Email:</span> <span style="font-family:monospace;color:#1a2744;">${tw.approval_email || ""}</span></div>
      <div><span style="color:#6B7C93;font-weight:600;display:inline-block;min-width:140px;">IP Address:</span> <span style="font-family:monospace;color:#1a2744;">${tw.approval_ip || ""}</span></div>
      <div><span style="color:#6B7C93;font-weight:600;display:inline-block;min-width:140px;">Timestamp:</span> <span style="font-family:monospace;color:#1a2744;">${tw.customer_approved_at ? new Date(tw.customer_approved_at).toISOString().replace("T"," ").substring(0,19) + " UTC" : ""}</span></div>
      <div><span style="color:#6B7C93;font-weight:600;display:inline-block;min-width:140px;">Integrity hash:</span> <span style="font-family:monospace;color:#1a2744;">${tw.approval_hash?.substring(0,16) || "pending"}</span></div>
    </div>` : `<div style="font-size:11px;color:#6B7280;">Pending customer approval.</div>`;

  const approvedStatus = tw.approval_name
    ? `<div style="display:flex;align-items:center;gap:8px;background:#DCFCE7;border:1px solid #BBF7D0;border-radius:6px;padding:8px 14px;font-size:11px;font-weight:600;color:#166534;margin-bottom:20px;">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#166534" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
        Customer approved by ${tw.approval_name} (${tw.approval_email || ""}) — ${tw.customer_approved_at ? new Date(tw.customer_approved_at).toUTCString() : ""}
      </div>` : "";

  const html = `<!DOCTYPE html><html lang="en"><head>
<meta charset="UTF-8"/>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box;margin:0;padding:0;}
body{font-family:'Inter',-apple-system,sans-serif;background:#F8F9FA;-webkit-print-color-adjust:exact;print-color-adjust:exact;padding:28px 20px 50px;}
.sheet{background:white;border:1px solid #E5E7EB;border-radius:8px;max-width:1100px;margin:0 auto;overflow:hidden;}
.doc-head{display:flex;justify-content:space-between;align-items:flex-start;padding:36px 50px 18px;border-bottom:3px solid #1a2744;}
.doc-title{font-size:16px;font-weight:700;color:#1a2744;letter-spacing:0.04em;text-transform:uppercase;}
.doc-title-meta{font-size:10px;color:#6B7C93;margin-top:4px;}
.meta-grid{display:grid;grid-template-columns:repeat(4,1fr);border-bottom:1px solid #E5E7EB;}
.meta-item{padding:10px 14px;border-right:1px solid #E5E7EB;background:#FAFBFC;}
.meta-item:last-child{border-right:none;}
.meta-label{font-size:9px;font-weight:700;color:#6B7C93;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:3px;}
.meta-value{font-size:12px;font-weight:600;color:#1a2744;}
.body{padding:24px 50px 36px;font-size:11.5px;color:#1F2937;}
.section-label{font-size:10px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:#6B7C93;margin-bottom:10px;margin-top:22px;display:flex;align-items:center;gap:10px;}
.section-label:first-child{margin-top:0;}
.section-label::after{content:"";flex:1;height:1px;background:#E5E7EB;}
.ts-wrap{border:1px solid #E5E7EB;border-radius:4px;overflow:hidden;margin-bottom:18px;}
.shift-hdr{background:#EEF1F7;border-bottom:1px solid #E5E7EB;padding:6px 14px;font-size:10px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#1a2744;}
.ts-table{width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums;}
.grand-row td{background:#EEF1F7!important;font-weight:700;color:#1a2744;border-top:2px solid #1a2744;font-size:11.5px;}
.footnote{font-size:10px;color:#6B7280;padding:10px 0 14px;border-top:1px dashed #D1D5DB;margin-bottom:20px;line-height:1.6;}
.approval-box{background:#FAFBFC;border:1px solid #E5E7EB;border-radius:4px;padding:18px 22px;}
.doc-footer{border-top:1px solid #E5E7EB;padding:10px 50px;display:flex;justify-content:space-between;font-size:9px;color:#9CA3AF;}
@media print{body{background:white;padding:0;}.sheet{border:none;border-radius:0;}}
</style></head><body>
<div class="sheet">
  <div class="doc-head">
    <img src="${logoB64}" alt="Powerforce Global" style="height:50px;width:auto;display:block;"/>
    <div style="text-align:right;">
      <div class="doc-title">Weekly Timesheet</div>
      <div class="doc-title-meta">Document ID: PFG-TS-${new Date().getFullYear()}-${tw.project_code || ""}-${tw.id}</div>
    </div>
  </div>
  <div class="meta-grid">
    <div class="meta-item"><div class="meta-label">Project</div><div class="meta-value">${tw.project_name || ""}</div></div>
    <div class="meta-item"><div class="meta-label">Customer</div><div class="meta-value">${tw.customer || ""}</div></div>
    <div class="meta-item"><div class="meta-label">Week Commencing</div><div class="meta-value">${tw.week_commencing?.toString().substring(0,10) || ""}</div></div>
    <div class="meta-item"><div class="meta-label">Contract Type</div><div class="meta-value">T&amp;M · Time &amp; Material</div></div>
  </div>
  <div class="body">
    ${approvedStatus}

    ${dayWorkers.length > 0 ? `
    <div class="section-label">Day Shift</div>
    <div class="ts-wrap">
      <div class="shift-hdr">Day Shift · ${tw.day_sup_name || "Supervisor"}</div>
      <div style="overflow-x:auto;">
        <table class="ts-table">
          <thead><tr>
            <th style="text-align:left;padding:8px 6px 8px 14px;background:#1a2744;color:white;font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.03em;min-width:170px;">Worker / Role</th>
            ${thCols}
            <th style="text-align:right;padding:8px 10px;background:#1a2744;color:#D4A017;font-size:10px;font-weight:800;min-width:58px;">Total</th>
          </tr></thead>
          <tbody>
            ${buildRows(dayWorkers)}
            <tr class="grand-row">
              <td colspan="8" style="padding:8px 14px;font-size:10px;text-transform:uppercase;letter-spacing:0.08em;">Day Shift Total</td>
              <td style="text-align:right;padding:8px 10px;font-size:13px;">${dayGrandTotal.toFixed(1)}h</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>` : ""}

    ${nightWorkers.length > 0 ? `
    <div class="section-label">Night Shift</div>
    <div class="ts-wrap">
      <div class="shift-hdr">Night Shift · ${tw.night_sup_name || "Supervisor"}</div>
      <div style="overflow-x:auto;">
        <table class="ts-table">
          <thead><tr>
            <th style="text-align:left;padding:8px 6px 8px 14px;background:#1a2744;color:white;font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.03em;min-width:170px;">Worker / Role</th>
            ${thCols}
            <th style="text-align:right;padding:8px 10px;background:#1a2744;color:#D4A017;font-size:10px;font-weight:800;min-width:58px;">Total</th>
          </tr></thead>
          <tbody>
            ${buildRows(nightWorkers)}
            <tr class="grand-row">
              <td colspan="8" style="padding:8px 14px;font-size:10px;text-transform:uppercase;letter-spacing:0.08em;">Night Shift Total</td>
              <td style="text-align:right;padding:8px 10px;font-size:13px;">${nightGrandTotal.toFixed(1)}h</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>` : ""}

    <div class="footnote">All times are local site time. Hours are net of unpaid breaks. Override entries (amber) have been manually adjusted by the supervisor.</div>

    <div class="approval-box">${approvalBlock}</div>
  </div>
  <div class="doc-footer">
    <span>${tw.project_name || ""} · ${tw.project_code || ""} · w/c ${tw.week_commencing?.toString().substring(0,10) || ""}</span>
    <span>Integrity: ${tw.approval_hash?.substring(0,12) || "pending"} · © ${new Date().getFullYear()} Powerforce Global · Confidential</span>
  </div>
</div>
</body></html>`;

  const tmpPath = path2.join(require("os").tmpdir(), `pfg-ts-${Date.now()}.pdf`);
  await renderHtmlToPdf(html, tmpPath, { landscape: true, format: "A4" });
  require("fs").renameSync(tmpPath, outPath);
}
