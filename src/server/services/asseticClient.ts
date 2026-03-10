import { AxiosInstance, AxiosResponse } from "axios";
import settingsService from "./settingsService";
import { asseticWorkerPool } from "./asseticWorkerPool";
import { asseticApiLogger, ApiLogEntityType } from "./asseticApiLogger";

/**
 * Assetic REST API client.
 *
 * Reads connection details from system_settings (DB) so admins can
 * reconfigure without restarting the server.
 *
 * URL pattern:  {assetic_api_url}/api/{version}/{endpoint}
 *   e.g.  https://dohtassandbox.assetic.net/api/v2/workrequest
 *
 * Auth: HTTP Basic — base64(username:token)
 *
 * Assetic is treated as the **source of truth**.  XeonB only stores
 * user accounts, permissions, and a lightweight catalogue of IDs
 * needed to query the Assetic API.  All data reads/writes pass
 * through this client.
 *
 * All outbound calls are routed through the worker pool which
 * distributes requests across N API agent workers, each enforcing
 * a hard cap of 250 requests per rolling 60-second window.
 * Total throughput = workerCount × 250 req/min.
 */

/** Standard Assetic pagination / filter params */
export interface AsseticQueryParams {
  page?: number;
  pageSize?: number;
  filters?: string; // e.g. "Id~eq~'abc'" or "Status~contains~'Open'"
  sorts?: string; // e.g. "CreatedDateTime-desc"
  attributes?: string; // e.g. "Comment,DimensionDetail"
  [key: string]: any;
}

/** Convert our friendly params into Assetic's requestParams.* format */
function toAsseticParams(
  p?: AsseticQueryParams,
): Record<string, any> | undefined {
  if (!p) return undefined;
  const out: Record<string, any> = {};
  if (p.page != null) out["requestParams.page"] = p.page;
  if (p.pageSize != null) out["requestParams.pageSize"] = p.pageSize;
  if (p.filters) out["requestParams.filters"] = p.filters;
  if (p.sorts) out["requestParams.sorts"] = p.sorts;
  if (p.attributes) out["attributes"] = p.attributes;
  // Pass through any extra keys untouched
  for (const [k, v] of Object.entries(p)) {
    if (
      !["page", "pageSize", "filters", "sorts", "attributes"].includes(k) &&
      v != null
    ) {
      out[k] = v;
    }
  }
  return out;
}

class AsseticClient {
  /** User ID of the current request context (set per-request by middleware). */
  private _contextUserId?: number;
  private _contextSource?: string;

  /**
   * Set the calling context for logging (user + source route).
   * Should be called from route handlers before Assetic calls.
   */
  setContext(userId?: number, source?: string): this {
    this._contextUserId = userId;
    this._contextSource = source;
    return this;
  }

  /** Clear the context after a request cycle. */
  clearContext(): void {
    this._contextUserId = undefined;
    this._contextSource = undefined;
  }

  /**
   * Execute a rate-limited API call through the worker pool.
   * The pool selects the least-loaded worker and provides its
   * Axios client (with that worker's credentials) to `fn`.
   */
  private async call<T>(
    fn: (client: AxiosInstance) => Promise<T>,
    description?: string,
  ): Promise<T> {
    return asseticWorkerPool.execute(fn, description);
  }

