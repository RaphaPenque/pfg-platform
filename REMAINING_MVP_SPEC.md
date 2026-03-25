# Remaining MVP Features — Specification

## 1. SQEP Customer Pack PDF Generation

### Overview
From the Customer Portal page (/portal/:projectCode), customers can download a SQEP pack for each worker assigned to the project. This is also accessible from the Project Allocation edit view.

### What the SQEP Customer Pack contains per worker:
1. **Cover Profile Page** (single page PDF):
   - Photograph (or placeholder with initials)
   - Full Name
   - Age
   - Date Joined
   - English Proficiency
   - OEM Experience (list of OEM badges)

2. **Work Experience Page** (table format):
   - Columns: Site Name, Start Date, Finish Date, Role, OEM, Equipment, Scope of Work
   - Only historical and current assignments (startDate <= today)

3. **Qualifications & Certificates Page** (table format):
   - All cert types with status dots (green/amber/red)
   - Completion Date, Validity Date, Status

4. **Uploaded Certificate Files** (the actual PDF/image files uploaded to each cert)

### Implementation:
- Use jsPDF library for PDF generation (install: npm install jspdf)
- Add a "Download SQEP" button per worker on the Customer Portal
- Add a "Download All SQEP" button that generates a ZIP of all workers' packs
- API endpoint: GET /api/workers/:id/sqep — generates and returns the PDF
- For uploaded cert files: include download links on the portal page

### Customer Portal Updates:
- Show project histogram (already exists)
- Below histogram: list of team members assigned to the project
- Each team member row has: Name, Role, OEM experience badges, "Download SQEP" button
- "Download All" button at the top for the complete pack

## 2. Export to Excel/CSV

### Overview
Add export buttons to the main views so data can be pulled out for reports.

### Workforce Table Export:
- Button: "Export CSV" in the filter bar area (near Add Worker)
- Exports currently filtered/visible workers
- Columns: Name, Role, Status, Nationality, English Level, Tech Level, Measuring Skills, OEM Experience, Utilisation %, Current Assignment
- File name: `pfg-workforce-YYYY-MM-DD.csv`

### Person Schedule Export:
- Button: "Export CSV" in the filter bar
- Exports: Name, Status, Utilisation %, then for each assignment: Project Code, Start Date, End Date, Role, Duration
- One row per worker-assignment combination
- File name: `pfg-schedule-YYYY-MM-DD.csv`

### Project Allocation Export:
- Button: "Export CSV" in the header area
- Exports: Project Code, Name, Customer, Location, Equipment, Start Date, End Date, Headcount, Status, Team Count
- File name: `pfg-projects-YYYY-MM-DD.csv`

### Implementation:
- Client-side CSV generation (no server needed)
- Use a simple helper function that takes array of objects and converts to CSV string
- Create a Blob and trigger download via URL.createObjectURL
- Add the export button to each page component

## 3. Demand Curve Chart

### Overview
Add a stacked area/bar chart showing workforce demand over time across all active projects.

### Location:
Below the Gantt Chart timeline on the GanttChart.tsx page, inside a new card.

### Data:
- X axis: weeks or months of the current year
- Y axis: number of workers needed
- For each week, count the number of active assignments that overlap that week
- Stack by OEM/customer colour (same colours as Gantt bars)
- Show a horizontal line for FTE baseline (54 FTE)
- Area above FTE line = temp workers needed

### Implementation:
- Use Recharts library (already available in the project dependencies — check package.json)
- If Recharts not available, use Chart.js via CDN or a simple SVG-based chart
- Calculate demand per week by iterating through all active assignments
- Group by customer for stacked colouring
- Add to GanttChart.tsx below the existing timeline

### Visual:
- Stacked area chart or bar chart
- FTE baseline as a dashed horizontal line at 54
- Peak demand annotated
- Hover tooltips showing breakdown per customer/project
- PFG branded colours
