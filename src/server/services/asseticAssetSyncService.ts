import { db } from "../database";
import asseticClient from "./asseticClient";
import settingsService from "./settingsService";
import { asseticLocationHierarchyService } from "./asseticLocationHierarchyService";

/**
 * AsseticAssetSyncService — pulls all assets from the Assetic REST API into
 * the local database, then enriches each asset with its functional location
 * relationship to build the location hierarchy.
 *
 * Polling: on a configurable interval (default 60 min), compares the API
 * asset count with the local DB count. If they differ, a full sync runs.
 *
 * Hierarchy: after assets are synced, calls GET /assets/{guid}/functionallocation
 * for every asset that hasn't been enriched yet. The FL data (including type
 * Region/Site/Building/Floor) is stored in assetic_asset_functional_locations.
 * A separate method builds the hierarchy tree from the stored FL data combined
 * with the standalone FL list.
 */

export interface SyncStatus {
  isRunning: boolean;
  syncType: string | null;
  progress: number | null; // 0–100
  totalCount: number | null;
  syncedCount: number | null;
  errorCount: number | null;
  lastSync: {
    type: string;
    status: string;
    totalCount: number | null;
    syncedCount: number | null;
    errorCount: number | null;
    startedAt: string;
    completedAt: string | null;
  } | null;
}

class AsseticAssetSyncService {
  private _running = false;
  private _syncType: string | null = null;
  private _progress: number | null = null;
  private _totalCount: number | null = null;
  private _syncedCount: number | null = null;
  private _errorCount: number | null = null;
  private _pollTimer: ReturnType<typeof setInterval> | null = null;

  // ═══════════════════════════════════════════════════════════
  // STATUS
  // ═══════════════════════════════════════════════════════════

  async getStatus(): Promise<SyncStatus> {
    let lastSync = null;
    try {
      const row = await db("assetic_sync_log")
        .orderBy("started_at", "desc")
        .first();
      if (row) {
        lastSync = {
          type: row.sync_type,
          status: row.status,
          totalCount: row.total_count,
          syncedCount: row.synced_count,
          errorCount: row.error_count,
          startedAt: row.started_at,
          completedAt: row.completed_at,
        };
      }
    } catch {
      // table may not exist yet
    }

    return {
      isRunning: this._running,
      syncType: this._syncType,
      progress: this._progress,
      totalCount: this._totalCount,
      syncedCount: this._syncedCount,
      errorCount: this._errorCount,
      lastSync,
    };
  }

  // ═══════════════════════════════════════════════════════════
  // ASSET COUNT CHECK
  // ═══════════════════════════════════════════════════════════

  /**
   * Fetch a small page from the API just to read the total count header.
   */
  async getApiAssetCount(): Promise<number> {
    const resp = await asseticClient.getAssets({ page: 1, pageSize: 1 });
    // Assetic response envelope uses TotalResults for the total count
    const total =
      resp?.TotalResults ??
      resp?.TotalCount ??
      resp?.totalResults ??
      resp?.RecordCount ??
      resp?.Meta?.TotalCount ??
      resp?.Data?.TotalCount;
    if (typeof total === "number") return total;
    // Fallback: count ResourceList if available
    const list = resp?.ResourceList ?? resp?.Data ?? [];
    return Array.isArray(list) ? list.length : 0;
  }

  async getDbAssetCount(): Promise<number> {
    try {
      const result = await db("assetic_assets").count("id as count").first();
      return Number(result?.count ?? 0);
    } catch {
      return 0;
    }
  }

  // ═══════════════════════════════════════════════════════════
  // FULL ASSET SYNC
  // ═══════════════════════════════════════════════════════════

