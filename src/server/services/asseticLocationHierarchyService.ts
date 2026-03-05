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

    // Primary source: assets pull. This aligns with the location columns
    // used in downstream extracts (L6..L1 functional location fields).
    try {
      pagination = await this.fetchAllPages((params) =>
        asseticClient.getAssets(params),
      );
      records = pagination.rows;
    } catch (error) {
      console.warn(
        "[AsseticHierarchy] Failed to fetch /assets, falling back to /functionallocations:",
        error,
      );
    }

    if (!records.length) {
      source = "functionallocations";
      pagination = await this.fetchAllPages((params) =>
        asseticClient.getFunctionalLocations(params),
      );
      records = pagination.rows;
    }

    if (!records.length) {
      throw new Error("No hierarchy records returned by Assetic");
    }

    return this.buildHierarchy(records, source, pagination!);
  }

  private async fetchAllPages(
    fetchPage: (params: AsseticQueryParams) => Promise<any>,
  ): Promise<FetchAllPagesResult> {
    const pageSize = 500;
    const maxPages = 500;

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

    const leveled = this.buildHierarchyFromLeveledLocations(records);
    if (leveled.length > 0) {
      return {
        source,
        generatedAt: new Date().toISOString(),
        fetchedRecordCount: records.length,
        pageSize: pagination.pageSize,
        pagesFetched: pagination.pagesFetched,
        pageLimit: pagination.pageLimit,
        isTruncated,
        reportedTotalCount: pagination.totalCount,
        rawNodeCount: leveled.reduce(
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
        regions: leveled,
      };
    }

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

    return {
      source,
      generatedAt: new Date().toISOString(),
      fetchedRecordCount: records.length,
      pageSize: pagination.pageSize,
      pagesFetched: pagination.pagesFetched,
      pageLimit: pagination.pageLimit,
      isTruncated,
      reportedTotalCount: pagination.totalCount,
      rawNodeCount: nodes.size,
      rawRecordsSampleCount: Math.min(records.length, 50),
      rawRecordsSample: records.slice(0, 50),
      regions,
    };
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
