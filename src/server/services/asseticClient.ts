import axios, { AxiosInstance } from 'axios';
import settingsService from './settingsService';
import { asseticRateLimiter } from './asseticRateLimiter';

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
 * All outbound calls are routed through the rate limiter which
 * enforces a hard cap of 250 requests per rolling 60-second window.
 */

/** Standard Assetic pagination / filter params */
export interface AsseticQueryParams {
  page?: number;
  pageSize?: number;
  filters?: string;       // e.g. "Id~eq~'abc'" or "Status~contains~'Open'"
  sorts?: string;         // e.g. "CreatedDateTime-desc"
  attributes?: string;    // e.g. "Comment,DimensionDetail"
  [key: string]: any;
}

/** Convert our friendly params into Assetic's requestParams.* format */
function toAsseticParams(p?: AsseticQueryParams): Record<string, any> | undefined {
  if (!p) return undefined;
  const out: Record<string, any> = {};
  if (p.page != null)       out['requestParams.page'] = p.page;
  if (p.pageSize != null)   out['requestParams.pageSize'] = p.pageSize;
  if (p.filters)            out['requestParams.filters'] = p.filters;
  if (p.sorts)              out['requestParams.sorts'] = p.sorts;
  if (p.attributes)         out['attributes'] = p.attributes;
  // Pass through any extra keys untouched
  for (const [k, v] of Object.entries(p)) {
    if (!['page', 'pageSize', 'filters', 'sorts', 'attributes'].includes(k) && v != null) {
      out[k] = v;
    }
  }
  return out;
}

class AsseticClient {
  private client: AxiosInstance | null = null;

  /**
   * Build (or rebuild) the Axios instance from current DB settings.
   * URL:  {site}/api/{version}
   */
  private async getClient(): Promise<AxiosInstance> {
    const siteUrl = await settingsService.get('assetic_api_url');
    const apiKey = await settingsService.get('assetic_api_key');
    const apiUsername = await settingsService.get('assetic_api_username');
    const apiVersion = await settingsService.get('assetic_api_version', 'v2');

    if (!siteUrl || !apiKey || !apiUsername) {
      throw new Error(
        'Assetic API is not configured. Set the site URL, username, and API key in Admin > Settings.',
      );
    }

    const basicAuth = Buffer.from(`${apiUsername}:${apiKey}`).toString('base64');

    // Recreate on each call so DB setting changes take effect immediately
    this.client = axios.create({
      baseURL: `${siteUrl.replace(/\/+$/, '')}/api/${apiVersion}`,
      headers: {
        Authorization: `Basic ${basicAuth}`,
        'Content-Type': 'application/json',
      },
      timeout: 30000,
    });

    this.client.interceptors.response.use(
      (response) => response,
      (error) => {
        console.error('Assetic API Error:', error.response?.status, error.response?.data || error.message);
        throw error;
      },
    );

    return this.client;
  }

  /** Execute a rate-limited API call through the 250/min queue. */
  private async call<T>(
    fn: (client: AxiosInstance) => Promise<T>,
    description?: string,
  ): Promise<T> {
    return asseticRateLimiter.execute(async () => {
      const client = await this.getClient();
      return fn(client);
    }, description);
  }

  /** Check whether Assetic sync is enabled in settings. */
  async isEnabled(): Promise<boolean> {
    return settingsService.getBool('assetic_sync_enabled');
  }

  /** Return current rate-limit / queue status (exposed for the admin endpoint). */
  getRateLimitStatus() {
    return asseticRateLimiter.getStatus();
  }

  // ═══════════════════════════════════════════════════════════════════
  // AUTH / CONNECTION TEST
  // ═══════════════════════════════════════════════════════════════════

  /** Validate Login — GET /api/v2/auth */
  async validateLogin() {
    return this.call(
      (c) => c.get('/auth').then((r) => r.data),
      'GET /auth (validate login)',
    );
  }

  // ═══════════════════════════════════════════════════════════════════
  // WORK REQUESTS   (Assetic path: /workrequest)
  // ═══════════════════════════════════════════════════════════════════

  async getWorkRequests(params?: AsseticQueryParams) {
    return this.call(
      (c) => c.get('/workrequest', { params: toAsseticParams(params) }).then((r) => r.data),
      'GET /workrequest',
    );
  }

  async getWorkRequest(guid: string) {
    return this.call(
      (c) => c.get(`/workrequest/${guid}`).then((r) => r.data),
      `GET /workrequest/${guid}`,
    );
  }

  async createWorkRequest(data: any) {
    return this.call(
      (c) => c.post('/workrequest/', data).then((r) => r.data),
      'POST /workrequest',
    );
  }

  async updateWorkRequest(guid: string, data: any) {
    return this.call(
      (c) => c.put(`/workrequest/${guid}/`, data).then((r) => r.data),
      `PUT /workrequest/${guid}`,
    );
  }

  async getWorkRequestTypes() {
    return this.call(
      (c) => c.get('/workrequesttype').then((r) => r.data),
      'GET /workrequesttype',
    );
  }

  /** Add a comment / supporting info to a work request */
  async addWorkRequestComment(guid: string, data: any) {
    return this.call(
      (c) => c.post(`/workrequest/${guid}/supportinginfo`, data).then((r) => r.data),
      `POST /workrequest/${guid}/supportinginfo`,
    );
  }

