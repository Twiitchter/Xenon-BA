import axios from 'axios';
import { authService } from './authService';

const API_URL = '/api/admin';

class AdminService {
  // ─── Settings ─────────────────────────────────────────────────────

  async getSettings(category?: string) {
    const response = await axios.get(`${API_URL}/settings`, {
      headers: authService.getAuthHeader(),
      params: category ? { category } : undefined,
    });
    return response.data;
  }

  async updateSettings(settings: Record<string, string>) {
    const response = await axios.put(`${API_URL}/settings`, { settings }, {
      headers: authService.getAuthHeader(),
    });
    return response.data;
  }

  async testAsseticConnection() {
    const response = await axios.post(`${API_URL}/settings/test-assetic`, {}, {
      headers: authService.getAuthHeader(),
    });
    return response.data;
  }

  async getAsseticRateLimitStatus() {
    const response = await axios.get(`${API_URL}/settings/assetic-rate-limit`, {
      headers: authService.getAuthHeader(),
    });
    return response.data;
  }

  // ─── Users ────────────────────────────────────────────────────────

  async getUsers() {
    const response = await axios.get(`${API_URL}/users`, {
      headers: authService.getAuthHeader(),
    });
    return response.data;
  }

  async createUser(data: {
    email: string;
    password: string;
    firstName?: string;
    lastName?: string;
    role?: string;
    department?: string;
    phone?: string;
  }) {
    const response = await axios.post(`${API_URL}/users`, data, {
      headers: authService.getAuthHeader(),
    });
    return response.data;
  }

  async updateUser(id: number, data: any) {
    const response = await axios.put(`${API_URL}/users/${id}`, data, {
      headers: authService.getAuthHeader(),
    });
    return response.data;
  }

  async deactivateUser(id: number) {
    const response = await axios.delete(`${API_URL}/users/${id}`, {
      headers: authService.getAuthHeader(),
    });
    return response.data;
  }

  // ─── Stats / Activity ────────────────────────────────────────────

  async getStats() {
    const response = await axios.get(`${API_URL}/stats`, {
      headers: authService.getAuthHeader(),
    });
    return response.data;
  }

  async getActivity(limit = 50) {
    const response = await axios.get(`${API_URL}/activity`, {
      headers: authService.getAuthHeader(),
      params: { limit },
    });
    return response.data;
  }
}

export const adminService = new AdminService();