  /**
   * Pull all assets from the Assetic REST API and upsert into assetic_assets.
   * Runs incrementally page by page.
   */
  async syncAssets(): Promise<{ synced: number; errors: number }> {
    if (this._running) {
      throw new Error("A sync operation is already running");
    }

    this._running = true;
    this._syncType = "assets";
    this._progress = 0;
    this._syncedCount = 0;
    this._errorCount = 0;

    // Create sync log entry
    const [logId] = await db("assetic_sync_log")
      .insert({
        sync_type: "assets",
        status: "running",
        started_at: new Date(),
      })
      .returning("id");
    const syncLogId = typeof logId === "object" ? logId.id : logId;

    try {
      // Get total count first
      const apiTotal = await this.getApiAssetCount();
      this._totalCount = apiTotal;
      await db("assetic_sync_log")
        .where("id", syncLogId)
        .update({ total_count: apiTotal });

      console.log(
        `[AssetSync] Starting asset sync. API reports ${apiTotal} assets.`,
      );

      const pageSize = 500;
      let page = 1;
      let totalSynced = 0;
      let totalErrors = 0;
      const maxPages = 500; // Safety cap

      while (page <= maxPages) {
        let rows: any[] = [];
        try {
          const resp = await asseticClient.getAssets({ page, pageSize });
          rows = this.extractRows(resp);
        } catch (err) {
          console.error(
            `[AssetSync] Failed to fetch page ${page}:`,
            (err as any)?.message,
          );
          totalErrors++;
          break;
        }

        if (rows.length === 0) break;

        // Upsert each asset
        for (const asset of rows) {
          try {
            const guid = asset.Id || asset.id || asset.Guid || asset.guid || "";
            if (!guid) continue;

            const assetId =
              asset.AssetId || asset.assetId || asset.AssetCode || "";
            const assetName =
              asset.AssetName || asset.assetName || asset.Name || "";
            const assetStatus =
              asset.AssetStatusName || asset.AssetStatus || asset.Status || "";
            const assetType = asset.AssetTypeName || asset.AssetType || "";
            const assetClass = asset.AssetClassName || asset.AssetClass || "";
            const assetCategory =
              asset.AssetCategoryName || asset.AssetCategory || "";

            const exists = await db("assetic_assets")
              .where("assetic_guid", guid)
              .first();

            if (exists) {
              await db("assetic_assets")
                .where("assetic_guid", guid)
                .update({
                  asset_id: assetId,
                  asset_name: assetName,
                  asset_status: assetStatus,
                  asset_type: assetType,
                  asset_class: assetClass,
                  asset_category: assetCategory,
                  data: JSON.stringify(asset),
                  synced_at: new Date(),
                  updated_at: new Date(),
                });
            } else {
              await db("assetic_assets").insert({
                assetic_guid: guid,
                asset_id: assetId,
                asset_name: assetName,
                asset_status: assetStatus,
                asset_type: assetType,
                asset_class: assetClass,
                asset_category: assetCategory,
                data: JSON.stringify(asset),
                synced_at: new Date(),
                created_at: new Date(),
                updated_at: new Date(),
              });
            }
            totalSynced++;
          } catch (err) {
            totalErrors++;
          }
        }

        this._syncedCount = totalSynced;
        this._errorCount = totalErrors;
        this._progress =
          apiTotal > 0 ? Math.round((totalSynced / apiTotal) * 100) : 0;

        // Update sync log periodically
        if (page % 10 === 0) {
          await db("assetic_sync_log").where("id", syncLogId).update({
            synced_count: totalSynced,
            error_count: totalErrors,
          });
        }

        console.log(
          `[AssetSync] Page ${page}: +${rows.length} assets (${totalSynced} total, ${this._progress}%)`,
        );

        if (rows.length < pageSize) break;
        if (apiTotal > 0 && totalSynced >= apiTotal) break;
        page++;
      }

      await db("assetic_sync_log").where("id", syncLogId).update({
        status: "completed",
        synced_count: totalSynced,
        error_count: totalErrors,
        completed_at: new Date(),
      });

      console.log(
        `[AssetSync] Asset sync complete: ${totalSynced} synced, ${totalErrors} errors`,
      );

      return { synced: totalSynced, errors: totalErrors };
    } catch (err) {
      await db("assetic_sync_log")
        .where("id", syncLogId)
        .update({
          status: "failed",
          error_message: (err as any)?.message || String(err),
          completed_at: new Date(),
        });
      throw err;
    } finally {
      this._running = false;
      this._syncType = null;
      this._progress = null;
    }
  }

  // ═══════════════════════════════════════════════════════════
  // FL ENRICHMENT — per-asset functional location fetch
  // ═══════════════════════════════════════════════════════════

