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

async function getAccessToken(): Promise<string | null> {
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
    },
    saveToSentItems: true,
  };

  try {
    const res = await fetch(
      `https://graph.microsoft.com/v1.0/users/${MAIL_FROM}/sendMail`,
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