  /** Get supporting info / comments for a work request */
  async getWorkRequestComments(guid: string) {
    return this.call(
      (c) => c.get(`/workrequest/${guid}/supportinginfo`).then((r) => r.data),
      `GET /workrequest/${guid}/supportinginfo`,
    );
  }

  // ═══════════════════════════════════════════════════════════════════
  // WORK ORDERS   (Assetic path: /workorder)
  // ═══════════════════════════════════════════════════════════════════

  async getWorkOrders(params?: AsseticQueryParams) {
    return this.call(
      (c) => c.get('/workorder', { params: toAsseticParams(params) }).then((r) => r.data),
      'GET /workorder',
    );
  }

  async getWorkOrder(guid: string) {
    return this.call(
      (c) => c.get(`/workorder/${guid}`).then((r) => r.data),
      `GET /workorder/${guid}`,
    );
  }

  async createWorkOrder(data: any) {
    return this.call(
      (c) => c.post('/workorder', data).then((r) => r.data),
      'POST /workorder',
    );
  }

  /** Update a work order (also used to add comments via the body) */
  async updateWorkOrder(guid: string, data: any) {
    return this.call(
      (c) => c.put(`/workorder/${guid}`, data).then((r) => r.data),
      `PUT /workorder/${guid}`,
    );
  }

  async getWorkTypes() {
    return this.call(
      (c) => c.get('/worktype').then((r) => r.data),
      'GET /worktype',
    );
  }

  // ═══════════════════════════════════════════════════════════════════
  // ASSETS
  // ═══════════════════════════════════════════════════════════════════

  async getAssets(params?: AsseticQueryParams) {
    return this.call(
      (c) => c.get('/assets', { params: toAsseticParams(params) }).then((r) => r.data),
      'GET /assets',
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
      (c) => c.get('/assettype', { params: toAsseticParams(params) }).then((r) => r.data),
      'GET /assettype',
    );
  }

  async getAssetClasses(params?: AsseticQueryParams) {
    return this.call(
      (c) => c.get('/assetclass', { params: toAsseticParams(params) }).then((r) => r.data),
      'GET /assetclass',
    );
  }

  async getAssetCategories(params?: AsseticQueryParams) {
    return this.call(
      (c) => c.get('/assetcategory', { params: toAsseticParams(params) }).then((r) => r.data),
      'GET /assetcategory',
    );
  }

  async getWorkgroups(params?: AsseticQueryParams) {
    return this.call(
      (c) => c.get('/workgroup', { params: toAsseticParams(params) }).then((r) => r.data),
      'GET /workgroup',
    );
  }

  // ═══════════════════════════════════════════════════════════════════
  // FUNCTIONAL LOCATIONS  (for building / floor / room drill-down)
  // ═══════════════════════════════════════════════════════════════════

  async getFunctionalLocationTypes(params?: AsseticQueryParams) {
    return this.call(
      (c) => c.get('/functionallocationtypes', { params: toAsseticParams(params) }).then((r) => r.data),
      'GET /functionallocationtypes',
    );
  }

  async getFunctionalLocation(assetGuid: string) {
    return this.call(
      (c) => c.get(`/assets/${assetGuid}/functionallocation`).then((r) => r.data),
      `GET /assets/${assetGuid}/functionallocation`,
    );
  }

  async createFunctionalLocation(data: any) {
    return this.call(
      (c) => c.post('/functionallocations', data).then((r) => r.data),
      'POST /functionallocations',
    );
  }

  // ═══════════════════════════════════════════════════════════════════
  // RESOURCES
  // ═══════════════════════════════════════════════════════════════════

  async getResources(params?: AsseticQueryParams) {
    return this.call(
      (c) => c.get('/resource', { params: toAsseticParams(params) }).then((r) => r.data),
      'GET /resource',
    );
  }

  // ═══════════════════════════════════════════════════════════════════
  // DOCUMENTS
  // ═══════════════════════════════════════════════════════════════════

  async getDocuments(params?: AsseticQueryParams) {
    return this.call(
      (c) => c.get('/document', { params: toAsseticParams(params) }).then((r) => r.data),
      'GET /document',
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
      (c) => c.post('/document', data).then((r) => r.data),
      'POST /document',
    );
  }

  async getDocumentFile(id: string) {
    return this.call(
      (c) => c.get(`/document/${id}/file`, { responseType: 'arraybuffer' }).then((r) => r.data),
      `GET /document/${id}/file`,
    );
  }

  // ═══════════════════════════════════════════════════════════════════
  // MAINTENANCE CONFIG
  // ═══════════════════════════════════════════════════════════════════

  async getServiceActivities(params?: AsseticQueryParams) {
    return this.call(
      (c) => c.get('/serviceactivity', { params: toAsseticParams(params) }).then((r) => r.data),
      'GET /serviceactivity',
    );
  }

  async getMaintenanceAssetTypes() {
    return this.call(
      (c) => c.get('/maintenanceassettype').then((r) => r.data),
      'GET /maintenanceassettype',
    );
  }

  // ═══════════════════════════════════════════════════════════════════
  // VERSION
  // ═══════════════════════════════════════════════════════════════════

  async getVersion() {
    return this.call(
      (c) => c.get('/version').then((r) => r.data),
      'GET /version',
    );
  }
}

const asseticClient = new AsseticClient();
export default asseticClient;