  /**
   * For each asset in assetic_assets that doesn't yet have an FL record,
   * call GET /assets/{guid}/functionallocation and store the result.
   */
  async enrichFunctionalLocations(): Promise<{
    enriched: number;
    errors: number;
    skipped: number;
  }> {
    if (this._running) {
      throw new Error("A sync operation is already running");
    }

    this._running = true;
    this._syncType = "fl_enrichment";
    this._progress = 0;
    this._syncedCount = 0;
    this._errorCount = 0;

    const [logId] = await db("assetic_sync_log")
      .insert({
        sync_type: "fl_enrichment",
        status: "running",
        started_at: new Date(),
      })
      .returning("id");
    const syncLogId = typeof logId === "object" ? logId.id : logId;

    try {
      // Find assets without FL records
      const assetsNeedingFL = await db("assetic_assets")
        .leftJoin(
          "assetic_asset_functional_locations",
          "assetic_assets.assetic_guid",
          "assetic_asset_functional_locations.asset_guid",
        )
        .whereNull("assetic_asset_functional_locations.id")
        .select("assetic_assets.assetic_guid");

      const total = assetsNeedingFL.length;
      this._totalCount = total;
      await db("assetic_sync_log")
        .where("id", syncLogId)
        .update({ total_count: total });

      console.log(
        `[AssetSync] FL enrichment: ${total} assets need functional location data`,
      );

      let enriched = 0;
      let errors = 0;
      let skipped = 0;
      let loggedFirstFl = false;

      // Determine concurrency from configured worker count
      const poolStatus = asseticClient.getRateLimitStatus();
      const concurrency = Math.max(1, poolStatus.totalWorkers);
      console.log(
        `[AssetSync] FL enrichment: using ${concurrency} concurrent workers`,
      );

      // Process a single asset's FL enrichment
      const processOne = async (
        guid: string,
      ): Promise<"enriched" | "skipped" | "error"> => {
        try {
          const resp = await asseticClient.getFunctionalLocation(guid);
          const flData = resp?.Data?.[0] ?? resp?.ResourceList?.[0] ?? resp;

          if (!flData || (!flData.Id && !flData.FunctionalLocationId)) {
            if (!loggedFirstFl) {
              console.log(
                `[AssetSync] First FL response (no FL):`,
                JSON.stringify(resp).substring(0, 300),
              );
              loggedFirstFl = true;
            }
            await db("assetic_asset_functional_locations").insert({
              asset_guid: guid,
              fl_guid: null,
              fl_id: null,
              fl_name: null,
              fl_type: null,
              fl_type_id: null,
              fl_data: null,
              synced_at: new Date(),
            });
            return "skipped";
          }

          if (!loggedFirstFl) {
            console.log(
              `[AssetSync] First FL response keys:`,
              Object.keys(flData),
            );
            console.log(
              `[AssetSync] First FL response sample:`,
              JSON.stringify(flData).substring(0, 500),
            );
            loggedFirstFl = true;
          }

          const flGuid = flData.Id || flData.id || null;
          const flId =
            flData.FunctionalLocationId || flData.functionalLocationId || null;
          const flName =
            flData.FunctionalLocationName ||
            flData.functionalLocationName ||
            null;
          const flType =
            flData.FunctionalLocationType ||
            flData.functionalLocationType ||
            null;
          const flTypeId =
            flData.FunctionalLocationTypeId ||
            flData.functionalLocationTypeId ||
            null;
          const parentFlGuid =
            flData.ParentId ||
            flData.parentId ||
            flData.ParentFunctionalLocationId ||
            flData.parentFunctionalLocationId ||
            null;

          await db("assetic_asset_functional_locations").insert({
            asset_guid: guid,
            fl_guid: flGuid,
            fl_id: flId,
            fl_name: flName,
            fl_type: flType,
            fl_type_id: flTypeId,
            parent_fl_guid: parentFlGuid,
            fl_data: JSON.stringify(flData),
            synced_at: new Date(),
          });

          if (flGuid) {
            const existingFL = await db("assetic_functional_locations")
              .where("fl_guid", flGuid)
              .first();
            if (existingFL) {
              if (parentFlGuid && !existingFL.parent_fl_guid) {
                await db("assetic_functional_locations")
                  .where("fl_guid", flGuid)
                  .update({ parent_fl_guid: parentFlGuid });
              }
            } else {
              await db("assetic_functional_locations").insert({
                fl_guid: flGuid,
                fl_id: flId,
                fl_name: flName,
                fl_type: flType,
                fl_type_id: flTypeId,
                parent_fl_guid: parentFlGuid,
                fl_data: JSON.stringify(flData),
                synced_at: new Date(),
              });
            }
          }
          return "enriched";
        } catch (err: any) {
          if (err?.response?.status === 404) {
            await db("assetic_asset_functional_locations").insert({
              asset_guid: guid,
              fl_guid: null,
              fl_data: null,
              synced_at: new Date(),
            });
            return "skipped";
          }
          return "error";
        }
      };

      // Continuous concurrency pool — keep `concurrency` slots in-flight at
      // all times so workers are never idle waiting for a slow peer.
      // The rate limiter's internal queue handles the 250/min per-worker cap.
      let idx = 0;
      let inFlight = 0;
      let lastLogAt = 0;

      await new Promise<void>((resolveAll) => {
        const tryDispatch = () => {
          while (inFlight < concurrency && idx < assetsNeedingFL.length) {
            const guid = assetsNeedingFL[idx++].assetic_guid;
            inFlight++;

            processOne(guid)
              .then((result) => {
                if (result === "enriched") enriched++;
                else if (result === "skipped") skipped++;
                else errors++;
              })
              .catch(() => {
                errors++;
              })
              .finally(() => {
                inFlight--;

                this._syncedCount = enriched + skipped;
                this._errorCount = errors;
                const processed = enriched + skipped + errors;
                this._progress =
                  total > 0 ? Math.round((processed / total) * 100) : 0;

                // Log every 250 processed
                if (processed - lastLogAt >= 250 || processed === total) {
                  lastLogAt = processed;
                  console.log(
                    `[AssetSync] FL enrichment: ${enriched} enriched, ${skipped} skipped, ${errors} errors (${this._progress}%)`,
                  );
                  db("assetic_sync_log")
                    .where("id", syncLogId)
                    .update({
                      synced_count: enriched + skipped,
                      error_count: errors,
                    })
                    .catch(() => {});
                }

                if (idx < assetsNeedingFL.length) {
                  tryDispatch();
                } else if (inFlight === 0) {
                  resolveAll();
                }
              });
          }

          if (idx >= assetsNeedingFL.length && inFlight === 0) {
            resolveAll();
          }
        };

        tryDispatch();
      });

      await db("assetic_sync_log")
        .where("id", syncLogId)
        .update({
          status: "completed",
          synced_count: enriched + skipped,
          error_count: errors,
          completed_at: new Date(),
        });

      console.log(
        `[AssetSync] FL enrichment complete: ${enriched} enriched, ${skipped} no FL, ${errors} errors`,
      );

      return { enriched, errors, skipped };
    } catch (err) {
      await db("assetic_sync_log")
        .where("id", syncLogId)
        .update({
          status: "failed",
          error_message: (err as any)?.message || String(err),
          completed_at: new Date(),
        });
      throw err;
    } finally {
      this._running = false;
      this._syncType = null;
      this._progress = null;
    }
  }

