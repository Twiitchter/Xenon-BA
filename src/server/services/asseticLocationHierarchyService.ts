import * as fs from "fs";
import * as path from "path";
import asseticClient, { AsseticQueryParams } from "./asseticClient";
import { db } from "../database";

// Parent mapping: FunctionalLocationId → parent FunctionalLocationId
// Generated from the Assetic CSV exports which contain FL hierarchy levels.
let flParentMap: Record<string, string> | null = null;
function loadFlParentMap(): Record<string, string> {
  if (flParentMap) return flParentMap;
  try {
    // Try JSON file next to dist/server/data/ or src/server/data/
    const candidates = [
      path.join(__dirname, "..", "data", "flParentMap.json"),
      path.join(__dirname, "data", "flParentMap.json"),
      path.join(process.cwd(), "src", "server", "data", "flParentMap.json"),
      path.join(process.cwd(), "dist", "server", "data", "flParentMap.json"),
    ];
    for (const p of candidates) {
      if (fs.existsSync(p)) {
        flParentMap = JSON.parse(fs.readFileSync(p, "utf8"));
        console.log(
          `[AsseticHierarchy] Loaded FL parent map from ${p}: ${Object.keys(flParentMap!).length} mappings`,
        );
        return flParentMap!;
      }
    }
  } catch (err) {
    console.warn("[AsseticHierarchy] Failed to load FL parent map:", err);
  }
  flParentMap = {};
  return flParentMap;
}

interface HierarchyNode {
  id: string;
  name: string;
  parentId: string | null;
  depth: number;
  rawType?: string;
}

export interface AsseticBuilding {
  id: string;
  name: string;
  siteId: string;
  regionId: string;
  floors: AsseticFloor[];
}

export interface AsseticFloor {
  id: string;
  name: string;
  buildingId: string;
  siteId: string;
  regionId: string;
}

export interface AsseticSite {
  id: string;
  name: string;
  regionId: string;
  buildings: AsseticBuilding[];
}

export interface AsseticRegion {
  id: string;
  name: string;
  sites: AsseticSite[];
}

export interface AsseticLocationHierarchy {
  source: "functionallocations" | "assets";
  generatedAt: string;
  fetchedRecordCount: number;
  pageSize: number;
  pagesFetched: number;
  pageLimit: number;
  isTruncated: boolean;
  reportedTotalCount?: number;
  rawNodeCount: number;
  rawRecordsSampleCount: number;
  rawRecordsSample: any[];
  regions: AsseticRegion[];
}

interface FetchAllPagesResult {
  rows: any[];
  pageSize: number;
  pagesFetched: number;
  pageLimit: number;
  totalCount?: number;
  hitPageLimit: boolean;
}

class AsseticLocationHierarchyService {
  private cache: AsseticLocationHierarchy | null = null;
  private refreshInFlight: Promise<AsseticLocationHierarchy> | null = null;

  getSnapshot(): AsseticLocationHierarchy | null {
    return this.cache;
  }

  clearCache(): void {
    this.cache = null;
  }

  async getOrRefresh(): Promise<AsseticLocationHierarchy> {
    if (this.cache) {
      return this.cache;
    }
    return this.refreshFromAssetic();
  }

  /**
   * Import hierarchy from CSV data (Advanced Search export).
   * Accepts the raw CSV string contain columns like:
   *   Functional Location Name L6, ... L1, Asset Id, Asset Name, Asset Status
   * Returns the built hierarchy and caches it.
   */
  importFromCsv(csvText: string): AsseticLocationHierarchy {
    const rows = this.parseCsv(csvText);
    if (rows.length === 0) {
      throw new Error("CSV file is empty or has no data rows");
    }

    const headers = rows[0];
    const dataRows = rows.slice(1).filter((r) => r.some((c) => c.trim()));

    if (dataRows.length === 0) {
      throw new Error("CSV file has headers but no data rows");
    }

    // Detect how many levels exist (L1 through L6)
    const maxLevel = this.detectMaxLevel(headers);
    if (maxLevel < 1) {
      throw new Error(
        "CSV does not contain Functional Location columns (expected headers like 'Functional Location Name L1')",
      );
    }

    console.log(
      `[AsseticHierarchy] CSV import: ${dataRows.length} rows, ${maxLevel} levels detected`,
    );

    // Build column index map: levelN → { nameCol, typeCol, idCol }
    const levelCols = new Map<
      number,
      { nameIdx: number; typeIdx: number; idIdx: number }
    >();
    for (let n = 1; n <= maxLevel; n++) {
      const nameIdx = headers.findIndex(
        (h) => h.trim().toLowerCase() === `functional location name l${n}`,
      );
      const typeIdx = headers.findIndex(
        (h) => h.trim().toLowerCase() === `functional location type l${n}`,
      );
      const idIdx = headers.findIndex(
        (h) => h.trim().toLowerCase() === `functional location id l${n}`,
      );
      if (nameIdx >= 0) {
        levelCols.set(n, {
          nameIdx,
          typeIdx: typeIdx >= 0 ? typeIdx : -1,
          idIdx: idIdx >= 0 ? idIdx : -1,
        });
      }
    }

    // Parse records into the same format as extractFunctionalLocationLevels
    const records: any[] = [];
    for (const row of dataRows) {
      const record: any = {};
      for (const [level, cols] of levelCols) {
        const name = row[cols.nameIdx]?.trim() || "";
        const type = cols.typeIdx >= 0 ? row[cols.typeIdx]?.trim() || "" : "";
        const id = cols.idIdx >= 0 ? row[cols.idIdx]?.trim() || "" : "";
        if (name) {
          record[`FunctionalLocationNameL${level}`] = name;
          if (type) record[`FunctionalLocationTypeL${level}`] = type;
          if (id) record[`FunctionalLocationIdL${level}`] = id;
        }
      }
      if (Object.keys(record).length > 0) {
        records.push(record);
      }
    }

    console.log(
      `[AsseticHierarchy] CSV: ${records.length} parsed records with level data`,
    );

    const regions = this.buildHierarchyFromLeveledLocations(records);

    const hierarchy: AsseticLocationHierarchy = {
      source: "assets",
      generatedAt: new Date().toISOString(),
      fetchedRecordCount: dataRows.length,
      pageSize: dataRows.length,
      pagesFetched: 1,
      pageLimit: 1,
      isTruncated: false,
      reportedTotalCount: dataRows.length,
      rawNodeCount: regions.reduce(
        (sum, region) =>
          sum +
          1 +
          region.sites.length +
          region.sites.reduce(
            (s, site) =>
              s +
              site.buildings.length +
              site.buildings.reduce((fb, b) => fb + b.floors.length, 0),
            0,
          ),
        0,
      ),
      rawRecordsSampleCount: Math.min(records.length, 50),
      rawRecordsSample: records.slice(0, 50),
      regions,
    };

    this.cache = hierarchy;
    console.log(
      `[AsseticHierarchy] CSV import complete: ${regions.length} region(s)`,
    );
    return hierarchy;
  }

  private detectMaxLevel(headers: string[]): number {
    let max = 0;
    for (const h of headers) {
      const m = h
        .trim()
        .toLowerCase()
        .match(/^functional location (?:name|type|id) l(\d+)$/);
      if (m) {
        const n = parseInt(m[1], 10);
        if (n > max) max = n;
      }
    }
    return max;
  }

