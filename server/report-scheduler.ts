/**
 * Weekly report scheduler
 * Generates a PDF weekly report and emails it to customer contacts.
 * Called from server/index.ts every hour; only fires on Monday (UTC 07:00 = 08:00 BST).
 */

import * as fs from 'fs';
import * as path from 'path';
import { storage } from './storage';
import { sendMail } from './email';
import { generateWeeklyReportPdfHtml, type ReportData } from './report-generator';

const UPLOAD_ROOT = process.env.UPLOAD_ROOT || '/data/uploads';

const APP_URL = process.env.APP_URL || 'https://pfg-platform.onrender.com';

// ── Helpers ──────────────────────────────────────────────────────────────────

async function getPmUser(projectId: number): Promise<{ name: string; email: string } | undefined> {
  try {
    const lead = await storage.getProjectLead(projectId);
    if (!lead) return undefined;
    const user = await storage.getUserById(lead.userId);
    if (!user) return undefined;
    return { name: user.name || '', email: user.email || '' };
  } catch {
    return undefined;
  }
}

function toISO(d: Date): string {
  return d.toISOString().split('T')[0];
}

function fmtDateDisplay(iso: string): string {
  if (!iso) return '';
  try {
    const d = new Date(iso + 'T00:00:00Z');
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
  } catch {
    return iso;
  }
}

function weekBounds(reportDate: string): { weekStart: string; weekEnd: string } {
  const d = new Date(reportDate + 'T00:00:00Z');
  const dow = d.getUTCDay(); // 0=Sun, 1=Mon … 6=Sat
  const daysToMonday = dow === 0 ? 6 : dow - 1;
  const monDate = new Date(d);
  monDate.setUTCDate(d.getUTCDate() - daysToMonday);
  const sunDate = new Date(monDate);
  sunDate.setUTCDate(monDate.getUTCDate() + 6);
  return { weekStart: toISO(monDate), weekEnd: toISO(sunDate) };
}