  // ═══════════════════════════════════════════════════════════
  // FL SYNC — pull all functional locations for hierarchy
  // ═══════════════════════════════════════════════════════════

  /**
   * Fetch all functional locations from /functionallocations and store them.
   * Then try to discover parent-child relationships via nested endpoint.
   */
  async syncFunctionalLocations(): Promise<{
    synced: number;
    parentsFound: number;
  }> {
    if (this._running) {
      throw new Error("A sync operation is already running");
    }

    this._running = true;
    this._syncType = "functional_locations";
    this._progress = 0;
    this._syncedCount = 0;

    const [logId] = await db("assetic_sync_log")
      .insert({
        sync_type: "functional_locations",
        status: "running",
        started_at: new Date(),
      })
      .returning("id");
    const syncLogId = typeof logId === "object" ? logId.id : logId;

    try {
      // Fetch all FLs
      const pageSize = 500;
      let page = 1;
      let allRows: any[] = [];

      while (page <= 500) {
        const resp = await asseticClient.getFunctionalLocations({
          page,
          pageSize,
        });
        const rows = this.extractRows(resp);
        if (rows.length === 0) break;
        allRows = allRows.concat(rows);
        if (rows.length < pageSize) break;
        page++;
      }

      this._totalCount = allRows.length;
      console.log(
        `[AssetSync] FL sync: fetched ${allRows.length} functional locations`,
      );

      let synced = 0;
      for (const fl of allRows) {
        const guid = fl.Id || fl.id || fl.Guid || "";
        if (!guid) continue;

        const flId = fl.FunctionalLocationId || fl.functionalLocationId || null;
        const flName =
          fl.FunctionalLocationName || fl.functionalLocationName || null;
        const flType =
          fl.FunctionalLocationType || fl.functionalLocationType || null;
        const flTypeId =
          fl.FunctionalLocationTypeId || fl.functionalLocationTypeId || null;

        const exists = await db("assetic_functional_locations")
          .where("fl_guid", guid)
          .first();

        if (exists) {
          await db("assetic_functional_locations")
            .where("fl_guid", guid)
            .update({
              fl_id: flId,
              fl_name: flName,
              fl_type: flType,
              fl_type_id: flTypeId,
              fl_data: JSON.stringify(fl),
              synced_at: new Date(),
            });
        } else {
          await db("assetic_functional_locations").insert({
            fl_guid: guid,
            fl_id: flId,
            fl_name: flName,
            fl_type: flType,
            fl_type_id: flTypeId,
            fl_data: JSON.stringify(fl),
            synced_at: new Date(),
          });
        }
        synced++;
        this._syncedCount = synced;
      }

      // Try to discover parent-child relationships by probing region children
      let parentsFound = 0;
      const regions = await db("assetic_functional_locations").where(
        "fl_type",
        "like",
        "%Region%",
      );

      for (const region of regions) {
        try {
          const children = await asseticClient.getChildFunctionalLocations(
            region.fl_guid,
            { pageSize: 500 },
          );
          if (children) {
            const childRows = this.extractRows(children);
            for (const child of childRows) {
              const childGuid = child.Id || child.id || "";
              if (childGuid) {
                await db("assetic_functional_locations")
                  .where("fl_guid", childGuid)
                  .update({ parent_fl_guid: region.fl_guid });
                parentsFound++;
              }
            }
          }
        } catch {
          // Nested endpoint may not be available — that's fine
        }
      }

      // If nested endpoint worked for regions, do sites → buildings too
      if (parentsFound > 0) {
        const sites = await db("assetic_functional_locations")
          .where("fl_type", "like", "%Site%")
          .orWhere("fl_type", "like", "%Precinct%");

        for (const site of sites) {
          try {
            const children = await asseticClient.getChildFunctionalLocations(
              site.fl_guid,
              { pageSize: 500 },
            );
            if (children) {
              const childRows = this.extractRows(children);
              for (const child of childRows) {
                const childGuid = child.Id || child.id || "";
                if (childGuid) {
                  await db("assetic_functional_locations")
                    .where("fl_guid", childGuid)
                    .update({ parent_fl_guid: site.fl_guid });
                  parentsFound++;
                }
              }
            }
          } catch {
            break; // Stop if endpoint not available
          }
        }
      }

      await db("assetic_sync_log").where("id", syncLogId).update({
        status: "completed",
        synced_count: synced,
        total_count: allRows.length,
        completed_at: new Date(),
      });

      console.log(
        `[AssetSync] FL sync complete: ${synced} FLs stored, ${parentsFound} parent relationships found`,
      );

      return { synced, parentsFound };
    } catch (err) {
      await db("assetic_sync_log")
        .where("id", syncLogId)
        .update({
          status: "failed",
          error_message: (err as any)?.message || String(err),
          completed_at: new Date(),
        });
      throw err;
    } finally {
      this._running = false;
      this._syncType = null;
      this._progress = null;
    }
  }

