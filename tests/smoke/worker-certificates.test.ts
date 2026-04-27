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

if (process.exitCode) {
  console.error("\nFAIL");
  process.exit(process.exitCode);
}
console.log("\nOK");
