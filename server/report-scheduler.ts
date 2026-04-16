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

  const activeProjects = allProjects.filter(p => p.status === 'active');

  for (const project of activeProjects) {
    try {
      // Find most recently published daily report
      const allReports = await storage.getDailyReports(project.id);
      const published = allReports.filter(r => r.publishedToPortal);
      if (published.length === 0) {
        console.log(`[report-scheduler] ${project.code}: no published reports — skipping`);
        continue;
      }
      // Most recent by reportDate (already ordered desc from storage, but sort to be safe)
      const report = published.sort((a, b) => (a.reportDate > b.reportDate ? -1 : 1))[0];

      // PM
      const pmUser = await getPmUser(project.id);
      const fromEmail = pmUser?.email?.endsWith('@powerforce.global') ? pmUser.email : undefined;
      const pmName = pmUser?.name || 'Powerforce Global Project Management';

      // Customer contacts
      const toAddresses = [
        project.customerProjectManagerEmail,
        project.siteManagerEmail,
      ].filter((e): e is string => Boolean(e));

      if (toAddresses.length === 0) {
        console.log(`[report-scheduler] ${project.code}: no customer contact emails — skipping`);
        continue;
      }

      // Week bounds
      const { weekStart, weekEnd } = weekBounds(report.reportDate);
      const weekEndFormatted = fmtDateDisplay(weekEnd);

      // Team members
      const [assignments, allWorkers] = await Promise.all([
        storage.getAssignmentsByProject(project.id),
        storage.getWorkers(),
      ]);
      const workerMap = Object.fromEntries(allWorkers.map(w => [w.id, w]));
      const activeAssignments = assignments.filter(a => a.status === 'active' || a.status === 'flagged');
      const teamMembers = activeAssignments.map(a => {
        const w = workerMap[a.workerId];
        return {
          name: w?.name || `Worker ${a.workerId}`,
          role: a.role || '',
          shift: a.shift || '',
          startDate: a.startDate || '',
          endDate: a.endDate || '',
        };
      });

      // Safety data
      const [allToolboxTalks, allSafetyObs, allIncidents, allComments] = await Promise.all([
        storage.getToolboxTalks(project.id),
        storage.getSafetyObservations(project.id),
        storage.getIncidentReports(project.id),
        storage.getCommentsLog(project.id),
      ]);

      const weekStartMs = new Date(weekStart + 'T00:00:00Z').getTime();
      const weekEndMs   = new Date(weekEnd   + 'T00:00:00Z').getTime() + 86_400_000;
      const filterWeek = (items: Array<{ createdAt?: Date | string | null }>) =>
        items.filter(item => {
          if (!item.createdAt) return false;
          const t = new Date(item.createdAt as string).getTime();
          return t >= weekStartMs && t < weekEndMs;
        });

      const weekTalks      = filterWeek(allToolboxTalks).length;
      const weekObs        = filterWeek(allSafetyObs).length;
      const weekNearMisses = allIncidents.filter(i => {
        if (!i.createdAt) return false;
        const t = new Date(String(i.createdAt)).getTime();
        return t >= weekStartMs && t < weekEndMs && (i as any).type === 'near_miss';
      }).length;
      const weekIncidents  = filterWeek(allIncidents).length;

      // Comments for this report
      const reportComments = allComments
        .filter(c => c.reportId === report.id)
        .map(c => ({
          date: (c.enteredAt || '').toString().split('T')[0],
          entry: c.entry || '',
          userName: (c as any).userName || '',
        }));

      // Days remaining / progress
      const today2 = new Date();
      const msPerDay = 86_400_000;
      const projStart = project.startDate ? new Date(project.startDate + 'T00:00:00Z') : null;
      const projEnd   = project.endDate   ? new Date(project.endDate   + 'T00:00:00Z') : null;
      const daysRemaining = projEnd
        ? Math.max(0, Math.ceil((projEnd.getTime() - today2.getTime()) / msPerDay))
        : 0;
      const totalDays = (projStart && projEnd)
        ? Math.ceil((projEnd.getTime() - projStart.getTime()) / msPerDay)
        : 1;
      const elapsedDays = projStart
        ? Math.ceil((today2.getTime() - projStart.getTime()) / msPerDay)
        : 0;
      const progressPct = Math.min(100, Math.max(0, (elapsedDays / totalDays) * 100));

      const completedTasks: ReportData['completedTasks'] =
        Array.isArray(report.completedTasks)
          ? (report.completedTasks as any[]).map(t =>
              typeof t === 'string' ? { description: t } : t
            )
          : [];

      const delaysLog: ReportData['delaysLog'] =
        Array.isArray(report.delaysLog)
          ? (report.delaysLog as any[]).map(d =>
              typeof d === 'string' ? { description: d } : d
            )
          : [];

      // Work packages (L/S only)
      const contractType = (project as any).contractType || 'T&M';
      let workPackages: ReportData['workPackages'];
      if (contractType.toUpperCase().includes('L') && contractType.toUpperCase().includes('S')) {
        try {
          const roleSlots = await storage.getRoleSlotsByProject(project.id);
          workPackages = (roleSlots as any[]).filter(rs => rs.name).map(rs => ({
            name: rs.name || rs.role || '',
            plannedStart:  rs.plannedStart  || '',
            plannedFinish: rs.plannedFinish || '',
            actualStart:   rs.actualStart   || '',
            actualFinish:  rs.actualFinish  || '',
          }));
        } catch { /* ignore */ }
      }

      const reportData: ReportData = {
        projectName:  project.name     || '',
        projectCode:  project.code     || '',
        customer:     project.customer || '',
        siteName:     project.siteName || project.location || '',
        startDate:    project.startDate || '',
        endDate:      project.endDate   || '',
        contractType,
        shiftPattern: (project as any).shiftPattern || '',
        weekStart,
        weekEnd,
        pmName,
        completedTasks,
        delaysLog,
        commentsEntries: reportComments,
        teamMembers,
        workPackages,
        safetyData: {
          toolboxTalks: weekTalks,
          observations: weekObs,
          nearMisses:   weekNearMisses,
          incidents:    weekIncidents,
        },
        daysRemaining,
        activeTeam:  teamMembers.length,
        progressPct,
        oemColour: (project as any).oemColour || '#005E60',
      };

      // Generate PDF
      const pdfBuffer = await generateWeeklyReportPdf(reportData);
      const base64Pdf = pdfBuffer.toString('base64');
      const dateStr = report.reportDate.replace(/-/g, '');
      const attachmentName = `${project.code}-report-${dateStr}.pdf`;

      // Build email
      const portalUrl = `${APP_URL}/#/portal/${project.code}`;
      const subject = `Weekly Project Report \u2014 ${project.name} \u2014 w/e ${weekEndFormatted}`;
      const html = buildEmailHtml(project.name, project.code, weekEndFormatted, pmName, portalUrl);

      await sendMail({
        from: fromEmail,
        to: toAddresses,
        subject,
        html,
        attachments: [
          {
            name: attachmentName,
            contentType: 'application/pdf',
            contentBytes: base64Pdf,
          },
        ],
      });

      console.log(
        `[report-scheduler] Sent weekly report for ${project.code} to ${toAddresses.join(', ')} — week ending ${weekEndFormatted}`,
      );
    } catch (err) {
      console.error(`[report-scheduler] Error processing project ${project.code}:`, err);
    }
  }
}
