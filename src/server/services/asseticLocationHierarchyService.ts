import asseticClient, { AsseticQueryParams } from "./asseticClient";

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

  async refreshFromAssetic(): Promise<AsseticLocationHierarchy> {
    if (this.refreshInFlight) {
      return this.refreshInFlight;
    }

    this.refreshInFlight = this.buildFromAssetic()
      .then((hierarchy) => {
        this.cache = hierarchy;
        return hierarchy;
      })
      .finally(() => {
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
    let source: "functionallocations" | "assets" = "assets";
    let pagination: FetchAllPagesResult | null = null;

    // ── Strategy 1: OData discovery → /assets with FL level attributes ──
    // Use the OData $metadata endpoint to discover the internal field
    // names for Functional Location hierarchy levels (L1–L6).
    // Then request /assets with those attributes so the API returns
    // the full leveled hierarchy data alongside each asset record.
    try {
      console.log(
        "[AsseticHierarchy] Discovering FL attribute names via OData metadata…",
      );
      const fieldMap = await asseticClient.discoverFieldNames(
        "asset",
        "functional location",
      );

      if (fieldMap.size > 0) {
        console.log(
          `[AsseticHierarchy] OData discovered ${fieldMap.size} FL fields`,
        );
        // Log all discovered fields for debugging
        for (const [label, name] of fieldMap) {
          console.log(`  [OData] "${label}" → ${name}`);
        }

        // Build the attributes list: only request Name, Type, Id for
        // each level that was found in the metadata.
        const attrSet = new Set<string>();
        for (const [label, internalName] of fieldMap) {
          // Only include level fields (L1-L6)
          if (/functional location (name|type|id) l\d/i.test(label)) {
            attrSet.add(internalName);
          }
        }

        if (attrSet.size > 0) {
          const attributes = Array.from(attrSet).join(",");
          console.log(
            `[AsseticHierarchy] Requesting /assets with ${attrSet.size} FL attributes: ${attributes}`,
          );

          source = "assets";
          pagination = await this.fetchAllPages(
            (params) => asseticClient.getAssets({ ...params, attributes }),
            20, // 10K records is enough to discover the full tree
          );
          records = pagination.rows;

          if (records.length > 0) {
            const sampleKeys = Object.keys(records[0]);
            console.log(
              `[AsseticHierarchy] Fetched ${records.length} assets with attributes. Keys: ${sampleKeys.join(", ")}`,
            );

            const result = this.buildHierarchy(records, source, pagination);
            if (result.regions.length > 0) {
              console.log(
                `[AsseticHierarchy] OData+assets: ${result.regions.length} region(s)`,
              );
              return result;
            }
            console.warn(
              "[AsseticHierarchy] OData attributes fetched but no hierarchy built; continuing.",
            );
          }
        } else {
          console.log(
            "[AsseticHierarchy] OData found FL fields but none matched L1-L6 pattern.",
          );
        }
      } else {
        console.log("[AsseticHierarchy] OData metadata returned no FL fields.");
      }
    } catch (error) {
      console.warn(
        "[AsseticHierarchy] OData discovery failed (non-fatal):",
        (error as any)?.message || error,
      );
    }

    // ── Strategy 2: /functionallocations (plain) ──
    // Fetch FL records which include FunctionalLocationType.
    // The buildHierarchyFromFLTypes method groups records by type
    // (Region/Site/Building/Floor).
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

    // ── Strategy 3: /assets with service-area fallback ──
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
      parsed.push({ id, flId: flId || id, name, type, parentId });
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
      // No parent IDs — create flat tree: each region with a default site
      // containing all buildings. This preserves what we can.
      for (const rRec of regionRecords) {
        const region: AsseticRegion = {
          id: rRec.id,
          name: rRec.name,
          sites: [],
        };
        regionsById.set(rRec.id, region);
      }

      // Assign sites to regions by name proximity or just first region
      const defaultRegion =
        regionRecords.length === 1
          ? regionsById.get(regionRecords[0].id)!
          : null;

      for (const sRec of siteRecords) {
        const target = defaultRegion || regionsById.values().next().value!;
        const site: AsseticSite = {
          id: sRec.id,
          name: sRec.name,
          regionId: target.id,
          buildings: [],
        };
        target.sites.push(site);
      }

      for (const bRec of buildingRecords) {
        // Attach to first site of first region
        const firstRegion = regionsById.values().next().value;
        if (firstRegion && firstRegion.sites.length > 0) {
          firstRegion.sites[0].buildings.push({
            id: bRec.id,
            name: bRec.name,
            siteId: firstRegion.sites[0].id,
            regionId: firstRegion.id,
            floors: [],
          });
        }
      }
    }

    return Array.from(regionsById.values()).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
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
      ]),
      type: this.readString(record, [
        `FunctionalLocationTypeL${n}`,
        `Functional Location Type L${n}`,
        `Functional_Location_Type_L${n}`,
      ]),
      id: this.readString(record, [
        `FunctionalLocationIdL${n}`,
        `Functional Location Id L${n}`,
        `Functional_Location_Id_L${n}`,
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
