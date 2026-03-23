import React, { useState, useEffect, useMemo } from "react";
import { adminService } from "../services/adminService";
import { maintenanceService } from "../services/maintenanceService";
import Modal from "../components/Modal";
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

interface ImportResult {
  message: string;
  created: string[];
  skipped: { email: string; reason: string }[];
}

const ROLE_CHIPS = [
  { value: "admin", label: "Admin", color: "#ef4444" },
  { value: "manager", label: "Manager", color: "#f59e0b" },
  { value: "user", label: "User", color: "#0ea5e9" },
];

const STATUS_CHIPS = [
  { value: "active", label: "Active", color: "#22c55e" },
  { value: "inactive", label: "Inactive", color: "#64748b" },
];

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
  const [showImport, setShowImport] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);

  // Filter state
  const [search, setSearch] = useState("");
  const [filterRoles, setFilterRoles] = useState<string[]>([]);
  const [filterStatuses, setFilterStatuses] = useState<string[]>([]);
  const [filtersOpen, setFiltersOpen] = useState(false);

  const filteredUsers = useMemo(() => {
    let list = users;
    if (search) {
      const s = search.toLowerCase();
      list = list.filter(
        (u) =>
          u.username.toLowerCase().includes(s) ||
          u.email.toLowerCase().includes(s) ||
          (u.display_name || "").toLowerCase().includes(s) ||
          (u.department || "").toLowerCase().includes(s),
      );
    }
    if (filterRoles.length)
      list = list.filter((u) => filterRoles.includes(u.role));
    if (filterStatuses.length)
      list = list.filter((u) =>
        filterStatuses.includes(u.is_active ? "active" : "inactive"),
      );
    return list;
  }, [users, search, filterRoles, filterStatuses]);

  const toggleRole = (v: string) =>
    setFilterRoles((f) =>
      f.includes(v) ? f.filter((x) => x !== v) : [...f, v],
    );
  const toggleStatus = (v: string) =>
    setFilterStatuses((f) =>
      f.includes(v) ? f.filter((x) => x !== v) : [...f, v],
    );
  const activeFilterCount = [
    filterRoles.length > 0,
    filterStatuses.length > 0,
  ].filter(Boolean).length;

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

  const downloadTemplate = () => {
    const header =
      "email,password,username,role,first_name,last_name,department,phone,display_name";
    const example = "john.doe@example.com,ChangeMe!8,johnd,user,John,Doe,IT,,";
    const blob = new Blob([header + "\n" + example + "\n"], {
      type: "text/csv",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "user_import_template.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    setImportResult(null);
    setError("");
    const reader = new FileReader();
    reader.onload = async (ev) => {
      try {
        const csv = ev.target?.result as string;
        const result = await adminService.importUsers(csv);
        setImportResult(result);
        fetchUsers();
      } catch (err: any) {
        setError(err?.response?.data?.error || "CSV import failed");
      } finally {
        setImporting(false);
        // Reset file input so the same file can be re-uploaded if needed
        e.target.value = "";
      }
    };
    reader.readAsText(file);
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
      {/* ── Unified header card ── */}
      <div className="card filter-header-card">
        <div className="filter-topbar">
          <div>
            <h2 style={{ margin: 0 }}>Users</h2>
            <p
              style={{
                margin: "2px 0 0",
                fontSize: 13,
                color: "var(--text-muted)",
              }}
            >
              Manage user accounts, roles and default location
            </p>
          </div>
          <div className="filter-topbar-controls">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search users…"
              className="filter-search"
            />
            <button
              className={`filter-toggle-btn${
                filtersOpen ? " filter-toggle-open" : ""
              }${activeFilterCount > 0 ? " filter-toggle-active" : ""}`}
              onClick={() => setFiltersOpen((o) => !o)}
            >
              ⚙ Filters
              {activeFilterCount > 0 && (
                <span className="filter-badge">{activeFilterCount}</span>
              )}
            </button>
            <button
              className="btn-outline"
              onClick={() => {
                setShowImport((v) => !v);
                setImportResult(null);
              }}
            >
              Import CSV
            </button>
            <button
              onClick={() => {
                cancelForm();
                setShowForm(true);
              }}
            >
              + New User
            </button>
          </div>
        </div>
        {filtersOpen && (
          <div className="filter-expand">
            <div className="filter-chip-row">
              <label>Role</label>
              <div className="filter-chip-group">
                {ROLE_CHIPS.map(({ value, label, color }) => {
                  const on = filterRoles.includes(value);
                  return (
                    <button
                      key={value}
                      className="filter-chip"
                      style={
                        on
                          ? {
                              background: color,
                              borderColor: color,
                              color: "#fff",
                            }
                          : {}
                      }
                      onClick={() => toggleRole(value)}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="filter-chip-row" style={{ marginBottom: 0 }}>
              <label>Status</label>
              <div className="filter-chip-group">
                {STATUS_CHIPS.map(({ value, label, color }) => {
                  const on = filterStatuses.includes(value);
                  return (
                    <button
                      key={value}
                      className="filter-chip"
                      style={
                        on
                          ? {
                              background: color,
                              borderColor: color,
                              color: "#fff",
                            }
                          : {}
                      }
                      onClick={() => toggleStatus(value)}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}
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

      {showImport && (
        <div className="card" style={{ marginBottom: "20px" }}>
          <h3 style={{ marginBottom: "12px" }}>Import Users from CSV</h3>
          <p
            style={{
              color: "var(--text-secondary)",
              marginBottom: "12px",
              fontSize: "0.9em",
            }}
          >
            Upload a CSV file to create multiple user accounts at once.
            Passwords are encrypted with bcrypt (10 rounds). Existing emails are
            skipped.
          </p>
          <p
            style={{
              color: "var(--text-secondary)",
              marginBottom: "12px",
              fontSize: "0.85em",
            }}
          >
            Required columns: <strong>email</strong>, <strong>password</strong>{" "}
            (min 8 chars). Optional: username, role (user/manager/admin),
            first_name, last_name, department, phone, display_name.
          </p>
          <div
            style={{
              display: "flex",
              gap: "10px",
              alignItems: "center",
              flexWrap: "wrap",
            }}
          >
            <label
              style={{
                display: "inline-block",
                padding: "8px 16px",
                background: "var(--primary)",
                color: "#fff",
                borderRadius: "4px",
                cursor: importing ? "not-allowed" : "pointer",
                opacity: importing ? 0.6 : 1,
              }}
            >
              {importing ? "Importing…" : "Choose CSV File"}
              <input
                type="file"
                accept=".csv,text/csv"
                style={{ display: "none" }}
                disabled={importing}
                onChange={handleImportFile}
              />
            </label>
            <button className="btn-outline" onClick={downloadTemplate}>
              Download Template
            </button>
          </div>

          {importResult && (
            <div style={{ marginTop: "16px" }}>
              <p style={{ fontWeight: 500 }}>{importResult.message}</p>
              {importResult.created.length > 0 && (
                <div style={{ marginTop: "8px" }}>
                  <strong>Created ({importResult.created.length}):</strong>
                  <ul
                    style={{
                      margin: "4px 0 0 16px",
                      fontSize: "0.85em",
                      color: "var(--text-secondary)",
                    }}
                  >
                    {importResult.created.map((e) => (
                      <li key={e}>{e}</li>
                    ))}
                  </ul>
                </div>
              )}
              {importResult.skipped.length > 0 && (
                <div style={{ marginTop: "8px" }}>
                  <strong>Skipped ({importResult.skipped.length}):</strong>
                  <ul
                    style={{
                      margin: "4px 0 0 16px",
                      fontSize: "0.85em",
                      color: "var(--text-muted)",
                    }}
                  >
                    {importResult.skipped.map((s, i) => (
                      <li key={i}>
                        {s.email} — {s.reason}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {showForm && (
        <Modal onClose={cancelForm} maxWidth="680px" disableBackdropClose>
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
        </Modal>
      )}

      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        {loading ? (
          <div className="loading" style={{ padding: 40, textAlign: "center" }}>
            Loading users...
          </div>
        ) : filteredUsers.length === 0 ? (
          <p
            style={{
              color: "var(--text-muted)",
              textAlign: "center",
              padding: "30px",
            }}
          >
            {users.length === 0
              ? "No users found"
              : "No users match the filters"}
          </p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>User</th>
                <th>Role</th>
                <th>Department</th>
                <th>Default Location</th>
                <th>Status</th>
                <th style={{ width: 120 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredUsers.map((u) => (
                <tr key={u.id}>
                  <td>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>
                      {u.display_name || u.username}
                    </div>
                    <div
                      style={{
                        fontSize: 12,
                        color: "var(--text-muted)",
                        marginTop: 1,
                      }}
                    >
                      {u.display_name ? u.username + " · " : ""}
                      {u.email}
                    </div>
                  </td>
                  <td>{roleBadge(u.role)}</td>
                  <td style={{ fontSize: 13, color: "var(--text-secondary)" }}>
                    {u.department || "—"}
                  </td>
                  <td
                    style={{
                      fontSize: 12,
                      color: "var(--text-muted)",
                      maxWidth: 240,
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
                    <div style={{ display: "flex", gap: 4 }}>
                      <button
                        className="btn-ghost"
                        style={{ padding: "3px 8px", fontSize: 12 }}
                        onClick={() => handleEdit(u)}
                      >
                        Edit
                      </button>
                      <button
                        className="btn-ghost"
                        style={{ padding: "3px 8px", fontSize: 12 }}
                        onClick={() => handleToggleActive(u)}
                      >
                        {u.is_active ? "Disable" : "Enable"}
                      </button>
                      <button
                        className="btn-ghost btn-danger-ghost"
                        style={{ padding: "3px 8px", fontSize: 12 }}
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