  /**
   * Execute a rate-limited API call with full DB logging.
   *
   * Captures the Axios response (or error), measures duration,
   * and writes a row into `assetic_api_log`.  Used for work
   * request creation and other operations that need an audit trail.
   */
  private async loggedCall<T>(options: {
    method: string;
    endpoint: string;
    description: string;
    entityType: ApiLogEntityType;
    entityGuid?: string;
    requestBody?: any;
    fn: (client: AxiosInstance) => Promise<AxiosResponse<T>>;
  }): Promise<T> {
    const start = Date.now();
    try {
      const response = await asseticWorkerPool.execute(
        (client) => options.fn(client),
        options.description,
      );

      const durationMs = Date.now() - start;

      // Log success — fire-and-forget
      asseticApiLogger.log({
        method: options.method,
        endpoint: options.endpoint,
        description: options.description,
        entityType: options.entityType,
        entityGuid: options.entityGuid,
        requestBody: options.requestBody,
        responseBody: response.data,
        httpStatus: response.status,
        durationMs,
        performedBy: this._contextUserId,
        source: this._contextSource,
        status: "success",
      });

      return response.data;
    } catch (error: any) {
      const durationMs = Date.now() - start;
      const httpStatus = error.response?.status;
      const responseBody = error.response?.data;
      const errorMessage = error.message || "Unknown error";

      // Log failure — fire-and-forget
      asseticApiLogger.log({
        method: options.method,
        endpoint: options.endpoint,
        description: options.description,
        entityType: options.entityType,
        entityGuid: options.entityGuid,
        requestBody: options.requestBody,
        responseBody,
        httpStatus,
        errorMessage,
        durationMs,
        performedBy: this._contextUserId,
        source: this._contextSource,
        status: httpStatus ? "error" : "timeout",
      });

      throw error;
    }
  }

  /** Check whether Assetic sync is enabled in settings. */
  async isEnabled(): Promise<boolean> {
    return settingsService.getBool("assetic_sync_enabled");
  }

  /** Return current rate-limit / queue status (exposed for the admin endpoint). */
  getRateLimitStatus() {
    return asseticWorkerPool.getStatus();
  }

  /** Refresh the worker pool configuration (call after admin saves settings). */
  async refreshWorkerPool() {
    return asseticWorkerPool.refresh();
  }

  /**
   * Fetch OData $metadata XML from the Assetic instance.
   * This reveals the internal field names (Property Name) for all
   * entity types including assets and functionallocations.
   *
   * The OData endpoint lives at {siteUrl}/odata/$metadata — outside
   * the normal /api/v2/ prefix — so we build a one-off Axios call
   * through the worker pool to reuse credentials + rate-limiting.
   */
  async getODataMetadata(): Promise<string> {
    return this.call(async (client) => {
      const baseURL = client.defaults.baseURL || "";
      const siteRoot = baseURL.replace(/\/api\/[^/]+\/?$/, "");
      const resp = await client.get(`${siteRoot}/odata/$metadata`, {
        baseURL: "",
        headers: {
          ...client.defaults.headers.common,
          Accept: "application/xml",
        },
        responseType: "text",
      });
      return resp.data as string;
    }, "GET /odata/$metadata");
  }

  /**
   * Query the OData endpoint for functional location data with
   * specific $select fields (e.g. hierarchy level columns).
   *
   * The OData endpoint supports field selection via $select,
   * filtering via $filter, pagination via $top/$skip, and
   * returns JSON by default.
   *
   * @param entitySet  - e.g. "functionallocations" or "assets"
   * @param select     - OData $select fields (internal names)
   * @param top        - max rows to return (default 10000)
   */
  async queryOData(
    entitySet: string,
    select: string[],
    top: number = 10000,
  ): Promise<any[]> {
    return this.call(async (client) => {
      const baseURL = client.defaults.baseURL || "";
      const siteRoot = baseURL.replace(/\/api\/[^/]+\/?$/, "");
      const params: Record<string, string> = {
        $top: String(top),
      };
      if (select.length > 0) {
        params.$select = select.join(",");
      }
      const resp = await client.get(`${siteRoot}/odata/${entitySet}`, {
        baseURL: "",
        params,
        headers: {
          ...client.defaults.headers.common,
          Accept: "application/json",
        },
      });
      const data = resp.data;
      // OData responses wrap rows in "value"
      if (data && Array.isArray(data.value)) return data.value;
      if (Array.isArray(data)) return data;
      return [];
    }, `GET /odata/${entitySet}`);
  }

