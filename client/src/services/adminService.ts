import axios from "axios";
import { authService } from "./authService";

const API_URL = "/api/admin";

export interface AdminHierarchyBuilding {
  id: string;
  name: string;
  siteId: string;
  regionId: string;
  floors: AdminHierarchyFloor[];
}

export interface AdminHierarchyFloor {
  id: string;
  name: string;
  buildingId: string;
  siteId: string;
  regionId: string;
}

export interface AdminHierarchySite {
  id: string;
  name: string;
  regionId: string;
  buildings: AdminHierarchyBuilding[];
}

export interface AdminHierarchyRegion {
  id: string;
  name: string;
  sites: AdminHierarchySite[];
}

export interface AdminHierarchyResponse {
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
  regions: AdminHierarchyRegion[];
}

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
    const response = await axios.put(
      `${API_URL}/settings`,
      { settings },
      {
        headers: authService.getAuthHeader(),
      },
    );
    return response.data;
  }

  async testAsseticConnection() {
    const response = await axios.post(
      `${API_URL}/settings/test-assetic`,
      {},
      {
        headers: authService.getAuthHeader(),
      },
    );
    return response.data;
  }

  async getAsseticRateLimitStatus() {
    const response = await axios.get(`${API_URL}/settings/assetic-rate-limit`, {
      headers: authService.getAuthHeader(),
    });
    return response.data;
  }

  async getAsseticLocationHierarchy(
    refresh = false,
  ): Promise<AdminHierarchyResponse> {
    const response = await axios.get(
      `${API_URL}/settings/assetic-location-hierarchy`,
      {
        headers: authService.getAuthHeader(),
        params: refresh ? { refresh: true } : undefined,
      },
    );
    return response.data;
  }

  async rebuildHierarchyFromDb(): Promise<
    AdminHierarchyResponse & { regionAssignmentsUpdated: number }
  > {
    const response = await axios.post(
      `${API_URL}/settings/assetic-rebuild-hierarchy-from-db`,
      {},
      { headers: authService.getAuthHeader() },
    );
    return response.data;
  }

  async flushAndRebuild(): Promise<
    AdminHierarchyResponse & {
      message: string;
      flsSynced: number;
      buildingSiteLinksRestored: number;
      regionAssignmentsUpdated: number;
      floorAssignmentsUpdated: number;
    }
  > {
    const response = await axios.post(
      `${API_URL}/settings/assetic-flush-and-rebuild`,
      {},
      { headers: authService.getAuthHeader() },
    );
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
    displayName?: string;
    prefRegionId?: string;
    prefRegionName?: string;
    prefSiteId?: string;
    prefSiteName?: string;
    prefBuildingId?: string;
    prefBuildingName?: string;
    prefFloorId?: string;
    prefFloorName?: string;
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

  // ─── Asset Sync ─────────────────────────────────────────────────

  async getAssetSyncStatus() {
    const response = await axios.get(`${API_URL}/settings/asset-sync-status`, {
      headers: authService.getAuthHeader(),
    });
    return response.data;
  }

  async triggerAssetSync() {
    const response = await axios.post(
      `${API_URL}/settings/asset-sync-trigger`,
      {},
      { headers: authService.getAuthHeader() },
    );
    return response.data;
  }

  async getAssetSyncLogs(limit = 20) {
    const response = await axios.get(`${API_URL}/settings/asset-sync-logs`, {
      headers: authService.getAuthHeader(),
      params: { limit },
    });
    return response.data;
  }

  async triggerFlSync() {
    const response = await axios.post(
      `${API_URL}/settings/asset-sync-trigger-fls`,
      {},
      { headers: authService.getAuthHeader() },
    );
    return response.data;
  }

  async triggerAssetOnlySync() {
    const response = await axios.post(
      `${API_URL}/settings/asset-sync-trigger-assets`,
      {},
      { headers: authService.getAuthHeader() },
    );
    return response.data;
  }

  async triggerFlEnrichment() {
    const response = await axios.post(
      `${API_URL}/settings/asset-sync-trigger-enrichment`,
      {},
      { headers: authService.getAuthHeader() },
    );
    return response.data;
  }

  async getFailedRequests(params?: { status?: string; limit?: number }) {
    const response = await axios.get(`${API_URL}/failed-requests`, {
      headers: authService.getAuthHeader(),
      params,
    });
    return response.data as { failed_requests: any[] };
  }

  async getFailedRequest(id: number) {
    const response = await axios.get(`${API_URL}/failed-requests/${id}`, {
      headers: authService.getAuthHeader(),
    });
    return response.data as { failed_request: any };
  }

  async updateFailedRequest(id: number, data: Record<string, any>) {
    const response = await axios.put(`${API_URL}/failed-requests/${id}`, data, {
      headers: authService.getAuthHeader(),
    });
    return response.data as { failed_request: any };
  }

  async retryFailedRequest(id: number) {
    const response = await axios.post(
      `${API_URL}/failed-requests/${id}/retry`,
      {},
      { headers: authService.getAuthHeader() },
    );
    return response.data as {
      message: string;
      maintenance_request_id: number;
      assetic_work_request_id: string | null;
    };
  }

  async deleteFailedRequest(id: number) {
    const response = await axios.delete(`${API_URL}/failed-requests/${id}`, {
      headers: authService.getAuthHeader(),
    });
    return response.data as { message: string };
  }
}

export const adminService = new AdminService();
