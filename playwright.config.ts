import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/smoke",
  testMatch: "**/*.spec.ts",
  timeout: 60_000,
  use: {
    baseURL:
      process.env.PLATFORM_URL ?? "https://pfg-platform.onrender.com",
  },
  projects: [
    {
      name: "chromium",
      use: { browserName: "chromium" },
    },
  ],
});
