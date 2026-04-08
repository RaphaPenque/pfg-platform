# V2 Migration: SQLite → PostgreSQL + Authentication + Audit Trail

## Overview
Migrate the PFG platform from SQLite (better-sqlite3 + Drizzle) to PostgreSQL (pg + Drizzle), add magic-link authentication with role-based access control, and implement an audit trail.

## PostgreSQL Connection
- Internal URL (use in production on Render): `postgresql://pfg_platform_db_user:zo7EyN89I4Dg1soyxv7X96QyeVarhqOP@dpg-d7b3hnkvjg8s73erao8g-a/pfg_platform_db`
- External URL (use for local testing): `postgresql://pfg_platform_db_user:zo7EyN89I4Dg1soyxv7X96QyeVarhqOP@dpg-d7b3hnkvjg8s73erao8g-a.frankfurt-postgres.render.com:5432/pfg_platform_db`
- Store as environment variable: `DATABASE_URL`

## New Tables (add to shared/schema.ts)

### users table
```
users:
  id: serial primary key
  email: text unique not null
  name: text not null
  role: text not null  -- 'admin' | 'resource_manager' | 'project_manager' | 'finance' | 'observer'
  createdAt: timestamp default now()
  lastLoginAt: timestamp
  isActive: boolean default true
```

### magic_links table (for passwordless auth)
```
magic_links:
  id: serial primary key
  email: text not null
  token: text unique not null  -- random UUID
  expiresAt: timestamp not null  -- 15 minutes from creation
  usedAt: timestamp  -- null if not yet used
  createdAt: timestamp default now()
```

### sessions table
```
sessions:
  id: serial primary key
  userId: integer references users(id)
  token: text unique not null  -- random UUID
  expiresAt: timestamp not null  -- 30 days from creation
  createdAt: timestamp default now()
  userAgent: text
  ipAddress: text
```

### audit_logs table
```
audit_logs:
  id: serial primary key
  userId: integer references users(id)
  action: text not null  -- e.g. 'worker.update', 'project.create', 'assignment.delete'
  entityType: text not null  -- 'worker' | 'project' | 'assignment' | 'role_slot'
  entityId: integer not null
  entityName: text  -- human readable name for display
  changes: jsonb  -- { field: { from, to } } for updates
  metadata: jsonb  -- any extra context
  createdAt: timestamp default now()
```

### project_lead_resource_managers table
```
project_leads:
  id: serial primary key
  projectId: integer references projects(id)
  userId: integer references users(id)
  assignedAt: timestamp default now()
```

## Schema Changes to Existing Tables

### projects table — add status field if not present
The status field already exists as text. No change needed.

### workers table — all fields same, just PostgreSQL types
- text → text (same)
- integer → integer (same)  
- All existing fields carry over identically

## Database Migration Strategy

1. Keep all existing SQLite table structures
2. Add the new PostgreSQL-specific tables above
3. Use `pg` driver with Drizzle ORM (drizzle-orm/node-postgres)
4. Create a migration script that reads from SQLite and inserts into PostgreSQL

## Changes to server/storage.ts

### Replace SQLite with PostgreSQL

```typescript
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

export const db = drizzle(pool);
```

### Change all query patterns
SQLite was synchronous. PostgreSQL is async. ALL storage methods must become async:
- `db.select()...get()` → `await db.select()...` (returns array, use [0] for single)
- `db.insert()...returning().get()` → `await db.insert()...returning()` (returns array)
- `db.delete()...run()` → `await db.delete()`
- `db.update()...run()` → `await db.update()`

### IStorage interface — all methods become async (return Promises)

## Authentication System

### Magic Link Flow
1. User visits the app — if no valid session cookie, redirect to `/login`
2. On `/login` page: enter email → POST /api/auth/request-link
3. Server creates a magic_link record with a UUID token, expiry 15min
4. Server sends email via Outlook with the link: `https://pfg-platform.onrender.com/auth/verify?token=<UUID>`
5. User clicks link → GET /api/auth/verify?token=<UUID>
6. Server validates token (not expired, not used), marks as used, creates session
7. Sets httpOnly cookie `pfg_session=<session_token>` (30 day expiry)
8. Redirects to app

### Session Middleware
Add Express middleware that runs on every request:
```typescript
async function requireAuth(req, res, next) {
  const sessionToken = req.cookies?.pfg_session;
  if (!sessionToken) return res.status(401).json({ error: 'Not authenticated' });
  
  const session = await db.select().from(sessions)
    .where(and(eq(sessions.token, sessionToken), gt(sessions.expiresAt, new Date())))
    .limit(1);
  
  if (!session[0]) return res.status(401).json({ error: 'Session expired' });
  
  const user = await db.select().from(users).where(eq(users.id, session[0].userId)).limit(1);
  if (!user[0]) return res.status(401).json({ error: 'User not found' });
  
  req.user = user[0];
  next();
}
```