  // ═══════════════════════════════════════════════════════════
  // FULL SYNC PIPELINE
  // ═══════════════════════════════════════════════════════════

  /**
   * Run the full sync pipeline:
   * 1. Sync all FLs from /functionallocations
   * 2. Sync all assets from /assets
   * 3. Enrich each asset with its FL relationship
   */
  async runFullSync(): Promise<{
    assets: { synced: number; errors: number };
    fls: { synced: number; parentsFound: number };
    enrichment: { enriched: number; errors: number; skipped: number };
  }> {
    console.log("[AssetSync] Starting full sync pipeline…");

    // Step 1: Sync FLs
    const fls = await this.syncFunctionalLocations();

    // Step 2: Sync assets
    const assets = await this.syncAssets();

    // Step 3: Enrich with FL per asset
    const flEnabled = await settingsService.getBool(
      "assetic_fl_enrichment_enabled",
      true,
    );
    let enrichment = { enriched: 0, errors: 0, skipped: 0 };
    if (flEnabled) {
      enrichment = await this.enrichFunctionalLocations();
    }

    // Step 4: Rebuild hierarchy from the updated DB data
    try {
      await asseticLocationHierarchyService.getOrRefresh();
      console.log("[AssetSync] Hierarchy rebuilt from updated DB data.");
    } catch (err) {
      console.error(
        "[AssetSync] Hierarchy rebuild failed:",
        (err as any)?.message,
      );
    }

    console.log("[AssetSync] Full sync pipeline complete.");
    return { assets, fls, enrichment };
  }

