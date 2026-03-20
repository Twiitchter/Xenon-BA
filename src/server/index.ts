import express, { Application } from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import dotenv from "dotenv";
import passport from "passport";
import authRoutes from "./routes/auth";
import assetRoutes from "./routes/assets";
import reportRoutes from "./routes/reports";
import maintenanceRoutes from "./routes/maintenance";
import adminRoutes from "./routes/admin";
import { initializePassport } from "./config/passport";
import { initializeDatabase } from "./database";
import settingsService from "./services/settingsService";
import asseticLocationHierarchyService from "./services/asseticLocationHierarchyService";
import asseticAssetSyncService from "./services/asseticAssetSyncService";

dotenv.config();

const app: Application = express();
const PORT = process.env.PORT || 3000;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function initializeDatabaseWithRetry() {
  const retryIntervalMs = parseInt(
    process.env.STARTUP_RETRY_INTERVAL_MS || "5000",
    10,
  );
  const defaultMaxAttempts = process.env.NODE_ENV === "production" ? 5 : 0;
  const maxAttempts = parseInt(
    process.env.STARTUP_MAX_ATTEMPTS || String(defaultMaxAttempts),
    10,
  );

  let attempt = 0;
  while (true) {
    attempt += 1;
    try {
      await initializeDatabase();
      return;
    } catch (error) {
      const attemptsText =
        maxAttempts > 0 ? `${attempt}/${maxAttempts}` : `${attempt}`;
      console.error(
        `Database initialization failed (attempt ${attemptsText}).`,
        error,
      );

      if (maxAttempts > 0 && attempt >= maxAttempts) {
        throw error;
      }

      console.log(
        `Retrying database initialization in ${Math.floor(retryIntervalMs / 1000)}s...`,
      );
      await sleep(retryIntervalMs);
    }
  }
}

// Middleware
app.use(helmet());
app.use(cors());
app.use(morgan("dev"));
// 50 MB limit to accommodate base64-encoded image attachments (a 10 MB photo
// becomes ~13.5 MB as base64 JSON). Keep server-side validation of file size
// inside the attachment route to reject excessively large payloads early.
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

// Initialize Passport
initializePassport(passport);
app.use(passport.initialize());

// Routes
app.use("/api/auth", authRoutes);
app.use("/api/assets", assetRoutes);
app.use("/api/reports", reportRoutes);
app.use("/api/maintenance", maintenanceRoutes);
app.use("/api/admin", adminRoutes);

// Health check (basic)
app.get("/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Health check with database status
app.get("/api/health/db", async (req, res) => {
  try {
    const { db } = await import("./database");
    await db.raw("SELECT 1");
    res.json({
      status: "ok",
      database: "connected",
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    res.status(503).json({
      status: "unavailable",
      database: "disconnected",
      message: "Database is not ready",
      timestamp: new Date().toISOString(),
    });
  }
});

// Error handling middleware
app.use(
  (
    err: any,
    req: express.Request,
    res: express.Response,
    next: express.NextFunction,
  ) => {
    console.error("Error:", err);
    res.status(err.status || 500).json({
      error: {
        message: err.message || "Internal server error",
        status: err.status || 500,
      },
    });
  },
);

// Initialize database and start server
async function startServer() {
  try {
    await initializeDatabaseWithRetry();
    console.log("Database initialized successfully");

    // Load settings cache
    await settingsService.loadCache();
    console.log("Settings cache loaded");

    app.listen(PORT, () => {
      console.log(`Server is running on port ${PORT}`);
      console.log(`Environment: ${process.env.NODE_ENV || "development"}`);
    });

    // Preload location hierarchy in the background so API startup is never blocked.
    void (async () => {
      try {
        const asseticEnabled = await settingsService.getBool(
          "assetic_sync_enabled",
        );
        if (asseticEnabled) {
          const hierarchy =
            await asseticLocationHierarchyService.refreshFromAssetic();
          console.log(
            `[AsseticHierarchy] Preloaded ${hierarchy.regions.length} region(s) from ${hierarchy.source}`,
          );
        }
      } catch (error) {
        console.warn("[AsseticHierarchy] Startup preload failed:", error);
      }
    })();
  } catch (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }
}

startServer();

export default app;
