/**
 * Email Inbox Poller
 * Polls Microsoft 365 inboxes via Graph API for unread emails with attachments,
 * classifies and files documents into the PFG database.
 */

import fs from 'fs';
import path from 'path';
import { getAccessToken, sendMail } from './email.js';
import { storage } from './storage.js';

// ── Constants ─────────────────────────────────────────────────────────────────

const INBOXES = [
  'dailyreport@powerforce.global',
  'hseaccidentincidents@powerforce.global',
];

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';

const UPLOAD_BASE = fs.existsSync('/data') ? '/data/uploads' : './uploads';

// ── Types ──────────────────────────────────────────────────────────────────────

type DocType = 'supervisor_report' | 'tbt' | 'safety_observation' | 'incident_report' | 'unknown';

interface GraphMessage {
  id: string;
  subject: string;
  from: { emailAddress: { address: string; name?: string } };
  receivedDateTime: string;
  hasAttachments: boolean;
  bodyPreview: string;
}

interface GraphAttachment {
  id: string;
  name: string;
  contentType: string;
  contentBytes: string;
  size: number;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function classifyDocument(filename: string, subject: string): DocType {
  const text = (filename + ' ' + subject).toLowerCase().replace(/[-_\s]/g, ' ');
  if (/\btbt\b|toolbox talk/.test(text)) return 'tbt';
  if (/observation|safety obs|unsafe condition/.test(text)) return 'safety_observation';
  if (/incident|accident|near miss|lti|lost time/.test(text)) return 'incident_report';
  if (/daily|activity report|dor|supervisor|site report/.test(text)) return 'supervisor_report';
  return 'unknown';
}

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').substring(0, 100);
}

function isProcessableAttachment(name: string, contentType: string): boolean {
  const nameLower = name.toLowerCase();
  return (
    contentType.includes('pdf') ||
    contentType.includes('image/') ||
    nameLower.endsWith('.pdf') ||
    nameLower.endsWith('.jpg') ||
    nameLower.endsWith('.jpeg') ||
    nameLower.endsWith('.png')
  );
}

// ── Core poller ───────────────────────────────────────────────────────────────

export async function pollInboxes(): Promise<void> {
  console.log('[email-poller] Starting inbox poll...');

  // Step 1: Get access token
  const token = await getAccessToken();
  if (!token) {
    console.error('[email-poller] Could not obtain access token — skipping poll');
    return;
  }

  // Prefetch all workers and projects once per poll cycle
  const allWorkers = await storage.getWorkers();
  const allUsers   = await storage.getUsers();

  // Step 2: For each inbox, fetch unread emails with attachments
  for (const inbox of INBOXES) {
    try {
      const messagesUrl =
        `${GRAPH_BASE}/users/${inbox}/messages` +
        `?$filter=isRead eq false and hasAttachments eq true` +
        `&$select=id,subject,from,receivedDateTime,hasAttachments,bodyPreview` +
        `&$top=25` +
        `&$orderby=receivedDateTime asc`;

      const msgRes = await fetch(messagesUrl, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!msgRes.ok) {
        const body = await msgRes.text();
        console.error(`[email-poller] Failed to fetch messages for ${inbox}: ${msgRes.status} ${body}`);
        continue;
      }

      const msgData = await msgRes.json() as { value: GraphMessage[] };
      const messages: GraphMessage[] = msgData.value ?? [];
      console.log(`[email-poller] ${inbox}: ${messages.length} unread message(s) with attachments`);

      for (const msg of messages) {
        try {
          await processMessage(token, inbox, msg, allWorkers, allUsers);
        } catch (err) {
          console.error(`[email-poller] Error processing message ${msg.id} in ${inbox}:`, err);
          // Still mark as read to avoid reprocessing broken emails endlessly
          await markAsRead(token, inbox, msg.id);
        }
      }
    } catch (err) {
      console.error(`[email-poller] Error polling inbox ${inbox}:`, err);
    }
  }

  console.log('[email-poller] Poll complete.');
}

