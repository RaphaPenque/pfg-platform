/**
 * Smoke test pinning the worker certificate upload invariants:
 *
 *   I1  POST /api/workers/:id/upload upserts a documents row whenever the
 *       uploaded type starts with "cert_". Without this, the file lands on
 *       disk but no documents row references it — the symptom RM Andre saw on
 *       Manuel Rabano (cert appeared to upload, then vanished on reload).
 *
 *   I2  PUT /api/workers/:workerId/documents only writes filePath /
 *       fileName / mimeType / fileSize when those keys are explicitly present
 *       in the request body. If they are absent, the existing values must be
 *       preserved, so saving date-only changes does not clobber a previously
 *       uploaded file. (The earlier code took `filePath || null`, which wiped
 *       the file pointer on every dates-only PUT.)
 *
 * Both checks are static-source assertions on server/routes.ts so a refactor
 * cannot silently regress these invariants. We avoid spinning up Express +
 * Postgres in the unit test — the production health-check (Section N) is the
 * data-side enforcement.
 *
 * Run: npx tsx tests/smoke/worker-certificates.test.ts
 */

import assert from "node:assert";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROUTES = readFileSync(
  path.resolve(__dirname, "../../server/routes.ts"),
  "utf8",
);

function section(label: string) {
  console.log(`\n${label}`);
}
function ok(label: string) {
  console.log(`  ✓ ${label}`);
}
function fail(label: string, err: unknown) {
  console.error(`  ✗ ${label}`);
  console.error(`    ${(err as any)?.message ?? err}`);
  process.exitCode = 1;
}
function check(label: string, fn: () => void) {
  try { fn(); ok(label); } catch (e) { fail(label, e); }
}

// ── I1: cert upload upserts a document row ───────────────────────────────────
section("Worker cert upload — file persists onto worker (mirrors the RM Andre / Manuel Rabano bug)");

