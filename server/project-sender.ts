/**
 * Resolves the email sender identity for project-scoped emails.
 *
 * Project emails (supervisor timesheet links, customer timesheets, weekly reports,
 * PM notifications) should logically be FROM the project's assigned PM — not from
 * whoever happened to be logged in or the central platform mailbox. This helper
 * encapsulates that lookup with a safe fallback hierarchy:
 *
 *   1. Assigned PM (project_leads → users) with a @powerforce.global email
 *   2. Configured per-project sender override (future: projects.sender_email)
 *   3. Central MAIL_FROM (raphael@powerforce.global by default)
 *
 * What the resolved identity actually drives:
 *
 *   - `from`        — the mailbox Graph API will send AS. Requires Mail.Send on that
 *                     mailbox; if the chosen address is NOT @powerforce.global, the
 *                     email module silently falls back to MAIL_FROM.
 *   - `fromName`    — display name shown next to the From: address. Always set to
 *                     the PM's name when known, even when impersonation isn't
 *                     possible — gives recipients a recognisable sender.
 *   - `replyTo`     — set to the PM email so a customer/supervisor reply lands in
 *                     the PM's inbox. Always populated when a PM email exists,
 *                     regardless of whether `from` succeeds at impersonation.
 *
 * Whether the email truly originates FROM the PM or merely shows the PM as the
 * reply-to depends on Graph permissions: the app registration needs Mail.Send
 * on the PM's mailbox. If that's missing, Graph rejects the send and the email
 * module falls back to MAIL_FROM transparently.
 */

import { sql } from "drizzle-orm";
import { db } from "./storage";

export interface ProjectSenderIdentity {
  /** Mailbox we attempt to send AS (Graph users/{from}/sendMail). */
  from: string | undefined;
  /** Display name to show alongside the From: address. */
  fromName: string | undefined;
  /** Address(es) replies should be routed to. */
  replyTo: string | undefined;
  /** Audit / debug: how the identity was resolved. */
  source:
    | "assigned_pm"
    | "central_default"
    | "missing";
  /** Audit / debug warnings (e.g. PM has no email on file). */
  warnings: string[];
}

const POWERFORCE_DOMAIN = "@powerforce.global";

/**
 * Look up the assigned PM for a project and resolve the sender identity.
 * Never throws — on any error returns a `central_default` identity.
 */
export async function getProjectSenderIdentity(
  projectId: number,
): Promise<ProjectSenderIdentity> {
  const warnings: string[] = [];

  try {
    const res = await db.execute(sql`
      SELECT u.email, u.name
      FROM project_leads pl
      JOIN users u ON u.id = pl.user_id
      WHERE pl.project_id = ${projectId}
      LIMIT 1
    `);
    const row = res.rows[0] as { email?: string | null; name?: string | null } | undefined;

    if (!row) {
      warnings.push(`No assigned PM for project ${projectId} — falling back to central sender.`);
      return { from: undefined, fromName: undefined, replyTo: undefined, source: "missing", warnings };
    }

    const pmEmail = (row.email || "").trim();
    const pmName = (row.name || "").trim() || undefined;

    if (!pmEmail) {
      warnings.push(`Assigned PM for project ${projectId} has no email on file — falling back to central sender with PM name only.`);
      return { from: undefined, fromName: pmName, replyTo: undefined, source: "missing", warnings };
    }

    const onDomain = pmEmail.toLowerCase().endsWith(POWERFORCE_DOMAIN);
    if (!onDomain) {
      warnings.push(`Assigned PM email "${pmEmail}" is not @powerforce.global — cannot send AS PM. Setting replyTo only.`);
      return {
        from: undefined,         // can't impersonate non-domain mailbox
        fromName: pmName,        // still show PM's name
        replyTo: pmEmail,        // replies still route to PM
        source: "assigned_pm",
        warnings,
      };
    }

    return {
      from: pmEmail,
      fromName: pmName,
      replyTo: pmEmail,
      source: "assigned_pm",
      warnings,
    };
  } catch (err: any) {
    warnings.push(`getProjectSenderIdentity: lookup failed for project ${projectId}: ${err?.message || String(err)}`);
    return { from: undefined, fromName: undefined, replyTo: undefined, source: "central_default", warnings };
  }
}

/**
 * Synchronous variant — for code paths that already know the PM email/name and
 * just need to apply the same resolution rules. Kept tiny + pure for unit tests.
 */
export function buildSenderIdentityFromPm(
  pmEmail: string | null | undefined,
  pmName: string | null | undefined,
): ProjectSenderIdentity {
  const warnings: string[] = [];
  const cleanEmail = (pmEmail || "").trim();
  const cleanName = (pmName || "").trim() || undefined;

  if (!cleanEmail) {
    return {
      from: undefined,
      fromName: cleanName,
      replyTo: undefined,
      source: cleanName ? "missing" : "central_default",
      warnings: cleanName ? ["PM has no email — central sender, PM name only."] : [],
    };
  }

  const onDomain = cleanEmail.toLowerCase().endsWith(POWERFORCE_DOMAIN);
  if (!onDomain) {
    warnings.push(`PM email "${cleanEmail}" is not @powerforce.global — cannot impersonate, replyTo only.`);
    return {
      from: undefined,
      fromName: cleanName,
      replyTo: cleanEmail,
      source: "assigned_pm",
      warnings,
    };
  }
  return {
    from: cleanEmail,
    fromName: cleanName,
    replyTo: cleanEmail,
    source: "assigned_pm",
    warnings,
  };
}
