import axios, { AxiosInstance } from 'axios';
import settingsService from './settingsService';

/**
 * Assetic API client — reads connection details from system_settings (DB)
 * so admins can reconfigure without restarting the server.
 */
class AsseticClient {
  private client: AxiosInstance | null = null;

  /**
   * Build (or rebuild) the Axios instance from current DB settings.
   */
  private async getClient(): Promise<AxiosInstance> {
    const apiUrl = await settingsService.get('assetic_api_url');
    const apiKey = await settingsService.get('assetic_api_key');
    const apiVersion = await settingsService.get('assetic_api_version', 'v1');

    if (!apiUrl || !apiKey) {
      throw new Error('Assetic API is not configured. Set the API URL and key in Admin > Settings.');
    }

    // Recreate client each call so setting changes take effect immediately
    this.client = axios.create({
      baseURL: `${apiUrl}/${apiVersion}`,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: 30000,
    });

    this.client.interceptors.response.use(
      (response) => response,
      (error) => {
        console.error('Assetic API Error:', error.response?.data || error.message);
        throw error;
      }
    );

    return this.client;
  }

  /**
   * Check whether Assetic sync is enabled in settings
   */
  async isEnabled(): Promise<boolean> {
    return settingsService.getBool('assetic_sync_enabled');
  }

  // ─── Work Requests ──────────────────────────────────────────────────

  async getWorkRequests(params?: { status?: string; limit?: number; offset?: number }) {
    const client = await this.getClient();
    const response = await client.get('/workrequests', { params });
    return response.data;
  }

  async getWorkRequest(id: string) {
    const client = await this.getClient();
    const response = await client.get(`/workrequests/${id}`);
    return response.data;
  }

  async createWorkRequest(data: any) {
    const client = await this.getClient();
    const response = await client.post('/workrequests', data);
    return response.data;
  }

  async updateWorkRequest(id: string, data: any) {
    const client = await this.getClient();
    const response = await client.put(`/workrequests/${id}`, data);
    return response.data;
  }

  // ─── Work Orders ────────────────────────────────────────────────────

  async getWorkOrders(params?: { status?: string; limit?: number; offset?: number }) {
    const client = await this.getClient();
    const response = await client.get('/workorders', { params });
    return response.data;
  }

  async getWorkOrder(id: string) {
    const client = await this.getClient();
    const response = await client.get(`/workorders/${id}`);
    return response.data;
  }

  async createWorkOrder(data: any) {
    const client = await this.getClient();
    const response = await client.post('/workorders', data);
    return response.data;
  }

  async updateWorkOrder(id: string, data: any) {
    const client = await this.getClient();
    const response = await client.put(`/workorders/${id}`, data);
    return response.data;
  }

  // ─── Assets (read-only for reference) ───────────────────────────────

  async getAssets(params?: { limit?: number; offset?: number; status?: string }) {
    const client = await this.getClient();
    const response = await client.get('/assets', { params });
    return response.data;
  }

  async getAsset(assetId: string) {
    const client = await this.getClient();
    const response = await client.get(`/assets/${assetId}`);
    return response.data;
  }

  // ─── Lookups ────────────────────────────────────────────────────────

  async getLocations() {
    const client = await this.getClient();
    const response = await client.get('/locations');
    return response.data;
  }

  async getCategories() {
    const client = await this.getClient();
    const response = await client.get('/categories');
    return response.data;
  }

  async getCrafts() {
    const client = await this.getClient();
    const response = await client.get('/crafts');
    return response.data;
  }
}

const asseticClient = new AsseticClient();
export default asseticClient;
}

export default new AsseticClient();
