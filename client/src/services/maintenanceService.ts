import axios from "axios";
import { authService } from "./authService";
import type { PdfTemplateConfig } from "./adminService";

const API_URL = "/api";

export interface WorkRequestSource {
  id: string;
  name: string;
}

export interface LocationHierarchyBuilding {
  id: string;
  name: string;
  siteId: string;
  regionId: string;
  floors?: {
    id: string;
    name: string;
    buildingId: string;
    siteId: string;
    regionId: string;
  }[];
}

export interface LocationHierarchySite {
  id: string;
  name: string;
  regionId: string;
  buildings: LocationHierarchyBuilding[];
}

export interface LocationHierarchyRegion {
  id: string;
  name: string;
  sites: LocationHierarchySite[];
}

export interface LocationHierarchyResponse {
  source: "functionallocations" | "assets";
  generatedAt: string;
  rawNodeCount: number;
  regions: LocationHierarchyRegion[];
}

interface CreateRequestParams {
  title: string;
  description?: string;
  priority?: string;
  category?: string;
  location?: string;
  assetId?: number;
  // Assetic asset GUID (assetic_assets.assetic_guid) — passed as AssetId to Assetic
  asseticAssetGuid?: string;

  // Assetic required fields
  workRequestSourceId?: string;

  // Requestor details (at least displayName OR firstName+surname required by Assetic)
  requestorDisplayName?: string;
  requestorFirstName?: string;
  requestorSurname?: string;
  requestorEmail?: string;
  requestorPhone?: string;
  requestorMobile?: string;
  requestorTypeId?: string;

  // Optional Assetic fields
  workRequestSubtypeId?: string;
  workRequestPriorityId?: string;
  externalIdentifier?: string;
  supportingInformation?: string;

  // Physical location details
  streetNumber?: string;
  streetAddress?: string;
  citySuburb?: string;
  state?: string;
  zipPostcode?: string;
  country?: string;
  otherLocation?: string;
  whereLocation?: string;

  // Spatial location
  spatialLocation?: string;

  // Reactive inspection
  reactiveInspectorName?: string;
  reactiveInspectionDate?: string;
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
  workGroup?: string;
  assignedTo?: number;
  scheduledDate?: string;
  estimatedDuration?: number;
}

interface UpdateWorkOrderParams {
  title?: string;
  description?: string;
  priority?: string;
  status?: string;
  craft?: string;
  workGroup?: string;
  assignedTo?: number;
  scheduledDate?: string;
}

class MaintenanceService {
  // ─── My Items (Combined User View) ───────────────────────────────────

  async getMyItems(params?: {
    status?: string;
    priority?: string;
    limit?: number;
    offset?: number;
  }) {
    const response = await axios.get(`${API_URL}/maintenance/my-items`, {
      headers: authService.getAuthHeader(),
      params,
    });
    return response.data;
  }

  // ─── Maintenance Requests ───────────────────────────────────────────

  async getRequests(params?: {
    status?: string;
    priority?: string;
    limit?: number;
    offset?: number;
  }) {
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
    const response = await axios.put(
      `${API_URL}/maintenance/requests/${id}`,
      data,
      {
        headers: authService.getAuthHeader(),
      },
    );
    return response.data;
  }

  // ─── Work Orders ──────────────────────────────────────────────────

  async getWorkOrders(params?: {
    status?: string;
    craft?: string;
    limit?: number;
    offset?: number;
  }) {
    const response = await axios.get(`${API_URL}/maintenance/work-orders`, {
      headers: authService.getAuthHeader(),
      params,
    });
    return response.data;
  }

  async getWorkOrder(id: number) {
    const response = await axios.get(
      `${API_URL}/maintenance/work-orders/${id}`,
      {
        headers: authService.getAuthHeader(),
      },
    );
    return response.data;
  }

  async createWorkOrder(data: CreateWorkOrderParams) {
    const response = await axios.post(
      `${API_URL}/maintenance/work-orders`,
      data,
      {
        headers: authService.getAuthHeader(),
      },
    );
    return response.data;
  }