  // ═══════════════════════════════════════════════════════════
  // HOURLY POLL
  // ═══════════════════════════════════════════════════════════

  /**
   * Check if the API asset count differs from DB and trigger sync if needed.
   */
  async checkAndSync(): Promise<boolean> {
    try {
      const enabled = await settingsService.getBool(
        "assetic_asset_sync_enabled",
        false,
      );
      if (!enabled) return false;

      const asseticEnabled = await settingsService.getBool(
        "assetic_sync_enabled",
        false,
      );
      if (!asseticEnabled) return false;

      if (this._running) {
        console.log("[AssetSync] Sync already running, skipping check.");
        return false;
      }

      const apiCount = await this.getApiAssetCount();
      const dbCount = await this.getDbAssetCount();

      console.log(`[AssetSync] Count check: API=${apiCount}, DB=${dbCount}`);

      if (apiCount !== dbCount) {
        console.log(
          `[AssetSync] Count mismatch (API: ${apiCount}, DB: ${dbCount}). Starting sync…`,
        );
        // Run in background — don't block the timer
        this.runFullSync().catch((err) => {
          console.error("[AssetSync] Background sync failed:", err);
        });
        return true;
      }

      // Even if counts match, check if FL enrichment is needed
      const unenriched = await db("assetic_assets")
        .leftJoin(
          "assetic_asset_functional_locations",
          "assetic_assets.assetic_guid",
          "assetic_asset_functional_locations.asset_guid",
        )
        .whereNull("assetic_asset_functional_locations.id")
        .count("assetic_assets.id as count")
        .first();

      const unenrichedCount = Number(unenriched?.count ?? 0);
      if (unenrichedCount > 0) {
        console.log(
          `[AssetSync] ${unenrichedCount} assets need FL enrichment. Starting…`,
        );
        this.enrichFunctionalLocations().catch((err) => {
          console.error("[AssetSync] Background FL enrichment failed:", err);
        });
        return true;
      }

      return false;
    } catch (err) {
      console.error("[AssetSync] Check and sync error:", err);
      return false;
    }
  }

  /**
   * Start the periodic polling timer.
   */
  async startPolling(): Promise<void> {
    if (this._pollTimer) return;

    // Clean up stale "running" sync logs from interrupted runs
    try {
      await db("assetic_sync_log")
        .where("status", "running")
        .update({ status: "interrupted", completed_at: new Date() });
    } catch {
      // table may not exist yet
    }

    const intervalMin = parseInt(
      await settingsService.get("assetic_sync_interval_minutes", "60"),
      10,
    );
    const intervalMs = Math.max(intervalMin, 1) * 60 * 1000;

    console.log(`[AssetSync] Starting polling every ${intervalMin} minute(s)`);

    this._pollTimer = setInterval(() => {
      this.checkAndSync().catch((err) => {
        console.error("[AssetSync] Poll check failed:", err);
      });
    }, intervalMs);

    // Also run an initial check after a short delay
    setTimeout(() => {
      this.checkAndSync().catch((err) => {
        console.error("[AssetSync] Initial check failed:", err);
      });
    }, 15_000);
  }

  stopPolling(): void {
    if (this._pollTimer) {
      clearInterval(this._pollTimer);
      this._pollTimer = null;
      console.log("[AssetSync] Polling stopped");
    }
  }

  // ═══════════════════════════════════════════════════════════
  // HELPERS
  // ═══════════════════════════════════════════════════════════

  private extractRows(resp: any): any[] {
    if (!resp) return [];
    if (Array.isArray(resp)) return resp;
    if (Array.isArray(resp.ResourceList)) return resp.ResourceList;
    if (Array.isArray(resp.Data?.ResourceList)) return resp.Data.ResourceList;
    if (Array.isArray(resp.Data)) return resp.Data;
    return [];
  }
}

const asseticAssetSyncService = new AsseticAssetSyncService();
export default asseticAssetSyncService;
