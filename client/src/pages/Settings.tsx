import React, { useEffect, useMemo, useState } from "react";
import { AdminHierarchyResponse, adminService } from "../services/adminService";

interface SettingItem {
  id: number;
  setting_key: string;
  setting_value: string | null;
  setting_type: string;
  category: string;
  description: string | null;
}

const categories = ["general", "assetic", "hierarchy", "sso", "email"];
const categoryLabels: Record<string, string> = {
  general: "General",
  assetic: "Assetic API",
  hierarchy: "Location Hierarchy",
  sso: "SSO / Authentication",
  email: "Email",
};

const Settings: React.FC = () => {
  const [settings, setSettings] = useState<SettingItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [activeCategory, setActiveCategory] = useState("general");
  const [editedValues, setEditedValues] = useState<Record<string, string>>({});
  const [testingAssetic, setTestingAssetic] = useState(false);
  const [hierarchyLoading, setHierarchyLoading] = useState(false);
  const [hierarchyError, setHierarchyError] = useState("");
  const [hierarchyData, setHierarchyData] =
    useState<AdminHierarchyResponse | null>(null);

  useEffect(() => {
    void fetchSettings();
  }, []);

  const categorySettings = useMemo(
    () =>
      activeCategory === "hierarchy"
        ? []
        : settings.filter((s) => s.category === activeCategory),
    [settings, activeCategory],
  );

  useEffect(() => {
    if (
      (activeCategory === "assetic" || activeCategory === "hierarchy") &&
      !hierarchyData &&
      !hierarchyLoading
    ) {
      void fetchAsseticHierarchy(false);
    }
  }, [activeCategory, hierarchyData, hierarchyLoading]);

  const fetchSettings = async () => {
    setLoading(true);
    setError("");
    try {
      const data = await adminService.getSettings();
      const next = data.settings || [];
      setSettings(next);

      const vals: Record<string, string> = {};
      for (const s of next) {
        vals[s.setting_key] = s.setting_value || "";
      }
      setEditedValues(vals);
    } catch (err: any) {
      setError(err?.response?.data?.error || "Failed to load settings");
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      const toSave: Record<string, string> = {};
      for (const s of categorySettings) {
        toSave[s.setting_key] =
          editedValues[s.setting_key] ?? s.setting_value ?? "";
      }
      await adminService.updateSettings(toSave);
      setSuccess("Settings saved successfully");
      setTimeout(() => setSuccess(""), 3000);
    } catch (err: any) {
      setError(err?.response?.data?.error || "Failed to save settings");
    } finally {
      setSaving(false);
    }
  };

  const handleTestAssetic = async () => {
    setTestingAssetic(true);
    setError("");
    setSuccess("");
    try {
      await handleSave();
      const result = await adminService.testAsseticConnection();
      if (result.success) {
        setSuccess("Assetic connection successful");
      } else {
        setError(`Assetic connection failed: ${result.message}`);
      }
    } catch (err: any) {
      setError(err?.response?.data?.error || "Connection test failed");
    } finally {
      setTestingAssetic(false);
    }
  };

  const fetchAsseticHierarchy = async (refresh: boolean) => {
    setHierarchyLoading(true);
    setHierarchyError("");
    try {
      const data = await adminService.getAsseticLocationHierarchy(refresh);
      setHierarchyData(data);
    } catch (err: any) {
      setHierarchyError(
        err?.response?.data?.error || "Failed to load Assetic hierarchy",
      );
    } finally {
      setHierarchyLoading(false);
    }
  };

  const renderInput = (setting: SettingItem) => {
    const value = editedValues[setting.setting_key] ?? "";
    const isSecret =
      setting.setting_key.includes("secret") ||
      setting.setting_key.includes("password") ||
      setting.setting_key.includes("api_key");

    if (setting.setting_type === "boolean") {
      return (
        <select
          value={value}
          onChange={(e) =>
            setEditedValues((prev) => ({
              ...prev,
              [setting.setting_key]: e.target.value,
            }))
          }
        >
          <option value="true">Enabled</option>
          <option value="false">Disabled</option>
        </select>
      );
    }

    return (
      <input
        type={isSecret ? "password" : "text"}
        value={value}
        onChange={(e) =>
          setEditedValues((prev) => ({
            ...prev,
            [setting.setting_key]: e.target.value,
          }))
        }
        placeholder={setting.description || ""}
      />
    );
  };

  const formatKey = (key: string) =>
    key
      .replace(/^(assetic_|sso_|email_|app_)/, "")
      .replace(/_/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase());

  return (
    <div className="container">
      <div className="page-header">
        <h2>Settings</h2>
        <p style={{ color: "var(--text-secondary)" }}>
          Configure system settings and integrations
        </p>
      </div>

      {error && <div className="error card">{error}</div>}
      {success && <div className="success card">{success}</div>}

      <div className="settings-shell">
        <aside className="card settings-menu">
          <div className="settings-menu-title">Backend Settings</div>
          {categories.map((cat) => (
            <button
              key={cat}
              className={`settings-menu-item ${activeCategory === cat ? "active" : ""}`}
              onClick={() => setActiveCategory(cat)}
              type="button"
            >
              {categoryLabels[cat]}
            </button>
          ))}
        </aside>

        <section className="card settings-panel">
          {loading && activeCategory !== "hierarchy" ? (
            <div className="loading">Loading settings...</div>
          ) : activeCategory === "hierarchy" ? (
            /* ── Location Hierarchy section ── */
            <>
              <h3 style={{ marginTop: 0 }}>Location Hierarchy</h3>
              <p className="settings-muted">
                Import and review the Assetic location hierarchy used for
                cascading Region / Site / Building / Floor selectors.
              </p>

              <div
                style={{ display: "flex", gap: "10px", marginBottom: "16px" }}
              >
                <button
                  onClick={() => void fetchAsseticHierarchy(true)}
                  disabled={hierarchyLoading}
                >
                  {hierarchyLoading
                    ? "Refreshing Hierarchy..."
                    : "Refresh Hierarchy"}
                </button>
              </div>

              {hierarchyError && <div className="error">{hierarchyError}</div>}
              {hierarchyLoading && (
                <div className="loading">Loading hierarchy...</div>
              )}
              {!hierarchyLoading && hierarchyData && (
                <div
                  className="settings-muted"
                  style={{ marginBottom: "10px" }}
                >
                  Source: <strong>{hierarchyData.source}</strong> | Regions:{" "}
                  <strong>{hierarchyData.regions.length}</strong> | Raw nodes:{" "}
                  <strong>{hierarchyData.rawNodeCount}</strong> | Records:{" "}
                  <strong>{hierarchyData.fetchedRecordCount}</strong>
                </div>
              )}
              {!hierarchyLoading &&
                hierarchyData &&
                hierarchyData.regions.length === 0 && (
                  <div className="settings-muted">
                    No hierarchy records returned.
                  </div>
                )}
              {!hierarchyLoading &&
                hierarchyData &&
                hierarchyData.regions.length > 0 && (
                  <div className="settings-tree">
                    {hierarchyData.regions.map((region) => (
                      <details key={region.id} open>
                        <summary>
                          <strong>{region.name}</strong> ({region.sites.length}{" "}
                          sites)
                        </summary>
                        <div style={{ paddingLeft: "16px" }}>
                          {region.sites.map((site) => (
                            <details key={site.id}>
                              <summary>
                                {site.name} ({site.buildings.length} buildings)
                              </summary>
                              <div style={{ paddingLeft: "16px" }}>
                                {site.buildings.map((building) => (
                                  <details key={building.id}>
                                    <summary>
                                      {building.name} (
                                      {building.floors?.length || 0} floors)
                                    </summary>
                                    {(building.floors || []).length > 0 && (
                                      <ul style={{ paddingLeft: "16px" }}>
                                        {(building.floors || []).map(
                                          (floor) => (
                                            <li key={floor.id}>{floor.name}</li>
                                          ),
                                        )}
                                      </ul>
                                    )}
                                  </details>
                                ))}
                              </div>
                            </details>
                          ))}
                        </div>
                      </details>
                    ))}
                  </div>
                )}
            </>
          ) : categorySettings.length === 0 ? (
            <div className="settings-muted">
              No settings in this category yet.
            </div>
          ) : (
            /* ── Normal category: show all settings inline ── */
            <>
              {categorySettings.map((setting) => (
                <div
                  className="form-group"
                  key={setting.setting_key}
                  style={{ marginBottom: "16px" }}
                >
                  <label>{formatKey(setting.setting_key)}</label>
                  {setting.description && (
                    <div className="settings-muted">{setting.description}</div>
                  )}
                  {renderInput(setting)}
                </div>
              ))}

              <div style={{ display: "flex", gap: "10px", marginTop: "20px" }}>
                <button onClick={handleSave} disabled={saving}>
                  {saving ? "Saving..." : "Save Settings"}
                </button>
                {activeCategory === "assetic" && (
                  <button
                    className="btn-outline"
                    onClick={handleTestAssetic}
                    disabled={testingAssetic}
                    type="button"
                  >
                    {testingAssetic ? "Testing..." : "Test Connection"}
                  </button>
                )}
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
};

export default Settings;
