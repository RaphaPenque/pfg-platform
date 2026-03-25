# Worker Edit Wizard & Profile Updates — Full Specification

## Overview
Add an "Edit" button to worker cards that opens a 4-step wizard. The existing Summary tab becomes the read-only day-to-day view. Also add a simple "Add Worker" form.

## Database Schema Changes (shared/schema.ts)

Add these fields to the `workers` table:
- `dateOfBirth: text("date_of_birth")` — ISO date
- `costCentre: text("cost_centre")` — only for FTE workers
- `roles: text("roles")` — JSON array of role strings (replacing single `role` field, keep `role` for backward compat as primary/highest role)
- `profilePhotoPath: text("profile_photo_path")` — file path for uploaded photo
- `passportPath: text("passport_path")` — file path for passport scan
- `driversLicense: text("drivers_license")` — expiry date ISO string or null
- `driversLicenseUploaded: integer("drivers_license_uploaded")` — 0 or 1

Keep existing fields: name, role, status, nationality, age, joined, ctc, englishLevel, techLevel, measuringSkills, countryCode, comments, experienceScore, technicalScore, attitudeScore, oemFocus, oemExperience.

Note: `age` should be auto-calculated from dateOfBirth if available.

## Cost Centres (FTE only, hidden for Temps)
- Powerforce Maintenance UK Limited
- Powerforce Global S.L
- Powerforce Maintenance B.V
- Powerforce Arabia for Operations and Maintenance Company
- Powerforce MENA Industrial Maintenance Services
- Powerforce Maintenance d.o.o.
- POWERFORCE MANUTENÇÃO INDUSTRIAL, UNIPESSOAL LDA
- Powerforce Maintenance Services Morocco

## Certificate Definitions (update constants.ts)
Add to CERT_DEFS:
- `{ name: "Driver's License" }` — at the end of the list

Status dots logic:
- GREEN dot: certificate file uploaded AND (no expiry OR expiry > 4 months from today)
- AMBER dot: certificate uploaded AND expiry within 4 months
- RED dot: no certificate uploaded
- EXCEPTION: Trade Diploma is always GREEN if uploaded. If no Trade Diploma, show "Work Experience" text instead. Trade Diploma dot should be green always (never red).

## Role Hierarchy (highest first)
Superintendent > Foreman > Lead Technician > Technician 2 > Technician 1 > Rigger > Crane Driver > HSE Officer > Welder > I&C Technician > Electrician > Apprentice

When a worker has multiple roles, the highest role shows on the table and Summary page.

## 4-Step Edit Wizard

### Step 1: Profile
Fields:
- Full Name (text, mandatory)
- Job Title (multi-select from PROJECT_ROLES — can pick multiple)
- Date of Birth (date picker)
- Status (FTE / Temp dropdown)
- Cost Centre (dropdown of 8 entities — ONLY shown if Status=FTE)
- English Proficiency (dropdown: A1, A2, B1, B2, C1, C2, TBC)
- Date Joined (date picker)
- Passport Copy (drag-and-drop file upload area)
- Profile Photo (drag-and-drop area — if no photo, show placeholder)

### Step 2: Qualifications & Certificates
Show all CERT_DEFS (including Driver's License) as rows.
Each row has:
- Status dot (green/amber/red per logic above)
- Certificate name
- Completion Date (date input, editable)
- Validity/Expiry Date (date input, editable — N/A for Trade Diploma)
- Upload area: drag-and-drop zone or click-to-upload for the certificate file
- Status text: "Uploaded" (green) or "Not uploaded" (muted)

When a file is uploaded, the dot turns green (or amber if expiring).

### Step 3: Work Experience
Show a table of work experience entries:
- Site Name (project name)
- Start Date
- End Date
- Role
- OEM
- Equipment (GT/ST/STV/COMP/GEN/Auxiliaries)
- Scope of Work (Major/Minor/Combustor/Turbine Inspection)

Auto-populated from assignments where:
- startDate <= today (historical and current only, NOT future assignments)
- Pull project details (name, customer/OEM, equipment type) from project data

At the bottom: "Add Previous Experience" button that opens an inline form to manually add a work experience entry (for experience before Powerforce).

### Step 4: Review
Fields:
- Experience Score (number input — measured in years)
- Technical Score (number input — score out of 5, allow decimals like 3.5)
- Attitude Score (number input — score out of 5, allow decimals)
- Measuring Skills (Yes/No dropdown)
- Comments (textarea — free text summary of the person)

### Footer: Back / Next / Save buttons

## Redesigned Summary Page (read-only, day-to-day view)

Layout (the card that appears when you click a worker row):

LEFT COLUMN - Profile:
- Profile photo (or placeholder)
- Full Name (large)
- Status badge (FTE/Temp)
- Date Joined
- Age (calculated from DOB)
- Cost Centre (if FTE)
- English Proficiency
- Driver's License indicator (green badge if has one, omit if not)

MIDDLE COLUMN - Scores & OEM:
- Scores section:
  - Experience: X years
  - Technical: X/5
  - Attitude: X/5
- OEM Experience section:
  - Coloured badges pulled from work experience data
- Measuring Skills: Yes/No

RIGHT COLUMN:
- Comments box (the text summary)
- Utilisation bar (auto-calculated from current year assignments)

Below the summary: tabs for "Qualifications & Certificates" and "Work Experience" (read-only views)
The "Edit" button in the top-right opens the 4-step wizard.

## Add New Worker (Simple Form)
A modal with fields:
- Full Name (mandatory)
- Primary Role (dropdown from PROJECT_ROLES, mandatory)
- Status: FTE or Temp (mandatory)
- Cost Centre (dropdown, only shown if FTE)
- Nationality (text)

On save, creates the worker. They can then be fully edited through the wizard.

## File Upload API
Add endpoints:
- POST /api/workers/:id/upload — multipart form upload for passport, photo, certificates
  - Field: `type` (passport, photo, cert_trade_diploma, cert_working_at_height, etc.)
  - Store files in /data/uploads/:workerId/ directory (persistent disk on Render)
  - Return file path
- GET /api/workers/:id/files/:type — serve the uploaded file

## Branding
- Use the existing PFG brand: Jet Black #1A1D23, Metallic Yellow #F5BD00, Steel Blue #63758C
- Wizard step indicator: same style as the project wizard (numbered steps with yellow active state)
- All inputs: same inputCls style used in ProjectAllocation.tsx
