# Project Edit & Status Management — Full Specification

## Overview
Add the ability to edit existing projects via a tabbed edit view, manage project statuses (Active, Completed, Cancelled, Potential), and filter the project allocation view by status.

## Project Statuses
- **Active**: Real, ongoing projects. Default state when created via the wizard.
- **Completed**: Finished projects. Hidden by default. Can be set from Active.
- **Cancelled**: Cancelled real projects. Hidden by default. Can be set from Active.
- **Potential**: "What-if" capacity checks. Visible by default alongside Active.
  - Can be **Materialised** → becomes Active
  - Can be **Cancelled** → deleted entirely (no record, since it was never real)

## Project Allocation Page Changes

### Status filter toggles
Add filter toggles above the project grid:
- **Active** (on by default)
- **Potential** (on by default) — styled differently (dashed border or muted style to distinguish from real projects)
- **Completed** (off by default)
- **Cancelled** (off by default)

### Project Cards
- Active projects: current solid card style with OEM colour header
- Potential projects: dashed border, muted/semi-transparent header, "POTENTIAL" badge
- Completed projects: greyed out with "COMPLETED" badge
- Cancelled projects: greyed out with "CANCELLED" badge and strikethrough on name

### Create Project Wizard
Add a toggle or radio at the top of Step 1 (Project Details):
- "Create as Active Project" (default)
- "Create as Potential Project"

### Project Edit View (replaces the current EditProjectModal)
When clicking on a project card, open a full modal with **tabs** (not a step-by-step wizard):

**Tab 1: Details**
- All project fields editable: Code, Name, Customer, OEM, Location, Equipment Type, Start Date, End Date, Shift, Headcount, Notes
- Status shown but not directly editable here (use action buttons instead)

**Tab 2: Role Planning**
- Same table as the creation wizard Step 2
- Can add, edit, and remove role slots
- Each row: Role dropdown, Start Date, End Date, Quantity, Shift, Delete button

**Tab 3: Team / Staff**
- List of currently assigned workers with their role, shift, dates
- Remove button per worker
- "Add Person" section (same as current EditProjectModal's add panel)
- Smart sorting: FTE first, OEM match, lowest utilisation

**Action buttons in the modal header/footer:**
- For **Active** projects: "Mark Completed" button, "Cancel Project" button
- For **Potential** projects: "Materialise" button (converts to Active), "Discard" button (deletes entirely)
- For **Completed/Cancelled**: "Reactivate" button (sets back to Active)
- "Save Changes" button (saves edits to details/roles/staff)
- "Close" button

### Action behaviours:
- **Mark Completed**: Sets project status to "completed". All assignments remain in history.
- **Cancel Project**: Sets project status to "cancelled". Assignments remain but are marked inactive.
- **Materialise** (Potential only): Changes status from "potential" to "active". Project becomes real.
- **Discard** (Potential only): Deletes the project and all its role slots and assignments entirely. No trace left.
- **Reactivate**: Changes status back to "active".

## API Changes needed

### Update project endpoint
PATCH /api/projects/:id — already exists, just needs to handle status changes

### Delete project endpoint  
DELETE /api/projects/:id — should also delete associated role_slots and assignments
- Only allowed for Potential projects (discard)

### New endpoint for bulk status change
POST /api/projects/:id/status — body: { status: "active" | "completed" | "cancelled" }
- For "cancelled" active projects: also update all assignments to status "removed"

## Gantt Chart & Person Schedule
- Only show Active projects by default
- Potential projects: show with dashed bars on the Gantt (to visualise capacity impact)
- Completed/Cancelled: hidden by default, toggleable

## Implementation Notes
- Use the existing modal pattern (ModalOverlay) from ProjectAllocation.tsx
- The tabbed edit view should look like the worker detail card tabs (Summary/Certs/Experience)
- Keep the PFG branding: yellow active tab indicator, navy text, steel muted text
- All interactive elements need data-testid attributes
- Invalidate queryKey ["/api/dashboard"] after any mutation
- Use apiRequest from @/lib/queryClient for all HTTP requests

## File: client/src/pages/ProjectAllocation.tsx
This is the main file to modify. The current EditProjectModal should be replaced with the new tabbed edit view. The AddProjectModal should get the Active/Potential toggle.

## File: server/routes.ts
Add the POST /api/projects/:id/status endpoint. Update DELETE to cascade-delete role_slots and assignments.

## Additional Requirements (added during build)

### Auto-Complete Projects
- Projects where endDate < today should automatically display as "Completed" in the UI
- This is a display-level check, not a database update — the status field stays "active" but the UI shows it as completed
- If someone edits the end date to extend it beyond today, it goes back to showing as Active
- This means the filter logic should treat projects with past end dates as completed when filtering

### Project Extensions
- When editing a project, the end date can be extended
- Extending the end date keeps the project Active
- The role slots and assignments do NOT automatically extend — the resource manager must manually update each one
- In the Team/Staff tab of the edit view, show each assignment's end date clearly so the manager can see who needs extending
- Allow inline editing of assignment end dates in the Team tab

### Assignment Extension in Team Tab
- Each assigned worker row should show: Name, Role, Shift, Start Date, End Date
- The End Date should be editable inline (click to change)
- If the assignment end date is before the project end date, show an amber indicator ("ends early")
- Add an "Extend All" button that sets all assignment end dates to match the new project end date (with confirmation)
