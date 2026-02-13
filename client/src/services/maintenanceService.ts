import axios from 'axios';
import { authService } from './authService';

const API_URL = '/api';

interface CreateRequestParams {
  title: string;
  description?: string;
  priority?: string;
  category?: string;
  location?: string;
  assetId?: number;
}

interface UpdateRequestParams {
  title?: string;
  description?: string;
  priority?: string;
  status?: string;
  category?: string;
  location?: string;
}

interface CreateWorkOrderParams {
  requestId: number;
  title: string;
  description?: string;
  priority?: string;
  craft?: string;
  assignedTo?: number;
  scheduledDate?: string;
}

interface UpdateWorkOrderParams {
  title?: string;
  description?: string;
  priority?: string;
  status?: string;
  craft?: string;
  assignedTo?: number;
  scheduledDate?: string;
}

class MaintenanceService {
  // ─── Maintenance Requests ───────────────────────────────────────────

  async getRequests(params?: { status?: string; priority?: string; limit?: number; offset?: number }) {
    const response = await axios.get(`${API_URL}/maintenance/requests`, {
      headers: authService.getAuthHeader(),
      params,
    });
    return response.data;
  }

  async getRequest(id: number) {
    const response = await axios.get(`${API_URL}/maintenance/requests/${id}`, {
      headers: authService.getAuthHeader(),
    });
    return response.data;
  }

  async createRequest(data: CreateRequestParams) {
    const response = await axios.post(`${API_URL}/maintenance/requests`, data, {
      headers: authService.getAuthHeader(),
    });
    return response.data;
  }

  async updateRequest(id: number, data: UpdateRequestParams) {
    const response = await axios.put(`${API_URL}/maintenance/requests/${id}`, data, {
      headers: authService.getAuthHeader(),
    });
    return response.data;
  }

  // ─── Work Orders ──────────────────────────────────────────────────

  async getWorkOrders(params?: { status?: string; craft?: string; limit?: number; offset?: number }) {
    const response = await axios.get(`${API_URL}/maintenance/work-orders`, {
      headers: authService.getAuthHeader(),
      params,
    });
    return response.data;
  }

  async getWorkOrder(id: number) {
    const response = await axios.get(`${API_URL}/maintenance/work-orders/${id}`, {
      headers: authService.getAuthHeader(),
    });
    return response.data;
  }

  async createWorkOrder(data: CreateWorkOrderParams) {
    const response = await axios.post(`${API_URL}/maintenance/work-orders`, data, {
      headers: authService.getAuthHeader(),
    });
    return response.data;
  }

  async updateWorkOrder(id: number, data: UpdateWorkOrderParams) {
    const response = await axios.put(`${API_URL}/maintenance/work-orders/${id}`, data, {
      headers: authService.getAuthHeader(),
    });
    return response.data;
  }

  // ─── Messages ─────────────────────────────────────────────────────

  async getMessages(workOrderId: number, params?: { limit?: number; offset?: number }) {
    const response = await axios.get(`${API_URL}/maintenance/work-orders/${workOrderId}/messages`, {
      headers: authService.getAuthHeader(),
      params,
    });
    return response.data;
  }

  async sendMessage(workOrderId: number, message: string) {
    const response = await axios.post(
      `${API_URL}/maintenance/work-orders/${workOrderId}/messages`,
      { message },
      { headers: authService.getAuthHeader() }
    );
    return response.data;
  }

  // ─── Crafts ───────────────────────────────────────────────────────

  async getCrafts() {
    const response = await axios.get(`${API_URL}/maintenance/crafts`, {
      headers: authService.getAuthHeader(),
    });
    return response.data;
  }
}

export const maintenanceService = new MaintenanceService();
