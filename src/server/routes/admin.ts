import { Router, Response } from "express";
import bcrypt from "bcrypt";
import { body, validationResult } from "express-validator";
import { authenticateToken, AuthRequest } from "../middleware/auth";
import db from "../database";
import settingsService from "../services/settingsService";
import activityService from "../services/activityService";
import asseticClient from "../services/asseticClient";
import asseticApiLogger from "../services/asseticApiLogger";
import asseticLocationHierarchyService from "../services/asseticLocationHierarchyService";
import asseticAssetSyncService from "../services/asseticAssetSyncService";

const router = Router();

function buildAsseticHierarchyError(error: any): {
  status: number;
  message: string;
  log: string;
} {
  const status = error?.response?.status;
  const upstream =
    error?.response?.data?.Message || error?.response?.data?.message;

  if (status === 401 || status === 403) {
    return {
      status: 502,
      message:
        "Assetic credentials are valid for login but do not have permission to read location hierarchy endpoints (/assets or /functionallocations). Update API permissions or use a service account with read access.",
      log: `Assetic hierarchy unauthorized (${status})${upstream ? `: ${upstream}` : ""}`,
    };
  }

  if (status === 404) {
    return {
      status: 502,
      message:
        "Assetic endpoint was not found while fetching hierarchy. Check API base URL and version settings.",
      log: `Assetic hierarchy endpoint missing (404)${upstream ? `: ${upstream}` : ""}`,
    };
  }

  return {
    status: 500,
    message: "Failed to fetch location hierarchy",
    log: `Assetic hierarchy fetch failed${status ? ` (status ${status})` : ""}${upstream ? `: ${upstream}` : ""}`,
  };
}

// All admin routes require authentication
router.use(authenticateToken);

// Middleware: require admin role
const requireAdmin = async (
  req: AuthRequest,
  res: Response,
  next: Function,
) => {
  try {
    const user = await db("users")
      .where("id", req.user.id)
      .select("role")
      .first();
    if (!user || user.role !== "admin") {
      return res.status(403).json({ error: "Admin access required" });
    }
    next();
  } catch {
    res.status(500).json({ error: "Authorization check failed" });
  }
};

router.use(requireAdmin);

// Set Assetic logging context (user + source) for every request through this router
router.use((req: AuthRequest, _res: Response, next: Function) => {
  asseticClient.setContext(req.user?.id, "admin");
  _res.on("finish", () => asseticClient.clearContext());
  next();
});

// ═══════════════════════════════════════════════════════════════════════
// SETTINGS
// ═══════════════════════════════════════════════════════════════════════

/**
 * GET /api/admin/settings
 * Get all system settings (optionally filtered by category)
 */
router.get("/settings", async (req: AuthRequest, res: Response) => {
  try {
    const { category } = req.query;
    const settings = await settingsService.getAll(
      category as string | undefined,
    );
    res.json({ settings });
  } catch (error) {
    console.error("Error fetching settings:", error);
    res.status(500).json({ error: "Failed to fetch settings" });
  }
});

/**
 * PUT /api/admin/settings
 * Bulk update settings
 * Body: { settings: { key: value, ... } }
 */
router.put("/settings", async (req: AuthRequest, res: Response) => {
  try {
    const { settings } = req.body;
    if (!settings || typeof settings !== "object") {
      return res.status(400).json({ error: "Settings object required" });
    }

    await settingsService.bulkSet(settings, req.user.id);

    // If any assetic/worker settings changed, refresh the worker pool
    const asseticKeys = Object.keys(settings).filter((k) =>
      k.startsWith("assetic_"),
    );
    if (asseticKeys.length > 0) {
      try {
        await asseticClient.refreshWorkerPool();
      } catch (e) {
        console.warn("Worker pool refresh after settings update failed:", e);
      }
    }

    await activityService.log({
      entity_type: "setting",
      entity_id: 0,
      action: "updated",
      details: { keys: Object.keys(settings) },
      performed_by: req.user.id,
    });

    res.json({ message: "Settings updated successfully" });
  } catch (error) {
    console.error("Error updating settings:", error);
    res.status(500).json({ error: "Failed to update settings" });
  }
});

/**
 * POST /api/admin/settings/test-assetic
 * Test Assetic API connection using the Validate Login endpoint (GET /api/v2/auth)
 */
