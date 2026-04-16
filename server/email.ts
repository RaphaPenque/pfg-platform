/**
 * Microsoft Graph email service
 * Uses client-credentials OAuth2 flow to send mail via Graph API.
 * Requires: AZURE_CLIENT_ID, AZURE_TENANT_ID, AZURE_CLIENT_SECRET, MAIL_FROM
 */

import { ConfidentialClientApplication } from "@azure/msal-node";

const CLIENT_ID     = process.env.AZURE_CLIENT_ID     || "";
const TENANT_ID     = process.env.AZURE_TENANT_ID     || "";
const CLIENT_SECRET = process.env.AZURE_CLIENT_SECRET || "";
const MAIL_FROM     = process.env.MAIL_FROM            || "raphael@powerforce.global";

// Lazy singleton — only created when credentials are present
let msalApp: ConfidentialClientApplication | null = null;

function getMsalApp(): ConfidentialClientApplication | null {
  if (!CLIENT_ID || !TENANT_ID || !CLIENT_SECRET) return null;
  if (!msalApp) {
    msalApp = new ConfidentialClientApplication({
      auth: {
        clientId: CLIENT_ID,
        authority: `https://login.microsoftonline.com/${TENANT_ID}`,
        clientSecret: CLIENT_SECRET,
      },
    });
  }
  return msalApp;
}

export async function getAccessToken(): Promise<string | null> {
  const app = getMsalApp();
  if (!app) return null;
  try {
    const result = await app.acquireTokenByClientCredential({
      scopes: ["https://graph.microsoft.com/.default"],
    });
    return result?.accessToken ?? null;
  } catch (err) {
    console.error("[email] Failed to acquire token:", err);
    return null;
  }
}

export interface MailOptions {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  /** Optional sender — must be a valid @powerforce.global mailbox. Defaults to MAIL_FROM env var. */
  from?: string;
  /** Optional file attachments (base64-encoded). */
  attachments?: Array<{
    name: string;
    contentType: string;
    contentBytes: string;  // base64
  }>;
}

/**
 * Send an email via Microsoft Graph.
 * Falls back to console.log (for local dev) if credentials are missing.
 */
export async function sendMail(opts: MailOptions): Promise<boolean> {
  const recipients = Array.isArray(opts.to) ? opts.to : [opts.to];

  // ── Dev / missing credentials fallback ──────────────────────────
  if (!CLIENT_ID || !TENANT_ID || !CLIENT_SECRET) {
    console.log("[email:dev] Would send email:");
    console.log(`  To:      ${recipients.join(", ")}`);
    console.log(`  Subject: ${opts.subject}`);
    console.log(`  Body:    ${opts.text || opts.html.replace(/<[^>]+>/g, "").substring(0, 200)}`);
    return true;
  }

  const token = await getAccessToken();
  if (!token) {
    console.error("[email] Could not obtain access token — email not sent");
    return false;
  }

  const message = {
    message: {
      subject: opts.subject,
      body: {
        contentType: "HTML",
        content: opts.html,
      },
      toRecipients: recipients.map((addr) => ({
        emailAddress: { address: addr },
      })),
      ...(opts.attachments && opts.attachments.length > 0 ? {
        attachments: opts.attachments.map(a => ({
          "@odata.type": "#microsoft.graph.fileAttachment",
          name: a.name,
          contentType: a.contentType,
          contentBytes: a.contentBytes,
        })),
      } : {}),
    },
    saveToSentItems: true,
  };

  // Use specified sender or fall back to default MAIL_FROM
  const sender = (opts.from && opts.from.endsWith('@powerforce.global')) ? opts.from : MAIL_FROM;

  try {
    const res = await fetch(
      `https://graph.microsoft.com/v1.0/users/${sender}/sendMail`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(message),
      }
    );

    if (res.status === 202) {
      console.log(`[email] Sent "${opts.subject}" → ${recipients.join(", ")}`);
      return true;
    }

    const body = await res.text();
    console.error(`[email] Graph sendMail failed ${res.status}:`, body);
    return false;
  } catch (err) {
    console.error("[email] Network error sending mail:", err);
    return false;
  }
}

// ─── Template helpers ────────────────────────────────────────────────────────

const BASE_STYLE = `
  font-family: 'Inter', Arial, sans-serif;
  background: #f4f4f5;
  padding: 40px 0;
`;
const CARD_STYLE = `
  max-width: 520px;
  margin: 0 auto;
  background: #ffffff;
  border-radius: 12px;
  overflow: hidden;
  box-shadow: 0 2px 8px rgba(0,0,0,0.08);
`;
const HEADER_STYLE = `
  background: #1A1D23;
  padding: 28px 32px;
  text-align: center;
`;
const BODY_STYLE = `
  padding: 32px;
  color: #1A1D23;
`;
const BTN_STYLE = `
  display: inline-block;
  background: #F5BD00;
  color: #1A1D23 !important;
  font-weight: 700;
  font-size: 15px;
  padding: 14px 32px;
  border-radius: 8px;
  text-decoration: none;
  margin: 24px 0 8px;
`;
const FOOTER_STYLE = `
  text-align: center;
  padding: 20px 32px;
  font-size: 11px;
  color: #9ca3af;
  border-top: 1px solid #f0f0f0;
`;

