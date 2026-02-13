import axios from 'axios';
import { authService } from './authService';

const API_URL = '/api';

interface GenerateReportParams {
  status?: string;
  category?: string;
  assetId?: number;
  startDate?: string;
  endDate?: string;
  email?: string;
}

class ReportService {
  async generateAssetReport(params: GenerateReportParams) {
    const response = await axios.post(`${API_URL}/reports/assets`, params, {
      headers: authService.getAuthHeader(),
    });
    return response.data;
  }

  async generateChangeReport(params: GenerateReportParams) {
    const response = await axios.post(`${API_URL}/reports/changes`, params, {
      headers: authService.getAuthHeader(),
    });
    return response.data;
  }

  async sendEmail(data: { to: string; subject: string; body: string; attachmentFileName?: string }) {
    const response = await axios.post(`${API_URL}/reports/email`, data, {
      headers: authService.getAuthHeader(),
    });
    return response.data;
  }

  getDownloadUrl(fileName: string): string {
    return `${API_URL}/reports/download/${fileName}`;
  }
}

export const reportService = new ReportService();