async function processMessage(
  token: string,
  inbox: string,
  msg: GraphMessage,
  allWorkers: Awaited<ReturnType<typeof storage.getWorkers>>,
  allUsers: Awaited<ReturnType<typeof storage.getUsers>>,
): Promise<void> {
  const fromEmail = msg.from?.emailAddress?.address?.toLowerCase() ?? '';
  const subject   = msg.subject ?? '';
  const today     = new Date().toISOString().split('T')[0];

  // Step 3: Get attachments
  const attachUrl = `${GRAPH_BASE}/users/${inbox}/messages/${msg.id}/attachments` +
    `?$select=id,name,contentType,contentBytes,size`;

  const attachRes = await fetch(attachUrl, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!attachRes.ok) {
    const body = await attachRes.text();
    console.error(`[email-poller] Failed to fetch attachments for message ${msg.id}: ${attachRes.status} ${body}`);
    await markAsRead(token, inbox, msg.id);
    return;
  }

  const attachData = await attachRes.json() as { value: GraphAttachment[] };
  const attachments: GraphAttachment[] = (attachData.value ?? []).filter(a =>
    isProcessableAttachment(a.name ?? '', a.contentType ?? '')
  );

  if (attachments.length === 0) {
    // No processable attachments — mark as read and skip
    await markAsRead(token, inbox, msg.id);
    return;
  }

  // Step 5: Match sender email to worker + project
  const worker = allWorkers.find(w =>
    (w.personalEmail && w.personalEmail.toLowerCase() === fromEmail) ||
    (w.workEmail     && w.workEmail.toLowerCase()     === fromEmail)
  ) ?? null;

  let workerId: number | null   = worker?.id ?? null;
  let projectId: number | null  = null;
  let projectCode: string | null = null;

  if (worker) {
    // Find the worker's active/confirmed assignments to determine project
    const workerAssignments = await storage.getAssignmentsByWorker(worker.id);
    const activeAssignment  = workerAssignments.find(a =>
      a.status === 'active' || a.status === 'confirmed'
    );
    if (activeAssignment) {
      projectId   = activeAssignment.projectId;
      // Fetch project code for logging
      const proj  = await storage.getProject(projectId);
      projectCode = proj?.code ?? String(projectId);
    }
  }

  if (!worker) {
    console.log(`[email-poller] Unrecognised sender: ${fromEmail} → pending queue`);
  }

  // Process each attachment
  for (const attachment of attachments) {
    try {
      await processAttachment(
        token,
        inbox,
        msg,
        attachment,
        fromEmail,
        subject,
        today,
        workerId,
        projectId,
        projectCode,
        allUsers,
      );
    } catch (err) {
      console.error(`[email-poller] Error processing attachment "${attachment.name}":`, err);
    }
  }

  // Step 8: Mark email as read
  await markAsRead(token, inbox, msg.id);
}

