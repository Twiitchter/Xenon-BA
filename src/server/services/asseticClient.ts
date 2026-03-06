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
      // The worker's client baseURL is {siteUrl}/api/{version}.
      // We need {siteUrl}/odata/$metadata, so derive the site root.
      const baseURL = client.defaults.baseURL || "";
      const siteRoot = baseURL.replace(/\/api\/[^/]+\/?$/, "");
      const resp = await client.get(`${siteRoot}/odata/$metadata`, {
        baseURL: "", // override so Axios uses the full URL
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
   * Parse the OData $metadata XML to find internal field names for
   * an entity type (e.g. "functionallocations" or "assets").
   *
   * Returns a map of lowercase label → internal Property Name for
   * fields whose label contains the search term (case-insensitive).
   */
  async discoverFieldNames(
    entityType: string,
    labelFilter: string,
  ): Promise<Map<string, string>> {
    const xml = await this.getODataMetadata();
    const result = new Map<string, string>();

    // The XML contains <EntityType Name="..."> blocks.
    // Each has <Property Name="InternalName" ... /> elements
    // with an annotation like:
    //   <Annotation Term="..." String="User-Friendly Label" />
    // We look for our entity type and then match labels.

    const filterLower = labelFilter.toLowerCase();

    // Find the EntityType block for our target
    // OData metadata names the type with a capital first letter
    // e.g. "Assets", "FunctionalLocations" etc.

    // Extract all Property elements with their names and annotations
    const propertyRegex =
      /<Property\s+Name="([^"]+)"[^>]*(?:Type="([^"]*)")?[^>]*\/?>([\s\S]*?)(?:<\/Property>|(?=<Property\s|<\/EntityType>|<NavigationProperty))/gi;
    const annotationRegex = /<Annotation[^>]*String="([^"]*)"[^>]*\/?>/gi;

    // Find entity type section
    const entityTypeRegex = new RegExp(
      `<EntityType\\s+Name="[^"]*${entityType}[^"]*"[^>]*>([\\s\\S]*?)</EntityType>`,
      "gi",
    );

    let entityMatch: RegExpExecArray | null;
    while ((entityMatch = entityTypeRegex.exec(xml)) !== null) {
      const block = entityMatch[1];

      let propMatch: RegExpExecArray | null;
      const propRegex = /<Property\s+Name="([^"]+)"[^>]*\/?>/gi;

      // Re-scan with a simpler approach: find each Property name,
      // then check if any nearby annotation string matches our filter
      const lines = block.split("\n");
      let currentPropName = "";

      for (const line of lines) {
        const propNameMatch = line.match(/<Property\s+Name="([^"]+)"/i);
        if (propNameMatch) {
          currentPropName = propNameMatch[1];
        }

        const annMatch = line.match(
          /<Annotation[^>]*String="([^"]*)"[^>]*\/?>/i,
        );
        if (annMatch && currentPropName) {
          const label = annMatch[1];
          if (label.toLowerCase().includes(filterLower)) {
            result.set(label.toLowerCase(), currentPropName);
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
