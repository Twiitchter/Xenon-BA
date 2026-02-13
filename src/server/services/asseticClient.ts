import axios, { AxiosInstance } from 'axios';

interface AsseticConfig {
  apiUrl: string;
  apiKey: string;
  apiVersion: string;
}

class AsseticClient {
  private client: AxiosInstance;
  private config: AsseticConfig;

  constructor() {
    this.config = {
      apiUrl: process.env.ASSETIC_API_URL || '',
      apiKey: process.env.ASSETIC_API_KEY || '',
      apiVersion: process.env.ASSETIC_API_VERSION || 'v1',
    };

    this.client = axios.create({
      baseURL: `${this.config.apiUrl}/${this.config.apiVersion}`,
      headers: {
        'Authorization': `Bearer ${this.config.apiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: 30000,
    });

    // Add response interceptor for error handling
    this.client.interceptors.response.use(
      (response) => response,
      (error) => {
        console.error('Assetic API Error:', error.response?.data || error.message);
        throw error;
      }
    );
  }

  /**
   * Get all assets from Assetic API
   */
  async getAssets(params?: {
    limit?: number;
    offset?: number;
    status?: string;
    category?: string;
  }) {
    try {
      const response = await this.client.get('/assets', { params });
      return response.data;
    } catch (error) {
      throw new Error(`Failed to fetch assets: ${error}`);
    }
  }

  /**
   * Get a single asset by ID
   */
  async getAsset(assetId: string) {
    try {
      const response = await this.client.get(`/assets/${assetId}`);
      return response.data;
    } catch (error) {
      throw new Error(`Failed to fetch asset ${assetId}: ${error}`);
    }
  }

  /**
   * Get asset history/changes
   */
  async getAssetHistory(assetId: string) {
    try {
      const response = await this.client.get(`/assets/${assetId}/history`);
      return response.data;
    } catch (error) {
      throw new Error(`Failed to fetch asset history for ${assetId}: ${error}`);
    }
  }

  /**
   * Update an asset
   */
  async updateAsset(assetId: string, data: any) {
    try {
      const response = await this.client.put(`/assets/${assetId}`, data);
      return response.data;
    } catch (error) {
      throw new Error(`Failed to update asset ${assetId}: ${error}`);
    }
  }

  /**
   * Create a new asset
   */
  async createAsset(data: any) {
    try {
      const response = await this.client.post('/assets', data);
      return response.data;
    } catch (error) {
      throw new Error(`Failed to create asset: ${error}`);
    }
  }

  /**
   * Get asset categories
   */
  async getCategories() {
    try {
      const response = await this.client.get('/categories');
      return response.data;
    } catch (error) {
      throw new Error(`Failed to fetch categories: ${error}`);
    }
  }

  /**
   * Get asset locations
   */
  async getLocations() {
    try {
      const response = await this.client.get('/locations');
      return response.data;
    } catch (error) {
      throw new Error(`Failed to fetch locations: ${error}`);
    }
  }

  /**
   * Search assets
   */
  async searchAssets(query: string, filters?: any) {
    try {
      const response = await this.client.get('/assets/search', {
        params: { q: query, ...filters },
      });
      return response.data;
    } catch (error) {
      throw new Error(`Failed to search assets: ${error}`);
    }
  }
}

export default new AsseticClient();