async function processAttachment(
  token: string,
  inbox: string,
  msg: GraphMessage,
  attachment: GraphAttachment,
  fromEmail: string,
  subject: string,
  today: string,
  workerId: number | null,
  projectId: number | null,
  projectCode: string | null,
  allUsers: Awaited<ReturnType<typeof storage.getUsers>>,
): Promise<void> {
  const originalName = attachment.name ?? 'attachment';
  const docType: DocType = classifyDocument(originalName, subject);

  // Step 6: Save attachment to disk
  const datePrefix    = today; // YYYY-MM-DD
  const sanitizedType = docType.replace(/_/g, '-');
  const sanitizedName = sanitizeFilename(originalName);
  const filename      = `${datePrefix}_${sanitizedType}_${sanitizedName}`;

  const subDir = docType === 'supervisor_report' || docType === 'unknown'
    ? 'supervisor'
    : docType === 'tbt'
      ? 'toolbox-talks'
      : docType === 'safety_observation'
        ? 'safety-observations'
        : 'incident-reports';

  const dirPath = projectId
    ? path.join(UPLOAD_BASE, String(projectId), subDir)
    : path.join(UPLOAD_BASE, 'pending');

  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }

  const filePath = path.join(dirPath, filename);
  fs.writeFileSync(filePath, Buffer.from(attachment.contentBytes, 'base64'));

  const apiFilePath = projectId
    ? `/api/uploads/${projectId}/${subDir}/${filename}`
    : `/api/uploads/pending/${filename}`;

  console.log(`[email-poller] Processed: ${originalName} → ${docType} for project ${projectCode ?? 'unmatched'}`);

  // Step 7: Create DB record based on docType
  // For supervisor_report / unknown — always store (projectId may be null, schema allows it)
  if (docType === 'supervisor_report' || docType === 'unknown') {
    await storage.createSupervisorReport({
      projectId:    projectId,
      workerId:     workerId,
      reportDate:   today,
      shift:        null,
      submissionMethod: 'email',
      senderEmail:  fromEmail,
      filePath:     apiFilePath,
      fileName:     originalName,
      documentType: docType,
      status:       projectId ? 'filed' : 'pending_assignment',
    });
    return;
  }

  // For other doc types, skip DB insert if no project matched (schema requires projectId in practice)
  if (!projectId) {
    console.log(`[email-poller] Skipping DB insert for ${docType} — no project matched for sender ${fromEmail}. File saved to pending.`);
    // Still save a supervisor_report record as a fallback so the document isn't lost
    await storage.createSupervisorReport({
      projectId:    null,
      workerId:     workerId,
      reportDate:   today,
      shift:        null,
      submissionMethod: 'email',
      senderEmail:  fromEmail,
      filePath:     apiFilePath,
      fileName:     originalName,
      documentType: docType,
      status:       'pending_assignment',
    });
    return;
  }

  if (docType === 'tbt') {
    await storage.createToolboxTalk({
      projectId:        projectId,
      workerId:         workerId,
      reportDate:       today,
      shift:            null,
      topic:            subject,
      attendeeCount:    null,
      filePath:         apiFilePath,
      fileName:         originalName,
      notes:            null,
      submissionMethod: 'email',
    });
    return;
  }

  if (docType === 'safety_observation') {
    await storage.createSafetyObservation({
      projectId:           projectId,
      reportedByWorkerId:  workerId,
      relatesToWorkerIds:  [],
      shiftSupervisorId:   null,
      observationDate:     today,
      observationTime:     null,
      shift:               null,
      observationType:     'unsafe_condition',
      locationOnSite:      null,
      description:         subject,
      actionsTaken:        null,
      filePath:            apiFilePath,
      fileName:            originalName,
      status:              'open',
      submissionMethod:    'email',
    });
    return;
  }

  if (docType === 'incident_report') {
    const text = (originalName + ' ' + subject).toLowerCase();
    const isLti = /\blti\b|lost time/.test(text);

    await storage.createIncidentReport({
      projectId:           projectId,
      workerInvolvedId:    workerId,
      reportedByWorkerId:  workerId,
      shiftSupervisorId:   null,
      incidentDate:        today,
      incidentTime:        null,
      shift:               null,
      incidentType:        isLti ? 'lost_time_injury' : 'near_miss',
      description:         subject,
      lostTime:            isLti,
      lostTimeHours:       null,
      actionsTaken:        null,
      rootCause:           null,
      filePath:            apiFilePath,
      fileName:            originalName,
      status:              'open',
      submissionMethod:    'email',
    });

    // Step 9: Send alerts for LTI
    if (isLti) {
      await sendLtiAlert(allUsers, projectId, subject);
    }
  }
}

async function sendLtiAlert(
  allUsers: Awaited<ReturnType<typeof storage.getUsers>>,
  projectId: number,
  subject: string,
): Promise<void> {
  try {
    // Get all admin users + PM for the project
    const adminUsers    = allUsers.filter(u => u.role === 'admin' && u.isActive);
    const projectLead   = await storage.getProjectLead(projectId);
    const project       = await storage.getProject(projectId);
    const projectName   = project?.name ?? `Project ${projectId}`;

    const alertEmails: string[] = adminUsers.map(u => u.email);
    if (projectLead) {
      const pmUser = allUsers.find(u => u.id === projectLead.userId);
      if (pmUser && !alertEmails.includes(pmUser.email)) {
        alertEmails.push(pmUser.email);
      }
    }

    if (alertEmails.length === 0) {
      console.log('[email-poller] No admin/PM recipients found for LTI alert');
      return;
    }

    await sendMail({
      to: alertEmails,
      subject: `[ALERT] LTI Report received — ${projectName}`,
      html: `
        <p>An LTI (Lost Time Injury) incident report has been received via email for project <strong>${projectName}</strong>.</p>
        <p><strong>Subject:</strong> ${subject}</p>
        <p>Please review the incident report in the platform immediately.</p>
      `,
      text: `An LTI incident report has been received via email for project ${projectName}.\n\nSubject: ${subject}\n\nPlease review the incident report in the platform immediately.`,
    });

    console.log(`[email-poller] LTI alert sent to: ${alertEmails.join(', ')}`);
  } catch (err) {
    console.error('[email-poller] Failed to send LTI alert:', err);
  }
}

async function markAsRead(token: string, inbox: string, messageId: string): Promise<void> {
  try {
    const res = await fetch(`${GRAPH_BASE}/users/${inbox}/messages/${messageId}`, {
      method:  'PATCH',
      headers: {
        Authorization:  `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ isRead: true }),
    });

    if (!res.ok) {
      const body = await res.text();
      console.error(`[email-poller] Failed to mark message ${messageId} as read: ${res.status} ${body}`);
    }
  } catch (err) {
    console.error(`[email-poller] Error marking message as read:`, err);
  }
}
