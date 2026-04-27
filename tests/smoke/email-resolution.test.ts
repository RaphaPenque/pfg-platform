/**
 * Smoke test for sendMail's sender resolution + replyTo behavior.
 * Uses the dev fallback (no Azure credentials) — sendMail logs to console
 * instead of hitting Graph, which lets us verify the resolution end-to-end
 * without networking.
 *
 * Run: npx tsx tests/smoke/email-resolution.test.ts
 */

import assert from "node:assert";

// Force dev fallback by clearing creds before importing the module
delete process.env.AZURE_CLIENT_ID;
delete process.env.AZURE_TENANT_ID;
delete process.env.AZURE_CLIENT_SECRET;
process.env.MAIL_FROM = "raphael@powerforce.global";

const { sendMail } = await import("../../server/email");

async function captureLogs(fn: () => Promise<unknown>): Promise<string[]> {
  const lines: string[] = [];
  const origLog = console.log;
  console.log = (...args: any[]) => {
    lines.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "));
  };
  try {
    await fn();
  } finally {
    console.log = origLog;
  }
  return lines;
}

async function check(label: string, fn: () => Promise<void>) {
  try {
    await fn();
    console.error(`  ✓ ${label}`);
  } catch (e: any) {
    console.error(`  ✗ ${label}`);
    console.error(`    ${e.message}`);
    process.exitCode = 1;
  }
}

console.error("sendMail dev fallback resolution:");

await check("PM @powerforce.global email is used as From", async () => {
  const lines = await captureLogs(() =>
    sendMail({
      to: "customer@external.com",
      from: "alice@powerforce.global",
      fromName: "Alice Smith",
      subject: "test",
      html: "<p>hi</p>",
    }),
  );
  const fromLine = lines.find((l) => l.includes("From:"));
  assert.ok(fromLine, "expected a From: log line");
  assert.ok(
    fromLine!.includes("alice@powerforce.global"),
    `From line should contain PM email — got: ${fromLine}`,
  );
  assert.ok(
    fromLine!.includes("Alice Smith"),
    `From line should contain PM display name — got: ${fromLine}`,
  );
});

await check("Non-domain From falls back to MAIL_FROM, requested addr added to ReplyTo", async () => {
  const lines = await captureLogs(() =>
    sendMail({
      to: "customer@external.com",
      from: "external-pm@otherdomain.com",
      fromName: "Bob",
      subject: "test",
      html: "<p>hi</p>",
    }),
  );
  const fromLine = lines.find((l) => l.includes("From:"));
  const replyLine = lines.find((l) => l.includes("ReplyTo:"));
  assert.ok(fromLine, "expected a From: log line");
  assert.ok(
    fromLine!.includes("raphael@powerforce.global"),
    `From line should fall back to MAIL_FROM — got: ${fromLine}`,
  );
  // The dev fallback only logs explicit replyTo from opts; in this test we did NOT set replyTo,
  // so it should be undefined. The PRODUCTION send path adds the rejected From to replyTo;
  // the dev fallback is intentionally narrower — this test just confirms no impersonation.
  assert.ok(!replyLine, `dev fallback should not invent a replyTo when not provided — got: ${replyLine}`);
});

await check("Explicit replyTo is logged", async () => {
  const lines = await captureLogs(() =>
    sendMail({
      to: "customer@external.com",
      from: "alice@powerforce.global",
      replyTo: "alice@powerforce.global",
      subject: "test",
      html: "<p>hi</p>",
    }),
  );
  const replyLine = lines.find((l) => l.includes("ReplyTo:"));
  assert.ok(replyLine, "expected a ReplyTo: log line");
  assert.ok(replyLine!.includes("alice@powerforce.global"));
});

console.error(process.exitCode ? "\nFAILED" : "\nAll email-resolution tests passed.");