router.post(
  "/settings/test-assetic",
  async (req: AuthRequest, res: Response) => {
    try {
      const apiUrl = await settingsService.get("assetic_api_url");
      const apiKey = await settingsService.get("assetic_api_key");
      const apiUsername = await settingsService.get("assetic_api_username");

      if (!apiUrl || !apiKey || !apiUsername) {
        return res.status(400).json({
          error:
            "Assetic site URL, username, and API key must be configured first",
        });
      }

      // Validate login, then validate read access for hierarchy source endpoint.
      const result = await asseticClient.validateLogin();
      await asseticClient.getAssets({ page: 1, pageSize: 1 });

      res.json({
        success: true,
        message:
          "Assetic connection successful - credentials and asset read access validated",
        status: 200,
        data: result,
      });
    } catch (error: any) {
      const status = error.response?.status || 0;
      let message =
        error.response?.data?.message || error.message || "Connection failed";

      if (status === 401 || status === 403) {
        message =
          "Authentication/authorization failed - ensure this account can read /auth and /assets endpoints";
      } else if (status === 404) {
        message =
          "Endpoint not found - check your Assetic site URL (should be e.g. https://yoursite.assetic.net)";
      }

      res.json({ success: false, message, status });
    }
  },
);

/**
 * GET /api/admin/settings/assetic-rate-limit
 * Return current Assetic API rate-limit and queue status.
 * The frontend polls this to show toast notifications.
 * Includes per-worker breakdown when multiple workers are configured.
 */
router.get(
  "/settings/assetic-rate-limit",
  async (_req: AuthRequest, res: Response) => {
    try {
      const status = asseticClient.getRateLimitStatus();
      res.json(status);
    } catch (error: any) {
      res.status(500).json({ error: "Failed to retrieve rate limit status" });
    }
  },
);

/**
 * POST /api/admin/settings/assetic-refresh-workers
 * Force-reload the worker pool configuration from DB settings.
 */
router.post(
  "/settings/assetic-refresh-workers",
  async (_req: AuthRequest, res: Response) => {
    try {
      await asseticClient.refreshWorkerPool();
      const status = asseticClient.getRateLimitStatus();
      res.json({ message: "Worker pool refreshed", status });
    } catch (error: any) {
      res.status(500).json({ error: "Failed to refresh worker pool" });
    }
  },
);

/**
 * GET /api/admin/settings/assetic-location-hierarchy
 * Return region/site/building hierarchy for visual review in settings.
 * Pass ?refresh=true to force an immediate refresh from Assetic.
 */
router.get(
  "/settings/assetic-location-hierarchy",
  async (req: AuthRequest, res: Response) => {
    try {
      const enabled = await asseticClient.isEnabled();
      if (!enabled) {
        return res
          .status(503)
          .json({ error: "Assetic integration is not enabled" });
      }

      const forceRefresh =
        String(req.query.refresh || "").toLowerCase() === "true";
      const hierarchy = forceRefresh
        ? await asseticLocationHierarchyService.refreshFromAssetic()
        : await asseticLocationHierarchyService.getOrRefresh();

      res.json(hierarchy);
    } catch (error: any) {
      const mapped = buildAsseticHierarchyError(error);
      console.error(`Error fetching Assetic location hierarchy: ${mapped.log}`);
      res.status(mapped.status).json({ error: mapped.message });
    }
  },
);

/**
 * POST /api/admin/settings/assetic-rebuild-hierarchy-from-db
 * Sync region assignments from asset data then rebuild the hierarchy from DB only.
 * Does NOT call the Assetic API.
 */
router.post(
  "/settings/assetic-rebuild-hierarchy-from-db",
  async (req: AuthRequest, res: Response) => {
    try {
      const assigned = await asseticAssetSyncService.syncRegionAssignments();
      const floors = await asseticAssetSyncService.syncFloorAssignments();
      // Clear stale in-memory cache so getOrRefresh() picks up the new DB state
      asseticLocationHierarchyService.clearCache();
      const hierarchy =
        await asseticLocationHierarchyService.refreshFromAssetic();
      res.json({
        ...hierarchy,
        regionAssignmentsUpdated: assigned,
        floorAssignmentsUpdated: floors,
      });
    } catch (error: any) {
      console.error("Error rebuilding hierarchy from DB:", error);
      res.status(500).json({ error: "Failed to rebuild hierarchy from DB" });
    }
  },
);

