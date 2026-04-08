# Role Slot Date Change — Conflict Resolution Flow

## Overview
When a resource manager saves a role slot date change (via the per-row floppy disk button in the Role Planning tab of EditProjectModal), the system must:
1. Auto-update all workers assigned to that slot whose dates have no conflicts
2. For workers with conflicts, show a resolution modal before saving

## Trigger
The per-row Save button (floppy disk icon) in the Role Planning tab of EditProjectModal (`client/src/pages/ProjectAllocation.tsx`).

Currently this button calls `PATCH /api/role-slots/:id` and then checks for conflicts as a warning. We need to extend this to:
- First save the role slot
- Check all workers assigned to the slot for date conflicts
- Auto-update conflict-free workers
- Show the conflict resolution modal for conflicting workers

## Data needed
The Edit modal already has:
- `card.members` — all workers on the project with their assignments
- `allWorkers` — full worker list with all assignments
- `roleSlotEdits` — current role slot drafts with new dates

## Step 1: Check assigned workers after saving slot

After PATCH /api/role-slots/:id succeeds:

1. Find all workers assigned to this specific slot (match by `assignment.roleSlotId === slotId`)
2. For each assigned worker, get the new slot dates
3. Check if the worker has any OTHER assignment (different project) that overlaps the new slot dates
4. Split into two groups:
   - `cleanWorkers` — no conflicts, can be auto-updated
   - `conflictWorkers` — have overlapping assignments on other projects

## Step 2: Auto-update clean workers
For each worker in `cleanWorkers`:
- PATCH /api/assignments/:id with { startDate: newSlotStart, endDate: newSlotEnd }
- No UI needed, happens silently

## Step 3: Conflict Resolution Modal
If `conflictWorkers.length > 0`, show a modal BEFORE completing the save.

### Modal design

Title: "Scheduling Conflicts Detected"
Subtitle: "The following workers have overlapping assignments. Choose how to resolve each one."

For each conflicting worker, show a card:

```
[Worker Name] (FTE/Temp badge)

GNT slot: [new start] → [new end]    ←→    [other project code]: [other start] → [other end]
                      [OVERLAP VISUAL: simple timeline showing the conflict]

[ Shorten GNT ]   [ Delay [other project] ]   [ Flag for Review ]
```

**Shorten** button:
- Sets the worker's GNT assignment end date to (other project start date - 1 day)
- Button label: "Shorten to [date]"
- Calls PATCH /api/assignments/:assignmentId with { endDate: conflictStart - 1 day }

**Delay [other project]** button:
- Sets the worker's assignment on the OTHER project to start on (new slot end date + 1 day)
- Button label: "Delay [PROJECT CODE] to [date]"
- Calls PATCH /api/assignments/:otherAssignmentId with { startDate: newSlotEnd + 1 day }

**Flag** button:
- Keeps assignment dates unchanged
- Calls PATCH /api/assignments/:assignmentId with { status: "flagged" }
- Worker shows a red warning badge on Person Schedule and their profile
- Button label: "Flag for Review"

### After all workers resolved
- Close modal
- Show a toast: "Role slot updated. X workers updated automatically, Y resolved manually, Z flagged."
- Invalidate queryKey ["/api/dashboard"] to refresh all views

## New status value
Add "flagged" as a valid assignment status (in addition to "active", "removed").
The dashboard should treat "flagged" as active for scheduling purposes but show a red indicator.

## Conflict detection logic
A conflict exists between:
- Worker's assignment on THIS project (slot): newStart to newEnd
- Worker's assignment on ANOTHER project: otherStart to otherEnd
When: newStart <= otherEnd AND otherStart <= newEnd (date overlap)

## Files to modify
- `client/src/pages/ProjectAllocation.tsx` — extend the slot save handler + add conflict modal component
- `server/routes.ts` — ensure PATCH /api/assignments/:id accepts "flagged" status
- `shared/schema.ts` — no changes needed (status is text field)

## State needed in EditProjectModal
```typescript
const [conflictModalData, setConflictModalData] = useState<{
  slotId: number;
  newStart: string;
  newEnd: string;
  conflicts: Array<{
    worker: DashboardWorker;
    thisAssignment: DashboardAssignment;      // assignment on this slot
    otherAssignment: DashboardAssignment;     // conflicting assignment on another project
    resolution: 'shorten' | 'delay' | 'flag' | null;
  }>;
} | null>(null);
```

## Visual style
- PFG branding: navy header, yellow accent buttons
- Conflict card: white background, amber left border
- Timeline visual: simple horizontal bar showing overlap in red
- Shorten button: navy/yellow (primary action)
- Delay button: outline (secondary action)
- Flag button: muted/grey (last resort)
- All three buttons must be clicked before proceeding (prevent dismiss without resolution)