  /**
   * Parse the OData $metadata XML to find internal field names for
   * an entity type (e.g. "functionallocation" or "asset").
   *
   * Returns a map of lowercase label → internal Property Name.
   * If labelFilter is non-empty, only fields whose label contains
   * that string (case-insensitive) are included.  If labelFilter is
   * empty, ALL fields with annotations are returned.
   */
  async discoverFieldNames(
    entityType: string,
    labelFilter: string,
  ): Promise<Map<string, string>> {
    const xml = await this.getODataMetadata();
    const result = new Map<string, string>();
    const filterLower = labelFilter.toLowerCase();

    // ── 1. Find relevant <EntityType> blocks ──
    // The block may be named "assets", "functionallocations", etc.
    // Match case-insensitively and allow partial name match.
    const entityBlockRegex = new RegExp(
      `<EntityType\\s+Name="([^"]*${entityType}[^"]*)"[^>]*>([\\s\\S]*?)</EntityType>`,
      "gi",
    );

    let entityMatch: RegExpExecArray | null;
    while ((entityMatch = entityBlockRegex.exec(xml)) !== null) {
      const block = entityMatch[2];

      // ── 2. Extract all <Property> elements ──
      // Collect each property name and any annotation strings within it.
      // Properties may be self-closing or have children (annotations).
      //
      // Pattern A (self-closing): <Property Name="Foo" Type="Edm.String" />
      // Pattern B (with annotations):
      //   <Property Name="Foo" Type="Edm.String">
      //     <Annotation Term="..." String="Label" />
      //   </Property>

      // First collect all property names with their positions
      const propRegex = /<Property\s+Name="([^"]+)"/gi;
      const props: { name: string; startIdx: number }[] = [];
      let pm: RegExpExecArray | null;
      while ((pm = propRegex.exec(block)) !== null) {
        props.push({ name: pm[1], startIdx: pm.index });
      }

