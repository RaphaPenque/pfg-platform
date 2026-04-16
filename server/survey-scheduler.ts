/**
 * Survey reminder scheduler
 * Checks survey tokens periodically and sends reminder/final-reminder emails.
 * Called from server/index.ts on a 6-hour interval.
 */

import { storage } from "./storage";
import { sendMail } from "./email";
import crypto from "crypto";
import { sendFinalReportForProject } from "./report-scheduler";

async function getPmEmail(projectId: number): Promise<string | undefined> {
  try {
    const lead = await storage.getProjectLead(projectId);
    if (!lead) return undefined;
    const user = await storage.getUser(lead.userId);
    return user?.email?.endsWith('@powerforce.global') ? user.email : undefined;
  } catch { return undefined; }
}

const APP_URL = process.env.APP_URL || "https://pfg-platform.onrender.com";

const MS_7_DAYS  = 7  * 24 * 60 * 60 * 1000;
const MS_13_DAYS = 13 * 24 * 60 * 60 * 1000;

// ── Auto-send survey on the last day of any active project that hasn't had one sent yet ──
async function autoSendSurveysForEndingProjects(today: string): Promise<void> {
  const allProjects = await storage.getProjects();
  const endingToday = allProjects.filter(
    p => p.endDate === today && p.status !== "cancelled" && p.status !== "potential"
  );

  for (const project of endingToday) {
    // Check if a survey has already been sent for this project
    const existingTokens = await storage.getSurveyTokensByProject(project.id);
    if (existingTokens.length > 0) {
      console.log(`[survey-scheduler] Project ${project.code} ends today but survey already sent — skipping`);
      continue;
    }

    // Build contact list from project stakeholder fields
    const contacts: { email: string; name: string; role: string }[] = [];
    if (project.customerProjectManagerEmail) {
      contacts.push({
        email: project.customerProjectManagerEmail,
        name: project.customerProjectManager || "Project Manager",
        role: "pm",
      });
    }
    if (project.siteManagerEmail) {
      contacts.push({
        email: project.siteManagerEmail,
        name: project.siteManager || "Site Manager",
        role: "site_manager",
      });
    }

    if (contacts.length === 0) {
      console.log(`[survey-scheduler] Project ${project.code} ends today but has no customer contact emails — skipping`);
      continue;
    }

    const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);

    for (const contact of contacts) {
      try {
        const token = crypto.randomBytes(32).toString("hex");
        await storage.createSurveyToken({
          projectId: project.id,
          contactEmail: contact.email,
          contactName: contact.name,
          contactRole: contact.role,
          token,
          expiresAt,
        });

        const surveyUrl = `${APP_URL}/survey?token=${token}`;
        const firstName = contact.name.split(" ")[0];
        const html = buildSurveyInviteEmail(firstName, project.name, surveyUrl);
        const pmEmail = await getPmEmail(project.id);

        await sendMail({
          to: contact.email,
          from: pmEmail,
          subject: `We'd love your feedback \u2014 ${project.name}`,
          html,
          text: `Hi ${firstName},\n\nThank you for working with Powerforce Global on ${project.name}.\nWe'd love your feedback — it takes about 3 minutes.\n\nSurvey link: ${surveyUrl}\n\nThis link is personal to you and expires in 14 days.`,
        });

        console.log(`[survey-scheduler] Auto-sent survey to ${contact.email} for project ${project.code} (ends today)`);
      } catch (err) {
        console.error(`[survey-scheduler] Failed to auto-send survey to ${contact.email} for ${project.code}:`, err);
      }
    }

    // Send final report and mark project complete (fire-and-forget after surveys)
    setTimeout(() => {
      sendFinalReportForProject(project.id).catch(err =>
        console.error(`[survey-scheduler] Final report error for ${project.code}:`, err)
      );
    }, 5000); // 5s delay — let survey emails go first
  }
}

export async function checkSurveyReminders(): Promise<void> {
  try {
    const now = new Date();
    const today = now.toISOString().split("T")[0]; // "YYYY-MM-DD"

    // Auto-send surveys for projects ending today
    await autoSendSurveysForEndingProjects(today);

    const allProjects = await storage.getProjects();

    for (const project of allProjects) {
      const tokens = await storage.getSurveyTokensByProject(project.id);

      for (const token of tokens) {
        // Skip if already used
        if (token.usedAt) continue;

        const createdAt = token.createdAt ? new Date(token.createdAt) : null;
        const expiresAt = new Date(token.expiresAt);
        const firstName = (token.contactName || "").split(" ")[0] || "there";
        const surveyUrl = `${APP_URL}/survey?token=${token.token}`;

        // Expired tokens with no response → mark project survey status as no_response
        if (expiresAt < now) {
          // No survey status field on project currently — log and skip
          console.log(`[survey-scheduler] Token ${token.id} expired with no response for project ${project.name}`);
          continue;
        }

        if (!createdAt) continue;

        const ageMs = now.getTime() - createdAt.getTime();
        const pmEmail = await getPmEmail(project.id);

        // 7-day reminder
        if (ageMs >= MS_7_DAYS && !token.reminderSentAt) {
          try {
            const html = buildReminderEmail(firstName, project.name, surveyUrl, "reminder");
            await sendMail({
              to: token.contactEmail,
              from: pmEmail,
              subject: `Reminder: We'd love your feedback — ${project.name}`,
              html,
              text: `Hi ${firstName},\n\nJust a friendly reminder to share your feedback on ${project.name}.\n\nSurvey link: ${surveyUrl}\n\nThank you,\nPowerforce Global`,
            });
            await storage.updateSurveyToken(token.id, { reminderSentAt: now });
            console.log(`[survey-scheduler] Sent 7-day reminder to ${token.contactEmail} for project ${project.name}`);
          } catch (err) {
            console.error(`[survey-scheduler] Failed to send 7-day reminder:`, err);
          }
        }

        // 13-day final reminder
        if (ageMs >= MS_13_DAYS && !token.finalReminderSentAt) {
          try {
            const html = buildReminderEmail(firstName, project.name, surveyUrl, "final");
            await sendMail({
              to: token.contactEmail,
              from: pmEmail,
              subject: `Final reminder: Your feedback on ${project.name}`,
              html,
              text: `Hi ${firstName},\n\nThis is a final reminder to share your feedback on ${project.name}. Your link expires soon.\n\nSurvey link: ${surveyUrl}\n\nThank you,\nPowerforce Global`,
            });
            await storage.updateSurveyToken(token.id, { finalReminderSentAt: now });
            console.log(`[survey-scheduler] Sent 13-day final reminder to ${token.contactEmail} for project ${project.name}`);
          } catch (err) {
            console.error(`[survey-scheduler] Failed to send 13-day final reminder:`, err);
          }
        }
      }
    }
  } catch (err) {
    console.error("[survey-scheduler] checkSurveyReminders error:", err);
  }
}