function baseTemplate(bodyContent: string): string {
  return `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="${BASE_STYLE}">
  <div style="${CARD_STYLE}">
    <div style="${HEADER_STYLE}">
      <img src="https://pfg-platform.onrender.com/logo-gold.png" alt="Powerforce Global" height="36" style="display:block;margin:0 auto;" />
    </div>
    <div style="${BODY_STYLE}">${bodyContent}</div>
    <div style="${FOOTER_STYLE}">
      &copy; ${new Date().getFullYear()} Powerforce Global &middot; Confidential &middot;
      <a href="https://pfg-platform.onrender.com" style="color:#63758C;text-decoration:none;">pfg-platform.onrender.com</a>
    </div>
  </div>
</body>
</html>`;
}

/** Magic link login email */
export function magicLinkEmail(name: string, loginUrl: string): { subject: string; html: string; text: string } {
  const subject = "Your Powerforce Platform login link";
  const html = baseTemplate(`
    <h2 style="margin:0 0 8px;font-size:20px;font-weight:700;color:#1A1D23;">Hi ${name},</h2>
    <p style="margin:0 0 16px;color:#4b5563;font-size:15px;line-height:1.6;">
      Here is your secure login link for the <strong>Powerforce Global Platform</strong>.
      It expires in <strong>15 minutes</strong> and can only be used once.
    </p>
    <div style="text-align:center;">
      <a href="${loginUrl}" style="${BTN_STYLE}">Log in to Platform</a>
    </div>
    <p style="margin:16px 0 0;font-size:12px;color:#9ca3af;text-align:center;">
      Or copy this link: <span style="word-break:break-all;">${loginUrl}</span>
    </p>
    <p style="margin:24px 0 0;font-size:13px;color:#6b7280;">
      If you didn't request this, you can safely ignore this email.
    </p>
  `);
  const text = `Hi ${name},\n\nYour Powerforce Platform login link (expires in 15 minutes):\n\n${loginUrl}\n\nIf you didn't request this, ignore this email.`;
  return { subject, html, text };
}

/** Temp assignment confirmation email — sent to worker */
export function confirmationEmail(
  workerName: string,
  projectName: string,
  role: string,
  shift: string,
  startDate: string,
  endDate: string,
  location: string,
  confirmUrl: string,
  declineUrl: string,
): { subject: string; html: string; text: string } {
  const firstName = workerName.split(" ")[0];
  const respondBy = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  const subject = `Assignment Confirmation — ${projectName}`;
  const GREEN_BTN = `
    display: inline-block;
    background: #16a34a;
    color: #ffffff !important;
    font-weight: 700;
    font-size: 15px;
    padding: 14px 32px;
    border-radius: 8px;
    text-decoration: none;
    margin: 8px 6px;
  `;
  const RED_BTN = `
    display: inline-block;
    background: #dc2626;
    color: #ffffff !important;
    font-weight: 700;
    font-size: 15px;
    padding: 14px 32px;
    border-radius: 8px;
    text-decoration: none;
    margin: 8px 6px;
  `;
  const html = baseTemplate(`
    <h2 style="margin:0 0 8px;font-size:20px;font-weight:700;color:#1A1D23;">Hi ${firstName},</h2>
    <p style="margin:0 0 16px;color:#4b5563;font-size:15px;line-height:1.6;">
      You have been assigned to a project. Please review the details below and confirm your availability.
    </p>
    <table style="width:100%;border-collapse:collapse;margin:16px 0;">
      <tr><td style="padding:6px 12px;font-size:13px;color:#6b7280;border-bottom:1px solid #f0f0f0;">Project</td><td style="padding:6px 12px;font-size:14px;font-weight:600;color:#1A1D23;border-bottom:1px solid #f0f0f0;">${projectName}</td></tr>
      <tr><td style="padding:6px 12px;font-size:13px;color:#6b7280;border-bottom:1px solid #f0f0f0;">Role</td><td style="padding:6px 12px;font-size:14px;font-weight:600;color:#1A1D23;border-bottom:1px solid #f0f0f0;">${role}</td></tr>
      <tr><td style="padding:6px 12px;font-size:13px;color:#6b7280;border-bottom:1px solid #f0f0f0;">Shift</td><td style="padding:6px 12px;font-size:14px;font-weight:600;color:#1A1D23;border-bottom:1px solid #f0f0f0;">${shift}</td></tr>
      <tr><td style="padding:6px 12px;font-size:13px;color:#6b7280;border-bottom:1px solid #f0f0f0;">Dates</td><td style="padding:6px 12px;font-size:14px;font-weight:600;color:#1A1D23;border-bottom:1px solid #f0f0f0;">${startDate} &ndash; ${endDate}</td></tr>
      <tr><td style="padding:6px 12px;font-size:13px;color:#6b7280;">Location</td><td style="padding:6px 12px;font-size:14px;font-weight:600;color:#1A1D23;">${location || "TBC"}</td></tr>
    </table>
    <div style="text-align:center;margin:24px 0;">
      <a href="${confirmUrl}" style="${GREEN_BTN}">&#10003; Confirm Assignment</a>
      <a href="${declineUrl}" style="${RED_BTN}">&#10007; Decline Assignment</a>
    </div>
    <p style="margin:16px 0 0;font-size:12px;color:#9ca3af;text-align:center;">
      Please respond by <strong>${respondBy}</strong>.
    </p>
  `);
  const text = `Hi ${firstName},\n\nYou have been assigned to ${projectName}.\n\nRole: ${role}\nShift: ${shift}\nDates: ${startDate} – ${endDate}\nLocation: ${location || "TBC"}\n\nConfirm: ${confirmUrl}\nDecline: ${declineUrl}\n\nPlease respond by ${respondBy}.`;
  return { subject, html, text };
}