/**
 * POST /api/admin/settings/assetic-flush-and-rebuild
 * DESTRUCTIVE: Wipes all synced asset/FL data then runs a full resync from the
 * Assetic API. Used to recover from a corrupted or incomplete sync state.
 *
 * Flow:
 *  1. Save Building→Site parent_fl_guid links (only available via CSV, not API)
 *  2. Truncate assetic_assets, assetic_functional_locations,
 *     assetic_asset_functional_locations
 *  3. syncFunctionalLocations — re-fetch all FLs from API
 *  4. Restore Building→Site parent links
 *  5. syncRegionAssignments + syncFloorAssignments
 *  6. Rebuild hierarchy cache
 *  7. Fire syncAssets + enrichFunctionalLocations in background
 *
 * Returns immediately after step 6. The asset/enrichment sync continues in
 * background — monitor progress via GET /settings/asset-sync-status.
 */
router.post(
  "/settings/assetic-flush-and-rebuild",
  async (req: AuthRequest, res: Response) => {
    try {
      const enabled = await asseticClient.isEnabled();
      if (!enabled) {
        return res
          .status(503)
          .json({ error: "Assetic integration is not enabled" });
      }

      const status = await asseticAssetSyncService.getStatus();
      if (status.isRunning) {
        return res
          .status(409)
          .json({ error: "A sync operation is already running", status });
      }

      // 1. Save Building→Site parent links before wiping
      const buildingSiteLinks: Array<{
        building_guid: string;
        site_guid: string;
      }> = await db("assetic_functional_locations as b")
        .join(
          "assetic_functional_locations as s",
          "b.parent_fl_guid",
          "s.fl_guid",
        )
        .where("b.fl_type", "Building")
        .where("s.fl_type", "Site")
        .select("b.fl_guid as building_guid", "b.parent_fl_guid as site_guid");

      console.log(
        `[FlushRebuild] Saved ${buildingSiteLinks.length} Building→Site links`,
      );

      // 2. Truncate tables (order matters: dependents first)
      await db.raw("TRUNCATE TABLE assetic_asset_functional_locations");
      await db.raw("TRUNCATE TABLE assetic_assets");
      await db.raw("TRUNCATE TABLE assetic_functional_locations");
      console.log("[FlushRebuild] Tables truncated");

      // 3. Re-sync functional locations from Assetic API (blocks until done)
      const flResult = await asseticAssetSyncService.syncFunctionalLocations();
      console.log(`[FlushRebuild] FL sync done: ${flResult.synced} FLs`);

      // 4. Restore Building→Site parent links
      let restored = 0;
      const BATCH = 50;
      for (let i = 0; i < buildingSiteLinks.length; i += BATCH) {
        const chunk = buildingSiteLinks.slice(i, i + BATCH);
        await Promise.all(
          chunk.map((link) =>
            db("assetic_functional_locations")
              .where("fl_guid", link.building_guid)
              .whereNull("parent_fl_guid")
              .update({ parent_fl_guid: link.site_guid }),
          ),
        );
        restored += chunk.length;
      }
      console.log(`[FlushRebuild] Restored ${restored} Building→Site links`);

      // 5. Sync region + floor assignments
      const regionCount = await asseticAssetSyncService.syncRegionAssignments();
      const floorCount = await asseticAssetSyncService.syncFloorAssignments();
      console.log(
        `[FlushRebuild] Region assignments: ${regionCount}, Floor assignments: ${floorCount}`,
      );

      // 6. Rebuild hierarchy cache
      asseticLocationHierarchyService.clearCache();
      const hierarchy =
        await asseticLocationHierarchyService.refreshFromAssetic();
      console.log("[FlushRebuild] Hierarchy rebuilt");

      // 7. Fire full asset sync in background
      asseticAssetSyncService
        .runFullSync()
        .catch((err) =>
          console.error("[FlushRebuild] Background asset sync failed:", err),
        );

      res.json({
        message:
          "Flush complete. FL hierarchy rebuilt. Asset sync running in background — monitor via sync status.",
        flsSynced: flResult.synced,
        buildingSiteLinksRestored: restored,
        regionAssignmentsUpdated: regionCount,
        floorAssignmentsUpdated: floorCount,
        ...hierarchy,
      });
    } catch (error: any) {
      console.error("[FlushRebuild] Error:", error);
      res
        .status(500)
        .json({ error: "Flush and rebuild failed: " + error.message });
    }
  },
);