check("POST /api/workers/:id/upload upserts a document for cert_* types", () => {
  // Locate the upload route block.
  const uploadIdx = ROUTES.indexOf('app.post("/api/workers/:id/upload"');
  assert.notStrictEqual(uploadIdx, -1, "upload route must exist");
  // Slice from the route declaration to the next route declaration —
  // a generous but bounded window so we don't accidentally match
  // unrelated upsertDocument calls elsewhere in routes.ts.
  const routeBody = ROUTES.slice(uploadIdx, uploadIdx + 4000);
  assert.match(
    routeBody,
    /fileType\.startsWith\(["']cert_["']\)/,
    "cert_* branch must be present",
  );
  assert.match(
    routeBody,
    /storage\.upsertDocument\(/,
    "cert branch must call storage.upsertDocument",
  );
  assert.match(
    routeBody,
    /filePath[\s,]/,
    "upsert payload must include filePath",
  );
  assert.match(
    routeBody,
    /fileName/,
    "upsert payload must include fileName",
  );
});

// ── I2: PUT documents preserves existing file fields when omitted ────────────
section("PUT /api/workers/:workerId/documents preserves existing file fields when body omits them");

check("PUT documents handler reads file fields with `'key' in body`, not `value || null`", () => {
  const putIdx = ROUTES.indexOf('app.put("/api/workers/:workerId/documents"');
  assert.notStrictEqual(putIdx, -1, "PUT documents route must exist");
  const routeBody = ROUTES.slice(putIdx, putIdx + 2000);

  // Must use `'filePath' in body` style key-presence check so date-only saves
  // do not wipe the existing filePath. The legacy code wrote
  //   filePath: filePath || null
  // which destroyed the previously-uploaded reference whenever the frontend
  // re-saved dates without re-attaching the file.
  assert.match(
    routeBody,
    /["']filePath["']\s+in\s+body/,
    "filePath must be guarded by an `in body` presence check",
  );
  assert.match(
    routeBody,
    /["']fileName["']\s+in\s+body/,
    "fileName must be guarded by an `in body` presence check",
  );

  // Belt-and-braces: forbid the regressed pattern.
  assert.doesNotMatch(
    routeBody,
    /filePath:\s*filePath\s*\|\|\s*null/,
    "must NOT unconditionally set filePath to null when key is absent",
  );
});

// ── I3: storage.upsertDocument keeps the schema contract ─────────────────────
section("storage.upsertDocument signature pin");

check("upsertDocument(workerId, type, name, data) is the only public shape", () => {
  const STORAGE = readFileSync(
    path.resolve(__dirname, "../../server/storage.ts"),
    "utf8",
  );
  assert.match(
    STORAGE,
    /upsertDocument\(\s*workerId:\s*number,\s*type:\s*string,\s*name:\s*string,\s*data:\s*Partial<InsertDocument>\s*\)/,
    "upsertDocument signature must remain (workerId, type, name, data)",
  );
});

// ── I4: GET document/worker endpoints reconcile DB rows with disk ────────────
// Some legacy doc rows have file_path = NULL (the regression PR #9 fixes), but
// the file may still exist on the persistent disk under
// /data/uploads/<workerId>/. The read paths must surface those files so
// passports/certificates remain downloadable from the worker profile and end
// up inside the customer portal Team SQEP export. The DB is never written to
// from a GET path.
section("GET worker/document routes reconcile docs with files on disk");

check("server/routes.ts defines reconcileDocsWithDisk and reconcileWorkerFilePaths", () => {
  assert.match(
    ROUTES,
    /function\s+reconcileDocsWithDisk\s*\(/,
    "reconcileDocsWithDisk helper must exist (read-only disk → docs reconciliation)",
  );
  assert.match(
    ROUTES,
    /function\s+reconcileWorkerFilePaths\s*<.*>?\(|function\s+reconcileWorkerFilePaths\s*\(/,
    "reconcileWorkerFilePaths helper must exist (passport/photo column backfill)",
  );
  // The reconciliation path must NEVER mutate the DB. Belt-and-braces guard:
  // walk from the function declaration to the next top-level `function `
  // declaration in the file and assert no storage write call appears.
  const start = ROUTES.indexOf("function reconcileDocsWithDisk");
  const next = ROUTES.indexOf("\nfunction ", start + 1);
  const end = next === -1 ? start + 2000 : next;
  const block = ROUTES.slice(start, end);
  assert.doesNotMatch(
    block,
    /storage\.(update|create|insert|upsertDocument|deleteDocument|deleteWorker|updateWorker|createWorker)/,
    "reconcileDocsWithDisk must not touch the database",
  );
});

check("/api/workers/:id/full reconciles documents and worker file paths", () => {
  const idx = ROUTES.indexOf('app.get("/api/workers/:id/full"');
  assert.notStrictEqual(idx, -1, "route must exist");
  const win = ROUTES.slice(idx, idx + 1500);
  assert.match(win, /reconcileDocsWithDisk\(\s*worker\.id\s*,/, "must reconcile docs");
  assert.match(win, /reconcileWorkerFilePaths\(\s*worker\s*\)/, "must reconcile worker file paths");
});

check("GET /api/workers/:workerId/documents reconciles with disk", () => {
  const idx = ROUTES.indexOf('app.get("/api/workers/:workerId/documents"');
  assert.notStrictEqual(idx, -1, "route must exist");
  const win = ROUTES.slice(idx, idx + 800);
  assert.match(win, /reconcileDocsWithDisk\(/, "must reconcile docs");
});

check("/api/portal/:code reconciles each assigned worker's documents with disk", () => {
  const idx = ROUTES.indexOf('app.get("/api/portal/:code"');
  assert.notStrictEqual(idx, -1, "portal route must exist");
  const win = ROUTES.slice(idx, idx + 6000);
  assert.match(
    win,
    /reconcileDocsWithDisk\(\s*wid\s*,/,
    "portal endpoint must reconcile each worker's docs (so SQEP export can include cert files even if file_path was wiped)",
  );
});

check("/api/dashboard reconciles worker documents and file paths", () => {
  const idx = ROUTES.indexOf('app.get("/api/dashboard"');
  assert.notStrictEqual(idx, -1, "dashboard route must exist");
  const win = ROUTES.slice(idx, idx + 5000);
  assert.match(win, /reconcileDocsWithDisk\(/, "dashboard must reconcile docs");
  assert.match(win, /reconcileWorkerFilePaths\(/, "dashboard must reconcile worker file paths");
});

// ── I5: Worker profile UI shows a passport download affordance ───────────────
section("Worker profile shows a passport download link when passportPath is present");

check("WorkforceTable.tsx renders passport-download-${id} anchor when passportPath set", () => {
  const TABLE = readFileSync(
    path.resolve(__dirname, "../../client/src/pages/WorkforceTable.tsx"),
    "utf8",
  );
  assert.match(
    TABLE,
    /data-testid=\{`passport-download-\$\{worker\.id\}`\}/,
    "passport download anchor with stable testid must exist",
  );
  assert.match(
    TABLE,
    /worker\.passportPath \|\| worker\.passportNumber|worker\.passportExpiry \|\| worker\.passportNumber \|\| worker\.passportPath/,
    "passport block must render when passportPath alone is present",
  );
});

// ── I6: Customer portal link opens in a new tab ──────────────────────────────
section("Customer portal direct-click opens in a new tab");

check("ProjectHubDetail.tsx renders a target=_blank anchor with the hash URL", () => {
  const PHD = readFileSync(
    path.resolve(__dirname, "../../client/src/pages/ProjectHubDetail.tsx"),
    "utf8",
  );
  // Must be a plain <a> with target=_blank and the hash URL — not <Link>.
  const portalBlockIdx = PHD.indexOf("project-customer-portal-link");
  assert.notStrictEqual(portalBlockIdx, -1, "portal anchor must exist");
  // Look at the anchor element preceding the testid.
  const window = PHD.slice(Math.max(0, portalBlockIdx - 500), portalBlockIdx + 200);
  assert.match(window, /target="_blank"/, "must use target=_blank");
  assert.match(window, /rel="noopener noreferrer"/, "must use rel=noopener noreferrer");
  assert.match(
    window,
    /href=\{`\/#\/portal\/\$\{project\.code\}\?token=\$\{project\.portalAccessToken\}`\}/,
    "must use the hash-routed portal URL with token",
  );
});

check("ProjectAllocation.tsx Share-with-Customer link opens in a new tab", () => {
  const PA = readFileSync(
    path.resolve(__dirname, "../../client/src/pages/ProjectAllocation.tsx"),
    "utf8",
  );
  const idx = PA.indexOf("share-customer-${card.project.code}");
  assert.notStrictEqual(idx, -1, "share-customer anchor must exist");
  const win = PA.slice(Math.max(0, idx - 500), idx + 200);
  assert.match(win, /target="_blank"/, "must use target=_blank");
  assert.match(
    win,
    /href=\{`\/#\/portal\/\$\{card\.project\.code\}\?token=\$\{card\.project\.portalAccessToken\}`\}/,
    "must use the hash-routed portal URL with token",
  );
});

// ── I7: SQEP customer pack walks documents.filePath and includes cert files ─
section("Team SQEP export pulls every doc with a filePath into the worker's Certificates folder");

check("downloadCustomerPack iterates worker.documents and fetches d.filePath", () => {
  const SQEP = readFileSync(
    path.resolve(__dirname, "../../client/src/lib/sqep-pdf.ts"),
    "utf8",
  );
  assert.match(SQEP, /export async function downloadCustomerPack\(/, "function must exist");
  const idx = SQEP.indexOf("downloadCustomerPack");
  const win = SQEP.slice(idx, idx + 3000);
  assert.match(win, /worker\.id/, "iterates workers");
  assert.match(win, /\.documents/, "reads worker.documents");
  assert.match(win, /Certificates/, "creates a Certificates folder per worker");
  assert.match(win, /d\.filePath/, "skips entries without filePath");
  assert.match(win, /fetch\(d\.filePath/, "fetches each cert file's URL");
});

if (process.exitCode) {
  console.error("\nFAIL");
  process.exit(process.exitCode);
}
console.log("\nOK");
