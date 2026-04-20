import express, { type Request, Response, NextFunction } from "express";
import cookieParser from "cookie-parser";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";
import { warmupDb } from "./storage";
import { checkSurveyReminders } from "./survey-scheduler";
import { checkAndSendWeeklyReports, autoPublishDailyReports } from "./report-scheduler";
import { checkTimesheetReminders } from "./timesheet-routes";
import { pollInboxes } from "./email-poller";

const app = express();
const httpServer = createServer(app);

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

app.use(cookieParser());

app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false }));

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  // Warm up DB connection pool immediately so first user request isn't slow
  await warmupDb();

  // Always run schema updates (creates new tables like payroll_rules if missing)
  try {
    const { runSchemaUpdates, runMigrationIfNeeded } = await import("./migrate-to-postgres");
    await runSchemaUpdates();
    await runMigrationIfNeeded();
  } catch (e: any) {
    console.error("Migration check failed:", e.message);
  }

  await registerRoutes(httpServer, app);

  app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    console.error("Internal Server Error:", err);

    if (res.headersSent) {
      return next(err);
    }

    return res.status(status).json({ message });
  });

  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  // On startup: auto-complete any projects whose end date has passed but are still 'active'
  setTimeout(async () => {
    try {
      const { autoCompleteOverdueProjects } = await import("./survey-scheduler");
      await autoCompleteOverdueProjects();
    } catch (e: any) {
      console.error('[startup] autoCompleteOverdueProjects error:', e.message);
    }
  }, 5000);

  // ── ALL AUTO-SENDS DISABLED — manual only ──────────────────────────────────
  // Weekly reports, timesheets, and survey reminders must be triggered manually
  // from the platform. Re-enable individually when ready.
  //
  // setInterval(() => checkSurveyReminders(), 6 * 60 * 60 * 1000);
  // setInterval(() => autoPublishDailyReports(), 60 * 60 * 1000);     // Sundays 18:00 BST
  // setInterval(() => checkAndSendWeeklyReports(), 60 * 60 * 1000);   // Mondays 08:00 BST
  // setInterval(() => checkTimesheetReminders(), 60 * 60 * 1000);     // hourly
  // ────────────────────────────────────────────────────────────────────────────

  // Poll email inboxes every 15 minutes (kept active — receive-only, no sends)
  setInterval(() => {
    pollInboxes().catch(err => console.error('[email-poller] Error:', err));
  }, 15 * 60 * 1000);

  // Poll once on startup after 60s (let DB warm up first)
  setTimeout(() => {
    pollInboxes().catch(err => console.error('[email-poller] Startup poll error:', err));
  }, 60 * 1000);

  const port = parseInt(process.env.PORT || "5000", 10);
  httpServer.listen(
    {
      port,
      host: "0.0.0.0",
      reusePort: true,
    },
    () => {
      log(`serving on port ${port}`);
    },
  );
})();

// Sun Apr 19 18:45:49 UTC 2026
// db-fix 1776624598
