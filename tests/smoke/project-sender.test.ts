/**
 * Unit tests for buildSenderIdentityFromPm — pure function, no DB.
 *
 * Run: npx tsx tests/smoke/project-sender.test.ts
 */

import assert from "node:assert";
import { buildSenderIdentityFromPm } from "../../server/project-sender";

function check(label: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${label}`);
  } catch (e: any) {
    console.error(`  ✗ ${label}`);
    console.error(`    ${e.message}`);
    process.exitCode = 1;
  }
}

console.log("buildSenderIdentityFromPm:");

check("PM with @powerforce.global email → impersonate + replyTo + name", () => {
  const id = buildSenderIdentityFromPm("alice@powerforce.global", "Alice Smith");
  assert.strictEqual(id.from, "alice@powerforce.global");
  assert.strictEqual(id.fromName, "Alice Smith");
  assert.strictEqual(id.replyTo, "alice@powerforce.global");
  assert.strictEqual(id.source, "assigned_pm");
});

check("PM with non-domain email → no impersonation, replyTo + name still set", () => {
  const id = buildSenderIdentityFromPm("bob@external.com", "Bob Jones");
  assert.strictEqual(id.from, undefined);
  assert.strictEqual(id.fromName, "Bob Jones");
  assert.strictEqual(id.replyTo, "bob@external.com");
  assert.strictEqual(id.source, "assigned_pm");
  assert.ok(id.warnings.length > 0, "expected a warning for non-domain email");
});

check("PM email missing but name present → name only, fall back to central", () => {
  const id = buildSenderIdentityFromPm(null, "Carol Lee");
  assert.strictEqual(id.from, undefined);
  assert.strictEqual(id.fromName, "Carol Lee");
  assert.strictEqual(id.replyTo, undefined);
  assert.strictEqual(id.source, "missing");
});

check("PM email and name missing → central default, no overrides", () => {
  const id = buildSenderIdentityFromPm(null, null);
  assert.strictEqual(id.from, undefined);
  assert.strictEqual(id.fromName, undefined);
  assert.strictEqual(id.replyTo, undefined);
  assert.strictEqual(id.source, "central_default");
});

check("Email with mixed-case domain still treated as @powerforce.global", () => {
  const id = buildSenderIdentityFromPm("dave@PowerForce.Global", "Dave");
  assert.strictEqual(id.from, "dave@PowerForce.Global");
  assert.strictEqual(id.replyTo, "dave@PowerForce.Global");
  assert.strictEqual(id.source, "assigned_pm");
});

check("Whitespace in email/name is trimmed", () => {
  const id = buildSenderIdentityFromPm("  eve@powerforce.global  ", "  Eve  ");
  assert.strictEqual(id.from, "eve@powerforce.global");
  assert.strictEqual(id.fromName, "Eve");
});

console.log(process.exitCode ? "\nFAILED" : "\nAll project-sender tests passed.");
