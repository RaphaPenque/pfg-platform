# Worker Edit Wizard & Profile Updates — Changes Made

## Files Modified

### 1. shared/schema.ts
- Added 7 new columns to `workers` table:
  - `dateOfBirth` (text) — ISO date
  - `costCentre` (text) — FTE only
  - `roles` (text) — JSON array of role strings
  - `profilePhotoPath` (text) — path to uploaded photo
  - `passportPath` (text) — path to uploaded passport
  - `driversLicense` (text) — expiry date ISO string
  - `driversLicenseUploaded` (integer) — 0 or 1

### 2. client/src/lib/constants.ts
- Added `Driver's License` to `CERT_DEFS` array
- Added `COST_CENTRES` array (8 Powerforce entities)
- Added `ROLE_HIERARCHY` array (Superintendent → Apprentice)
- Added `getHighestRole(roles)` helper function
- Added `ENGLISH_LEVELS` array

### 3. server/routes.ts
- Added `multer` import and upload configuration
- Added `POST /api/workers/:id/upload` endpoint for file uploads
- Added `GET /api/uploads/:workerId/:filename` endpoint to serve uploaded files
- Added `equipmentType` to enriched assignment data in dashboard endpoint

### 4. client/src/hooks/use-dashboard-data.ts
- Added new fields to `DashboardWorker` interface: dateOfBirth, costCentre, roles, profilePhotoPath, passportPath, driversLicense, driversLicenseUploaded
- Added `role` and `equipmentType` fields to `DashboardAssignment` interface

### 5. client/src/pages/WorkforceTable.tsx (full rebuild)
- **Add Worker Modal**: Simple form with name, primary role, status, cost centre (FTE only), nationality
- **Edit Wizard Modal**: 4-step wizard (Profile → Qualifications → Work Experience → Review)
  - Step 1: Profile fields with file upload zones for passport and photo
  - Step 2: All cert rows with date inputs, file upload, and status dots (green/amber/red)
  - Step 3: Historical assignments auto-populated + manual experience entry
  - Step 4: Scores, measuring skills, and comments
- **Redesigned Summary Card**: 3-column layout (Profile with photo, Scores & OEM, Comments & Utilisation)
- **Edit button**: Pencil icon + "Edit Profile" in worker detail header
- **Add Worker button**: In the filter bar next to filters
- Read-only Qualifications & Work Experience tabs

### 6. Database Migrations
- Ran ALTER TABLE on pfg.db and pfg-seed.db to add new columns

### 7. Package Dependencies
- Installed `multer` and `@types/multer` for file upload handling

## Build Status
- TypeScript: 0 errors
- Build: Successful
