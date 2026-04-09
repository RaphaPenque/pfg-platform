/**
 * Playwright smoke tests for SQEP PDF and Customer Pack ZIP downloads.
 *
 * Run: npx playwright test tests/smoke/downloads.spec.ts
 */

import { test, expect } from "@playwright/test";
import fs from "node:fs";

const BASE_URL =
  process.env.PLATFORM_URL ?? "https://pfg-platform.onrender.com";

const PORTAL_PATH = "/#/portal/GNT";

test.describe("Portal downloads", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`${BASE_URL}${PORTAL_PATH}`, {
      waitUntil: "networkidle",
    });
    // Wait for the team table to be visible (confirms data loaded)
    await page.waitForSelector("table", { timeout: 30_000 });
  });

  test("SQEP Pack downloads a valid PDF", async ({ page }) => {
    const downloadPromise = page.waitForEvent("download", { timeout: 30_000 });

    // Click the first "SQEP Pack" button
    const sqepButton = page.getByRole("button", { name: /sqep/i }).first();
    await expect(sqepButton).toBeVisible({ timeout: 10_000 });
    await sqepButton.click();

    const download = await downloadPromise;
    const suggestedName = download.suggestedFilename();
    expect(suggestedName.toLowerCase()).toContain(".pdf");

    // Verify the file starts with %PDF magic bytes
    const filePath = await download.path();
    expect(filePath).toBeTruthy();
    const head = fs.readFileSync(filePath!).subarray(0, 5).toString("ascii");
    expect(head).toBe("%PDF-");
  });

  test("Customer Pack downloads a valid ZIP", async ({ page }) => {
    const downloadPromise = page.waitForEvent("download", { timeout: 30_000 });

    const packButton = page
      .getByRole("button", { name: /customer pack/i })
      .first();
    await expect(packButton).toBeVisible({ timeout: 10_000 });
    await packButton.click();

    const download = await downloadPromise;
    const suggestedName = download.suggestedFilename();
    expect(suggestedName.toLowerCase()).toContain(".zip");

    // Verify the file starts with PK magic bytes (ZIP signature)
    const filePath = await download.path();
    expect(filePath).toBeTruthy();
    const head = fs.readFileSync(filePath!).subarray(0, 2).toString("ascii");
    expect(head).toBe("PK");
  });
});