  async updateWorkOrder(id: number, data: UpdateWorkOrderParams) {
    const response = await axios.put(
      `${API_URL}/maintenance/work-orders/${id}`,
      data,
      {
        headers: authService.getAuthHeader(),
      },
    );
    return response.data;
  }

  // ─── Messages ─────────────────────────────────────────────────────

  async getMessages(
    workOrderId: number,
    params?: { limit?: number; offset?: number },
  ) {
    const response = await axios.get(
      `${API_URL}/maintenance/work-orders/${workOrderId}/messages`,
      {
        headers: authService.getAuthHeader(),
        params,
      },
    );
    return response.data;
  }

  async sendMessage(workOrderId: number, message: string) {
    const response = await axios.post(
      `${API_URL}/maintenance/work-orders/${workOrderId}/messages`,
      { message },
      { headers: authService.getAuthHeader() },
    );
    return response.data;
  }

  async markWorkOrderMessagesRead(workOrderId: number) {
    const response = await axios.put(
      `${API_URL}/maintenance/work-orders/${workOrderId}/messages/read`,
      {},
      { headers: authService.getAuthHeader() },
    );
    return response.data;
  }

  // ─── Request Messages ─────────────────────────────────────────────

  async getRequestMessages(requestId: number) {
    const response = await axios.get(
      `${API_URL}/maintenance/requests/${requestId}/messages`,
      { headers: authService.getAuthHeader() },
    );
    return response.data;
  }

  async sendRequestMessage(requestId: number, message: string) {
    const response = await axios.post(
      `${API_URL}/maintenance/requests/${requestId}/messages`,
      { message },
      { headers: authService.getAuthHeader() },
    );
    return response.data;
  }

  async markRequestMessagesRead(requestId: number) {
    const response = await axios.put(
      `${API_URL}/maintenance/requests/${requestId}/messages/read`,
      {},
      { headers: authService.getAuthHeader() },
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

  // ─── Attachments ──────────────────────────────────────────────────

  async getAttachments(requestId: number) {
    const response = await axios.get(
      `${API_URL}/maintenance/requests/${requestId}/attachments`,
      { headers: authService.getAuthHeader() },
    );
    return response.data;
  }

  async uploadAttachment(
    requestId: number,
    file: {
      filename: string;
      mimeType: string;
      contentBase64: string;
      fileSizeBytes?: number;
    },
  ) {
    const response = await axios.post(
      `${API_URL}/maintenance/requests/${requestId}/attachments`,
      file,
      { headers: authService.getAuthHeader() },
    );
    return response.data;
  }

  // ─── Work Groups (Assetic labour groups) ─────────────────────────

  async getWorkGroups() {
    const response = await axios.get(
      `${API_URL}/maintenance/assetic/work-groups`,
      { headers: authService.getAuthHeader() },
    );
    return response.data;
  }

  // ─── Clone Work Order ─────────────────────────────────────────────

  async cloneWorkOrder(id: number) {
    const response = await axios.post(
      `${API_URL}/maintenance/work-orders/${id}/clone`,
      {},
      { headers: authService.getAuthHeader() },
    );
    return response.data;
  }

  // ─── Assetic Integration ──────────────────────────────────────────

  async getWorkRequestSources() {
    const response = await axios.get(
      `${API_URL}/maintenance/assetic/work-request-sources`,
      {
        headers: authService.getAuthHeader(),
      },
    );
    return response.data;
  }

  async getLocationHierarchy(
    refresh = false,
  ): Promise<LocationHierarchyResponse> {
    const response = await axios.get(
      `${API_URL}/maintenance/assetic/location-hierarchy`,
      {
        headers: authService.getAuthHeader(),
        params: refresh ? { refresh: true } : undefined,
      },
    );
    return response.data;
  }

  async getPdfTemplateConfig(type: "work_order" | "work_request") {
    const response = await axios.get(
      `${API_URL}/maintenance/pdf-templates/${type}`,
      { headers: authService.getAuthHeader() },
    );
    return response.data as { template_type: string; config: PdfTemplateConfig };
  }
}

export const maintenanceService = new MaintenanceService();