function buildEmailHtml(
  projectName: string,
  projectCode: string,
  weekEndFormatted: string,
  pmName: string,
  portalUrl: string,
): string {
  const iconUrl = `${APP_URL}/logo-gold-mark.png`;
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#F4F5F7;font-family:'Helvetica Neue',Arial,sans-serif;-webkit-font-smoothing:antialiased;">
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#F4F5F7;"><tr><td align="center" style="padding:40px 16px;">
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background:#ffffff;border-radius:10px;overflow:hidden;box-shadow:0 4px 24px rgba(17,24,39,0.09);">
      <tr><td style="background:#1a2744;padding:20px 32px;border-bottom:3px solid #D4A017;">
        <table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
          <td><img src="${iconUrl}" alt="Powerforce Global" height="34" style="display:block;height:34px;width:auto;"/></td>
          <td align="right" style="vertical-align:middle;"><span style="font-size:10px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:rgba(255,255,255,0.4);">Weekly Project Report</span></td>
        </tr></table>
      </td></tr>
      <tr><td style="padding:28px 32px 22px;">
        <p style="margin:0 0 20px;font-size:19px;font-weight:700;color:#111827;">Weekly Report Ready</p>
        <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#EEF1F7;border-radius:8px;margin-bottom:22px;overflow:hidden;"><tr>
          <td style="padding:18px 20px;">
            <p style="margin:0 0 2px;font-size:9px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#6B7C93;">Project</p>
            <p style="margin:0 0 14px;font-size:16px;font-weight:700;color:#111827;">${projectName}</p>
            <table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
              <td width="50%"><p style="margin:0 0 2px;font-size:9px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:#6B7C93;">Week Ending</p><p style="margin:0;font-size:13px;font-weight:600;color:#111827;">${weekEndFormatted}</p></td>
              <td width="50%"><p style="margin:0 0 2px;font-size:9px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:#6B7C93;">Prepared By</p><p style="margin:0;font-size:13px;font-weight:600;color:#111827;">${pmName}</p></td>
            </tr></table>
          </td>
          <td width="4" style="background:#D4A017;">&nbsp;</td>
        </tr></table>
        <p style="margin:0 0 20px;font-size:13px;color:#374151;line-height:1.65;">Please find attached the weekly project report for <strong>${projectName}</strong>. The report includes the H&amp;S summary, agreed delays, comments &amp; concerns, and on-site workforce. Completed tasks are viewable on the live portal.</p>
        <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:22px 0;"><tr><td align="center">
          <a href="${portalUrl}" style="display:inline-block;background:#D4A017;color:#1a2744;font-family:'Helvetica Neue',Arial,sans-serif;font-weight:700;font-size:14px;padding:13px 34px;border-radius:8px;text-decoration:none;">View on Project Portal &rarr;</a>
        </td></tr></table>
      </td></tr>
      <tr><td style="padding:0 32px;"><div style="height:1px;background:#E5E7EB;"></div></td></tr>
      <tr><td style="padding:16px 32px 20px;"><p style="margin:0;font-size:11px;color:#9CA3AF;">Sent by <strong style="color:#6B7280;">Powerforce Global</strong> &mdash; ${pmName}<br>&copy; ${new Date().getFullYear()} Powerforce Global &middot; Confidential</p></td></tr>
    </table>
  </td></tr></table>
</body></html>`;
}


// ── Main export ───────────────────────────────────────────────────────────────

// ── Core send function — shared by weekly and final sends ──
export async function sendReportForProject(
  project: any,
  isFinal: boolean = false
): Promise<void> {
  const allReports = await storage.getDailyReports(project.id);
  const published = allReports.filter((r: any) => r.publishedToPortal);
  if (published.length === 0) {
    console.log(`[report-scheduler] ${project.code}: no published reports — skipping ${isFinal ? 'final' : 'weekly'}`);
    return;
  }
  // Use the most recent published report to determine the week
  const report = published.sort((a: any, b: any) => (a.reportDate > b.reportDate ? -1 : 1))[0];

  const pmUser = await getPmUser(project.id);
  const fromEmail = pmUser?.email?.endsWith('@powerforce.global') ? pmUser.email : undefined;
  const pmName = pmUser?.name || 'Powerforce Global Project Management';

  const toAddresses = [
    project.sourcingContactEmail,
    project.customerProjectManagerEmail,
    project.siteManagerEmail,
  ].filter((e: any): e is string => Boolean(e));

  if (toAddresses.length === 0) {
    console.log(`[report-scheduler] ${project.code}: no customer contact emails — skipping`);
    return;
  }

  const { weekStart, weekEnd } = weekBounds(report.reportDate);

  // Belt-and-braces: don't re-send if already sent this week
  if (!isFinal) {
    const alreadySent = await storage.getWeeklyReportByWeek(project.id, weekStart);
    if (alreadySent?.sentAt) {
      console.log(`[report-scheduler] ${project.code}: already sent for w/c ${weekStart} — skipping duplicate`);
      return;
    }
  }
  const weekEndFormatted = fmtDateDisplay(weekEnd);

  const [assignments, allWorkers, allToolboxTalks, allSafetyObs, allIncidents, allComments] = await Promise.all([
    storage.getAssignmentsByProject(project.id),
    storage.getWorkers(),
    storage.getToolboxTalks(project.id),
    storage.getSafetyObservations(project.id),
    storage.getIncidentReports(project.id),
    storage.getCommentsLog(project.id),
  ]);

  const workerMap = Object.fromEntries((allWorkers as any[]).map((w: any) => [w.id, w]));
  const activeAssignments = (assignments as any[]).filter((a: any) =>
    ['active', 'confirmed', 'pending_confirmation', 'flagged'].includes(a.status || '')
  );
  // Only include workers who are actually on site during this week
  const teamMembers = activeAssignments
    .filter((a: any) => {
      const aStart = a.startDate || '';
      const aEnd = a.endDate || '9999-12-31';
      // Assignment overlaps with the report week
      return aStart <= weekEnd && aEnd >= weekStart;
    })
    .map((a: any) => {
      const w = (workerMap as any)[a.workerId];
      return {
        name: (w?.name || `Worker ${a.workerId}`).replace(/\s*\([^)]*\)/g, '').trim(),
        role: a.role || '',
        shift: a.shift || '',
        startDate: a.startDate || '',
        endDate: a.endDate || '',
      };
    });

  // Aggregate full week: all published reports within the week window
  const weekReports = published.filter((r: any) => r.reportDate >= weekStart && r.reportDate <= weekEnd);

  // Delays: aggregate across all week's reports (no tasks in PDF)
  const reportDelays = weekReports.flatMap((r: any) =>
    Array.isArray(r.delaysLog)
      ? r.delaysLog.map((d: any) => ({ ...d, date: r.reportDate || r.date || '' }))
      : []
  );

  // Comments: entries within the week by logDate OR linked to a week report by reportId
  const weekReportIds = new Set(weekReports.map((r: any) => r.id));
  const reportComments = (allComments as any[]).filter((c: any) => {
    // Linked to a report in this week
    if (c.reportId && weekReportIds.has(c.reportId)) return true;
    // Standalone entry with logDate in this week
    const d = c.logDate || c.enteredAt?.slice(0, 10) || '';
    return d >= weekStart && d <= weekEnd;
  });
  const now = new Date();
  const projEnd = project.endDate ? new Date(project.endDate + 'T00:00:00Z') : null;
  const projStart = project.startDate ? new Date(project.startDate + 'T00:00:00Z') : null;
  const totalDays = projStart && projEnd ? Math.max(1, Math.round((projEnd.getTime() - projStart.getTime()) / 86400000)) : 1;
  const elapsedDays = projStart ? Math.round((now.getTime() - projStart.getTime()) / 86400000) : 0;
  const daysRemaining = projEnd ? Math.max(0, Math.round((projEnd.getTime() - now.getTime()) / 86400000)) : 0;

  const OEM_COLOURS: Record<string, string> = {
    'GE Vernova': '#005E60', 'Mitsubishi Power': '#E60012', 'Siemens Energy': '#009999',
    'Arabelle Solutions': '#FE5716', 'Alstom': '#0066CC', 'Ansaldo Energia': '#003399',
    'Sulzer': '#1D59AF',
  };
  const oemColour = OEM_COLOURS[project.customer || ''] || '#1A1D23';

  const reportData = {
    projectName: project.name || '',
    projectCode: project.code || '',
    customer: project.customer || '',
    siteName: project.siteName || '',
    startDate: project.startDate || '',
    endDate: project.endDate || '',
    contractType: project.contractType || 'T&M',
    shiftPattern: project.shift || 'Day & Night',
    weekStart,
    weekEnd,
    pmName,
    completedTasks: [], // Tasks removed from PDF — shown on portal instead
    delaysLog: reportDelays,
    commentsEntries: reportComments.map((c: any) => ({
      date: c.enteredAt ? new Date(c.enteredAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }) : '',
      entry: c.entry || '',
      userName: '',
    })),
    teamMembers,
    safetyData: {
      toolboxTalks: (allToolboxTalks as any[]).filter((t: any) => (t.reportDate || '') >= weekStart && (t.reportDate || '') <= weekEnd).length,
      observations: (allSafetyObs as any[]).filter((o: any) => (o.observationDate || '') >= weekStart && (o.observationDate || '') <= weekEnd).length,
      nearMisses: (allIncidents as any[]).filter((i: any) => i.incidentType === 'near_miss' && (i.incidentDate || '') >= weekStart && (i.incidentDate || '') <= weekEnd).length,
      incidents: (allIncidents as any[]).filter((i: any) => i.incidentType !== 'near_miss' && (i.incidentDate || '') >= weekStart && (i.incidentDate || '') <= weekEnd).length,
    },
    safetyObservations: (allSafetyObs as any[]).filter((o: any) =>
      (o.observationDate || '') >= weekStart && (o.observationDate || '') <= weekEnd
    ),
    toolboxTalks: (allToolboxTalks as any[]).filter((t: any) =>
      (t.reportDate || '') >= weekStart && (t.reportDate || '') <= weekEnd
    ),
    daysRemaining,
    activeTeam: teamMembers.length,
    progressPct: Math.round((elapsedDays / totalDays) * 100),
    oemColour,
    isFinalReport: isFinal,
  };

  // Generate PDF — gracefully skip if Playwright not available (e.g. production)
  let pdfBuffer: Buffer | null = null;
  let base64Pdf: string | null = null;
  try {
    pdfBuffer = await generateWeeklyReportPdfHtml(reportData as any);
    base64Pdf = pdfBuffer.toString('base64');
  } catch (pdfErr: any) {
    console.warn(`[report-scheduler] PDF generation skipped (${pdfErr.message?.slice(0, 80)}) — checking DB for stored PDF`);
    // Fall back to a manually uploaded PDF stored in aggregated_data
    try {
      const existingReport = await storage.getWeeklyReportByWeek(project.id, weekStart);
      const storedB64 = (existingReport?.aggregatedData as any)?.pdfBase64;
      if (storedB64) {
        base64Pdf = storedB64;
        pdfBuffer = Buffer.from(storedB64, 'base64');
        console.log(`[report-scheduler] Using stored PDF from DB (${pdfBuffer.length} bytes)`);
      }
    } catch (dbErr: any) {
      console.warn(`[report-scheduler] Could not retrieve stored PDF: ${dbErr.message}`);
    }
  }

  const filename = isFinal
    ? `${project.code}-final-report-${report.reportDate}.pdf`
    : `${project.code}-report-w-e-${weekEnd}.pdf`;

  // Store PDF to disk and create/update weekly_reports record
  if (!isFinal) {
    try {
      let pdfPath: string | null = null;
      if (pdfBuffer) {
        const reportDir = path.join(UPLOAD_ROOT, 'reports', project.code);
        fs.mkdirSync(reportDir, { recursive: true });
        pdfPath = path.join(reportDir, filename);
        fs.writeFileSync(pdfPath, pdfBuffer);
      }

      // Aggregate data to store in DB (for inline portal view)
      const aggregatedData = {
        weekStart,
        weekEnd,
        delays: reportDelays,
        comments: reportComments.map((c: any) => ({
          date: c.logDate || c.enteredAt?.slice(0, 10) || '',
          entry: c.entry || '',
          userName: (c as any).userName || '',
        })),
        tasks: weekReports.flatMap((r: any) => Array.isArray(r.completedTasks) ? r.completedTasks : []),
        safetyStats: reportData.safetyData,
        toolboxTalks: reportData.toolboxTalks,
        safetyObservations: reportData.safetyObservations,
        teamMembers,
        daysRemaining,
        progressPct: reportData.progressPct,
      };

      const existing = await storage.getWeeklyReportByWeek(project.id, weekStart);
      if (existing) {
        await storage.updateWeeklyReport(existing.id, {
          status: 'published',
          pdfPath,
          aggregatedData,
          sentAt: new Date() as any,
        });
      } else {
        await storage.createWeeklyReport({
          projectId: project.id,
          weekCommencing: weekStart,
          weekEnding: weekEnd,
          status: 'published',
          pdfPath,
          aggregatedData,
          sentAt: new Date() as any,
        });
      }
      console.log(`[report-scheduler] Weekly report stored: ${pdfPath}`);
    } catch (storeErr) {
      console.error(`[report-scheduler] Failed to store weekly report PDF:`, storeErr);
    }
  }

  const subject = isFinal
    ? `Final Project Report — ${project.name}`
    : `Weekly Project Report — ${project.name} — w/e ${weekEndFormatted}`;

  const portalToken = (project as any).portalAccessToken;
  const portalUrl = portalToken
    ? `${APP_URL}/#/portal/${project.code}?token=${portalToken}`
    : `${APP_URL}/#/portal/${project.code}`;
  const emailHtml = isFinal
    ? buildFinalEmailHtml(project.name, project.code, fmtDateDisplay(project.endDate || ''), pmName, portalUrl)
    : buildEmailHtml(project.name, project.code, weekEndFormatted, pmName, portalUrl);

  await sendMail({
    to: toAddresses,
    from: fromEmail,
    subject,
    html: emailHtml,
    text: `${isFinal ? 'Final project report' : 'Weekly report'} for ${project.name} attached.\n\nPortal: ${portalUrl}`,
    ...(base64Pdf ? { attachments: [{ name: filename, contentType: 'application/pdf', contentBytes: base64Pdf }] } : {}),
  });

  console.log(`[report-scheduler] ${isFinal ? 'FINAL' : 'Weekly'} report sent for ${project.code} to ${toAddresses.join(', ')}`);
}

