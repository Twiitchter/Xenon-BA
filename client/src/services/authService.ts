import axios from "axios";

const API_URL = "/api";

interface LoginCredentials {
  username: string;
  password: string;
}

class AuthService {
  async login(credentials: LoginCredentials) {
    const response = await axios.post(`${API_URL}/auth/login`, credentials);
    if (response.data.token) {
      localStorage.setItem("token", response.data.token);
      localStorage.setItem("user", JSON.stringify(response.data.user));
    }
    return response.data;
  }

  logout() {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
  }

  getToken(): string | null {
    return localStorage.getItem("token");
  }

  getUser() {
    const userStr = localStorage.getItem("user");
    return userStr ? JSON.parse(userStr) : null;
  }

  isAdmin(): boolean {
    const user = this.getUser();
    return user?.role === "admin";
  }

  getAuthHeader() {
    const token = this.getToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  }

  async getCurrentUser() {
    const token = this.getToken();
    if (!token) {
      return null;
    }

    try {
      const response = await axios.get(`${API_URL}/auth/me`, {
        headers: this.getAuthHeader(),
      });

      localStorage.setItem("user", JSON.stringify(response.data));
      return response.data;
    } catch {
      // Stored auth is stale/invalid; clear it so UI can recover to login.
      this.logout();
      return null;
    }
  }

  async updateProfile(profileData: {
    prefRegionId?: string;
    prefRegionName?: string;
    prefSiteId?: string;
    prefSiteName?: string;
    prefBuildingId?: string;
    prefBuildingName?: string;
    prefFloorId?: string;
    prefFloorName?: string;
    phone?: string;
    mobile?: string;
    contactEmail?: string;
    displayName?: string;
  }) {
    const response = await axios.put(`${API_URL}/auth/profile`, profileData, {
      headers: this.getAuthHeader(),
    });
    localStorage.setItem("user", JSON.stringify(response.data));
    return response.data;
  }
}

export const authService = new AuthService();