  private parseCsv(text: string): string[][] {
    const rows: string[][] = [];
    const lines = text.split(/\r?\n/);
    for (const line of lines) {
      if (!line.trim()) continue;
      // Simple CSV parse handling quoted fields
      const cells: string[] = [];
      let current = "";
      let inQuotes = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (inQuotes) {
          if (ch === '"' && line[i + 1] === '"') {
            current += '"';
            i++;
          } else if (ch === '"') {
            inQuotes = false;
          } else {
            current += ch;
          }
        } else {
          if (ch === '"') {
            inQuotes = true;
          } else if (ch === ",") {
            cells.push(current);
            current = "";
          } else {
            current += ch;
          }
        }
      }
      cells.push(current);
      rows.push(cells);
    }
    return rows;
  }

  /**
   * Build hierarchy from local DB data (assetic_functional_locations +
   * assetic_asset_functional_locations). This uses data previously synced
   * by AsseticAssetSyncService — no live API calls needed.
   */
  async buildHierarchyFromDb(): Promise<AsseticLocationHierarchy | null> {
    try {
      // Check if we have FL data in the DB
      const flCount = await db("assetic_functional_locations")
        .count("id as count")
        .first();
      const total = Number(flCount?.count ?? 0);
      if (total === 0) return null;

      // Load all FLs
      const allFLs = await db("assetic_functional_locations").select(
        "fl_guid",
        "fl_id",
        "fl_name",
        "fl_type",
        "fl_type_id",
        "parent_fl_guid",
      );

      // ── Structural + type-aware classification ────────────────────────────
      // fl_type is reliable for Region, Building, Floor, Structure (from the
      // top-level /functionallocations endpoint). It may be null for Site FLs
      // inserted via the nested children endpoint. So:
      //   • Region  → fl_type contains "region" (always reliable)
      //   • Site    → fl_type contains "site"/"precinct" OR
      //               parent=Region AND fl_type is NOT building/floor/structure
      //   • Building → fl_type contains "building" (reliable); parent may be
      //               stale (pointing to Region instead of Site)
      //   • Floor   → fl_type contains "floor"/"level"/"structure" (reliable)
      //               parent should be a Building

      const classifyType = (t: string): string => {
        const tl = (t || "").toLowerCase();
        if (tl.includes("region")) return "region";
        if (tl.includes("site") || tl.includes("precinct")) return "site";
        if (tl.includes("building")) return "building";
        if (tl.includes("floor") || tl.includes("level")) return "floor";
        // "Structure" FLs are physical shell records — excluded from hierarchy
        if (tl.includes("structure")) return "structure";
        return "other";
      };

      // Index all FLs by guid for O(1) parent-chain lookups
      const byGuid = new Map<string, (typeof allFLs)[0]>();
      for (const f of allFLs) byGuid.set(f.fl_guid, f);

      const regions: AsseticRegion[] = [];
      const regionMap = new Map<string, AsseticRegion>();
      const siteMap = new Map<string, AsseticSite>();
      const buildingMap = new Map<string, AsseticBuilding>();

      // Step 1: Identify Regions (type-based — "Region" type is reliably set)
      for (const f of allFLs) {
        if (classifyType(f.fl_type) === "region") {
          const region: AsseticRegion = {
            id: f.fl_guid,
            name: f.fl_name || "Unknown Region",
            sites: [],
          };
          regions.push(region);
          regionMap.set(f.fl_guid, region);
        }
      }

      if (regions.length === 0) return null;

      // Helper: walk parent chain to find the nearest ancestor that is a Region
      const findRegionAncestor = (
        fl: (typeof allFLs)[0],
      ): AsseticRegion | undefined => {
        let current = fl;
        for (let depth = 0; depth < 6; depth++) {
          if (!current.parent_fl_guid) break;
          const parent = byGuid.get(current.parent_fl_guid);
          if (!parent) break;
          const r = regionMap.get(parent.fl_guid);
          if (r) return r;
          current = parent;
        }
        return undefined;
      };

      const nonRegionFLs = allFLs.filter((f) => !regionMap.has(f.fl_guid));

      // Pass A — Sites
      // Include: fl_type=site/precinct, OR parent=Region AND fl_type is NOT
      // building/floor/structure (handles null-type Site FLs from nested probing).
      // EXCLUDE: fl_type=building or floor even if parent=Region — those are
      // stale DB entries where syncRegionAssignments overwrote the correct
      // Site parent; they will be re-homed in Pass B.
      for (const f of nonRegionFLs) {
        const tc = classifyType(f.fl_type);
        const typeIsSite = tc === "site";
        const typeIsBuilding = tc === "building";
        const typeIsFloor = tc === "floor";

        const directParentIsRegion = f.parent_fl_guid
          ? regionMap.has(f.parent_fl_guid)
          : false;

        // Skip if definitely not a site
        if (!typeIsSite && !directParentIsRegion) continue;
        // Skip building/floor FLs with stale region parent — handled below
        if (typeIsBuilding || typeIsFloor) continue;

        // Resolve owning region
        let region: AsseticRegion | undefined;
        if (f.parent_fl_guid) region = regionMap.get(f.parent_fl_guid);
        if (!region) region = findRegionAncestor(f);
        if (!region) {
          console.log(
            `[AsseticHierarchy] Site "${f.fl_name}" has no resolvable region — skipped`,
          );
          continue;
        }

        const site: AsseticSite = {
          id: f.fl_guid,
          name: f.fl_name || "Unknown Site",
          regionId: region.id,
          buildings: [],
        };
        region.sites.push(site);
        siteMap.set(f.fl_guid, site);
      }

      const hasSites = siteMap.size > 0;
      console.log(
        `[AsseticHierarchy] Structural classification: ${regionMap.size} regions, ${siteMap.size} sites. ` +
          `${hasSites ? "Using Region→Site→Building→Floor layout." : "No sites found — will promote Building→Site, Floor→Building."}`,
      );

      // Pass B — Buildings
      // fl_type=building is reliable. Parent may be:
      //   a) Site guid  → correct, direct assignment
      //   b) Region guid (stale from old syncRegionAssignments) → name-match to site
      //   c) null → name-match to any site
      for (const f of nonRegionFLs) {
        if (siteMap.has(f.fl_guid)) continue; // already a Site

        if (hasSites) {
          const tc = classifyType(f.fl_type);
          // In promoted layout skip — handled after this block
          // Only process items that fl_type says are buildings, OR whose parent is a known site
          const parentSite = f.parent_fl_guid
            ? siteMap.get(f.parent_fl_guid)
            : undefined;
          if (!parentSite && tc !== "building") continue;

          let site = parentSite;

          if (!site && f.parent_fl_guid) {
            // Parent is a Region (stale) — find the correct site via name-matching
            const staleRegion = regionMap.get(f.parent_fl_guid);
            if (staleRegion && staleRegion.sites.length > 0) {
              const bLower = (f.fl_name || "").toLowerCase();
              // Try: site abbreviation-prefix match (e.g. LGHP prefix in fl_id)
              const flIdUpper = (f.fl_id || "").toUpperCase();
              site = staleRegion.sites.find((s) => {
                const abbr = s.name.match(/\(([A-Z][A-Za-z0-9]+)\)\s*$/)?.[1];
                return abbr && flIdUpper.startsWith(abbr);
              });
              // Try: building name contains site name (without abbreviation)
              if (!site) {
                site = staleRegion.sites.find((s) => {
                  const sName = s.name
                    .toLowerCase()
                    .replace(/\s*\([^)]+\)\s*$/, "")
                    .trim();
                  return sName.length > 3 && bLower.includes(sName);
                });
              }
              // Fall back to first site in the region
              if (!site) site = staleRegion.sites[0];
            }
          }

          if (!site) continue;
          const building: AsseticBuilding = {
            id: f.fl_guid,
            name: f.fl_name || "Unknown Building",
            siteId: site.id,
            regionId: site.regionId,
            floors: [],
          };
          site.buildings.push(building);
          buildingMap.set(f.fl_guid, building);
        } else {
          // Promotion: Building FLs → Sites, only those whose parent is a Region
          const region = f.parent_fl_guid
            ? regionMap.get(f.parent_fl_guid)
            : undefined;
          if (!region) continue;
          const site: AsseticSite = {
            id: f.fl_guid,
            name: f.fl_name || "Unknown Site",
            regionId: region.id,
            buildings: [],
          };
          region.sites.push(site);
          siteMap.set(f.fl_guid, site);
        }
      }

      // Pass C — Floors: parent must be a known Building
      // Skip Structure-type FLs — they are physical shell records, not floors
      for (const f of nonRegionFLs) {
        if (siteMap.has(f.fl_guid) || buildingMap.has(f.fl_guid)) continue;
        if (!f.parent_fl_guid) continue;
        if (classifyType(f.fl_type) === "structure") continue;

        if (hasSites) {
          const building = buildingMap.get(f.parent_fl_guid);
          if (!building) continue;
          building.floors.push({
            id: f.fl_guid,
            name: f.fl_name || "Unknown Floor",
            buildingId: building.id,
            siteId: building.siteId,
            regionId: building.regionId,
          });
        } else {
          // In promoted layout, "Floor" FLs are actual Buildings under promoted Sites
          const site = siteMap.get(f.parent_fl_guid);
          if (!site) continue;
          const building: AsseticBuilding = {
            id: f.fl_guid,
            name: f.fl_name || "Unknown Building",
            siteId: site.id,
            regionId: site.regionId,
            floors: [],
          };
          site.buildings.push(building);
          buildingMap.set(f.fl_guid, building);
        }
      }

      // Deduplicate regions that share the same name (merge their sites)
      const regionsByName = new Map<string, AsseticRegion>();
      const deduplicatedRegions: AsseticRegion[] = [];
      for (const region of regions) {
        const existing = regionsByName.get(region.name);
        if (existing) {
          console.log(
            `[AsseticHierarchy] Merging duplicate region "${region.name}" (${region.sites.length} sites) into existing (${existing.sites.length} sites)`,
          );
          for (const site of region.sites) {
            site.regionId = existing.id;
            for (const building of site.buildings) {
              building.regionId = existing.id;
              for (const floor of building.floors) {
                floor.regionId = existing.id;
              }
            }
            existing.sites.push(site);
          }
        } else {
          regionsByName.set(region.name, region);
          deduplicatedRegions.push(region);
        }
      }
      regions.length = 0;
      regions.push(...deduplicatedRegions);

      // Sort everything
      for (const region of regions) {
        for (const site of region.sites) {
          for (const building of site.buildings) {
            building.floors.sort((a, b) => a.name.localeCompare(b.name));
          }
          site.buildings.sort((a, b) => a.name.localeCompare(b.name));
        }
        region.sites.sort((a, b) => a.name.localeCompare(b.name));
      }
      regions.sort((a, b) => a.name.localeCompare(b.name));

      const totalNodes = regions.reduce(
        (sum, r) =>
          sum +
          1 +
          r.sites.length +
          r.sites.reduce(
            (s, si) =>
              s +
              si.buildings.length +
              si.buildings.reduce((fb, b) => fb + b.floors.length, 0),
            0,
          ),
        0,
      );

      const hierarchy: AsseticLocationHierarchy = {
        source: "functionallocations",
        generatedAt: new Date().toISOString(),
        fetchedRecordCount: total,
        pageSize: total,
        pagesFetched: 1,
        pageLimit: 1,
        isTruncated: false,
        reportedTotalCount: total,
        rawNodeCount: totalNodes,
        rawRecordsSampleCount: 0,
        rawRecordsSample: [],
        regions,
      };

      console.log(
        `[AsseticHierarchy] Built from DB: ${regions.length} regions, ` +
          `${regions.reduce((s, r) => s + r.sites.length, 0)} sites, ` +
          `${regions.reduce((s, r) => s + r.sites.reduce((sb, si) => sb + si.buildings.length, 0), 0)} buildings, ` +
          `${regions.reduce((s, r) => s + r.sites.reduce((sb, si) => sb + si.buildings.reduce((fb, b) => fb + b.floors.length, 0), 0), 0)} floors`,
      );

      return hierarchy;
    } catch (err) {
      console.warn("[AsseticHierarchy] buildHierarchyFromDb failed:", err);
      return null;
    }
  }

  async refreshFromAssetic(): Promise<AsseticLocationHierarchy> {
    if (this.refreshInFlight) {
      return this.refreshInFlight;
    }

    this.refreshInFlight = (async () => {
      // Strategy 0: Try building from local DB data first (no API calls).
      // This uses data synced by AsseticAssetSyncService.
      try {
        const fromDb = await this.buildHierarchyFromDb();
        if (fromDb && fromDb.regions.length > 0) {
          console.log(
            `[AsseticHierarchy] Using DB-cached hierarchy: ${fromDb.regions.length} region(s)`,
          );
          this.cache = fromDb;
          return fromDb;
        }
      } catch (err) {
        console.warn(
          "[AsseticHierarchy] DB hierarchy failed, falling back to API:",
          err,
        );
      }

      // Fall back to live API strategies
      const hierarchy = await this.buildFromAssetic();
      this.cache = hierarchy;
      return hierarchy;
    })().finally(() => {
      this.refreshInFlight = null;
    });

    return this.refreshInFlight;
  }

  private async buildFromAssetic(): Promise<AsseticLocationHierarchy> {
    const enabled = await asseticClient.isEnabled();
    if (!enabled) {
      throw new Error("Assetic integration is not enabled");
    }

    let records: any[] = [];
    let source: "functionallocations" | "assets" = "functionallocations";
    let pagination: FetchAllPagesResult | null = null;

    // ── Strategy 1: OData discovery → /functionallocations with attributes ──
    // The OData $metadata endpoint reveals internal field names.
    // We search both "functionallocations" and "assets" entity types
    // for parent/level fields, then request /functionallocations with
    // those attributes. Per Assetic docs, FL-level fields listed under
    // "assets" cannot be used with the Asset API — they must be fetched
    // via /functionallocations.
    let odataAttributes: string | null = null;
    try {
      console.log(
        "[AsseticHierarchy] Discovering FL field names via OData $metadata…",
      );

      // Search both entity types for FL-related fields
      const [flFields, assetFields] = await Promise.all([
        asseticClient
          .discoverFieldNames("functionallocation", "")
          .catch(() => new Map<string, string>()),
        asseticClient
          .discoverFieldNames("asset", "functional location")
          .catch(() => new Map<string, string>()),
      ]);

      // Merge all discovered fields (FL entity takes precedence)
      const allFields = new Map<string, string>();
      for (const [label, name] of assetFields) allFields.set(label, name);
      for (const [label, name] of flFields) allFields.set(label, name);

      if (allFields.size > 0) {
        console.log(
          `[AsseticHierarchy] OData discovered ${allFields.size} fields (FL entity: ${flFields.size}, asset entity: ${assetFields.size})`,
        );
        for (const [label, name] of allFields) {
          console.log(`  [OData] "${label}" → ${name}`);
        }

        // Look for parent / hierarchy / level attributes
        const attrSet = new Set<string>();
        for (const [label, internalName] of allFields) {
          const ll = label.toLowerCase();
          if (
            /functional location (name|type|id) l\d/.test(ll) ||
            ll.includes("parent") ||
            ll.includes("hierarchy")
          ) {
            attrSet.add(internalName);
          }
        }

        if (attrSet.size > 0) {
          odataAttributes = Array.from(attrSet).join(",");
          console.log(
            `[AsseticHierarchy] Will request FL attributes: ${odataAttributes}`,
          );
        }
      } else {
        console.log("[AsseticHierarchy] OData returned no relevant fields.");
      }
    } catch (error) {
      console.warn(
        "[AsseticHierarchy] OData discovery failed (non-fatal):",
        (error as any)?.message || error,
      );
    }

    // ── Strategy 2: /functionallocations with discovered attributes ──
    if (odataAttributes) {
      try {
        console.log(
          `[AsseticHierarchy] Fetching /functionallocations with OData attributes…`,
        );
        source = "functionallocations";
        pagination = await this.fetchAllPages(
          (params) =>
            asseticClient.getFunctionalLocations({
              ...params,
              attributes: odataAttributes!,
            }),
          50,
        );
        records = pagination.rows;

        if (records.length > 0) {
          const sampleKeys = Object.keys(records[0]);
          console.log(
            `[AsseticHierarchy] FL+attrs records: ${records.length}. Keys: ${sampleKeys.join(", ")}`,
          );

          const result = this.buildHierarchy(records, source, pagination);
          if (result.regions.length > 0) {
            console.log(
              `[AsseticHierarchy] OData+FL: ${result.regions.length} region(s)`,
            );
            return result;
          }
          console.warn(
            "[AsseticHierarchy] FL+attrs fetched but no hierarchy built; continuing.",
          );
        }
      } catch (error) {
        console.warn(
          "[AsseticHierarchy] /functionallocations with OData attrs failed:",
          (error as any)?.message || error,
        );
      }
    }

    // ── Strategy 3: OData direct query for leveled hierarchy ──
    // The REST API rejects OData-internal field names (GroupAssetNameL1, etc.)
    // but the OData query endpoint returns them directly.  Fetch FL records
    // with $select for the GroupAsset hierarchy columns, remap to the
    // FunctionalLocationNameLN keys that buildHierarchyFromLeveledLocations
    // already knows how to parse.
    try {
      const odataSelectFields: string[] = [];
      for (let n = 1; n <= 7; n++) {
        odataSelectFields.push(`GroupAssetNameL${n}`);
        odataSelectFields.push(`GroupAssetIdL${n}`);
        odataSelectFields.push(`GroupAssetTypeIdL${n}`);
      }
      // Also grab core identity fields
      odataSelectFields.push(
        "Id",
        "FunctionalLocationId",
        "FunctionalLocationName",
        "FunctionalLocationType",
      );

      console.log(
        `[AsseticHierarchy] Querying OData /functionallocations with $select for ${odataSelectFields.length} level fields…`,
      );

      const odataRows = await asseticClient.queryOData(
        "functionallocations",
        odataSelectFields,
        10000,
      );

      if (odataRows.length > 0) {
        console.log(
          `[AsseticHierarchy] OData query returned ${odataRows.length} rows. Sample keys: ${Object.keys(odataRows[0]).join(", ")}`,
        );

        // Remap GroupAsset* → FunctionalLocationName/Id/Type L# keys
        const remapped = odataRows.map((row: any) => {
          const out: any = { ...row };
          for (let n = 1; n <= 7; n++) {
            if (row[`GroupAssetNameL${n}`] !== undefined) {
              out[`FunctionalLocationNameL${n}`] = row[`GroupAssetNameL${n}`];
            }
            if (row[`GroupAssetIdL${n}`] !== undefined) {
              out[`FunctionalLocationIdL${n}`] = row[`GroupAssetIdL${n}`];
            }
            if (row[`GroupAssetTypeIdL${n}`] !== undefined) {
              out[`FunctionalLocationTypeL${n}`] = row[`GroupAssetTypeIdL${n}`];
            }
          }
          return out;
        });

        // Check if any leveled fields actually came back populated
        const hasLevels = remapped.some(
          (r: any) => r.FunctionalLocationNameL1 || r.FunctionalLocationNameL2,
        );

        if (hasLevels) {
          source = "functionallocations";
          records = remapped;
          pagination = {
            rows: remapped,
            pageSize: remapped.length,
            pagesFetched: 1,
            pageLimit: 1,
            totalCount: remapped.length,
            hitPageLimit: false,
          };

          const result = this.buildHierarchy(records, source, pagination);
          if (result.regions.length > 0) {
            console.log(
              `[AsseticHierarchy] OData direct query: ${result.regions.length} region(s), ` +
                `${result.regions.reduce((s, r) => s + r.sites.length, 0)} site(s), ` +
                `${result.regions.reduce((s, r) => s + r.sites.reduce((sb, si) => sb + si.buildings.length, 0), 0)} building(s), ` +
                `${result.regions.reduce((s, r) => s + r.sites.reduce((sb, si) => sb + si.buildings.reduce((fb, b) => fb + b.floors.length, 0), 0), 0)} floor(s)`,
            );
            return result;
          }
          console.warn(
            "[AsseticHierarchy] OData direct query returned rows but no hierarchy built; continuing.",
          );
        } else {
          console.warn(
            "[AsseticHierarchy] OData query returned rows but no GroupAssetNameL* fields populated; continuing.",
          );
        }
      } else {
        console.log(
          "[AsseticHierarchy] OData query returned 0 rows; continuing.",
        );
      }
    } catch (error) {
      console.warn(
        "[AsseticHierarchy] OData direct query failed (non-fatal):",
        (error as any)?.message || error,
      );
    }

    // ── Strategy 3b: OData /assets with GroupAsset hierarchy fields ──
    // The GroupAsset* fields (L1-L7) belong to the "asset" entity in OData
    // metadata, NOT "functionallocation".  Querying /odata/assets with $select
    // should return each asset's full FL hierarchy path — the same data that
    // appears as "Functional Location Name L1…L4" in CSV exports.
    try {
      const assetODataFields: string[] = [];
      for (let n = 1; n <= 7; n++) {
        assetODataFields.push(`GroupAssetNameL${n}`);
        assetODataFields.push(`GroupAssetIdL${n}`);
        assetODataFields.push(`GroupAssetTypeIdL${n}`);
      }
      assetODataFields.push("Id", "AssetName");

      console.log(
        `[AsseticHierarchy] Querying OData /assets with $select for ${assetODataFields.length} hierarchy fields…`,
      );

      const assetRows = await asseticClient.queryOData(
        "assets",
        assetODataFields,
        10000,
      );

      if (assetRows.length > 0) {
        console.log(
          `[AsseticHierarchy] OData /assets returned ${assetRows.length} rows. Sample keys: ${Object.keys(assetRows[0]).join(", ")}`,
        );

        // Remap GroupAsset* → FunctionalLocationName/Id/Type L# keys
        const remapped = assetRows.map((row: any) => {
          const out: any = { ...row };
          for (let n = 1; n <= 7; n++) {
            if (row[`GroupAssetNameL${n}`] !== undefined) {
              out[`FunctionalLocationNameL${n}`] = row[`GroupAssetNameL${n}`];
            }
            if (row[`GroupAssetIdL${n}`] !== undefined) {
              out[`FunctionalLocationIdL${n}`] = row[`GroupAssetIdL${n}`];
            }
            if (row[`GroupAssetTypeIdL${n}`] !== undefined) {
              out[`FunctionalLocationTypeL${n}`] = row[`GroupAssetTypeIdL${n}`];
            }
          }
          return out;
        });

        const hasLevels = remapped.some(
          (r: any) => r.FunctionalLocationNameL1 || r.FunctionalLocationNameL2,
        );

        if (hasLevels) {
          source = "assets";
          records = remapped;
          pagination = {
            rows: remapped,
            pageSize: remapped.length,
            pagesFetched: 1,
            pageLimit: 1,
            totalCount: remapped.length,
            hitPageLimit: false,
          };

          const result = this.buildHierarchy(records, source, pagination);
          if (result.regions.length > 0) {
            console.log(
              `[AsseticHierarchy] OData /assets hierarchy: ${result.regions.length} region(s), ` +
                `${result.regions.reduce((s, r) => s + r.sites.length, 0)} site(s), ` +
                `${result.regions.reduce((s, r) => s + r.sites.reduce((sb, si) => sb + si.buildings.length, 0), 0)} building(s), ` +
                `${result.regions.reduce((s, r) => s + r.sites.reduce((sb, si) => sb + si.buildings.reduce((fb, b) => fb + b.floors.length, 0), 0), 0)} floor(s)`,
            );
            return result;
          }
          console.warn(
            "[AsseticHierarchy] OData /assets returned leveled data but no hierarchy built; continuing.",
          );
        } else {
          console.warn(
            "[AsseticHierarchy] OData /assets returned rows but GroupAssetNameL* fields not populated; continuing.",
          );
        }
      } else {
        console.log(
          "[AsseticHierarchy] OData /assets returned 0 rows; continuing.",
        );
      }
    } catch (error) {
      console.warn(
        "[AsseticHierarchy] OData /assets query failed (non-fatal):",
        (error as any)?.message || error,
      );
    }

    // ── Strategy 4: /functionallocations plain + nested child probe ──
    // Core fields include FunctionalLocationType (Region/Site/Building/Floor).
    // buildHierarchyFromFLTypes groups records by type.
    // We also probe the nested /{guid}/functionallocations endpoint to find
    // parent-child relationships that the list endpoint doesn't expose.
    try {
      console.log("[AsseticHierarchy] Trying /functionallocations…");
      source = "functionallocations";
      pagination = await this.fetchAllPages(
        (params) => asseticClient.getFunctionalLocations(params),
        50,
      );
      records = pagination.rows;

      if (records.length > 0) {
        console.log(
          `[AsseticHierarchy] FL records: ${records.length}. Sample keys: ${Object.keys(records[0]).join(", ")}`,
        );

        // Classify records to find regions for the nested probe
        const regionGuids: { guid: string; name: string }[] = [];
        for (const r of records) {
          const flt = (
            r.FunctionalLocationType ||
            r.functionalLocationType ||
            ""
          ).toLowerCase();
          if (flt.includes("region")) {
            regionGuids.push({
              guid: r.Id || r.id || r.Guid || r.guid,
              name: r.FunctionalLocationName || r.functionalLocationName || "",
            });
          }
        }

        // Probe: try nested children endpoint on first region
        let nestedWorks = false;
        if (regionGuids.length > 0) {
          try {
            console.log(
              `[AsseticHierarchy] Probing nested children for region "${regionGuids[0].name}" (${regionGuids[0].guid})…`,
            );
            const childResult = await asseticClient.getChildFunctionalLocations(
              regionGuids[0].guid,
              { pageSize: 5 },
            );
            if (childResult !== null) {
              const childData =
                childResult?.Data ||
                childResult?.data ||
                childResult?.ResourceList ||
                (Array.isArray(childResult) ? childResult : []);
              if (childData.length > 0) {
                nestedWorks = true;
                console.log(
                  `[AsseticHierarchy] Nested children endpoint works! Got ${childData.length} children for "${regionGuids[0].name}". Sample: ${JSON.stringify(childData[0]).substring(0, 200)}`,
                );
              } else {
                console.log(
                  `[AsseticHierarchy] Nested children endpoint returned empty for "${regionGuids[0].name}". Response: ${JSON.stringify(childResult).substring(0, 200)}`,
                );
              }
            } else {
              console.log(
                "[AsseticHierarchy] Nested children endpoint returned 404 — not available.",
              );
            }
          } catch (err) {
            console.log(
              `[AsseticHierarchy] Nested children probe failed: ${(err as any)?.message || err}`,
            );
          }
        }

        if (nestedWorks) {
          // Build hierarchy by querying children at each level
          const hierarchy = await this.buildHierarchyFromNestedFLs(
            asseticClient,
            regionGuids,
          );
          if (hierarchy.length > 0) {
            const totalSites = hierarchy.reduce(
              (s, r) => s + r.sites.length,
              0,
            );
            const totalBuildings = hierarchy.reduce(
              (s, r) =>
                s + r.sites.reduce((sb, si) => sb + si.buildings.length, 0),
              0,
            );
            const totalFloors = hierarchy.reduce(
              (s, r) =>
                s +
                r.sites.reduce(
                  (sb, si) =>
                    sb +
                    si.buildings.reduce((fb, b) => fb + b.floors.length, 0),
                  0,
                ),
              0,
            );
            console.log(
              `[AsseticHierarchy] Nested FL hierarchy: ${hierarchy.length} regions, ${totalSites} sites, ${totalBuildings} buildings, ${totalFloors} floors`,
            );
            const totalNodes = hierarchy.reduce(
              (sum, r) =>
                sum +
                1 +
                r.sites.length +
                r.sites.reduce(
                  (s, si) =>
                    s +
                    si.buildings.length +
                    si.buildings.reduce((fb, b) => fb + b.floors.length, 0),
                  0,
                ),
              0,
            );
            return {
              source,
              generatedAt: new Date().toISOString(),
              fetchedRecordCount: records.length,
              pageSize: pagination!.pageSize,
              pagesFetched: pagination!.pagesFetched,
              pageLimit: pagination!.pageLimit,
              isTruncated: false,
              reportedTotalCount: records.length,
              rawNodeCount: totalNodes,
              rawRecordsSampleCount: Math.min(records.length, 50),
              rawRecordsSample: records.slice(0, 50),
              regions: hierarchy,
            };
          }
        }

        const fromFL = this.buildHierarchy(records, source, pagination);
        if (fromFL.regions.length > 0) {
          console.log(
            `[AsseticHierarchy] Built hierarchy from FLs: ${fromFL.regions.length} region(s)`,
          );
          return fromFL;
        }
      }
    } catch (error) {
      console.warn(
        "[AsseticHierarchy] /functionallocations failed:",
        (error as any)?.message || error,
      );
    }

    // ── Strategy 5: /assets with service-area fallback ──
    // Derive hierarchy from AssetPrimaryServiceAreaName / Secondary.
    try {
      console.log("[AsseticHierarchy] Falling back to /assets service areas…");
      source = "assets";
      pagination = await this.fetchAllPages(
        (params) => asseticClient.getAssets(params),
        20,
      );
      records = pagination.rows;

      if (records.length > 0) {
        console.log(
          `[AsseticHierarchy] Asset records: ${records.length}. Sample keys: ${Object.keys(records[0]).join(", ")}`,
        );

        const fromAssets = this.buildHierarchy(records, source, pagination);
        if (fromAssets.regions.length > 0) {
          console.log(
            `[AsseticHierarchy] Built hierarchy from service areas: ${fromAssets.regions.length} region(s)`,
          );
          return fromAssets;
        }
      }
    } catch (error) {
      console.warn(
        "[AsseticHierarchy] /assets service-area fallback failed:",
        (error as any)?.message || error,
      );
    }

    throw new Error("No hierarchy records returned by Assetic");
  }

  private async fetchAllPages(
    fetchPage: (params: AsseticQueryParams) => Promise<any>,
    maxPages: number = 500,
  ): Promise<FetchAllPagesResult> {
    const pageSize = 500;

    const allRows: any[] = [];
    let pagesFetched = 0;
    let lastTotalCount: number | undefined;

    for (let page = 1; page <= maxPages; page += 1) {
      const response = await fetchPage({ page, pageSize });
      const rows = this.extractRows(response);
      pagesFetched = page;

      if (!rows.length) {
        break;
      }

      allRows.push(...rows);

      const totalCount = this.extractTotalCount(response);
      if (typeof totalCount === "number") {
        lastTotalCount = totalCount;
      }
      if (typeof totalCount === "number" && allRows.length >= totalCount) {
        break;
      }

      if (rows.length < pageSize) {
        break;
      }
    }

    const hitPageLimit = pagesFetched >= maxPages;
    return {
      rows: allRows,
      pageSize,
      pagesFetched,
      pageLimit: maxPages,
      totalCount: lastTotalCount,
      hitPageLimit,
    };
  }

  private extractRows(response: any): any[] {
    if (!response) return [];
    if (Array.isArray(response)) return response;
    if (Array.isArray(response.ResourceList)) return response.ResourceList;
    if (Array.isArray(response.Data)) return response.Data;
    if (response.Data && Array.isArray(response.Data.ResourceList))
      return response.Data.ResourceList;
    if (response.ResourceList && Array.isArray(response.ResourceList.Data))
      return response.ResourceList.Data;
    return [];
  }

  private extractTotalCount(response: any): number | undefined {
    const total =
      response?.TotalResults ??
      response?.totalResults ??
      response?.TotalCount ??
      response?.totalCount ??
      response?.RecordCount ??
      response?.recordCount ??
      response?.Meta?.TotalCount ??
      response?.meta?.totalCount ??
      response?.Data?.TotalCount ??
      response?.Data?.totalCount;

    return typeof total === "number" ? total : undefined;
  }

  private buildHierarchy(
    records: any[],
    source: "functionallocations" | "assets",
    pagination: FetchAllPagesResult,
  ): AsseticLocationHierarchy {
    const isTruncated =
      pagination.hitPageLimit &&
      (pagination.totalCount == null || records.length < pagination.totalCount);

    const pack = (regions: AsseticRegion[]): AsseticLocationHierarchy => ({
      source,
      generatedAt: new Date().toISOString(),
      fetchedRecordCount: records.length,
      pageSize: pagination.pageSize,
      pagesFetched: pagination.pagesFetched,
      pageLimit: pagination.pageLimit,
      isTruncated,
      reportedTotalCount: pagination.totalCount,
      rawNodeCount: regions.reduce(
        (sum, region) =>
          sum +
          1 +
          region.sites.length +
          region.sites.reduce(
            (s, site) =>
              s +
              site.buildings.length +
              site.buildings.reduce((fb, b) => fb + b.floors.length, 0),
            0,
          ),
        0,
      ),
      rawRecordsSampleCount: Math.min(records.length, 50),
      rawRecordsSample: records.slice(0, 50),
      regions,
    });

    // 1. Try leveled location fields (L1–L6)
    const leveled = this.buildHierarchyFromLeveledLocations(records);
    if (leveled.length > 0) return pack(leveled);

    // 2. Try FL type + parent tree (functionallocations with type info)
    const fromTypes = this.buildHierarchyFromFLTypes(records);
    if (fromTypes.length > 0) return pack(fromTypes);

    // 3. Try service-area derivation (assets with primary/secondary SA)
    const serviceAreaHierarchy = this.buildHierarchyFromServiceAreas(records);
    if (serviceAreaHierarchy.length > 0) return pack(serviceAreaHierarchy);

    // 4. Fall through to parent-child node tree
    const nodes = new Map<string, Omit<HierarchyNode, "depth">>();

    for (const record of records) {
      const id = this.readString(record, [
        "Id",
        "id",
        "Guid",
        "guid",
        "AssetId",
        "assetId",
        "FunctionalLocationId",
        "functionalLocationId",
      ]);
      const name = this.readString(record, [
        "Name",
        "name",
        "AssetName",
        "assetName",
        "FunctionalLocationName",
        "functionalLocationName",
        "DisplayName",
        "displayName",
        "Description",
        "description",
      ]);

      if (!id || !name) {
        continue;
      }

      const parentId = this.readString(record, [
        "ParentId",
        "parentId",
        "ParentGuid",
        "parentGuid",
        "ParentAssetId",
        "parentAssetId",
        "ParentFunctionalLocationId",
        "parentFunctionalLocationId",
        "FunctionalLocationParentId",
        "functionalLocationParentId",
      ]);

      const rawType = this.readString(record, [
        "FunctionalLocationTypeName",
        "functionalLocationTypeName",
        "TypeName",
        "typeName",
        "AssetTypeName",
        "assetTypeName",
      ]);

      nodes.set(id, {
        id,
        name,
        parentId: parentId || null,
        rawType,
      });
    }

    const depthMap = new Map<string, number>();
    const ancestorMap = new Map<string, string[]>();

    const resolveDepth = (id: string, seen: Set<string>): number => {
      if (depthMap.has(id)) return depthMap.get(id)!;
      if (seen.has(id)) return 0;

      seen.add(id);

      const node = nodes.get(id);
      if (!node) {
        depthMap.set(id, 0);
        ancestorMap.set(id, []);
        return 0;
      }

      if (!node.parentId || !nodes.has(node.parentId)) {
        depthMap.set(id, 0);
        ancestorMap.set(id, []);
        return 0;
      }

      const parentDepth = resolveDepth(node.parentId, seen);
      const parentAncestors = ancestorMap.get(node.parentId) || [];
      const ancestry = [node.parentId, ...parentAncestors];

      ancestorMap.set(id, ancestry);
      depthMap.set(id, parentDepth + 1);
      return parentDepth + 1;
    };

    for (const id of nodes.keys()) {
      resolveDepth(id, new Set<string>());
    }

    const regionsById = new Map<string, AsseticRegion>();
    const sitesById = new Map<string, AsseticSite>();

    const ensureRegion = (nodeId: string): AsseticRegion | null => {
      const node = nodes.get(nodeId);
      if (!node) return null;

      const existing = regionsById.get(nodeId);
      if (existing) return existing;

      const region: AsseticRegion = {
        id: node.id,
        name: node.name,
        sites: [],
      };
      regionsById.set(nodeId, region);
      return region;
    };

    const ensureSite = (
      nodeId: string,
      region: AsseticRegion,
    ): AsseticSite | null => {
      const node = nodes.get(nodeId);
      if (!node) return null;

      const existing = sitesById.get(nodeId);
      if (existing) return existing;

      const site: AsseticSite = {
        id: node.id,
        name: node.name,
        regionId: region.id,
        buildings: [],
      };
      sitesById.set(nodeId, site);
      region.sites.push(site);
      return site;
    };

    for (const [nodeId, node] of nodes.entries()) {
      const depth = depthMap.get(nodeId) || 0;
      if (depth < 3) {
        continue;
      }

      const ancestors = ancestorMap.get(nodeId) || [];
      const siteAncestorId = ancestors.find(
        (id) => (depthMap.get(id) || 0) === 2,
      );
      const regionAncestorId = ancestors.find(
        (id) => (depthMap.get(id) || 0) === 1,
      );

      if (!siteAncestorId || !regionAncestorId) {
        continue;
      }

      const region = ensureRegion(regionAncestorId);
      if (!region) {
        continue;
      }

      const site = ensureSite(siteAncestorId, region);
      if (!site) {
        continue;
      }

      const buildingNodeId = this.resolveBuildingNodeId(
        nodeId,
        ancestors,
        depthMap,
        nodes,
      );
      const buildingNode = nodes.get(buildingNodeId);
      if (!buildingNode) {
        continue;
      }

      const alreadyExists = site.buildings.some(
        (b) => b.id === buildingNode.id,
      );
      if (alreadyExists) {
        continue;
      }

      site.buildings.push({
        id: buildingNode.id,
        name: buildingNode.name,
        siteId: site.id,
        regionId: region.id,
        floors: [],
      });
    }

    const regions = Array.from(regionsById.values())
      .map((region) => ({
        ...region,
        sites: region.sites
          .map((site) => ({
            ...site,
            buildings: [...site.buildings].sort((a, b) =>
              a.name.localeCompare(b.name),
            ),
          }))
          .sort((a, b) => a.name.localeCompare(b.name)),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    return pack(regions);
  }

  private resolveBuildingNodeId(
    nodeId: string,
    ancestors: string[],
    depthMap: Map<string, number>,
    nodes: Map<string, Omit<HierarchyNode, "depth">>,
  ): string {
    const line = [nodeId, ...ancestors];

    const buildingLike = line.find((id) => {
      const node = nodes.get(id);
      if (!node) return false;
      const name = node.name.toLowerCase();
      return /building|hospital|centre|center|station|garage|residence|clinic|campus|precinct/.test(
        name,
      );
    });

    if (buildingLike) {
      return buildingLike;
    }

    const depth3 = line.find((id) => (depthMap.get(id) || 0) === 3);
    return depth3 || nodeId;
  }

  private readString(record: any, keys: string[]): string | undefined {
    for (const key of keys) {
      const value = record?.[key];
      if (typeof value === "string") {
        const trimmed = value.trim();
        if (trimmed) return trimmed;
      }
    }
    return undefined;
  }

  /**
   * Build hierarchy from /functionallocations records that have
   * FunctionalLocationType (Region, Site, Building, Floor, etc.)
   * and optionally ParentFunctionalLocationId / ParentId.
   */
  private buildHierarchyFromFLTypes(records: any[]): AsseticRegion[] {
    const parentMap = loadFlParentMap();

    interface FLRecord {
      id: string;
      flId: string;
      name: string;
      type: string;
      parentId?: string;
    }

    const parsed: FLRecord[] = [];

    for (const r of records) {
      const id = this.readString(r, ["Id", "id", "Guid", "guid"]);
      const flId = this.readString(r, [
        "FunctionalLocationId",
        "functionalLocationId",
      ]);
      const name = this.readString(r, [
        "FunctionalLocationName",
        "functionalLocationName",
        "Name",
        "name",
      ]);
      const type = this.readString(r, [
        "FunctionalLocationType",
        "functionalLocationType",
        "FunctionalLocationTypeName",
        "functionalLocationTypeName",
      ]);
      const parentId = this.readString(r, [
        "ParentFunctionalLocationId",
        "parentFunctionalLocationId",
        "ParentId",
        "parentId",
        "ParentGuid",
        "parentGuid",
      ]);

      if (!id || !name || !type) continue;

      // If no parentId from the API, look it up in the CSV-derived parent map
      let resolvedParentId = parentId;
      if (!resolvedParentId && flId) {
        const csvParentFlId = parentMap[flId];
        if (csvParentFlId) {
          // The parent map gives us a FunctionalLocationId.
          // Find the corresponding FL record's GUID (Id) from our parsed set.
          // We'll resolve this after ALL records are parsed.
          resolvedParentId = `flid:${csvParentFlId}`;
        }
      }

      parsed.push({
        id,
        flId: flId || id,
        name,
        type,
        parentId: resolvedParentId,
      });
    }

    // Resolve flid: references to actual GUIDs
    const guidByFlId = new Map<string, string>();
    for (const fl of parsed) {
      if (fl.flId) guidByFlId.set(fl.flId, fl.id);
    }
    for (const fl of parsed) {
      if (fl.parentId?.startsWith("flid:")) {
        const parentFlId = fl.parentId.substring(5);
        const parentGuid = guidByFlId.get(parentFlId);
        if (parentGuid) {
          fl.parentId = parentGuid;
        } else {
          fl.parentId = undefined;
        }
      }
    }

    if (!parsed.length) return [];

    // Classify by type
    const classify = (t: string): string => {
      const tl = t.toLowerCase();
      if (tl.includes("region")) return "region";
      if (tl.includes("site") || tl.includes("precinct")) return "site";
      if (tl.includes("building")) return "building";
      if (tl.includes("floor") || tl.includes("level")) return "floor";
      if (tl.includes("structure")) return "structure";
      if (tl.includes("organisation") || tl.includes("organization"))
        return "organisation";
      return "other";
    };

    const byId = new Map<string, FLRecord>();
    const regionRecords: FLRecord[] = [];
    const siteRecords: FLRecord[] = [];
    const buildingRecords: FLRecord[] = [];
    const floorRecords: FLRecord[] = [];

    for (const fl of parsed) {
      byId.set(fl.id, fl);
      const cls = classify(fl.type);
      if (cls === "region") regionRecords.push(fl);
      else if (cls === "site") siteRecords.push(fl);
      else if (cls === "building") buildingRecords.push(fl);
      else if (cls === "floor" || cls === "structure") floorRecords.push(fl);
    }

    // Need at least regions and some child data
    if (
      regionRecords.length === 0 ||
      (siteRecords.length === 0 && buildingRecords.length === 0)
    ) {
      return [];
    }

    console.log(
      `[AsseticHierarchy] FL types: ${regionRecords.length} regions, ${siteRecords.length} sites, ${buildingRecords.length} buildings, ${floorRecords.length} floors`,
    );

    // If parent IDs are available, use them to build the tree
    const hasParents =
      parsed.filter((p) => p.parentId).length > parsed.length * 0.3;

    const regionsById = new Map<string, AsseticRegion>();

    if (hasParents) {
      // Build tree via parent references
      const childrenOf = new Map<string, FLRecord[]>();
      for (const fl of parsed) {
        if (fl.parentId) {
          const children = childrenOf.get(fl.parentId) || [];
          children.push(fl);
          childrenOf.set(fl.parentId, children);
        }
      }

      for (const rRec of regionRecords) {
        const region: AsseticRegion = {
          id: rRec.id,
          name: rRec.name,
          sites: [],
        };
        regionsById.set(rRec.id, region);

        // Sites whose parent is this region
        const siteChildren = (childrenOf.get(rRec.id) || []).filter(
          (c) => classify(c.type) === "site",
        );
        for (const sRec of siteChildren) {
          const site: AsseticSite = {
            id: sRec.id,
            name: sRec.name,
            regionId: region.id,
            buildings: [],
          };
          region.sites.push(site);

          // Buildings whose parent is this site
          const buildingChildren = (childrenOf.get(sRec.id) || []).filter(
            (c) => classify(c.type) === "building",
          );
          for (const bRec of buildingChildren) {
            const building: AsseticBuilding = {
              id: bRec.id,
              name: bRec.name,
              siteId: site.id,
              regionId: region.id,
              floors: [],
            };
            site.buildings.push(building);

            // Floors whose parent is this building
            const floorChildren = (childrenOf.get(bRec.id) || []).filter(
              (c) =>
                classify(c.type) === "floor" ||
                classify(c.type) === "structure",
            );
            for (const fRec of floorChildren) {
              building.floors.push({
                id: fRec.id,
                name: fRec.name,
                buildingId: building.id,
                siteId: site.id,
                regionId: region.id,
              });
            }
            building.floors.sort((a, b) => a.name.localeCompare(b.name));
          }
          site.buildings.sort((a, b) => a.name.localeCompare(b.name));
        }
        region.sites.sort((a, b) => a.name.localeCompare(b.name));
      }
    } else {
      // No parent IDs — infer hierarchy via name matching.
      // Strategy: sites → regions by longest-name-first substring match;
      // buildings → sites and floors → buildings by FunctionalLocationId
      // numeric proximity (IDs in the same range tend to be siblings).

      for (const rRec of regionRecords) {
        regionsById.set(rRec.id, {
          id: rRec.id,
          name: rRec.name,
          sites: [],
        });
      }

      // Sort regions by name length DESC so "North West" matches before "North"
      const regionsSorted = [...regionRecords].sort(
        (a, b) => b.name.length - a.name.length,
      );

      // --- Sites → Regions (name substring match) ---
      const sitesById = new Map<string, AsseticSite>();
      const unmatchedSites: FLRecord[] = [];

      for (const sRec of siteRecords) {
        const sLower = sRec.name.toLowerCase();
        let matched = false;
        for (const rRec of regionsSorted) {
          if (sLower.includes(rRec.name.toLowerCase())) {
            const region = regionsById.get(rRec.id)!;
            const site: AsseticSite = {
              id: sRec.id,
              name: sRec.name,
              regionId: region.id,
              buildings: [],
            };
            region.sites.push(site);
            sitesById.set(sRec.id, site);
            matched = true;
            break;
          }
        }
        if (!matched) unmatchedSites.push(sRec);
      }

      // Distribute unmatched sites round-robin across regions
      const regionArr = Array.from(regionsById.values());
      for (let i = 0; i < unmatchedSites.length; i++) {
        const sRec = unmatchedSites[i];
        const region = regionArr[i % regionArr.length];
        const site: AsseticSite = {
          id: sRec.id,
          name: sRec.name,
          regionId: region.id,
          buildings: [],
        };
        region.sites.push(site);
        sitesById.set(sRec.id, site);
      }

      // --- Buildings → Sites ---
      // Extract abbreviation from site names: "Hospital Precinct (NWRHP)" → "NWRHP"
      const siteByAbbrev = new Map<string, AsseticSite>();
      const allSites = Array.from(sitesById.values());
      for (const site of allSites) {
        const m = site.name.match(/\(([A-Z][A-Za-z0-9]+)\)\s*$/);
        if (m) siteByAbbrev.set(m[1].toUpperCase(), site);
      }

      const buildingsById = new Map<string, AsseticBuilding>();
      const unmatchedBuildings: FLRecord[] = [];

      for (const bRec of buildingRecords) {
        // Try abbreviation prefix match on flId or name
        let site: AsseticSite | undefined;
        const bUpper = bRec.name.toUpperCase();
        const bFlUpper = bRec.flId.toUpperCase();
        for (const [abbr, s] of siteByAbbrev) {
          if (
            bUpper.startsWith(abbr + " ") ||
            bUpper.startsWith("(" + abbr + ")") ||
            bFlUpper.startsWith(abbr)
          ) {
            site = s;
            break;
          }
        }

        // Try site name containment
        if (!site) {
          const bLower = bRec.name.toLowerCase();
          for (const s of allSites) {
            if (bLower.includes(s.name.toLowerCase())) {
              site = s;
              break;
            }
          }
        }

        if (site) {
          const building: AsseticBuilding = {
            id: bRec.id,
            name: bRec.name,
            siteId: site.id,
            regionId: site.regionId,
            floors: [],
          };
          site.buildings.push(building);
          buildingsById.set(bRec.id, building);
        } else {
          unmatchedBuildings.push(bRec);
        }
      }

      // Distribute unmatched buildings round-robin across all sites
      if (unmatchedBuildings.length > 0 && allSites.length > 0) {
        for (let i = 0; i < unmatchedBuildings.length; i++) {
          const bRec = unmatchedBuildings[i];
          const site = allSites[i % allSites.length];
          const building: AsseticBuilding = {
            id: bRec.id,
            name: bRec.name,
            siteId: site.id,
            regionId: site.regionId,
            floors: [],
          };
          site.buildings.push(building);
          buildingsById.set(bRec.id, building);
        }
      }

      // --- Floors → Buildings ---
      const allBuildings = Array.from(buildingsById.values());
      const unmatchedFloors: FLRecord[] = [];

      for (const fRec of floorRecords) {
        // Try building name containment
        const fLower = fRec.name.toLowerCase();
        let building: AsseticBuilding | undefined;

        for (const b of allBuildings) {
          if (fLower.includes(b.name.toLowerCase())) {
            building = b;
            break;
          }
        }

        if (building) {
          building.floors.push({
            id: fRec.id,
            name: fRec.name,
            buildingId: building.id,
            siteId: building.siteId,
            regionId: building.regionId,
          });
        } else {
          unmatchedFloors.push(fRec);
        }
      }

      // Distribute unmatched floors round-robin across all buildings
      if (unmatchedFloors.length > 0 && allBuildings.length > 0) {
        for (let i = 0; i < unmatchedFloors.length; i++) {
          const fRec = unmatchedFloors[i];
          const building = allBuildings[i % allBuildings.length];
          building.floors.push({
            id: fRec.id,
            name: fRec.name,
            buildingId: building.id,
            siteId: building.siteId,
            regionId: building.regionId,
          });
        }
      }

      console.log(
        `[AsseticHierarchy] Name-matching: ` +
          `${siteRecords.length - unmatchedSites.length}/${siteRecords.length} sites matched, ` +
          `${buildingRecords.length - unmatchedBuildings.length}/${buildingRecords.length} buildings matched, ` +
          `${floorRecords.length - unmatchedFloors.length}/${floorRecords.length} floors matched`,
      );

      // Sort children
      for (const region of regionsById.values()) {
        for (const site of region.sites) {
          for (const building of site.buildings) {
            building.floors.sort((a, b) => a.name.localeCompare(b.name));
          }
          site.buildings.sort((a, b) => a.name.localeCompare(b.name));
        }
        region.sites.sort((a, b) => a.name.localeCompare(b.name));
      }
    }

    return Array.from(regionsById.values()).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
  }

  /**
   * Build full hierarchy by traversing nested FL children endpoint:
   *   Region → get children (Sites) → get children (Buildings) → get children (Floors)
   */
  private async buildHierarchyFromNestedFLs(
    client: typeof asseticClient,
    regionGuids: { guid: string; name: string }[],
  ): Promise<AsseticRegion[]> {
    const regions: AsseticRegion[] = [];

    const extractData = (result: any): any[] => {
      if (!result) return [];
      if (result.Data) return result.Data;
      if (result.data) return result.data;
      if (result.ResourceList) return result.ResourceList;
      if (Array.isArray(result)) return result;
      return [];
    };

    const readName = (r: any) =>
      r.FunctionalLocationName || r.functionalLocationName || r.Name || "";
    const readId = (r: any) => r.Id || r.id || r.Guid || r.guid || "";
    const readType = (r: any) =>
      (
        r.FunctionalLocationType ||
        r.functionalLocationType ||
        ""
      ).toLowerCase();

    for (const rg of regionGuids) {
      const region: AsseticRegion = {
        id: rg.guid,
        name: rg.name,
        sites: [],
      };
      regions.push(region);

      // Get children of this region (should be Sites)
      let siteRecords: any[];
      try {
        const siteResult = await client.getChildFunctionalLocations(rg.guid, {
          pageSize: 500,
        });
        siteRecords = extractData(siteResult);
      } catch {
        siteRecords = [];
      }

      console.log(
        `[AsseticHierarchy] Region "${rg.name}": ${siteRecords.length} children`,
      );

      for (const sRec of siteRecords) {
        const siteId = readId(sRec);
        const siteName = readName(sRec);
        const siteType = readType(sRec);

        // Skip children that are not sites (might be miscategorised)
        if (
          siteType &&
          !siteType.includes("site") &&
          !siteType.includes("precinct")
        ) {
          continue;
        }

        const site: AsseticSite = {
          id: siteId,
          name: siteName,
          regionId: region.id,
          buildings: [],
        };
        region.sites.push(site);

        // Get children of this site (should be Buildings)
        let buildingRecords: any[];
        try {
          const bResult = await client.getChildFunctionalLocations(siteId, {
            pageSize: 500,
          });
          buildingRecords = extractData(bResult);
        } catch {
          buildingRecords = [];
        }

        for (const bRec of buildingRecords) {
          const buildingId = readId(bRec);
          const buildingName = readName(bRec);

          const building: AsseticBuilding = {
            id: buildingId,
            name: buildingName,
            siteId: site.id,
            regionId: region.id,
            floors: [],
          };
          site.buildings.push(building);

          // Get children of this building (should be Floors)
          let floorRecords: any[];
          try {
            const fResult = await client.getChildFunctionalLocations(
              buildingId,
              { pageSize: 500 },
            );
            floorRecords = extractData(fResult);
          } catch {
            floorRecords = [];
          }

          for (const fRec of floorRecords) {
            building.floors.push({
              id: readId(fRec),
              name: readName(fRec),
              buildingId: building.id,
              siteId: site.id,
              regionId: region.id,
            });
          }
          building.floors.sort((a, b) => a.name.localeCompare(b.name));
        }
        site.buildings.sort((a, b) => a.name.localeCompare(b.name));
      }
      region.sites.sort((a, b) => a.name.localeCompare(b.name));
    }

    return regions.sort((a, b) => a.name.localeCompare(b.name));
  }

  private buildHierarchyFromLeveledLocations(records: any[]): AsseticRegion[] {
    const regionsByKey = new Map<string, AsseticRegion>();
    const sitesByRegionKey = new Map<string, Map<string, AsseticSite>>();
    const buildingsBySiteKey = new Map<string, Map<string, AsseticBuilding>>();

    for (const record of records) {
      const levels = this.extractFunctionalLocationLevels(record);
      if (!levels) continue;

      const region = levels.region;
      const site = levels.site;
      const building = levels.building;
      const floor = levels.floor;
      if (!region?.name || !site?.name || !building?.name) {
        continue;
      }

      const regionKey = region.id || region.name;
      if (!regionsByKey.has(regionKey)) {
        regionsByKey.set(regionKey, {
          id: region.id || region.name,
          name: region.name,
          sites: [],
        });
      }

      const regionNode = regionsByKey.get(regionKey)!;
      if (!sitesByRegionKey.has(regionKey)) {
        sitesByRegionKey.set(regionKey, new Map<string, AsseticSite>());
      }

      const sitesMap = sitesByRegionKey.get(regionKey)!;
      const siteKey = site.id || site.name;
      if (!sitesMap.has(siteKey)) {
        const siteNode: AsseticSite = {
          id: site.id || site.name,
          name: site.name,
          regionId: regionNode.id,
          buildings: [],
        };
        sitesMap.set(siteKey, siteNode);
        regionNode.sites.push(siteNode);
      }

      const siteNode = sitesMap.get(siteKey)!;
      const buildingMapKey = `${regionKey}::${siteKey}`;
      if (!buildingsBySiteKey.has(buildingMapKey)) {
        buildingsBySiteKey.set(
          buildingMapKey,
          new Map<string, AsseticBuilding>(),
        );
      }

      const buildingMap = buildingsBySiteKey.get(buildingMapKey)!;
      const buildingId = building.id || building.name;
      if (!buildingMap.has(buildingId)) {
        const buildingNode: AsseticBuilding = {
          id: buildingId,
          name: building.name,
          siteId: siteNode.id,
          regionId: regionNode.id,
          floors: [],
        };
        buildingMap.set(buildingId, buildingNode);
        siteNode.buildings.push(buildingNode);
      }

      const buildingNode = buildingMap.get(buildingId)!;
      if (floor?.name) {
        const floorId = floor.id || floor.name;
        const floorExists = buildingNode.floors.some((f) => f.id === floorId);
        if (!floorExists) {
          buildingNode.floors.push({
            id: floorId,
            name: floor.name,
            buildingId: buildingNode.id,
            siteId: siteNode.id,
            regionId: regionNode.id,
          });
        }
      }
    }

    return Array.from(regionsByKey.values())
      .map((region) => ({
        ...region,
        sites: region.sites
          .map((site) => ({
            ...site,
            buildings: [...site.buildings]
              .map((building) => ({
                ...building,
                floors: [...building.floors].sort((a, b) =>
                  a.name.localeCompare(b.name),
                ),
              }))
              .sort((a, b) => a.name.localeCompare(b.name)),
          }))
          .sort((a, b) => a.name.localeCompare(b.name)),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  private buildHierarchyFromServiceAreas(records: any[]): AsseticRegion[] {
    const regionsById = new Map<string, AsseticRegion>();
    const sitesByRegionId = new Map<string, Map<string, AsseticSite>>();
    const buildingsBySiteId = new Map<string, AsseticBuilding>();

    for (const record of records) {
      const primary = this.readString(record, [
        "AssetPrimaryServiceAreaName",
        "assetPrimaryServiceAreaName",
        "PrimaryServiceAreaName",
        "primaryServiceAreaName",
      ]);
      const secondary = this.readString(record, [
        "AssetSecondaryServiceAreaName",
        "assetSecondaryServiceAreaName",
        "SecondaryServiceAreaName",
        "secondaryServiceAreaName",
      ]);

      const regionName = primary || secondary;
      if (!regionName) {
        continue;
      }

      const siteName = secondary || primary || "General";
      const regionId = `region:${this.toKey(regionName)}`;
      const siteId = `site:${this.toKey(regionName)}:${this.toKey(siteName)}`;
      const buildingId = `building:${this.toKey(regionName)}:${this.toKey(siteName)}`;

      if (!regionsById.has(regionId)) {
        regionsById.set(regionId, {
          id: regionId,
          name: regionName,
          sites: [],
        });
      }
      const region = regionsById.get(regionId)!;

      if (!sitesByRegionId.has(regionId)) {
        sitesByRegionId.set(regionId, new Map<string, AsseticSite>());
      }
      const sites = sitesByRegionId.get(regionId)!;

      if (!sites.has(siteId)) {
        const buildingNode: AsseticBuilding = {
          id: buildingId,
          name: siteName,
          siteId,
          regionId,
          floors: [],
        };
        buildingsBySiteId.set(buildingId, buildingNode);
        const siteNode: AsseticSite = {
          id: siteId,
          name: siteName,
          regionId,
          buildings: [buildingNode],
        };
        sites.set(siteId, siteNode);
        region.sites.push(siteNode);
      }

      // Try to extract floor / level info from asset record
      const floorName = this.readString(record, [
        "AssetFloorAreaName",
        "assetFloorAreaName",
        "FloorAreaName",
        "floorAreaName",
        "AssetFloorName",
        "assetFloorName",
        "FloorName",
        "floorName",
        "Floor",
        "floor",
        "AssetFloor",
        "assetFloor",
        "Level",
        "level",
        "AssetLevel",
        "assetLevel",
        "LevelName",
        "levelName",
      ]);

      if (floorName) {
        const building = buildingsBySiteId.get(buildingId);
        if (building) {
          const floorId = `floor:${this.toKey(regionName)}:${this.toKey(siteName)}:${this.toKey(floorName)}`;
          const floorExists = building.floors.some((f) => f.id === floorId);
          if (!floorExists) {
            building.floors.push({
              id: floorId,
              name: floorName,
              buildingId,
              siteId,
              regionId,
            });
          }
        }
      }
    }

    return Array.from(regionsById.values())
      .map((region) => ({
        ...region,
        sites: [...region.sites].sort((a, b) => a.name.localeCompare(b.name)),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  private toKey(value: string): string {
    return value
      .toLowerCase()
      .trim()
      .replace(/\s+/g, "-")
      .replace(/[^a-z0-9\-]/g, "");
  }

  private extractFunctionalLocationLevels(record: any): {
    region: { id?: string; name?: string; type?: string };
    site: { id?: string; name?: string; type?: string };
    building: { id?: string; name?: string; type?: string };
    floor?: { id?: string; name?: string; type?: string };
  } | null {
    const level = (n: number) => ({
      name: this.readString(record, [
        `FunctionalLocationNameL${n}`,
        `Functional Location Name L${n}`,
        `Functional_Location_Name_L${n}`,
        `GroupAssetNameL${n}`,
      ]),
      type: this.readString(record, [
        `FunctionalLocationTypeL${n}`,
        `Functional Location Type L${n}`,
        `Functional_Location_Type_L${n}`,
        `GroupAssetTypeIdL${n}`,
      ]),
      id: this.readString(record, [
        `FunctionalLocationIdL${n}`,
        `Functional Location Id L${n}`,
        `Functional_Location_Id_L${n}`,
        `GroupAssetIdL${n}`,
      ]),
    });

    const l1 = level(1);
    const l2 = level(2);
    const l3 = level(3);
    const l4 = level(4);
    const l5 = level(5);
    const l6 = level(6);

    if (!l1.name && !l2.name && !l3.name && !l4.name && !l5.name && !l6.name) {
      return null;
    }

    const byType = (name: string) => {
      const wanted = name.toLowerCase();
      return [l1, l2, l3, l4, l5, l6].find((x) =>
        (x.type || "").toLowerCase().includes(wanted),
      );
    };

    const region = byType("region") || l5 || l3;
    const site = byType("site") || l4 || l2;
    const building = byType("building") || l3 || l1;
    const floor = byType("floor") || l2;

    return { region, site, building, floor: floor?.name ? floor : undefined };
  }
}

export const asseticLocationHierarchyService =
  new AsseticLocationHierarchyService();
export default asseticLocationHierarchyService;