/** Notification to RM when worker responds to confirmation */
export function confirmationResultEmail(
  rmName: string,
  workerName: string,
  projectName: string,
  response: "confirmed" | "declined",
): { subject: string; html: string; text: string } {
  const isConfirmed = response === "confirmed";
  const emoji = isConfirmed ? "&#10003;" : "&#10007;";
  const color = isConfirmed ? "#16a34a" : "#dc2626";
  const label = isConfirmed ? "Confirmed" : "Declined";
  const subject = `${workerName} has ${response} — ${projectName}`;
  const html = baseTemplate(`
    <h2 style="margin:0 0 8px;font-size:20px;font-weight:700;color:#1A1D23;">Hi ${rmName.split(" ")[0]},</h2>
    <p style="margin:0 0 16px;color:#4b5563;font-size:15px;line-height:1.6;">
      <strong>${workerName}</strong> has responded to their assignment confirmation for <strong>${projectName}</strong>.
    </p>
    <div style="text-align:center;margin:20px 0;">
      <span style="display:inline-block;padding:12px 28px;border-radius:8px;font-size:16px;font-weight:700;color:#fff;background:${color};">
        ${emoji} ${label}
      </span>
    </div>
    <p style="margin:16px 0 0;font-size:13px;color:#6b7280;text-align:center;">
      ${isConfirmed ? "The assignment is now confirmed and the worker is committed." : "You may need to find a replacement for this slot."}
    </p>
  `);
  const text = `Hi ${rmName.split(" ")[0]},\n\n${workerName} has ${response} their assignment for ${projectName}.\n\n${isConfirmed ? "The assignment is now confirmed." : "You may need to find a replacement."}`;
  return { subject, html, text };
}

/** New user welcome / invite email */
export function welcomeEmail(name: string, role: string, loginUrl: string): { subject: string; html: string; text: string } {
  const roleLabel: Record<string, string> = {
    admin: "Administrator",
    resource_manager: "Resource Manager",
    project_manager: "Project Manager",
    finance: "Finance",
    observer: "Observer",
  };
  const subject = "Welcome to the Powerforce Global Platform";
  const html = baseTemplate(`
    <h2 style="margin:0 0 8px;font-size:20px;font-weight:700;color:#1A1D23;">Welcome, ${name}!</h2>
    <p style="margin:0 0 16px;color:#4b5563;font-size:15px;line-height:1.6;">
      You've been added to the <strong>Powerforce Global Workforce Platform</strong>
      as a <strong>${roleLabel[role] || role}</strong>.
    </p>
    <p style="margin:0 0 8px;color:#4b5563;font-size:14px;">Click below to set up your access:</p>
    <div style="text-align:center;">
      <a href="${loginUrl}" style="${BTN_STYLE}">Access Platform</a>
    </div>
    <p style="margin:16px 0 0;font-size:12px;color:#9ca3af;text-align:center;">
      Link expires in 15 minutes. You can always request a new one from the login page.
    </p>
  `);
  const text = `Welcome to the Powerforce Global Platform, ${name}!\n\nYou've been added as ${roleLabel[role] || role}.\n\nAccess the platform here (link expires in 15 minutes):\n${loginUrl}\n\nYou can request a new link anytime from the login page.`;
  return { subject, html, text };
}