// ── Final email template ──
function buildFinalEmailHtml(
  projectName: string,
  projectCode: string,
  endDateFormatted: string,
  pmName: string,
  portalUrl: string,
): string {
  return `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:'Inter',Arial,sans-serif;background:#f4f4f5;padding:40px 0;">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
    <div style="background:#1A1D23;padding:28px 32px;text-align:center;">
      <img src="${APP_URL}/logo-gold.png" alt="Powerforce Global" height="36" style="display:block;margin:0 auto;" />
    </div>
    <div style="padding:32px;color:#1A1D23;">
      <div style="background:#F0FDF4;border:1px solid #BBF7D0;border-radius:8px;padding:12px 16px;margin-bottom:20px;">
        <p style="margin:0;font-size:13px;font-weight:700;color:#16A34A;">Project Complete</p>
      </div>
      <h2 style="margin:0 0 8px;font-size:20px;font-weight:700;">${projectName}</h2>
      <p style="margin:0 0 16px;color:#4b5563;font-size:15px;line-height:1.6;">
        Please find attached the <strong>final project report</strong> for <strong>${projectName}</strong>,
        covering all work completed through <strong>${endDateFormatted}</strong>.
      </p>
      <p style="margin:0 0 16px;color:#4b5563;font-size:14px;line-height:1.6;">
        It has been a pleasure working with your team. The project portal remains accessible if you need
        to reference any documentation or SQEP packs.
      </p>
      <div style="text-align:center;margin:24px 0;">
        <a href="${portalUrl}" style="display:inline-block;background:#F5BD00;color:#1A1D23;font-weight:700;font-size:15px;padding:14px 32px;border-radius:8px;text-decoration:none;">View Project Portal</a>
      </div>
    </div>
    <div style="text-align:center;padding:20px 32px;font-size:11px;color:#9ca3af;border-top:1px solid #f0f0f0;">
      &copy; ${new Date().getFullYear()} Powerforce Global &middot; Confidential
    </div>
  </div>
</body>
</html>`;
}