// ═══════════════════════════════════════════════════════════════════════
// ASSET SYNC
// ═══════════════════════════════════════════════════════════════════════

/**
 * GET /api/admin/settings/asset-sync-status
 * Returns current sync status including progress and last sync info.
 */
router.get(
  "/settings/asset-sync-status",
  async (req: AuthRequest, res: Response) => {
    try {
      const status = await asseticAssetSyncService.getStatus();
      const apiCount = await asseticAssetSyncService
        .getApiAssetCount()
        .catch(() => null);
      const dbCount = await asseticAssetSyncService.getDbAssetCount();
      res.json({ ...status, apiAssetCount: apiCount, dbAssetCount: dbCount });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  },
);

/**
 * POST /api/admin/settings/asset-sync-trigger
 * Manually trigger a full asset sync.
 */
router.post(
  "/settings/asset-sync-trigger",
  async (req: AuthRequest, res: Response) => {
    try {
      const enabled = await asseticClient.isEnabled();
      if (!enabled) {
        return res
          .status(503)
          .json({ error: "Assetic integration is not enabled" });
      }

      const status = await asseticAssetSyncService.getStatus();
      if (status.isRunning) {
        return res
          .status(409)
          .json({ error: "A sync operation is already running", status });
      }

      // Start sync in background
      asseticAssetSyncService.runFullSync().catch((err) => {
        console.error("[AssetSync] Manual trigger failed:", err);
      });

      res.json({
        message: "Asset sync started",
        status: await asseticAssetSyncService.getStatus(),
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  },
);

/**
 * POST /api/admin/settings/asset-sync-trigger-fls
 * Manually trigger functional locations sync only.
 */
router.post(
  "/settings/asset-sync-trigger-fls",
  async (req: AuthRequest, res: Response) => {
    try {
      const enabled = await asseticClient.isEnabled();
      if (!enabled) {
        return res
          .status(503)
          .json({ error: "Assetic integration is not enabled" });
      }
      const status = await asseticAssetSyncService.getStatus();
      if (status.isRunning) {
        return res
          .status(409)
          .json({ error: "A sync operation is already running", status });
      }
      asseticAssetSyncService.syncFunctionalLocations().catch((err) => {
        console.error("[AssetSync] Manual FL sync failed:", err);
      });
      res.json({
        message: "Functional location sync started",
        status: await asseticAssetSyncService.getStatus(),
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  },
);

/**
 * POST /api/admin/settings/asset-sync-trigger-assets
 * Manually trigger asset sync only.
 */
router.post(
  "/settings/asset-sync-trigger-assets",
  async (req: AuthRequest, res: Response) => {
    try {
      const enabled = await asseticClient.isEnabled();
      if (!enabled) {
        return res
          .status(503)
          .json({ error: "Assetic integration is not enabled" });
      }
      const status = await asseticAssetSyncService.getStatus();
      if (status.isRunning) {
        return res
          .status(409)
          .json({ error: "A sync operation is already running", status });
      }
      asseticAssetSyncService.syncAssets().catch((err) => {
        console.error("[AssetSync] Manual asset sync failed:", err);
      });
      res.json({
        message: "Asset sync started",
        status: await asseticAssetSyncService.getStatus(),
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  },
);

/**
 * POST /api/admin/settings/asset-sync-trigger-enrichment
 * Manually trigger FL enrichment (per-asset FL relationship) only.
 */
router.post(
  "/settings/asset-sync-trigger-enrichment",
  async (req: AuthRequest, res: Response) => {
    try {
      const enabled = await asseticClient.isEnabled();
      if (!enabled) {
        return res
          .status(503)
          .json({ error: "Assetic integration is not enabled" });
      }
      const status = await asseticAssetSyncService.getStatus();
      if (status.isRunning) {
        return res
          .status(409)
          .json({ error: "A sync operation is already running", status });
      }
      asseticAssetSyncService
        .enrichFunctionalLocations()
        .then(() => asseticAssetSyncService.syncRegionAssignments())
        .then(() => asseticAssetSyncService.syncFloorAssignments())
        .then(() => asseticLocationHierarchyService.getOrRefresh())
        .catch((err) => {
          console.error(
            "[AssetSync] Manual FL enrichment + region assignment failed:",
            err,
          );
        });
      res.json({
        message: "FL enrichment started",
        status: await asseticAssetSyncService.getStatus(),
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  },
);

/**
 * GET /api/admin/settings/asset-sync-logs
 * Returns recent sync log entries.
 */
router.get(
  "/settings/asset-sync-logs",
  async (req: AuthRequest, res: Response) => {
    try {
      const limit = Math.min(
        parseInt(String(req.query.limit || "20"), 10),
        100,
      );
      const logs = await db("assetic_sync_log")
        .orderBy("started_at", "desc")
        .limit(limit);
      res.json(logs);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  },
);

// ═══════════════════════════════════════════════════════════════════════
// USER MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════

/**
 * GET /api/admin/users
 * List all users
 */
router.get("/users", async (req: AuthRequest, res: Response) => {
  try {
    const users = await db("users")
      .select(
        "id",
        "username",
        "email",
        "first_name",
        "last_name",
        "role",
        "auth_provider",
        "is_active",
        "department",
        "phone",
        "display_name",
        "pref_region_id",
        "pref_region_name",
        "pref_site_id",
        "pref_site_name",
        "pref_building_id",
        "pref_building_name",
        "pref_floor_id",
        "pref_floor_name",
        "created_at",
        "updated_at",
      )
      .orderBy("created_at", "desc");

    res.json({ users });
  } catch (error) {
    console.error("Error fetching users:", error);
    res.status(500).json({ error: "Failed to fetch users" });
  }
});

/**
 * POST /api/admin/users
 * Create a new local user
 */
router.post(
  "/users",
  [
    body("email").isEmail().normalizeEmail(),
    body("password").isLength({ min: 6 }),
    body("firstName").optional().trim(),
    body("lastName").optional().trim(),
    body("role").optional().isIn(["admin", "manager", "user"]),
    body("department").optional().trim(),
    body("phone").optional().trim(),
    body("displayName").optional().trim(),
    body("prefRegionId").optional().trim(),
    body("prefRegionName").optional().trim(),
    body("prefSiteId").optional().trim(),
    body("prefSiteName").optional().trim(),
    body("prefBuildingId").optional().trim(),
    body("prefBuildingName").optional().trim(),
    body("prefFloorId").optional().trim(),
    body("prefFloorName").optional().trim(),
  ],
  async (req: AuthRequest, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    try {
      const {
        email,
        password,
        firstName,
        lastName,
        role,
        department,
        phone,
        displayName,
        prefRegionId,
        prefRegionName,
        prefSiteId,
        prefSiteName,
        prefBuildingId,
        prefBuildingName,
        prefFloorId,
        prefFloorName,
      } = req.body;

      // Check if user already exists
      const existing = await db("users").where("email", email).first();
      if (existing) {
        return res.status(409).json({ error: "Email already exists" });
      }

      const passwordHash = await bcrypt.hash(password, 10);
      const username = email.split("@")[0]; // derive username from email

      const [inserted] = await db("users")
        .insert({
          username,
          email,
          password_hash: passwordHash,
          first_name: firstName || null,
          last_name: lastName || null,
          role: role || "user",
          auth_provider: "local",
          is_active: true,
          department: department || null,
          phone: phone || null,
          display_name: displayName || null,
          pref_region_id: prefRegionId || null,
          pref_region_name: prefRegionName || null,
          pref_site_id: prefSiteId || null,
          pref_site_name: prefSiteName || null,
          pref_building_id: prefBuildingId || null,
          pref_building_name: prefBuildingName || null,
          pref_floor_id: prefFloorId || null,
          pref_floor_name: prefFloorName || null,
        })
        .returning("*");

      let user = inserted;
      if (!user || typeof user === "number") {
        const id = typeof user === "number" ? user : (user as any);
        user = await db("users").where("id", id).first();
      }

      await activityService.log({
        entity_type: "user",
        entity_id: user.id,
        action: "created",
        details: { email, role: role || "user" },
        performed_by: req.user.id,
      });

      res.status(201).json({
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          firstName: user.first_name,
          lastName: user.last_name,
          role: user.role,
          isActive: user.is_active,
        },
      });
    } catch (error) {
      console.error("Error creating user:", error);
      res.status(500).json({ error: "Failed to create user" });
    }
  },
);

/**
 * PUT /api/admin/users/:id
 * Update a user
 */
router.put(
  "/users/:id",
  [
    body("email").optional().isEmail().normalizeEmail(),
    body("firstName").optional().trim(),
    body("lastName").optional().trim(),
    body("role").optional().isIn(["admin", "manager", "user"]),
    body("isActive").optional().isBoolean(),
    body("password").optional().isLength({ min: 6 }),
    body("department").optional().trim(),
    body("phone").optional().trim(),
    body("displayName").optional().trim(),
    body("prefRegionId").optional().trim(),
    body("prefRegionName").optional().trim(),
    body("prefSiteId").optional().trim(),
    body("prefSiteName").optional().trim(),
    body("prefBuildingId").optional().trim(),
    body("prefBuildingName").optional().trim(),
    body("prefFloorId").optional().trim(),
    body("prefFloorName").optional().trim(),
  ],
  async (req: AuthRequest, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    try {
      const { id } = req.params;
      const {
        email,
        firstName,
        lastName,
        role,
        isActive,
        password,
        department,
        phone,
        displayName,
        prefRegionId,
        prefRegionName,
        prefSiteId,
        prefSiteName,
        prefBuildingId,
        prefBuildingName,
        prefFloorId,
        prefFloorName,
      } = req.body;

      const existing = await db("users").where("id", id).first();
      if (!existing) {
        return res.status(404).json({ error: "User not found" });
      }

      const updateData: any = { updated_at: db.fn.now() };
      if (email) updateData.email = email;
      if (firstName !== undefined) updateData.first_name = firstName;
      if (lastName !== undefined) updateData.last_name = lastName;
      if (role) updateData.role = role;
      if (isActive !== undefined) updateData.is_active = isActive;
      if (department !== undefined) updateData.department = department;
      if (phone !== undefined) updateData.phone = phone;
      if (displayName !== undefined)
        updateData.display_name = displayName || null;
      if (prefRegionId !== undefined)
        updateData.pref_region_id = prefRegionId || null;
      if (prefRegionName !== undefined)
        updateData.pref_region_name = prefRegionName || null;
      if (prefSiteId !== undefined)
        updateData.pref_site_id = prefSiteId || null;
      if (prefSiteName !== undefined)
        updateData.pref_site_name = prefSiteName || null;
      if (prefBuildingId !== undefined)
        updateData.pref_building_id = prefBuildingId || null;
      if (prefBuildingName !== undefined)
        updateData.pref_building_name = prefBuildingName || null;
      if (prefFloorId !== undefined)
        updateData.pref_floor_id = prefFloorId || null;
      if (prefFloorName !== undefined)
        updateData.pref_floor_name = prefFloorName || null;
      if (password) {
        updateData.password_hash = await bcrypt.hash(password, 10);
      }

      await db("users").where("id", id).update(updateData);

      await activityService.log({
        entity_type: "user",
        entity_id: Number(id),
        action: "updated",
        details: {
          fields: Object.keys(updateData).filter(
            (k) => k !== "updated_at" && k !== "password_hash",
          ),
        },
        performed_by: req.user.id,
      });

      const updated = await db("users")
        .where("id", id)
        .select(
          "id",
          "username",
          "email",
          "first_name",
          "last_name",
          "role",
          "auth_provider",
          "is_active",
          "department",
          "phone",
          "display_name",
          "pref_region_id",
          "pref_region_name",
          "pref_site_id",
          "pref_site_name",
          "pref_building_id",
          "pref_building_name",
          "pref_floor_id",
          "pref_floor_name",
        )
        .first();

      res.json({ user: updated });
    } catch (error) {
      console.error("Error updating user:", error);
      res.status(500).json({ error: "Failed to update user" });
    }
  },
);

/**
 * DELETE /api/admin/users/:id
 * Deactivate a user (soft delete)
 */
router.delete("/users/:id", async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    // Prevent self-deletion
    if (Number(id) === req.user.id) {
      return res
        .status(400)
        .json({ error: "Cannot deactivate your own account" });
    }

    await db("users")
      .where("id", id)
      .update({ is_active: false, updated_at: db.fn.now() });

    await activityService.log({
      entity_type: "user",
      entity_id: Number(id),
      action: "deactivated",
      performed_by: req.user.id,
    });

    res.json({ message: "User deactivated" });
  } catch (error) {
    console.error("Error deactivating user:", error);
    res.status(500).json({ error: "Failed to deactivate user" });
  }
});

// ═══════════════════════════════════════════════════════════════════════
// ACTIVITY LOG
// ═══════════════════════════════════════════════════════════════════════

/**
 * GET /api/admin/activity
 * Get recent activity log
 */
router.get("/activity", async (req: AuthRequest, res: Response) => {
  try {
    const { limit = 50 } = req.query;
    const activity = await activityService.getRecent(Number(limit));
    res.json({ activity });
  } catch (error) {
    console.error("Error fetching activity log:", error);
    res.status(500).json({ error: "Failed to fetch activity log" });
  }
});

// ═══════════════════════════════════════════════════════════════════════
// DASHBOARD STATS
// ═══════════════════════════════════════════════════════════════════════

/**
 * GET /api/admin/stats
 * Get dashboard statistics
 */
router.get("/stats", async (req: AuthRequest, res: Response) => {
  try {
    const [requestStats] = await db("maintenance_requests").select(
      db.raw("COUNT(*) as total"),
      db.raw("COUNT(CASE WHEN status = 'open' THEN 1 END) as open_count"),
      db.raw(
        "COUNT(CASE WHEN status = 'in_progress' THEN 1 END) as in_progress_count",
      ),
      db.raw(
        "COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed_count",
      ),
    );

    const [workOrderStats] = await db("work_orders").select(
      db.raw("COUNT(*) as total"),
      db.raw("COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending_count"),
      db.raw(
        "COUNT(CASE WHEN status = 'in_progress' THEN 1 END) as in_progress_count",
      ),
      db.raw(
        "COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed_count",
      ),
    );

    const [userStats] = await db("users").select(
      db.raw("COUNT(*) as total"),
      db.raw(
        "COUNT(CASE WHEN is_active = 1 OR is_active = true THEN 1 END) as active_count",
      ),
    );

    res.json({
      requests: requestStats,
      workOrders: workOrderStats,
      users: userStats,
    });
  } catch (error) {
    console.error("Error fetching stats:", error);
    res.status(500).json({ error: "Failed to fetch statistics" });
  }
});

// ═══════════════════════════════════════════════════════════════════════
// ASSETIC API LOGS
// ═══════════════════════════════════════════════════════════════════════

/**
 * GET /api/admin/api-logs
 * Query Assetic API call logs for debugging.
 * Supports filters: entityType, entityGuid, httpStatus, status,
 * performedBy, from, to, limit, offset
 */
router.get("/api-logs", async (req: AuthRequest, res: Response) => {
  try {
    const {
      entityType,
      entityGuid,
      httpStatus,
      status,
      performedBy,
      from,
      to,
      limit = 100,
      offset = 0,
    } = req.query;

    const params = {
      entityType: entityType as any,
      entityGuid: entityGuid as string | undefined,
      httpStatus: httpStatus ? Number(httpStatus) : undefined,
      status: status as any,
      performedBy: performedBy ? Number(performedBy) : undefined,
      from: from as string | undefined,
      to: to as string | undefined,
      limit: Number(limit),
      offset: Number(offset),
    };

    const [logs, total] = await Promise.all([
      asseticApiLogger.query(params),
      asseticApiLogger.count(params),
    ]);

    res.json({ logs, total, limit: params.limit, offset: params.offset });
  } catch (error) {
    console.error("Error fetching API logs:", error);
    res.status(500).json({ error: "Failed to fetch API logs" });
  }
});

/**
 * GET /api/admin/api-logs/:id
 * Get a single API log entry with full request/response payloads.
 */
router.get("/api-logs/:id", async (req: AuthRequest, res: Response) => {
  try {
    const log = await asseticApiLogger.getById(Number(req.params.id));
    if (!log) {
      return res.status(404).json({ error: "Log entry not found" });
    }
    res.json(log);
  } catch (error) {
    console.error("Error fetching API log entry:", error);
    res.status(500).json({ error: "Failed to fetch API log entry" });
  }
});

/**
 * DELETE /api/admin/api-logs/purge
 * Purge API log entries older than `days` (default 30).
 */
router.delete("/api-logs/purge", async (req: AuthRequest, res: Response) => {
  try {
    const days = Number(req.query.days) || 30;
    const deleted = await asseticApiLogger.purgeOlderThan(days);
    res.json({
      message: `Purged ${deleted} log entries older than ${days} days`,
      deleted,
    });
  } catch (error) {
    console.error("Error purging API logs:", error);
    res.status(500).json({ error: "Failed to purge API logs" });
  }
});

export default router;
