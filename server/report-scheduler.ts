/**
 * Weekly report scheduler
 * Generates a PDF weekly report and emails it to customer contacts.
 * Called from server/index.ts every hour; only fires on Monday (UTC 07:00 = 08:00 BST).
 */

import { storage } from './storage';
import { sendMail } from './email';
import { generateWeeklyReportPdf, type ReportData } from './report-generator';

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
      <h2 style="margin:0 0 8px;font-size:20px;font-weight:700;color:#1A1D23;">
        Weekly Project Report
      </h2>
      <p style="margin:0 0 16px;color:#4b5563;font-size:15px;line-height:1.6;">
        Please find attached the <strong>Weekly Project Report</strong> for
        <strong>${projectName}</strong>, covering the week ending
        <strong>${weekEndFormatted}</strong>.
      </p>
      <p style="margin:0 0 16px;color:#4b5563;font-size:14px;line-height:1.6;">
        This report includes completed tasks, delays log, comments &amp; concerns,
        workforce deployment, and the health &amp; safety summary for the reporting period.
      </p>
      <div style="text-align:center;margin:28px 0;">
        <a href="${portalUrl}"
           style="display:inline-block;background:#F5BD00;color:#1A1D23;font-weight:700;font-size:15px;padding:14px 32px;border-radius:8px;text-decoration:none;">
          View Live Project Portal
        </a>
      </div>
      <p style="margin:24px 0 0;font-size:13px;color:#6b7280;">
        Prepared by <strong>${pmName}</strong> · Powerforce Global Project Management
      </p>
      <p style="margin:8px 0 0;font-size:12px;color:#9ca3af;">
        If you have any questions about this report, please contact your Powerforce Global project manager.
      </p>
    </div>
    <div style="text-align:center;padding:20px 32px;font-size:11px;color:#9ca3af;border-top:1px solid #f0f0f0;">
      &copy; ${new Date().getFullYear()} Powerforce Global &middot; Confidential &middot;
      <a href="${APP_URL}" style="color:#63758C;text-decoration:none;">pfg-platform.onrender.com</a>
    </div>
  </div>
</body>
</html>`;
}

// ── Main export ───────────────────────────────────────────────────────────────

// ── Core send function — shared by weekly and final sends ──
async function sendReportForProject(
  project: any,
  isFinal: boolean = false
): Promise<void> {
  const allReports = await storage.getDailyReports(project.id);
  const published = allReports.filter((r: any) => r.publishedToPortal);
  if (published.length === 0) {
    console.log(`[report-scheduler] ${project.code}: no published reports — skipping ${isFinal ? 'final' : 'weekly'}`);
    return;
  }
  const report = published.sort((a: any, b: any) => (a.reportDate > b.reportDate ? -1 : 1))[0];

  const pmUser = await getPmUser(project.id);
  const fromEmail = pmUser?.email?.endsWith('@powerforce.global') ? pmUser.email : undefined;
  const pmName = pmUser?.name || 'Powerforce Global Project Management';

  const toAddresses = [
    project.customerProjectManagerEmail,
    project.siteManagerEmail,
  ].filter((e: any): e is string => Boolean(e));

  if (toAddresses.length === 0) {
    console.log(`[report-scheduler] ${project.code}: no customer contact emails — skipping`);
    return;
  }

  const { weekStart, weekEnd } = weekBounds(report.reportDate);
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
  const teamMembers = activeAssignments.map((a: any) => {
    const w = (workerMap as any)[a.workerId];
    return {
      name: (w?.name || `Worker ${a.workerId}`).replace(/\s*\([^)]*\)/g, '').trim(),
      role: a.role || '',
      shift: a.shift || '',
      startDate: a.startDate || '',
      endDate: a.endDate || '',
    };
  });

  const reportTasks = Array.isArray(report.completedTasks) ? report.completedTasks : [];
  const reportDelays = Array.isArray(report.delaysLog) ? report.delaysLog : [];
  const reportComments = (allComments as any[]).filter((c: any) => c.reportId === report.id);
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
    completedTasks: reportTasks,
    delaysLog: reportDelays,
    commentsEntries: reportComments.map((c: any) => ({
      date: c.enteredAt ? new Date(c.enteredAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }) : '',
      entry: c.entry || '',
      userName: '',
    })),
    teamMembers,
    safetyData: {
      toolboxTalks: (allToolboxTalks as any[]).length,
      observations: (allSafetyObs as any[]).length,
      nearMisses: (allSafetyObs as any[]).filter((o: any) => o.observationType === 'unsafe_condition').length,
      incidents: (allIncidents as any[]).length,
    },
    daysRemaining,
    activeTeam: teamMembers.length,
    progressPct: Math.round((elapsedDays / totalDays) * 100),
    oemColour,
    isFinalReport: isFinal,
  };

  const pdfBuffer = await generateWeeklyReportPdf(reportData as any);
  const base64Pdf = pdfBuffer.toString('base64');
  const filename = isFinal
    ? `${project.code}-final-report-${report.reportDate}.pdf`
    : `${project.code}-report-w-e-${weekEnd}.pdf`;

  const subject = isFinal
    ? `Final Project Report — ${project.name}`
    : `Weekly Project Report — ${project.name} — w/e ${weekEndFormatted}`;

  const portalUrl = `${APP_URL}/#/portal/${project.code}`;
  const emailHtml = isFinal
    ? buildFinalEmailHtml(project.name, project.code, fmtDateDisplay(project.endDate || ''), pmName, portalUrl)
    : buildEmailHtml(project.name, project.code, weekEndFormatted, pmName, portalUrl);

  await sendMail({
    to: toAddresses,
    from: fromEmail,
    subject,
    html: emailHtml,
    text: `${isFinal ? 'Final project report' : 'Weekly report'} for ${project.name} attached.\n\nPortal: ${portalUrl}`,
    attachments: [{ name: filename, contentType: 'application/pdf', contentBytes: base64Pdf }],
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

  for (const project of activeProjects) {
    try {
      await sendReportForProject(project, false);
    } catch (err) {
      console.error(`[report-scheduler] Error processing project ${project.code}:`, err);
    }
  }
}
