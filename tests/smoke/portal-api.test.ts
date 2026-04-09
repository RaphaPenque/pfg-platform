/**
 * Smoke tests for the Portal API shape.
 * Verifies /api/portal/:code returns correct structure for known project codes.
 *
 * Run: npx tsx tests/smoke/portal-api.test.ts
 */

import assert from "node:assert";

const BASE_URL =
  process.env.PLATFORM_URL ?? "https://pfg-platform.onrender.com";

const PROJECT_CODES = ["GNT", "GRTY", "SALT"];

interface PortalResponse {
  project: { code: string };
  roleSlots: unknown[];
  assignments: unknown[];
  workers: Record<
    string,
    { assignments: unknown[] | undefined; documents: unknown[] | undefined }
  >;
}

async function testPortalApi(code: string): Promise<void> {
  const url = `${BASE_URL}/api/portal/${code}`;
  const res = await fetch(url);

  assert.strictEqual(
    res.status,
    200,
    `Expected 200 for ${code}, got ${res.status}`,
  );

  const body: PortalResponse = await res.json();

  assert.ok(body.project, `${code}: missing "project" in response`);
  assert.strictEqual(
    body.project.code,
    code,
    `${code}: project.code mismatch — got "${body.project.code}"`,
  );

  assert.ok(body.workers, `${code}: missing "workers" in response`);
  assert.ok(
    typeof body.workers === "object" && body.workers !== null,
    `${code}: "workers" should be an object`,
  );

  const workerEntries = Object.entries(body.workers);
  assert.ok(
    workerEntries.length > 0,
    `${code}: expected at least one worker`,
  );

  for (const [workerId, worker] of workerEntries) {
    assert.ok(
      Array.isArray(worker.assignments),
      `${code}: worker ${workerId} missing assignments[]`,
    );
    assert.ok(
      Array.isArray(worker.documents),
      `${code}: worker ${workerId} missing documents[]`,
    );
  }
}

async function main() {
  let passed = 0;
  let failed = 0;

  for (const code of PROJECT_CODES) {
    try {
      await testPortalApi(code);
      console.log(`  ✓ /api/portal/${code}`);
      passed++;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  ✗ /api/portal/${code} — ${msg}`);
      failed++;
    }
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main();
