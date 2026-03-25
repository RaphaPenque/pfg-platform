# Project Edit & Status Management — Implementation Summary

## Files Modified

### 1. `server/storage.ts`
- Added `updateProjectStatus(id, status)` method to `IStorage` interface and `SqliteStorage` class
- Added `deleteProject(id)` method with cascade deletion (assignments → role_slots → project)

### 2. `server/routes.ts`
- **NEW** `POST /api/projects/:id/status` — Changes project status. Validates status is one of: active, completed, cancelled, potential. When cancelling an active project, marks all active assignments as "removed".
- **UPDATED** `DELETE /api/projects/:id` — Now only allows deletion of potential projects (returns 400 otherwise). Cascade-deletes role_slots and assignments via `storage.deleteProject()`.

### 3. `client/src/pages/ProjectAllocation.tsx` (major rewrite)
- **Status filter toggles** at top of page: Active (on), Potential (on), Completed (off), Cancelled (off)
- **Active/Potential radio** added to AddProjectModal Step 1 — users can create as either status
- **Project cards** styled per status:
  - Active: solid border, full-color header
  - Potential: dashed yellow border, semi-transparent header, "POTENTIAL" badge
  - Completed: greyed-out, "COMPLETED" badge
  - Cancelled: greyed-out, strikethrough name, "CANCELLED" badge
- **EditProjectModal completely replaced** with tabbed view:
  - **Details tab**: All project fields editable (code, name, customer, location, equipment, dates, shift, headcount, notes). Status shown read-only.
  - **Role Planning tab**: Same table as creation wizard. Add/edit/remove role slots. Existing slots loaded from dashboard data.
  - **Team tab**: Current team with remove/undo, add person panel with search. Smart sorting (FTE first, OEM match, lowest utilisation).
- **Action buttons in footer**:
  - Potential projects: "Materialise" (→ active) + "Discard" (delete entirely)
  - Active projects: "Mark Completed" + "Cancel Project"
  - Completed/Cancelled: "Reactivate" (→ active)
- **ConfirmDialog** component for destructive actions
- Project grid sorted: active → potential → completed → cancelled, then by member count

### 4. `client/src/pages/GanttChart.tsx`
- Added status filter toggles (Active + Potential on by default)
- Potential projects rendered with dashed/semi-transparent bars
- Completed/Cancelled shown greyed out with labels
- Demand curve only counts active project assignments
- Legend updated to show "Potential" indicator

### 5. `client/src/pages/PersonSchedule.tsx`
- Added status filter toggles in filter bar (Active on by default)
- Only shows assignment bars from projects matching the status filter
- Workers always shown but bars are filtered

## Technical Notes
- All mutations invalidate `["/api/dashboard"]` queryKey
- All HTTP requests use `apiRequest` from `@/lib/queryClient`
- All interactive elements have `data-testid` attributes
- No localStorage/sessionStorage used
- SQLite synchronous calls (.get()/.all()/.run()) used correctly
- Build verified: `npm run build` passes with no errors