Apply `requireAuth` to ALL /api routes except:
- GET /api/auth/* (login flow)
- GET /api/portal/:code (customer portal — public)

### API Endpoints for Auth
- POST /api/auth/request-link — body: { email } — creates magic link, sends email
- GET /api/auth/verify — query: { token } — validates token, creates session, sets cookie
- POST /api/auth/logout — clears session cookie, deletes session from DB
- GET /api/auth/me — returns current user { id, email, name, role }

### Install cookie-parser
`npm install cookie-parser @types/cookie-parser`
Add to server: `app.use(cookieParser())`

## Role-Based Access Control

### Role constants
```typescript
const ROLES = {
  ADMIN: 'admin',
  RESOURCE_MANAGER: 'resource_manager', 
  PROJECT_MANAGER: 'project_manager',
  FINANCE: 'finance',
  OBSERVER: 'observer'
} as const;
```

### Permission middleware
```typescript
function requireRole(...roles: string[]) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  };
}
```

### Apply permissions to routes:
- DELETE /api/workers/:id → requireRole('admin', 'resource_manager')
- DELETE /api/projects/:id → requireRole('admin', 'resource_manager')
- POST /api/projects/:id/status with status='cancelled' → requireRole('admin', 'resource_manager', 'project_manager')
- POST /api/workers → requireRole('admin', 'resource_manager')
- PATCH /api/workers/:id → requireRole('admin', 'resource_manager')
- All read routes (GET) → requireAuth only (all roles can read)
- POST /api/assignments → requireRole('admin', 'resource_manager', 'project_manager')
- PATCH /api/assignments/:id → requireRole('admin', 'resource_manager', 'project_manager')

## Audit Trail

### Log these events automatically in routes:
- Worker created/updated/deleted
- Project created/updated/status changed/deleted
- Assignment created/updated/deleted
- Role slot created/updated/deleted

### Helper function
```typescript
async function logAudit(
  userId: number,
  action: string,
  entityType: string,
  entityId: number,
  entityName: string,
  changes?: object
) {
  await db.insert(auditLogs).values({
    userId, action, entityType, entityId, entityName,
    changes: changes ? JSON.stringify(changes) : null,
    createdAt: new Date()
  });
}
```

### New API endpoint:
- GET /api/audit-logs?projectId=X&limit=50 → returns audit trail, requireRole admin/resource_manager/observer

## Frontend Changes

### Login Page (client/src/pages/Login.tsx)
Simple centered form:
- PFG logo and "Workforce Intelligence Platform" title
- Email input
- "Send Magic Link" button
- After submit: "Check your email" confirmation message
- PFG branded (navy background, yellow button)
- No password field

### Auth Context (client/src/context/AuthContext.tsx)
```typescript
interface AuthUser {
  id: number;
  email: string;
  name: string;
  role: string;
}

// Provides: user, isLoading, logout()
// On app load: GET /api/auth/me to check session
// If 401: redirect to /login
```

### App.tsx changes
- Add Router with /login route (no auth required)
- All other routes: check auth context, redirect to /login if not authenticated
- Show user's name and role in the header
- Add "Sign out" button in header

### Role-based UI hiding
- "Delete Profile" button: only show for admin and resource_manager
- "Add Worker" button: only show for admin and resource_manager
- "Discard" project button: only show for admin and resource_manager

## Data Migration Script (server/migrate-to-postgres.ts)

Create a script that:
1. Reads all data from pfg.db (SQLite)
2. Inserts into PostgreSQL in order: oemTypes → workers → projects → assignments → role_slots
3. Preserves all IDs so foreign keys remain valid
4. Can be run with: `npx ts-node server/migrate-to-postgres.ts`

## FTE % Bubble on Project Cards

On each project card in ProjectAllocation.tsx, add a small badge showing FTE allocation:
- Formula: FTE workers assigned to this project ÷ total workers assigned × 100
- ≥60%: green badge
- 50-59%: amber badge
- <50%: red badge
- Style: small pill bottom-right of the card header, e.g. "72% FTE"

## Lead Resource Manager on Projects

Add a "Lead Resource Manager" field to the project edit modal Details tab:
- Dropdown showing only users with role = 'resource_manager'
- Stored in project_leads table
- Shown on the project card as a small label

## Extension Notifications

When a Project Manager (or any user) changes an assignment end date or role slot end date:
- POST /api/notifications/extension — body: { projectId, changeDescription, changedBy }
- Server sends email to all users with role = 'resource_manager'
- Email subject: "Schedule change on [Project Name]"
- Email body: "[User Name] has made the following change: [description]. Please review and confirm."

## Environment Variables

Add to Render web service:
- DATABASE_URL = internal PostgreSQL connection string
- SESSION_SECRET = random 32-char string for cookie signing
- NODE_ENV = production

## Build Notes
- drizzle.config.ts needs updating for PostgreSQL dialect
- package.json: remove better-sqlite3, add pg
- tsconfig may need adjustments
- After all changes: npm run build with zero errors
- DO NOT start the dev server
