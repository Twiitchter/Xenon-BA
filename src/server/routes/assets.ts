import { Router, Response } from "express";
import { authenticateToken, AuthRequest } from "../middleware/auth";
import asseticClient from "../services/asseticClient";
import db from "../database";

const router = Router();

// All routes require authentication
router.use(authenticateToken);

// Set Assetic logging context (user + source) for every request through this router
router.use((req: AuthRequest, _res: Response, next: Function) => {
  asseticClient.setContext(req.user?.id, "assets");
  _res.on("finish", () => asseticClient.clearContext());
  next();
});

/**
 * GET /api/assets
 * Get all assets from local database
 */
router.get("/", async (req: AuthRequest, res: Response) => {
  try {
    const { status, category, limit = 100, offset = 0 } = req.query;

    let qb = db("assets");

    if (status) {
      qb = qb.where("status", status as string);
    }

    if (category) {
      qb = qb.where("category", category as string);
    }

    const assets = await qb
      .orderBy("created_at", "desc")
      .limit(Number(limit))
      .offset(Number(offset));

    res.json({
      assets,
      total: assets.length,
    });
  } catch (error) {
    console.error("Error fetching assets:", error);
    res.status(500).json({ error: "Failed to fetch assets" });
  }
});

/**
 * GET /api/assets/search?q=...
 * Search the synced Assetic asset cache by name or asset ID code.
 * Used by the New Work Request form to pick an asset before submission.
 */
router.get("/search", async (req: AuthRequest, res: Response) => {
  try {
    const { q = "", limit = 20 } = req.query;
    const term = String(q).trim();
    if (!term || term.length < 2) {
      return res.json({ assets: [] });
    }

    const assets = await db("assetic_assets")
      .where((qb) => {
        qb.whereILike("asset_name", `%${term}%`).orWhereILike(
          "asset_id",
          `%${term}%`,
        );
      })
      .where("asset_status", "Active")
      .select(
        "id",
        "assetic_guid",
        "asset_id",
        "asset_name",
        "asset_status",
        "asset_type",
        "asset_category",
      )
      .orderBy("asset_name", "asc")
      .limit(Number(limit));

    res.json({ assets });
  } catch (error) {
    console.error("Error searching assets:", error);
    res.status(500).json({ error: "Failed to search assets" });
  }
});

/**
 * GET /api/assets/:id
 * Get a specific asset
 */
router.get("/:id", async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    const asset = await db("assets").where("id", id).first();

    if (!asset) {
      return res.status(404).json({ error: "Asset not found" });
    }

    res.json(asset);
  } catch (error) {
    console.error("Error fetching asset:", error);
    res.status(500).json({ error: "Failed to fetch asset" });
  }
});

/**
 * GET /api/assets/by-fl/:flGuid
 * Return the (first active) asset linked to a given functional location GUID.
 * Used to auto-resolve the building asset from the location hierarchy picker.
 */
router.get("/by-fl/:flGuid", async (req: AuthRequest, res: Response) => {
  try {
    const { flGuid } = req.params;
    const asset = await db("assetic_assets as aa")
      .join(
        "assetic_asset_functional_locations as aafl",
        "aa.assetic_guid",
        "aafl.asset_guid",
      )
      .where("aafl.fl_guid", flGuid)
      .where("aa.asset_status", "Active")
      .select(
        "aa.id",
        "aa.assetic_guid",
        "aa.asset_id",
        "aa.asset_name",
        "aa.asset_status",
        "aa.asset_type",
        "aa.asset_category",
      )
      .first();

    if (!asset) {
      return res.json({ asset: null });
    }
    res.json({ asset });
  } catch (error) {
    console.error("Error fetching asset by functional location:", error);
    res.status(500).json({ error: "Failed to fetch asset" });
  }
});

/**
 * GET /api/assets/:id/changes
 * Get change history for an asset
 */
router.get("/:id/changes", async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { limit = 50, offset = 0 } = req.query;

    const changes = await db("asset_changes")
      .where("asset_id", id)
      .orderBy("changed_at", "desc")
      .limit(Number(limit))
      .offset(Number(offset));

    res.json({
      changes,
      total: changes.length,
    });
  } catch (error) {
    console.error("Error fetching asset changes:", error);
    res.status(500).json({ error: "Failed to fetch asset changes" });
  }
});

/**
 * POST /api/assets/sync
 * Sync assets from Assetic API to local database
 */
router.post("/sync", async (req: AuthRequest, res: Response) => {
  try {
    // Fetch assets from Assetic API
    const asseticAssets = await asseticClient.getAssets();

    let syncedCount = 0;
    let errorCount = 0;

    for (const asseticAsset of asseticAssets) {
      try {
        // Check if asset exists
        const existing = await db("assets")
          .where("assetic_id", asseticAsset.id)
          .select("id", "data")
          .first();

        if (existing) {
          // Update existing asset and track changes
          const oldData =
            typeof existing.data === "string"
              ? JSON.parse(existing.data)
              : existing.data;
          const changes = compareAssetData(oldData, asseticAsset);

          await db("assets")
            .where("assetic_id", asseticAsset.id)
            .update({
              asset_tag: asseticAsset.assetTag,
              description: asseticAsset.description,
              category: asseticAsset.category,
              location: asseticAsset.location,
              status: asseticAsset.status,
              data: JSON.stringify(asseticAsset),
              last_synced_at: db.fn.now(),
              updated_at: db.fn.now(),
            });

          // Log changes
          for (const change of changes) {
            await db("asset_changes").insert({
              asset_id: existing.id,
              change_type: "update",
              field_name: change.field,
              old_value: change.oldValue,
              new_value: change.newValue,
              changed_at: db.fn.now(),
            });
          }
        } else {
          // Insert new asset
          await db("assets").insert({
            assetic_id: asseticAsset.id,
            asset_tag: asseticAsset.assetTag,
            description: asseticAsset.description,
            category: asseticAsset.category,
            location: asseticAsset.location,
            status: asseticAsset.status,
            data: JSON.stringify(asseticAsset),
            last_synced_at: db.fn.now(),
          });
        }

        syncedCount++;
      } catch (error) {
        console.error(`Error syncing asset ${asseticAsset.id}:`, error);
        errorCount++;
      }
    }

    res.json({
      message: "Sync completed",
      syncedCount,
      errorCount,
      total: asseticAssets.length,
    });
  } catch (error) {
    console.error("Error syncing assets:", error);
    res.status(500).json({ error: "Failed to sync assets" });
  }
});

/**
 * Helper function to compare asset data and detect changes
 */
function compareAssetData(
  oldData: any,
  newData: any,
): Array<{ field: string; oldValue: any; newValue: any }> {
  const changes: Array<{ field: string; oldValue: any; newValue: any }> = [];
  const fieldsToCompare = [
    "assetTag",
    "description",
    "category",
    "location",
    "status",
  ];

  for (const field of fieldsToCompare) {
    if (oldData?.[field] !== newData[field]) {
      changes.push({
        field,
        oldValue: oldData?.[field],
        newValue: newData[field],
      });
    }
  }

  return changes;
}

export default router;
