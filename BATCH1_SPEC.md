# Batch 1 Improvements Spec

## 1. Delete Worker Profile

### Where
In WorkforceTable.tsx — inside the worker detail card (same area as the "Edit Profile" button).

### Button
Add a "Delete Profile" button (red/destructive style, trash icon) next to "Edit Profile" in the worker card header.

### Guard logic
Before deleting, call GET /api/workers/:id/assignments to check for active assignments (endDate >= today).
- If active assignments exist: show an error message "Cannot delete — [Name] is currently assigned to [project names]. Remove them from all projects first." Do NOT proceed with deletion.
- If no active assignments: show a confirmation dialog "Are you sure you want to delete [Name]'s profile? This cannot be undone." On confirm, call DELETE /api/workers/:id.

### API
Add DELETE /api/workers/:id endpoint in routes.ts:
- Check for active assignments (end_date >= date('now'))
- If found, return 409 with { message: "Worker has active assignments", projects: [...] }
- If clear, delete the worker (cascade: also delete their assignments and any documents)
- Add deleteWorker(id) to IStorage interface and SqliteStorage

### After deletion
Invalidate queryKey ["/api/dashboard"]. Close the worker card. Show a toast "Profile deleted".

---

## 2. New Profile Fields (Edit Wizard Step 1)

### Schema already updated
coverallSize, bootSize, localAirport added to shared/schema.ts and both databases.

### Update use-dashboard-data.ts
Add to DashboardWorker interface:
  coverallSize: string | null;
  bootSize: string | null;
  localAirport: string | null;

### Update WorkforceTable.tsx Edit Wizard Step 1 (Profile)
Add a new section "Field Kit & Logistics" after the Contact Information section with:
- Coverall Size: dropdown — XS, S, M, L, XL, XXL, XXXL
- Boot Size (EU): number input (placeholder "42") — free text, EU sizing
- Local Airport: text input (placeholder "e.g. LHR, MAD, LIS, OPO")

### Update handleSave in the wizard
Include coverallSize, bootSize, localAirport in the PATCH /api/workers/:id payload.

### Update Summary card
Add these fields to the Profile section of the Summary card if they have values:
- Coverall: [size]
- Boots: EU [size]  
- Airport: [code]

---

## 3. Driver's Licence "D" Watermark

A small "D" badge should appear next to a worker's name wherever their name is displayed, IF driversLicenseUploaded === 1.

### Style
Small filled circle or pill: background #1A1D23 (navy), text white, font-bold, text-[9px], content "D", inline next to name. Like: "Aitor Palmeiro Arosa  [D]"

### Where to add it
1. **Workforce Table** — in the NAME column next to the worker's name text
2. **Person Schedule** — in the PERSON column next to the name
3. **Project Allocation** — on project cards next to each assigned worker's name
4. **Project edit modal Team tab** — next to member names
5. **Project wizard Step 3 (Assign Staff)** — next to each worker's name in the list

Create a reusable inline component or simple JSX:
```tsx
{worker.driversLicenseUploaded ? (
  <span className="inline-flex items-center justify-center w-4 h-4 rounded-full text-[8px] font-bold ml-1 shrink-0" 
    style={{ background: "#1A1D23", color: "#F5BD00" }} title="Has Driver's Licence">D</span>
) : null}
```

---

## 4. Worker Search/Filter in Project Wizard Step 3 (Assign Staff)

### Current state
Step 3 shows all workers in a flat scrollable list grouped by role slot.

### What to add
Above the worker list for EACH role slot, add a search input:
- Placeholder: "Search by name..."
- Filters the worker list for that role slot in real-time as you type
- Also add quick filter buttons: "FTE only" | "All" (toggle)
- Show match count: "12 of 45 workers"

### Also add: click to preview worker profile
Each worker row in the assignment list should have a small expand icon (ChevronDown or Info icon) on the right.
Clicking it expands an inline panel below that row showing:
- Status badge (FTE/Temp)
- OEM experience badges
- English level
- Current utilisation %
- Current assignment (if any)
This is read-only — just a quick preview so the resource manager can make informed decisions without leaving the wizard.

### State management
Add state per role slot: `searchTerms: Record<string, string>` and `expandedWorkers: Set<number>`

---

## Technical notes
- Use apiRequest from @/lib/queryClient for ALL HTTP requests
- Invalidate queryKey ["/api/dashboard"] after mutations
- data-testid on all new interactive elements
- Don't use localStorage/sessionStorage
- Keep PFG branding: navy #1A1D23, yellow #F5BD00, steel #63758C
- After all changes, run `npm run build` to verify zero errors. Do NOT start the dev server.