      // For each property, find annotations between it and the next property
      for (let i = 0; i < props.length; i++) {
        const prop = props[i];
        const nextStart =
          i + 1 < props.length ? props[i + 1].startIdx : block.length;
        const segment = block.substring(prop.startIdx, nextStart);

        // Find all annotation strings in this segment
        const annRegex = /String="([^"]*)"/gi;
        let am: RegExpExecArray | null;
        while ((am = annRegex.exec(segment)) !== null) {
          const label = am[1];
          if (!label) continue;

          // Skip Term="..." annotations that aren't labels
          // (e.g. Term references often appear before String)
          // Accept the annotation if it looks like a field label

          if (filterLower === "" || label.toLowerCase().includes(filterLower)) {
            result.set(label.toLowerCase(), prop.name);
          }
        }
      }
    }

    return result;
  }

  // ═══════════════════════════════════════════════════════════════════
  // AUTH / CONNECTION TEST
  // ═══════════════════════════════════════════════════════════════════

  /** Validate Login — GET /api/v2/auth */
  async validateLogin() {
    return this.call(
      (c) => c.get("/auth").then((r) => r.data),
      "GET /auth (validate login)",
    );
  }

  // ═══════════════════════════════════════════════════════════════════
  // WORK REQUESTS   (Assetic path: /workrequest)
  // ═══════════════════════════════════════════════════════════════════

  async getWorkRequests(params?: AsseticQueryParams) {
    return this.loggedCall({
      method: "GET",
      endpoint: "/workrequest",
      description: "GET /workrequest",
      entityType: "work_request",
      requestBody: toAsseticParams(params),
      fn: (c) => c.get("/workrequest", { params: toAsseticParams(params) }),
    });
  }

  async getWorkRequest(guid: string) {
    return this.loggedCall({
      method: "GET",
      endpoint: `/workrequest/${guid}`,
      description: `GET /workrequest/${guid}`,
      entityType: "work_request",
      entityGuid: guid,
      fn: (c) => c.get(`/workrequest/${guid}`),
    });
  }

  async createWorkRequest(data: any) {
    return this.loggedCall({
      method: "POST",
      endpoint: "/workrequest",
      description: "POST /workrequest",
      entityType: "work_request",
      requestBody: data,
      fn: (c) => c.post("/workrequest/", data),
    });
  }

  async updateWorkRequest(guid: string, data: any) {
    return this.loggedCall({
      method: "PUT",
      endpoint: `/workrequest/${guid}`,
      description: `PUT /workrequest/${guid}`,
      entityType: "work_request",
      entityGuid: guid,
      requestBody: data,
      fn: (c) => c.put(`/workrequest/${guid}/`, data),
    });
  }

  async getWorkRequestTypes() {
    return this.call(
      (c) => c.get("/workrequesttype").then((r) => r.data),
      "GET /workrequesttype",
    );
  }

  /** Add a comment / supporting info to a work request */
  async addWorkRequestComment(guid: string, data: any) {
    return this.loggedCall({
      method: "POST",
      endpoint: `/workrequest/${guid}/supportinginfo`,
      description: `POST /workrequest/${guid}/supportinginfo`,
      entityType: "work_request",
      entityGuid: guid,
      requestBody: data,
      fn: (c) => c.post(`/workrequest/${guid}/supportinginfo`, data),
    });
  }

  /** Get supporting info / comments for a work request */
  async getWorkRequestComments(guid: string) {
    return this.loggedCall({
      method: "GET",
      endpoint: `/workrequest/${guid}/supportinginfo`,
      description: `GET /workrequest/${guid}/supportinginfo`,
      entityType: "work_request",
      entityGuid: guid,
      fn: (c) => c.get(`/workrequest/${guid}/supportinginfo`),
    });
  }

  // ═══════════════════════════════════════════════════════════════════
  // WORK ORDERS   (Assetic path: /workorder)
  // ═══════════════════════════════════════════════════════════════════

  async getWorkOrders(params?: AsseticQueryParams) {
    return this.call(
      (c) =>
        c
          .get("/workorder", { params: toAsseticParams(params) })
          .then((r) => r.data),
      "GET /workorder",
    );
  }

  async getWorkOrder(guid: string) {
    return this.call(
      (c) => c.get(`/workorder/${guid}`).then((r) => r.data),
      `GET /workorder/${guid}`,
    );
  }

  async createWorkOrder(data: any) {
    return this.loggedCall({
      method: "POST",
      endpoint: "/workorder",
      description: "POST /workorder",
      entityType: "work_order",
      requestBody: data,
      fn: (c) => c.post("/workorder", data),
    });
  }

  /** Update a work order (also used to add comments via the body) */
  async updateWorkOrder(guid: string, data: any) {
    return this.loggedCall({
      method: "PUT",
      endpoint: `/workorder/${guid}`,
      description: `PUT /workorder/${guid}`,
      entityType: "work_order",
      entityGuid: guid,
      requestBody: data,
      fn: (c) => c.put(`/workorder/${guid}`, data),
    });
  }

  async getWorkTypes() {
    return this.call(
      (c) => c.get("/worktype").then((r) => r.data),
      "GET /worktype",
    );
  }

  // ═══════════════════════════════════════════════════════════════════
  // ASSETS
  // ═══════════════════════════════════════════════════════════════════

  async getAssets(params?: AsseticQueryParams) {
    return this.call(
      (c) =>
        c
          .get("/assets", { params: toAsseticParams(params) })
          .then((r) => r.data),
      "GET /assets",
    );
  }

  async getAsset(guid: string) {
    return this.call(
      (c) => c.get(`/assets/${guid}`).then((r) => r.data),
      `GET /assets/${guid}`,
    );
  }

  // ═══════════════════════════════════════════════════════════════════
  // ASSET CONFIGURATION / LOOKUPS
  // ═══════════════════════════════════════════════════════════════════

  async getAssetTypes(params?: AsseticQueryParams) {
    return this.call(
      (c) =>
        c
          .get("/assettype", { params: toAsseticParams(params) })
          .then((r) => r.data),
      "GET /assettype",
    );
  }

  async getAssetClasses(params?: AsseticQueryParams) {
    return this.call(
      (c) =>
        c
          .get("/assetclass", { params: toAsseticParams(params) })
          .then((r) => r.data),
      "GET /assetclass",
    );
  }

  async getAssetCategories(params?: AsseticQueryParams) {
    return this.call(
      (c) =>
        c
          .get("/assetcategory", { params: toAsseticParams(params) })
          .then((r) => r.data),
      "GET /assetcategory",
    );
  }

  async getWorkgroups(params?: AsseticQueryParams) {
    return this.call(
      (c) =>
        c
          .get("/workgroup", { params: toAsseticParams(params) })
          .then((r) => r.data),
      "GET /workgroup",
    );
  }

  // ═══════════════════════════════════════════════════════════════════
  // FUNCTIONAL LOCATIONS  (for building / floor / room drill-down)
  // ═══════════════════════════════════════════════════════════════════

  async getFunctionalLocationTypes(params?: AsseticQueryParams) {
    return this.call(
      (c) =>
        c
          .get("/functionallocationtypes", { params: toAsseticParams(params) })
          .then((r) => r.data),
      "GET /functionallocationtypes",
    );
  }

  async getFunctionalLocation(assetGuid: string) {
    return this.call(
      (c) =>
        c.get(`/assets/${assetGuid}/functionallocation`).then((r) => r.data),
      `GET /assets/${assetGuid}/functionallocation`,
    );
  }

  async getFunctionalLocations(params?: AsseticQueryParams) {
    return this.call(
      (c) =>
        c
          .get("/functionallocations", { params: toAsseticParams(params) })
          .then((r) => r.data),
      "GET /functionallocations",
    );
  }

  /**
   * Try to get child functional locations of a parent FL.
   * Returns null if the endpoint doesn't exist (404).
   */
  async getChildFunctionalLocations(
    parentGuid: string,
    params?: AsseticQueryParams,
  ): Promise<any | null> {
    return this.call(async (c) => {
      try {
        const resp = await c.get(
          `/functionallocations/${parentGuid}/functionallocations`,
          { params: toAsseticParams(params) },
        );
        return resp.data;
      } catch (err: any) {
        if (err?.response?.status === 404) return null;
        throw err;
      }
    }, `GET /functionallocations/${parentGuid}/functionallocations`);
  }

  async createFunctionalLocation(data: any) {
    return this.call(
      (c) => c.post("/functionallocations", data).then((r) => r.data),
      "POST /functionallocations",
    );
  }

  // ═══════════════════════════════════════════════════════════════════
  // RESOURCES
  // ═══════════════════════════════════════════════════════════════════

  async getResources(params?: AsseticQueryParams) {
    return this.call(
      (c) =>
        c
          .get("/resource", { params: toAsseticParams(params) })
          .then((r) => r.data),
      "GET /resource",
    );
  }

  // ═══════════════════════════════════════════════════════════════════
  // DOCUMENTS
  // ═══════════════════════════════════════════════════════════════════

  async getDocuments(params?: AsseticQueryParams) {
    return this.call(
      (c) =>
        c
          .get("/document", { params: toAsseticParams(params) })
          .then((r) => r.data),
      "GET /document",
    );
  }

  async getDocument(id: string) {
    return this.call(
      (c) => c.get(`/document/${id}`).then((r) => r.data),
      `GET /document/${id}`,
    );
  }

  async uploadDocument(data: any) {
    return this.call(
      (c) => c.post("/document", data).then((r) => r.data),
      "POST /document",
    );
  }

  async getDocumentFile(id: string) {
    return this.call(
      (c) =>
        c
          .get(`/document/${id}/file`, { responseType: "arraybuffer" })
          .then((r) => r.data),
      `GET /document/${id}/file`,
    );
  }

  // ═══════════════════════════════════════════════════════════════════
  // MAINTENANCE CONFIG
  // ═══════════════════════════════════════════════════════════════════

  async getServiceActivities(params?: AsseticQueryParams) {
    return this.call(
      (c) =>
        c
          .get("/serviceactivity", { params: toAsseticParams(params) })
          .then((r) => r.data),
      "GET /serviceactivity",
    );
  }

  async getMaintenanceAssetTypes() {
    return this.call(
      (c) => c.get("/maintenanceassettype").then((r) => r.data),
      "GET /maintenanceassettype",
    );
  }

  // ═══════════════════════════════════════════════════════════════════
  // VERSION
  // ═══════════════════════════════════════════════════════════════════

  async getVersion() {
    return this.call(
      (c) => c.get("/version").then((r) => r.data),
      "GET /version",
    );
  }
}

const asseticClient = new AsseticClient();
export default asseticClient;
