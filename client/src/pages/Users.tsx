import React, { useState, useEffect } from "react";
import { adminService } from "../services/adminService";
import { maintenanceService } from "../services/maintenanceService";
import LocationHierarchyPicker, {
  EMPTY_LOCATION_SELECTION,
  LocationSelection,
} from "../components/LocationHierarchyPicker";

interface User {
  id: number;
  username: string;
  email: string;
  role: string;
  department?: string;
  phone?: string;
  display_name?: string;
  pref_region_id?: string;
  pref_region_name?: string;
  pref_site_id?: string;
  pref_site_name?: string;
  pref_building_id?: string;
  pref_building_name?: string;
  pref_floor_id?: string;
  pref_floor_name?: string;
  is_active: boolean;
  created_at: string;
  last_login?: string;
}

const EMPTY_FORM = {
  username: "",
  email: "",
  password: "",
  role: "user",
  department: "",
  phone: "",
  displayName: "",
};

const Users: React.FC = () => {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [locationHierarchy, setLocationHierarchy] = useState<any | null>(null);
  const [locationSelection, setLocationSelection] = useState<LocationSelection>(
    EMPTY_LOCATION_SELECTION,
  );

  useEffect(() => {
    fetchUsers();
    // Pre-load hierarchy so the picker is ready when the form opens
    maintenanceService
      .getLocationHierarchy()
      .then(setLocationHierarchy)
      .catch(() => {
        /* hierarchy optional */
      });
  }, []);

  const fetchUsers = async () => {
    setLoading(true);
    try {
      const data = await adminService.getUsers();
      setUsers(data.users || []);
    } catch (err: any) {
      setError("Failed to load users");
    } finally {
      setLoading(false);
    }
  };

  /** Derive cached name labels from the hierarchy tree given a location selection */
  const buildLocationNames = (sel: LocationSelection) => {
    const names = {
      prefRegionName: "",
      prefSiteName: "",
      prefBuildingName: "",
      prefFloorName: "",
    };
    if (!locationHierarchy?.regions) return names;
    const region = locationHierarchy.regions.find(
      (r: any) => r.id === sel.regionId,
    );
    if (!region) return names;
    names.prefRegionName = region.name;
    const site = region.sites?.find((s: any) => s.id === sel.siteId);
    if (!site) return names;
    names.prefSiteName = site.name;
    const building = site.buildings?.find((b: any) => b.id === sel.buildingId);
    if (!building) return names;
    names.prefBuildingName = building.name;
    const floor = building.floors?.find((f: any) => f.id === sel.floorId);
    if (floor) names.prefFloorName = floor.name;
    return names;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSuccess("");

    const locationNames = buildLocationNames(locationSelection);
    const prefPayload = {
      displayName: form.displayName || undefined,
      prefRegionId: locationSelection.regionId || undefined,
      prefRegionName: locationNames.prefRegionName || undefined,
      prefSiteId: locationSelection.siteId || undefined,
      prefSiteName: locationNames.prefSiteName || undefined,
      prefBuildingId: locationSelection.buildingId || undefined,
      prefBuildingName: locationNames.prefBuildingName || undefined,
      prefFloorId: locationSelection.floorId || undefined,
      prefFloorName: locationNames.prefFloorName || undefined,
    };

    try {
      if (editingUser) {
        const payload: any = { ...form, ...prefPayload };
        if (!payload.password) delete payload.password;
        await adminService.updateUser(editingUser.id, payload);
        setSuccess("User updated");
      } else {
        await adminService.createUser({ ...form, ...prefPayload });
        setSuccess("User created");
      }
      cancelForm();
      fetchUsers();
      setTimeout(() => setSuccess(""), 3000);
    } catch (err: any) {
      setError(err?.response?.data?.error || "Operation failed");
    }
  };

  const handleEdit = (user: User) => {
    setEditingUser(user);
    setForm({
      username: user.username,
      email: user.email,
      password: "",
      role: user.role,
      department: user.department || "",
      phone: user.phone || "",
      displayName: user.display_name || "",
    });
    setLocationSelection({
      regionId: user.pref_region_id || "",
      siteId: user.pref_site_id || "",
      buildingId: user.pref_building_id || "",
      floorId: user.pref_floor_id || "",
    });
    setShowForm(true);
  };

  const handleToggleActive = async (user: User) => {
    try {
      await adminService.updateUser(user.id, { is_active: !user.is_active });
      fetchUsers();
    } catch {
      setError("Failed to update user status");
    }
  };

  const handleDelete = async (user: User) => {
    if (!confirm(`Delete user ${user.username}? This cannot be undone.`))
      return;
    try {
      await adminService.deactivateUser(user.id);
      fetchUsers();
      setSuccess("User deleted");
      setTimeout(() => setSuccess(""), 3000);
    } catch {
      setError("Failed to delete user");
    }
  };

  const cancelForm = () => {
    setShowForm(false);
    setEditingUser(null);
    setForm(EMPTY_FORM);
    setLocationSelection(EMPTY_LOCATION_SELECTION);
  };

  /** Friendly summary of a user's preferred location for the table */
  const prefLocationSummary = (user: User) => {
    const parts = [
      user.pref_region_name,
      user.pref_site_name,
      user.pref_building_name,
      user.pref_floor_name,
    ].filter(Boolean);
    return parts.length > 0 ? parts.join(" › ") : "—";
  };

  const roleBadge = (role: string) => {
    const cls =
      role === "admin"
        ? "badge-error"
        : role === "manager"
          ? "badge-warning"
          : "badge-info";
    return <span className={`badge ${cls}`}>{role}</span>;
  };

  return (
    <div className="container">
      <div className="page-header">
        <div>
          <h2>Users</h2>
          <p style={{ color: "var(--text-secondary)" }}>
            Manage user accounts, roles and default location
          </p>
        </div>
        <button
          onClick={() => {
            cancelForm();
            setShowForm(true);
          }}
        >
          + New User
        </button>
      </div>

      {error && (
        <div
          className="error card"
          style={{ padding: "12px", marginBottom: "12px" }}
        >
          {error}
        </div>
      )}
      {success && (
        <div
          className="success card"
          style={{ padding: "12px", marginBottom: "12px" }}
        >
          {success}
        </div>
      )}

      {showForm && (
        <div className="card" style={{ marginBottom: "20px" }}>
          <h3 style={{ marginBottom: "16px" }}>
            {editingUser ? "Edit User" : "Create User"}
          </h3>
          <form onSubmit={handleSubmit}>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: "12px",
              }}
            >
              <div className="form-group">
                <label>Username</label>
                <input
                  required
                  value={form.username}
                  onChange={(e) =>
                    setForm({ ...form, username: e.target.value })
                  }
                />
              </div>
              <div className="form-group">
                <label>Email</label>
                <input
                  type="email"
                  required
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                />
              </div>
              <div className="form-group">
                <label>Password {editingUser && "(leave blank to keep)"}</label>
                <input
                  type="password"
                  required={!editingUser}
                  value={form.password}
                  onChange={(e) =>
                    setForm({ ...form, password: e.target.value })
                  }
                />
              </div>
              <div className="form-group">
                <label>Role</label>
                <select
                  value={form.role}
                  onChange={(e) => setForm({ ...form, role: e.target.value })}
                >
                  <option value="user">User</option>
                  <option value="manager">Manager</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
              <div className="form-group">
                <label>Department</label>
                <input
                  value={form.department}
                  onChange={(e) =>
                    setForm({ ...form, department: e.target.value })
                  }
                />
              </div>
              <div className="form-group">
                <label>Phone</label>
                <input
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                />
              </div>
              <div className="form-group" style={{ gridColumn: "1 / -1" }}>
                <label>
                  Display Name{" "}
                  <span style={{ color: "var(--text-muted)", fontWeight: 400 }}>
                    (shown on requests — e.g. "LGH Ward 4B")
                  </span>
                </label>
                <input
                  value={form.displayName}
                  placeholder="Optional friendly label for ward/location accounts"
                  onChange={(e) =>
                    setForm({ ...form, displayName: e.target.value })
                  }
                />
              </div>
            </div>

            {locationHierarchy && (
              <div style={{ marginTop: "16px" }}>
                <label
                  style={{
                    display: "block",
                    marginBottom: "6px",
                    fontWeight: 500,
                  }}
                >
                  Default Location{" "}
                  <span style={{ color: "var(--text-muted)", fontWeight: 400 }}>
                    (pre-fills the request form when this user logs in)
                  </span>
                </label>
                <LocationHierarchyPicker
                  hierarchy={locationHierarchy}
                  selection={locationSelection}
                  onChange={setLocationSelection}
                />
              </div>
            )}

            <div style={{ display: "flex", gap: "10px", marginTop: "16px" }}>
              <button type="submit">{editingUser ? "Update" : "Create"}</button>
              <button
                type="button"
                className="btn-outline"
                onClick={cancelForm}
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="card">
        {loading ? (
          <div className="loading">Loading users...</div>
        ) : users.length === 0 ? (
          <p
            style={{
              color: "var(--text-muted)",
              textAlign: "center",
              padding: "20px",
            }}
          >
            No users found
          </p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Username</th>
                <th>Email</th>
                <th>Role</th>
                <th>Department</th>
                <th>Default Location</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td>
                    <strong>{u.display_name || u.username}</strong>
                    {u.display_name && (
                      <div
                        style={{
                          color: "var(--text-muted)",
                          fontSize: "0.8em",
                        }}
                      >
                        {u.username}
                      </div>
                    )}
                  </td>
                  <td>{u.email}</td>
                  <td>{roleBadge(u.role)}</td>
                  <td>{u.department || "—"}</td>
                  <td
                    style={{
                      fontSize: "0.85em",
                      color: "var(--text-secondary)",
                    }}
                  >
                    {prefLocationSummary(u)}
                  </td>
                  <td>
                    <span
                      className={`badge ${u.is_active ? "badge-success" : "badge-muted"}`}
                    >
                      {u.is_active ? "Active" : "Inactive"}
                    </span>
                  </td>
                  <td>
                    <div style={{ display: "flex", gap: "6px" }}>
                      <button
                        className="btn-ghost"
                        onClick={() => handleEdit(u)}
                      >
                        Edit
                      </button>
                      <button
                        className="btn-ghost"
                        onClick={() => handleToggleActive(u)}
                      >
                        {u.is_active ? "Disable" : "Enable"}
                      </button>
                      <button
                        className="btn-ghost btn-danger-ghost"
                        onClick={() => handleDelete(u)}
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};

export default Users;
