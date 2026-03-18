import * as fs from "fs";
import * as path from "path";
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
      let totalSkipped = 0;
      let totalInserted = 0;
      let totalQueued = 0; // Assets that were genuinely new (not pre-existing) and queued for insert
      // Failed inserts are collected here and retried after the main loop
      const retryInserts: Array<{ guid: string; row: any }> = [];
      const maxPages = 500; // Safety cap

      // Load all existing GUIDs once to avoid per-row SELECT in the loop
      const existingGuids = new Set<string>(
        (await db("assetic_assets").select("assetic_guid")).map(
          (r: any) => r.assetic_guid as string,
        ),
      );
      const preExistingCount = existingGuids.size;
      console.log(
        `[AssetSync] Pre-existing assets in DB: ${preExistingCount}. API total: ${apiTotal}. Delta: ${apiTotal - preExistingCount}.`,
      );

      let consecutiveErrors = 0;
      const MAX_CONSECUTIVE_ERRORS = 3;

      while (page <= maxPages) {
        let rows: any[] = [];
        try {
          const resp = await asseticClient.getAssets({ page, pageSize });
          rows = this.extractRows(resp);
          consecutiveErrors = 0; // reset on success
        } catch (err) {
          consecutiveErrors++;
          console.error(
            `[AssetSync] Failed to fetch page ${page} (attempt ${consecutiveErrors}/${MAX_CONSECUTIVE_ERRORS}):`,
            (err as any)?.message,
          );
          totalErrors++;
          if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
            console.error(
              `[AssetSync] ${MAX_CONSECUTIVE_ERRORS} consecutive page failures — stopping pagination.`,
            );
            break;
          }
          // Wait 5s then retry the same page
          await new Promise((r) => setTimeout(r, 5000));
          continue;
        }

        if (rows.length === 0) break;

        const now = new Date();
        const toInsert: any[] = [];
        const toInsertGuids: string[] = [];

        for (const asset of rows) {
          try {
            const guid = asset.Id || asset.id || asset.Guid || asset.guid || "";
            if (!guid) continue;

            // Only insert assets not already in DB.
            // Existing assets are left as-is on routine syncs to avoid
            // the heavy write load of updating 64k rows with large JSON blobs.
            if (existingGuids.has(guid)) {
              totalSkipped++;
              totalSynced++; // count as processed
              continue;
            }

            const row = {
              assetic_guid: guid,
              asset_id: asset.AssetId || asset.assetId || asset.AssetCode || "",
              asset_name:
                asset.AssetName || asset.assetName || asset.Name || "",
              asset_status:
                asset.AssetStatusName ||
                asset.AssetStatus ||
                asset.Status ||
                "",
              asset_type: asset.AssetTypeName || asset.AssetType || "",
              asset_class: asset.AssetClassName || asset.AssetClass || "",
              asset_category:
                asset.AssetCategoryName || asset.AssetCategory || "",
              data: JSON.stringify(asset),
              synced_at: now,
              updated_at: now,
              created_at: now,
            };
            toInsert.push(row);
            toInsertGuids.push(guid);
            totalQueued++;
          } catch {
            totalErrors++;
          }
        }

        // Batch INSERT new assets (100 at a time)
        const INSERT_BATCH = 100;
        let insertedThisPage = 0;
        for (let i = 0; i < toInsert.length; i += INSERT_BATCH) {
          const batchEnd = Math.min(i + INSERT_BATCH, toInsert.length);
          try {
            await db("assetic_assets").insert(toInsert.slice(i, batchEnd));
            // Mark successfully inserted GUIDs so they're skipped on future pages/syncs
            for (let j = i; j < batchEnd; j++) {
              existingGuids.add(toInsertGuids[j]);
            }
            insertedThisPage += batchEnd - i;
          } catch (err) {
            // Try inserting individually to salvage as many as possible
            for (let j = i; j < batchEnd; j++) {
              try {
                await db("assetic_assets").insert(toInsert[j]);
                existingGuids.add(toInsertGuids[j]);
                insertedThisPage++;
              } catch {
                // Queue for retry after main loop rather than counting as permanent error
                retryInserts.push({ guid: toInsertGuids[j], row: toInsert[j] });
              }
            }
          }
        }

        totalInserted += insertedThisPage;
        totalSynced += insertedThisPage;
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

        const skippedThisPage = rows.length - toInsert.length;
        const droppedThisPage = toInsert.length - insertedThisPage;
        console.log(
          `[AssetSync] Page ${page}: ${rows.length} fetched, ${insertedThisPage} inserted, ${skippedThisPage} already-exist` +
            `${droppedThisPage > 0 ? `, ${droppedThisPage} queued-for-retry` : ""}, ${totalErrors} errors (${totalSynced} processed, ${this._progress}%)`,
        );

        // Log if a page returned no GUID (data quality issue)
        const noGuidCount = rows.filter(
          (a: any) => !(a.Id || a.id || a.Guid || a.guid),
        ).length;
        if (noGuidCount > 0) {
          console.warn(
            `[AssetSync] Page ${page}: ${noGuidCount} assets had no GUID and were skipped entirely`,
          );
        }

        // Only stop on truly empty response. A short page mid-sequence (API
        // hiccup returning <500 rows) must NOT break early — assets on later
        // pages would be silently missed and counted as "synced" via skips.
        if (rows.length === 0) {
          console.log(`[AssetSync] Page ${page}: empty — stopping pagination.`);
          break;
        }
        page++;
      }

      // ── Retry pass: re-attempt inserts that failed during main loop ─────
      if (retryInserts.length > 0) {
        console.log(
          `[AssetSync] Retrying ${retryInserts.length} failed inserts...`,
        );
        let retrySuccess = 0;
        for (const { guid, row } of retryInserts) {
          if (existingGuids.has(guid)) {
            totalSkipped++;
            continue;
          } // inserted by a later page
          try {
            await db("assetic_assets").insert(row);
            existingGuids.add(guid);
            totalInserted++;
            totalSynced++;
            retrySuccess++;
          } catch {
            totalErrors++;
          }
        }
        console.log(
          `[AssetSync] Retry pass: ${retrySuccess}/${retryInserts.length} recovered, ${retryInserts.length - retrySuccess} permanent failures.`,
        );
      }

      await db("assetic_sync_log").where("id", syncLogId).update({
        status: "completed",
        synced_count: totalSynced,
        error_count: totalErrors,
        completed_at: new Date(),
      });

      const finalDbCount = await this.getDbAssetCount();
      const apiDuplicates = totalQueued - totalInserted - totalErrors;
      console.log(
        `[AssetSync] Asset sync complete: ${totalInserted} newly inserted, ${totalSkipped} already existed, ${totalErrors} permanent errors. ` +
          `DB before: ${preExistingCount}, DB after: ${finalDbCount}, API reported: ${apiTotal}. ` +
          `Queued-for-insert: ${totalQueued}, API duplicates across pages: ${apiDuplicates >= 0 ? apiDuplicates : "unknown"}.` +
          `${apiTotal - finalDbCount > 0 ? ` GAP: ${apiTotal - finalDbCount} assets not in DB.` : " DB matches API count."}`,
      );
      if (totalErrors > 0) {
        console.warn(
          `[AssetSync] ${totalErrors} assets could not be inserted after retries — likely data/constraint issues.`,
        );
      }
      if (apiDuplicates > 50) {
        console.log(
          `[AssetSync] API returned ${apiDuplicates} duplicate GUIDs across pages — this is normal Assetic pagination behaviour and does not represent missing data.`,
        );
      }

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
      let noFlCount = 0;
      let notFoundCount = 0;
      let loggedFirstFl = false;
      const errorSamples = new Set<string>();

      // Determine concurrency from configured worker count
      const poolStatus = asseticClient.getRateLimitStatus();
      const concurrency = Math.max(1, poolStatus.totalWorkers);
      console.log(
        `[AssetSync] FL enrichment: using ${concurrency} concurrent workers`,
      );

      // ── Batch DB writer ───────────────────────────────────────────────────
      // API fetches run concurrently but DB writes are batched and serialised
      // to avoid overwhelming the DB connection pool with thousands of
      // simultaneous single-row INSERTs.
      const DB_BATCH_SIZE = 100;
      type AflRow = {
        asset_guid: string;
        fl_guid: string | null;
        fl_id: string | null;
        fl_name: string | null;
        fl_type: string | null;
        fl_type_id: string | null;
        parent_fl_guid: string | null;
        fl_data: string | null;
        synced_at: Date;
      };
      const writeBatch: AflRow[] = [];
      let dbWriteInFlight = false;
      const dbWriteQueue: Array<() => void> = [];

      const runNextDbWrite = () => {
        if (dbWriteInFlight || dbWriteQueue.length === 0) return;
        dbWriteInFlight = true;
        const next = dbWriteQueue.shift()!;
        next();
      };

      const flushBatch = (force = false): Promise<void> => {
        if (writeBatch.length === 0) return Promise.resolve();
        if (!force && writeBatch.length < DB_BATCH_SIZE)
          return Promise.resolve();
        const rows = writeBatch.splice(0, writeBatch.length);
        return new Promise<void>((resolve) => {
          dbWriteQueue.push(async () => {
            try {
              await db("assetic_asset_functional_locations").insert(rows);
            } catch {
              // Batch failed — write rows individually to salvage as many as possible
              for (const row of rows) {
                try {
                  await db("assetic_asset_functional_locations").insert(row);
                } catch {
                  // duplicate or constraint — ignore
                }
              }
            } finally {
              dbWriteInFlight = false;
              resolve();
              runNextDbWrite();
            }
          });
          runNextDbWrite();
        });
      };

      // Process a single asset's FL enrichment — API call only, no direct DB writes
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
            noFlCount++;
            writeBatch.push({
              asset_guid: guid,
              fl_guid: null,
              fl_id: null,
              fl_name: null,
              fl_type: null,
              fl_type_id: null,
              parent_fl_guid: null,
              fl_data: null,
              synced_at: new Date(),
            });
            await flushBatch();
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

          writeBatch.push({
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
          await flushBatch();
          return "enriched";
        } catch (err: any) {
          if (err?.response?.status === 404) {
            notFoundCount++;
            writeBatch.push({
              asset_guid: guid,
              fl_guid: null,
              fl_id: null,
              fl_name: null,
              fl_type: null,
              fl_type_id: null,
              parent_fl_guid: null,
              fl_data: null,
              synced_at: new Date(),
            });
            await flushBatch();
            return "skipped";
          }
          // Log first few unique error messages for diagnosis
          const errMsg =
            err?.message || err?.response?.statusText || String(err);
          if (errorSamples.size < 5) {
            errorSamples.add(
              `[${err?.response?.status || "unknown"}] ${errMsg}`,
            );
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

      // Flush any remaining rows that didn't fill a full batch
      await flushBatch(true);

      await db("assetic_sync_log")
        .where("id", syncLogId)
        .update({
          status: "completed",
          synced_count: enriched + skipped,
          error_count: errors,
          completed_at: new Date(),
        });

      console.log(
        `[AssetSync] FL enrichment complete: ${enriched} enriched, ${skipped} skipped (${noFlCount} no FL data, ${notFoundCount} 404 not found), ${errors} errors`,
      );
      if (errorSamples.size > 0) {
        console.warn(
          `[AssetSync] FL enrichment error samples:\n` +
            [...errorSamples].map((e) => `  - ${e}`).join("\n"),
        );
      }
      if (noFlCount > 100) {
        console.warn(
          `[AssetSync] ${noFlCount} assets returned no functional location — these assets won't appear in the hierarchy tree.`,
        );
      }

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
        page++;
      }

      this._totalCount = allRows.length;
      console.log(
        `[AssetSync] FL sync: fetched ${allRows.length} functional locations across ${page - 1} page(s)`,
      );
      if (page > 500) {
        console.warn(
          `[AssetSync] FL sync hit 500-page cap — some functional locations may be missing. Consider increasing page size.`,
        );
      }

      // Load existing FL GUIDs in one query to avoid N individual SELECTs
      const existingGuids = new Set<string>(
        (await db("assetic_functional_locations").select("fl_guid")).map(
          (r: any) => r.fl_guid as string,
        ),
      );

      const now = new Date();
      const toInsert: any[] = [];
      const toUpdate: any[] = [];

      for (const fl of allRows) {
        const guid = fl.Id || fl.id || fl.Guid || "";
        if (!guid) continue;

        const row = {
          fl_guid: guid,
          fl_id: fl.FunctionalLocationId || fl.functionalLocationId || null,
          fl_name:
            fl.FunctionalLocationName || fl.functionalLocationName || null,
          fl_type:
            fl.FunctionalLocationType || fl.functionalLocationType || null,
          fl_type_id:
            fl.FunctionalLocationTypeId || fl.functionalLocationTypeId || null,
          fl_data: JSON.stringify(fl),
          synced_at: now,
        };

        if (existingGuids.has(guid)) {
          toUpdate.push(row);
        } else {
          toInsert.push(row);
        }
      }

      // Batch INSERT new records (100 at a time)
      const INSERT_BATCH = 100;
      for (let i = 0; i < toInsert.length; i += INSERT_BATCH) {
        await db("assetic_functional_locations").insert(
          toInsert.slice(i, i + INSERT_BATCH),
        );
      }

      // Batch UPDATE existing records (20 concurrent)
      const UPDATE_CONCURRENCY = 20;
      for (let i = 0; i < toUpdate.length; i += UPDATE_CONCURRENCY) {
        await Promise.all(
          toUpdate.slice(i, i + UPDATE_CONCURRENCY).map((row) =>
            db("assetic_functional_locations")
              .where("fl_guid", row.fl_guid)
              .update({
                fl_id: row.fl_id,
                fl_name: row.fl_name,
                fl_type: row.fl_type,
                fl_type_id: row.fl_type_id,
                fl_data: row.fl_data,
                synced_at: row.synced_at,
              }),
          ),
        );
      }

      const synced = toInsert.length + toUpdate.length;
      this._syncedCount = synced;

      // Try to discover parent-child relationships by probing region children
      let parentsFound = 0;
      const regions = await db("assetic_functional_locations").where(
        "fl_type",
        "like",
        "%Region%",
      );
      console.log(
        `[AssetSync] FL sync: found ${regions.length} Region-type FLs. Probing nested children endpoint...`,
      );

      const upsertFlChild = async (
        child: any,
        parentGuid: string,
      ): Promise<void> => {
        const childGuid = child.Id || child.id || child.Guid || "";
        if (!childGuid) return;
        const childRow = {
          fl_guid: childGuid,
          fl_id:
            child.FunctionalLocationId || child.functionalLocationId || null,
          fl_name:
            child.FunctionalLocationName ||
            child.functionalLocationName ||
            null,
          fl_type:
            child.FunctionalLocationType ||
            child.functionalLocationType ||
            null,
          fl_type_id:
            child.FunctionalLocationTypeId ||
            child.functionalLocationTypeId ||
            null,
          parent_fl_guid: parentGuid,
          fl_data: JSON.stringify(child),
          synced_at: now,
        };
        if (!existingGuids.has(childGuid)) {
          try {
            await db("assetic_functional_locations").insert(childRow);
            existingGuids.add(childGuid);
          } catch {
            // Race or duplicate — fall back to update
            await db("assetic_functional_locations")
              .where("fl_guid", childGuid)
              .update({ parent_fl_guid: parentGuid });
          }
        } else {
          await db("assetic_functional_locations")
            .where("fl_guid", childGuid)
            .update({
              parent_fl_guid: parentGuid,
              fl_name: childRow.fl_name,
              fl_type: childRow.fl_type,
              fl_data: childRow.fl_data,
              synced_at: now,
            });
        }
      };

      for (const region of regions) {
        try {
          const children = await asseticClient.getChildFunctionalLocations(
            region.fl_guid,
            { pageSize: 500 },
          );
          if (children) {
            const childRows = this.extractRows(children);
            const newCount = childRows.filter(
              (c: any) => !existingGuids.has(c.Id || c.id || ""),
            ).length;
            console.log(
              `[AssetSync] Region "${region.fl_name}": ${childRows.length} children (${newCount} new Site FLs to insert)`,
            );
            for (const child of childRows) {
              await upsertFlChild(child, region.fl_guid);
              parentsFound++;
            }
          } else {
            console.log(
              `[AssetSync] Region "${region.fl_name}": nested endpoint returned null (not available)`,
            );
          }
        } catch (err) {
          console.log(
            `[AssetSync] Region "${region.fl_name}": nested children probe failed: ${(err as any)?.message || err}`,
          );
        }
      }

      // If nested endpoint worked for regions, do sites → buildings too
      if (parentsFound > 0) {
        const sites = await db("assetic_functional_locations")
          .where("fl_type", "like", "%Site%")
          .orWhere("fl_type", "like", "%Precinct%");

        console.log(
          `[AssetSync] FL sync: probing ${sites.length} Site FLs for building children...`,
        );
        let siteChildErrors = 0;
        for (const site of sites) {
          try {
            const children = await asseticClient.getChildFunctionalLocations(
              site.fl_guid,
              { pageSize: 500 },
            );
            if (children) {
              const childRows = this.extractRows(children);
              if (childRows.length > 0) {
                console.log(
                  `[AssetSync] Site "${site.fl_name}": ${childRows.length} building children`,
                );
              }
              for (const child of childRows) {
                await upsertFlChild(child, site.fl_guid);
                parentsFound++;
              }
            }
          } catch (err) {
            siteChildErrors++;
            if (siteChildErrors === 1) {
              console.warn(
                `[AssetSync] Site nested endpoint failed for "${site.fl_name}": ${(err as any)?.message || err}. Building→Site links will rely on syncRegionAssignments fallback.`,
              );
            }
          }
        }
        if (siteChildErrors > 1) {
          console.warn(
            `[AssetSync] ${siteChildErrors} sites failed nested children probe.`,
          );
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

    // Step 3.5: Assign parents to FLs using local data only (no API calls).
    // a) Regions → Sites/Buildings via AssetWorkGroup prefix + NAN suffix
    // b) Buildings → Floors via ExternalIdentifier prefix matching
    try {
      const regionAssigned = await this.syncRegionAssignments();
      console.log(
        `[AssetSync] Region assignment: ${regionAssigned} FLs updated.`,
      );
    } catch (err) {
      console.error(
        "[AssetSync] Region assignment failed:",
        (err as any)?.message,
      );
    }
    try {
      const floorsAssigned = await this.syncFloorAssignments();
      console.log(
        `[AssetSync] Floor assignment: ${floorsAssigned} floors/structures assigned.`,
      );
    } catch (err) {
      console.error(
        "[AssetSync] Floor assignment failed:",
        (err as any)?.message,
      );
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
  // FLOOR ASSIGNMENT (ExternalIdentifier prefix matching)
  // ═══════════════════════════════════════════════════════════

  /**
   * Assign parent_fl_guid for Floor FLs by matching their ExternalIdentifier
   * prefix to Building FLs.
   *
   * The Assetic ExternalIdentifier format is:
   *   Floor:    "0888-01"  (zero-padded building number + "-" + floor sequence)
   *   Building: "888-BuildingName"  (numeric prefix + "-" + name)
   *
   * We strip leading zeros from the floor prefix and match against the
   * building numeric prefix to find the parent building.
   *
   * This approach requires NO CSV files and NO external API calls beyond
   * the regular FL sync that already stores fl_data.
   */
  async syncFloorAssignments(): Promise<number> {
    // Load all Building FLs that have an ExternalIdentifier
    const buildingFLs = await db("assetic_functional_locations")
      .where("fl_type", "Building")
      .whereNotNull("fl_data")
      .select("fl_guid", "fl_name", "fl_data");

    // Build numeric-prefix → guid map for buildings
    // ExternalIdentifier like "888-BuildingName" → prefix "888"
    const buildingByPrefix = new Map<string, string>();
    for (const b of buildingFLs) {
      try {
        const data =
          typeof b.fl_data === "string" ? JSON.parse(b.fl_data) : b.fl_data;
        const extId: string = data?.ExternalIdentifier || "";
        const dashIdx = extId.indexOf("-");
        if (dashIdx > 0) {
          const prefix = String(parseInt(extId.substring(0, dashIdx), 10)); // strip leading zeros
          if (!buildingByPrefix.has(prefix)) {
            buildingByPrefix.set(prefix, b.fl_guid);
          }
        }
      } catch {
        // skip unparseable fl_data
      }
    }

    if (buildingByPrefix.size === 0) {
      console.log(
        "[AssetSync] Floor assignment: no building ExternalIdentifiers found.",
      );
      return 0;
    }

    // Load all Floor/Structure FLs without a parent
    const floorFLs = await db("assetic_functional_locations")
      .whereIn("fl_type", ["Floor", "Structure"])
      .whereNull("parent_fl_guid")
      .whereNotNull("fl_data")
      .select("fl_guid", "fl_data");

    const updates: Array<{ flGuid: string; parentGuid: string }> = [];
    for (const f of floorFLs) {
      try {
        const data =
          typeof f.fl_data === "string" ? JSON.parse(f.fl_data) : f.fl_data;
        const extId: string = data?.ExternalIdentifier || "";
        const dashIdx = extId.indexOf("-");
        if (dashIdx > 0) {
          const prefix = String(parseInt(extId.substring(0, dashIdx), 10));
          const buildingGuid = buildingByPrefix.get(prefix);
          if (buildingGuid) {
            updates.push({ flGuid: f.fl_guid, parentGuid: buildingGuid });
          }
        }
      } catch {
        // skip
      }
    }

    if (updates.length === 0) {
      console.log(
        "[AssetSync] Floor assignment: no floor→building matches found.",
      );
      return 0;
    }

    // Batch update in chunks of 200
    const CHUNK = 200;
    let updated = 0;
    for (let i = 0; i < updates.length; i += CHUNK) {
      const chunk = updates.slice(i, i + CHUNK);
      await Promise.all(
        chunk.map(({ flGuid, parentGuid }) =>
          db("assetic_functional_locations")
            .where("fl_guid", flGuid)
            .update({ parent_fl_guid: parentGuid }),
        ),
      );
      updated += chunk.length;
    }

    console.log(
      `[AssetSync] Floor assignment complete: ${updated} floors/structures assigned to buildings.`,
    );
    return updated;
  }

  // ═══════════════════════════════════════════════════════════
  // REGION ASSIGNMENT
  // ═══════════════════════════════════════════════════════════

  /**
   * Infer and store Region-level parent_fl_guid for functional locations that
   * have no parent set yet, using the AssetWorkGroup field on linked assets.
   *
   * Assetic encodes region in AssetWorkGroup as "<Region> - <workgroup>".
   * e.g. "South - Mechanical" → Region FL named "South".
   *
   * This compensates for Assetic instances where the nested FL endpoint
   * (GET /functionallocations/{id}/functionallocations) is unavailable.
   */
  async syncRegionAssignments(): Promise<number> {
    const regions = await db("assetic_functional_locations").where(
      "fl_type",
      "Region",
    );
    if (regions.length === 0) {
      console.log(
        "[AssetSync] No Region FLs found, skipping region assignment.",
      );
      return 0;
    }

    // Build region name → guid map (first match wins for duplicates)
    const regionByName = new Map<string, string>();
    for (const r of regions) {
      const name = (r.fl_name || "").trim();
      if (name && !regionByName.has(name)) {
        regionByName.set(name, r.fl_guid);
      }
    }

    // For each FL, count linked assets grouped by extracted region prefix.
    // AssetWorkGroup format: "<RegionName> - <workgroup>" where CHARINDEX
    // finds the position of the first " - " separator.
    const rawResult: any = await db.raw(`
      SELECT
        afl.fl_guid,
        LEFT(
          JSON_VALUE(a.data, '$.AssetWorkGroup'),
          CHARINDEX(' - ', JSON_VALUE(a.data, '$.AssetWorkGroup')) - 1
        ) AS region_prefix,
        COUNT(*) AS cnt
      FROM assetic_asset_functional_locations afl
      INNER JOIN assetic_assets a ON afl.asset_guid = a.assetic_guid
      WHERE afl.fl_guid IS NOT NULL
        AND JSON_VALUE(a.data, '$.AssetWorkGroup') LIKE '% - %'
        AND CHARINDEX(' - ', JSON_VALUE(a.data, '$.AssetWorkGroup')) > 1
      GROUP BY
        afl.fl_guid,
        LEFT(
          JSON_VALUE(a.data, '$.AssetWorkGroup'),
          CHARINDEX(' - ', JSON_VALUE(a.data, '$.AssetWorkGroup')) - 1
        )
    `);

    const rawRows: Array<{
      fl_guid: string;
      region_prefix: string;
      cnt: number;
    }> = Array.isArray(rawResult)
      ? rawResult
      : Array.isArray(rawResult?.[0])
        ? rawResult[0]
        : [];

    if (rawRows.length === 0) {
      console.log(
        "[AssetSync] Region assignment: no asset work group data found.",
      );
      return 0;
    }

    // Determine dominant region prefix per FL (highest count wins)
    const flBest = new Map<string, { prefix: string; cnt: number }>();
    for (const row of rawRows) {
      const existing = flBest.get(row.fl_guid);
      if (!existing || Number(row.cnt) > existing.cnt) {
        flBest.set(row.fl_guid, {
          prefix: row.region_prefix,
          cnt: Number(row.cnt),
        });
      }
    }

    // Map FL GUIDs → inferred region GUID
    const updates: Array<{ flGuid: string; parentGuid: string }> = [];
    for (const [flGuid, { prefix }] of flBest) {
      const regionGuid = regionByName.get((prefix || "").trim());
      if (regionGuid) {
        updates.push({ flGuid, parentGuid: regionGuid });
      }
    }

    if (updates.length === 0) {
      console.log(
        "[AssetSync] Region assignment: no FL→region mappings resolved.",
      );
      return 0;
    }

    // Filter out FLs that already have a parent set (e.g. correctly linked
    // to a Site by the nested endpoint probing). Only assign to FLs that are
    // truly orphaned (parent_fl_guid IS NULL).
    const orphanGuids = new Set<string>(
      (
        await db("assetic_functional_locations")
          .whereIn(
            "fl_guid",
            updates.map((u) => u.flGuid),
          )
          .whereNull("parent_fl_guid")
          .where("fl_type", "!=", "Region")
          .select("fl_guid")
      ).map((r: any) => r.fl_guid as string),
    );

    const orphanUpdates = updates.filter((u) => orphanGuids.has(u.flGuid));
    console.log(
      `[AssetSync] Region assignment Pass 1: ${updates.length} candidates, ${orphanUpdates.length} orphans to assign (${updates.length - orphanUpdates.length} already have a parent — skipped).`,
    );

    // Batch-update parent_fl_guid in chunks of 200
    let updated = 0;
    const CHUNK = 200;
    for (let i = 0; i < orphanUpdates.length; i += CHUNK) {
      const chunk = orphanUpdates.slice(i, i + CHUNK);
      await Promise.all(
        chunk.map(({ flGuid, parentGuid }) =>
          db("assetic_functional_locations")
            .where("fl_guid", flGuid)
            .whereNull("parent_fl_guid")
            .where("fl_type", "!=", "Region")
            .update({ parent_fl_guid: parentGuid }),
        ),
      );
      updated += chunk.length;
    }

    // ── Pass 1B: Fix orphaned Site FLs using flParentMap.json ──────────────
    // The flParentMap.json (CSV-derived) maps fl_id → parent fl_id for every
    // FL in the hierarchy. We use this to set parent_fl_guid on Site FLs that
    // have no parent yet (the asset-workgroup approach fails because assets
    // linked to Site-parented buildings don't carry AssetWorkGroup data).
    {
      const mapCandidates = [
        path.join(__dirname, "..", "data", "flParentMap.json"),
        path.join(__dirname, "data", "flParentMap.json"),
        path.join(process.cwd(), "src", "server", "data", "flParentMap.json"),
        path.join(process.cwd(), "dist", "server", "data", "flParentMap.json"),
      ];
      let flParentMap: Record<string, string> = {};
      for (const p of mapCandidates) {
        if (fs.existsSync(p)) {
          flParentMap = JSON.parse(fs.readFileSync(p, "utf8"));
          break;
        }
      }

      if (Object.keys(flParentMap).length > 0) {
        // Load all orphaned Sites and all Regions (by fl_id → guid)
        const orphanedSites = await db("assetic_functional_locations")
          .where("fl_type", "Site")
          .whereNull("parent_fl_guid")
          .whereNot("fl_name", "()")
          .select("fl_guid", "fl_id", "fl_name");

        const regionRows = await db("assetic_functional_locations")
          .where("fl_type", "Region")
          .select("fl_guid", "fl_id");

        const regionByFlId = new Map<string, string>();
        for (const r of regionRows) {
          if (r.fl_id) regionByFlId.set(String(r.fl_id), r.fl_guid);
        }

        const siteUpdates: Array<{ flGuid: string; parentGuid: string }> = [];
        for (const site of orphanedSites) {
          const parentFlId = flParentMap[String(site.fl_id)];
          if (!parentFlId) continue;
          const regionGuid = regionByFlId.get(parentFlId);
          if (regionGuid)
            siteUpdates.push({ flGuid: site.fl_guid, parentGuid: regionGuid });
        }

        console.log(
          `[AssetSync] Region assignment Pass 1B (Sites via flParentMap): ${orphanedSites.length} orphaned Sites, ${siteUpdates.length} resolved`,
        );

        for (let i = 0; i < siteUpdates.length; i += CHUNK) {
          const chunk = siteUpdates.slice(i, i + CHUNK);
          await Promise.all(
            chunk.map(({ flGuid, parentGuid }) =>
              db("assetic_functional_locations")
                .where("fl_guid", flGuid)
                .whereNull("parent_fl_guid")
                .update({ parent_fl_guid: parentGuid }),
            ),
          );
          updated += chunk.length;
        }
      } else {
        console.warn(
          "[AssetSync] flParentMap.json not found — Pass 1B skipped",
        );
      }
    }

    // ── Pass 1C: Fix Building FLs with stale Region parent via flParentMap ─
    // Buildings inserted by the main API endpoint may have parent_fl_guid
    // pointing to a Region (from syncRegionAssignments fallback) when their
    // correct parent is a Site. flParentMap.json (CSV-derived) has the truth.
    {
      const mapCandidates = [
        path.join(__dirname, "..", "data", "flParentMap.json"),
        path.join(__dirname, "data", "flParentMap.json"),
        path.join(process.cwd(), "src", "server", "data", "flParentMap.json"),
        path.join(process.cwd(), "dist", "server", "data", "flParentMap.json"),
      ];
      let flParentMap: Record<string, string> = {};
      for (const p of mapCandidates) {
        if (fs.existsSync(p)) {
          flParentMap = JSON.parse(fs.readFileSync(p, "utf8"));
          break;
        }
      }

      if (Object.keys(flParentMap).length > 0) {
        // Find all Building FLs whose parent is currently a Region (stale)
        const staleBuildings = await db("assetic_functional_locations as b")
          .join(
            "assetic_functional_locations as p",
            "b.parent_fl_guid",
            "p.fl_guid",
          )
          .where("b.fl_type", "Building")
          .where("p.fl_type", "Region")
          .select("b.fl_guid", "b.fl_id", "b.fl_name");

        // Build fl_id → guid map for all Sites in DB
        const siteRows = await db("assetic_functional_locations")
          .where("fl_type", "Site")
          .select("fl_guid", "fl_id");
        const siteByFlId = new Map<string, string>();
        for (const s of siteRows) {
          if (s.fl_id) siteByFlId.set(String(s.fl_id), s.fl_guid);
        }

        const buildingUpdates: Array<{ flGuid: string; parentGuid: string }> =
          [];
        for (const bldg of staleBuildings) {
          const parentFlId = flParentMap[String(bldg.fl_id)];
          if (!parentFlId) continue;
          const siteGuid = siteByFlId.get(parentFlId);
          if (siteGuid)
            buildingUpdates.push({
              flGuid: bldg.fl_guid,
              parentGuid: siteGuid,
            });
        }

        console.log(
          `[AssetSync] Region assignment Pass 1C (Buildings via flParentMap): ${staleBuildings.length} stale-parent Buildings, ${buildingUpdates.length} re-parented to correct Site`,
        );

        for (let i = 0; i < buildingUpdates.length; i += CHUNK) {
          const chunk = buildingUpdates.slice(i, i + CHUNK);
          await Promise.all(
            chunk.map(({ flGuid, parentGuid }) =>
              db("assetic_functional_locations")
                .where("fl_guid", flGuid)
                .update({ parent_fl_guid: parentGuid }),
            ),
          );
          updated += chunk.length;
        }
      }
    }

    // ── Pass 2: asset-name suffix (NAN / NANW / NAS) ───────────────────────
    // For FLs still unassigned after Pass 1, look at linked asset names.
    // PAE "Notional Asset" children carry a region suffix:
    //   NAN  → North   |   NANW → North West   |   NAS → South
    const suffixResult: any = await db.raw(`
      SELECT
        afl.fl_guid,
        CASE
          WHEN JSON_VALUE(a.data, '$.AssetName') LIKE '% NANW' THEN 'North West'
          WHEN JSON_VALUE(a.data, '$.AssetName') LIKE '% NAN'  THEN 'North'
          WHEN JSON_VALUE(a.data, '$.AssetName') LIKE '% NAS'  THEN 'South'
        END AS region_name,
        COUNT(*) AS cnt
      FROM assetic_asset_functional_locations afl
      INNER JOIN assetic_assets a ON afl.asset_guid = a.assetic_guid
      INNER JOIN assetic_functional_locations fl ON fl.fl_guid = afl.fl_guid
      WHERE fl.fl_type != 'Region'
        AND fl.parent_fl_guid IS NULL
        AND (
          JSON_VALUE(a.data, '$.AssetName') LIKE '% NAN'
          OR JSON_VALUE(a.data, '$.AssetName') LIKE '% NANW'
          OR JSON_VALUE(a.data, '$.AssetName') LIKE '% NAS'
        )
      GROUP BY
        afl.fl_guid,
        CASE
          WHEN JSON_VALUE(a.data, '$.AssetName') LIKE '% NANW' THEN 'North West'
          WHEN JSON_VALUE(a.data, '$.AssetName') LIKE '% NAN'  THEN 'North'
          WHEN JSON_VALUE(a.data, '$.AssetName') LIKE '% NAS'  THEN 'South'
        END
    `);

    const suffixRows: Array<{
      fl_guid: string;
      region_name: string;
      cnt: number;
    }> = Array.isArray(suffixResult)
      ? suffixResult
      : Array.isArray(suffixResult?.[0])
        ? suffixResult[0]
        : [];

    if (suffixRows.length > 0) {
      // Determine dominant region name per FL
      const suffixBest = new Map<string, { name: string; cnt: number }>();
      for (const row of suffixRows) {
        if (!row.region_name) continue;
        const existing = suffixBest.get(row.fl_guid);
        if (!existing || Number(row.cnt) > existing.cnt) {
          suffixBest.set(row.fl_guid, {
            name: row.region_name,
            cnt: Number(row.cnt),
          });
        }
      }

      // Build updates using regionByName map (already populated in Pass 1)
      const suffixUpdates: Array<{ flGuid: string; parentGuid: string }> = [];
      for (const [flGuid, { name }] of suffixBest) {
        const regionGuid = regionByName.get(name);
        if (regionGuid) {
          suffixUpdates.push({ flGuid, parentGuid: regionGuid });
        }
      }

      for (let i = 0; i < suffixUpdates.length; i += CHUNK) {
        const chunk = suffixUpdates.slice(i, i + CHUNK);
        await Promise.all(
          chunk.map(({ flGuid, parentGuid }) =>
            db("assetic_functional_locations")
              .where("fl_guid", flGuid)
              .where("fl_type", "!=", "Region")
              .update({ parent_fl_guid: parentGuid }),
          ),
        );
        updated += chunk.length;
      }

      console.log(
        `[AssetSync] Region assignment Pass 2 (NAN/NANW/NAS suffix): ${suffixUpdates.length} additional FLs assigned.`,
      );
    }

    console.log(
      `[AssetSync] Region assignment complete: ${updated} FLs assigned to regions.`,
    );
    return updated;
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
