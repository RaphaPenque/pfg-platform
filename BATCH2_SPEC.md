# Batch 2 — Project Allocation Improvements

## Overview
Three interconnected improvements to the project edit modal:
1. Edit allocation follows role-slot-based flow (like creation wizard)
2. Availability conflict check enforced on edit
3. Role planning dates are editable (with conflict warnings)
Plus: bulk email to Temps from project summary step.

---

## 1. Bulk Email to Temps from Project Wizard (Step 4 — Summary)

### Where
In the project creation wizard Step 4 (Summary), after showing the list of assigned workers.

### What
A "Email Temp Workers" button that appears if any assigned workers are Temp status AND have a personalEmail on file.

### Behaviour
- Shows a preview panel listing which Temps will receive an email
- Warns if any Temp has no email on file ("3 workers have no email — add contact info first")
- On confirm, sends one personalised email per Temp via POST /api/projects/notify-temps
- Each email is personalised with the worker's first name, their specific role slot dates, and the project details

### Email format (plain text):
```
Subject: Project Assignment — [Project Name]

Dear [First Name],

We would like to allocate you to the following project with Powerforce Global.

Project: [Project Name]
Location: [Location]
Role: [Their assigned role]
Start Date: [Their role slot start date]
End Date: [Their role slot end date]

If you are available and would be interested in joining us on this project, please reply as soon as possible.

Kind regards,
Powerforce Global
```

### API endpoint: POST /api/projects/notify-temps
Body: { projectId: number, assignmentIds: number[] }
- For each assignmentId, fetch the worker, their assignment details, and the project info
- Send email via Outlook connector (use the existing send_email integration)
- Note: This requires Outlook credentials. For now, implement the endpoint to accept the request and log it. Wire Outlook in a separate step.
- Return { sent: number, skipped: number, noEmail: string[] }

---

## 2. Role-Slot-Based Staff Assignment in Edit Modal

### Current problem
The Team tab in the project edit modal has a simple "add any worker" panel that ignores role slots and dates. It should mirror the Step 3 wizard flow.

### What to rebuild
Replace the current "add person" panel in the Team tab with a role-slot-based assignment panel identical to Step 3 of the creation wizard:

- Group assignments by role slot (same as creation wizard)
- Each role slot shows: Role, Date range, Shift, Qty filled/total
- Below each role slot: a worker search list filtered to AVAILABLE workers for that specific slot's dates
  - Uses the same `getAvailableWorkersBase` logic (check for date overlaps)
  - FTE/All toggle per slot
  - Search by name
  - Expand preview on click (info icon)
- Clicking "+" adds the worker to that slot (POST /api/assignments)
- Existing team members still shown above, with remove buttons and inline end date editing
- If a project has no role slots, show a message "No role slots defined — go to Role Planning tab first"

### Availability logic (reuse from creation wizard)
The `getAvailableWorkersBase` function in ProjectAllocation.tsx already implements date-overlap checking. Extract it into a shared utility so both the creation wizard and the edit modal use identical logic.

Function signature:
```typescript
function workerIsAvailable(
  worker: DashboardWorker,
  slotStart: string,
  slotEnd: string,
  excludeAssignmentId?: number // to exclude the current assignment when editing
): boolean
```

---

## 3. Editable Role Planning Dates in Edit Modal

### Current problem
Role slots in the edit modal's Role Planning tab have dates displayed but may not be editable, or changes don't persist.

### What to fix
- Make all role slot fields editable: Role, Start Date, End Date, Qty, Shift
- On change, call PATCH /api/role-slots/:id with the updated fields
- Add PATCH /api/role-slots/:id endpoint in routes.ts and storage.ts
- After updating a role slot's dates, check if any EXISTING assignments to that slot now have conflicting dates
- If conflicts found: show a warning banner "Warning: [Worker names] are assigned outside these new dates. Update their assignment dates in the Team tab."
- Do NOT auto-update assignment dates — let the resource manager decide

### API: PATCH /api/role-slots/:id
Body: { role?: string, startDate?: string, endDate?: string, quantity?: number, shift?: string }
Add updateRoleSlot(id, data) to IStorage and SqliteStorage.

---

## 4. Conflict Check on Edit Modal — Add Worker

When adding a worker in the edit modal's Team tab:
- Only show workers who are available for the specific role slot dates (no overlapping assignments)
- This is enforced by the role-slot-based panel from item 2 above — it already filters by availability
- If the role slot dates are undefined or the project has no role slots, fall back to a basic conflict check using the project's start/end dates

---

## Technical notes
- File to modify: client/src/pages/ProjectAllocation.tsx (edit modal Team + Role Planning tabs)
- New API routes in server/routes.ts: PATCH /api/role-slots/:id, POST /api/projects/notify-temps
- New storage methods: updateRoleSlot(id, data)
- Reuse existing getAvailableWorkersBase availability logic — extract as a utility
- Invalidate queryKey ["/api/dashboard"] after mutations
- data-testid on all new interactive elements
- Keep PFG branding: navy #1A1D23, yellow #F5BD00, steel #63758C
- After all changes, run `npm run build` with zero errors. Do NOT start the dev server.