function buildSurveyInviteEmail(firstName: string, projectName: string, surveyUrl: string): string {
  return `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:'Inter',Arial,sans-serif;background:#f4f4f5;padding:40px 0;">
  <div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
    <div style="background:#1A1D23;padding:28px 32px;text-align:center;">
      <img src="${APP_URL}/logo-gold.png" alt="Powerforce Global" height="36" style="display:block;margin:0 auto;" />
    </div>
    <div style="padding:32px;color:#1A1D23;">
      <h2 style="margin:0 0 8px;font-size:20px;font-weight:700;color:#1A1D23;">Hi ${firstName},</h2>
      <p style="margin:0 0 16px;color:#4b5563;font-size:15px;line-height:1.6;">
        Thank you for working with <strong>Powerforce Global</strong> on <strong>${projectName}</strong>.
        We'd love to hear your thoughts on how the project went — it takes about 3 minutes.
      </p>
      <p style="margin:0 0 16px;color:#4b5563;font-size:14px;line-height:1.6;">
        Your feedback helps us maintain the highest standards and deliver excellence on every project.
      </p>
      <div style="text-align:center;margin:24px 0;">
        <a href="${surveyUrl}" style="display:inline-block;background:#F5BD00;color:#1A1D23;font-weight:700;font-size:15px;padding:14px 32px;border-radius:8px;text-decoration:none;">Complete Feedback Survey</a>
      </div>
      <p style="margin:16px 0 0;font-size:12px;color:#9ca3af;text-align:center;">
        This link is personal to you and expires in 14 days.
      </p>
    </div>
    <div style="text-align:center;padding:20px 32px;font-size:11px;color:#9ca3af;border-top:1px solid #f0f0f0;">
      &copy; ${new Date().getFullYear()} Powerforce Global &middot; Confidential
    </div>
  </div>
</body>
</html>`;
}

function buildReminderEmail(firstName: string, projectName: string, surveyUrl: string, type: "reminder" | "final"): string {
  const isFinal = type === "final";
  const heading = isFinal
    ? "Last chance to share your feedback"
    : "A friendly reminder about your feedback";
  const body = isFinal
    ? `This is your final reminder to complete the feedback survey for <strong>${projectName}</strong>. Your link expires in approximately 24 hours.`
    : `We noticed you haven't yet completed the feedback survey for <strong>${projectName}</strong>. It only takes about 3 minutes and your input is very valuable to us.`;

  return `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:'Inter',Arial,sans-serif;background:#f4f4f5;padding:40px 0;">
  <div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
    <div style="background:#1A1D23;padding:28px 32px;text-align:center;">
      <img src="${APP_URL}/logo-gold.png" alt="Powerforce Global" height="36" style="display:block;margin:0 auto;" />
    </div>
    <div style="padding:32px;color:#1A1D23;">
      <h2 style="margin:0 0 8px;font-size:20px;font-weight:700;color:#1A1D23;">Hi ${firstName},</h2>
      <p style="margin:0 0 16px;color:#4b5563;font-size:15px;line-height:1.6;">${heading}</p>
      <p style="margin:0 0 16px;color:#4b5563;font-size:14px;line-height:1.6;">${body}</p>
      <div style="text-align:center;margin:24px 0;">
        <a href="${surveyUrl}" style="display:inline-block;background:#F5BD00;color:#1A1D23;font-weight:700;font-size:15px;padding:14px 32px;border-radius:8px;text-decoration:none;">Complete Feedback Survey</a>
      </div>
      <p style="margin:16px 0 0;font-size:12px;color:#9ca3af;text-align:center;">
        Your personal survey link: <span style="word-break:break-all;">${surveyUrl}</span>
      </p>
    </div>
    <div style="text-align:center;padding:20px 32px;font-size:11px;color:#9ca3af;border-top:1px solid #f0f0f0;">
      &copy; ${new Date().getFullYear()} Powerforce Global &middot; Confidential
    </div>
  </div>
</body>
</html>`;
}
