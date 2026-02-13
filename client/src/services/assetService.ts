import axios from 'axios';
import { authService } from './authService';

const API_URL = '/api';

class AssetService {
  async getAssets(params?: { status?: string; category?: string; limit?: number; offset?: number }) {
    const response = await axios.get(`${API_URL}/assets`, {
      headers: authService.getAuthHeader(),
      params,
    });
    return response.data;
  }

  async getAsset(id: number) {
    const response = await axios.get(`${API_URL}/assets/${id}`, {
      headers: authService.getAuthHeader(),
    });
    return response.data;
  }

  async getAssetChanges(id: number, params?: { limit?: number; offset?: number }) {
    const response = await axios.get(`${API_URL}/assets/${id}/changes`, {
      headers: authService.getAuthHeader(),
      params,
    });
    return response.data;
  }

  async syncAssets() {
    const response = await axios.post(
      `${API_URL}/assets/sync`,
      {},
      {
        headers: authService.getAuthHeader(),
      }
    );
    return response.data;
  }
}

export const assetService = new AssetService();