// ── Called from survey-scheduler on project end date ──
export async function sendFinalReportForProject(projectId: number): Promise<void> {
  try {
    const project = await storage.getProject(projectId);
    if (!project) return;
    await sendReportForProject(project, true);
    // Auto-complete the project
    await storage.updateProject(projectId, { status: 'completed' });
    console.log(`[report-scheduler] Project ${project.code} marked as completed after final report`);
  } catch (err) {
    console.error(`[report-scheduler] Final report error for project ${projectId}:`, err);
  }
}

export async function checkAndSendWeeklyReports(): Promise<void> {
  const now = new Date();

  // Only proceed on Monday (day === 1 in local server time)
  if (now.getDay() !== 1) return;

  console.log('[report-scheduler] Monday detected — checking for weekly reports to send');

  let allProjects: Awaited<ReturnType<typeof storage.getProjects>>;
  try {
    allProjects = await storage.getProjects();
  } catch (err) {
    console.error('[report-scheduler] Failed to load projects:', err);
    return;
  }

  const today = now.toISOString().split('T')[0];
  // Only send weekly for projects that are still running — exclude finished or future-ending-today
  const activeProjects = allProjects.filter(p =>
    p.status === 'active' &&
    (!p.endDate || p.endDate > today)  // endDate strictly in the future
  );

  // Calculate the current week commencing (Monday)
  const dayOfWeek = now.getUTCDay(); // 1 = Monday
  const weekStart = new Date(now);
  weekStart.setUTCDate(now.getUTCDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
  const weekStartStr = weekStart.toISOString().split('T')[0];

  for (const project of activeProjects) {
    try {
      // Guard: skip if we already sent a report for this week
      const existing = await storage.getWeeklyReportByWeek(project.id, weekStartStr);
      if (existing?.sentAt) {
        console.log(`[report-scheduler] ${project.code}: report already sent for w/c ${weekStartStr} — skipping`);
        continue;
      }
      await sendReportForProject(project, false);
    } catch (err) {
      console.error(`[report-scheduler] Error processing project ${project.code}:`, err);
    }
  }
}

// ── Auto-publish all daily reports for active projects ────────────────────────
// Called every Sunday at 17:00 UTC (18:00 BST) — publishes all unpublished reports
export async function autoPublishDailyReports(): Promise<void> {
  console.log('[report-scheduler] Auto-publishing daily reports for all active projects');
  try {
    const allProjects = await storage.getProjects();
    const today = new Date().toISOString().split('T')[0];
    const activeProjects = allProjects.filter(p =>
      p.status === 'active' && (!p.endDate || p.endDate >= today)
    );
    for (const project of activeProjects) {
      try {
        const reports = await storage.getDailyReports(project.id);
        const unpublished = reports.filter((r: any) => !r.publishedToPortal);
        for (const report of unpublished) {
          await storage.updateDailyReport(report.id, { publishedToPortal: true });
          console.log(`[report-scheduler] Auto-published report ${report.id} (${report.reportDate}) for ${project.code}`);
        }
        if (unpublished.length > 0) {
          console.log(`[report-scheduler] ${project.code}: published ${unpublished.length} report(s)`);
        }
      } catch (err) {
        console.error(`[report-scheduler] Auto-publish error for ${project.code}:`, err);
      }
    }
  } catch (err) {
    console.error('[report-scheduler] Auto-publish failed:', err);
  }
}
