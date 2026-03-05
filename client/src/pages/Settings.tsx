import React, { useState, useEffect } from "react";
import { AdminHierarchyResponse, adminService } from "../services/adminService";

interface SettingItem {
  id: number;
  setting_key: string;
  setting_value: string | null;
  setting_type: string;
  category: string;
  description: string | null;
}

const Settings: React.FC = () => {
  const [settings, setSettings] = useState<SettingItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [activeTab, setActiveTab] = useState("general");
  const [editedValues, setEditedValues] = useState<Record<string, string>>({});
  const [testingAssetic, setTestingAssetic] = useState(false);
  const [hierarchyLoading, setHierarchyLoading] = useState(false);
  const [hierarchyError, setHierarchyError] = useState("");
  const [hierarchyData, setHierarchyData] =
    useState<AdminHierarchyResponse | null>(null);

  useEffect(() => {
    fetchSettings();
  }, []);

  useEffect(() => {
    if (activeTab === "assetic" && !hierarchyData && !hierarchyLoading) {
      fetchAsseticHierarchy(false);
    }
  }, [activeTab]);

  const fetchSettings = async () => {
    setLoading(true);
    try {
      const data = await adminService.getSettings();
      setSettings(data.settings || []);
      // Initialize edited values
      const vals: Record<string, string> = {};
      for (const s of data.settings || []) {
        vals[s.setting_key] = s.setting_value || "";
      }
      setEditedValues(vals);
    } catch (err: any) {
      setError("Failed to load settings");
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      // Only send values that belong to the active category
      const categorySettings = settings.filter((s) => s.category === activeTab);
      const toSave: Record<string, string> = {};
      for (const s of categorySettings) {
        toSave[s.setting_key] =
          editedValues[s.setting_key] ?? s.setting_value ?? "";
      }
      await adminService.updateSettings(toSave);
      setSuccess("Settings saved successfully");
      setTimeout(() => setSuccess(""), 3000);
    } catch (err: any) {
      setError("Failed to save settings");
    } finally {
      setSaving(false);
    }
  };

  const handleTestAssetic = async () => {
    setTestingAssetic(true);
    setError("");
    setSuccess("");
    try {
      // Save first so test uses latest values
      await handleSave();
      const result = await adminService.testAsseticConnection();
      if (result.success) {
        setSuccess("Assetic connection successful!");
      } else {
        setError(`Assetic connection failed: ${result.message}`);
      }
    } catch (err: any) {
      setError("Connection test failed");
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
        err.response?.data?.error || "Failed to load Assetic hierarchy",
      );
    } finally {
      setHierarchyLoading(false);
    }
  };

  const categories = ["general", "assetic", "sso", "email"];
  const categoryLabels: Record<string, string> = {
    general: "General",
    assetic: "Assetic API",
    sso: "SSO / Authentication",
    email: "Email",
  };

  const filteredSettings = settings.filter((s) => s.category === activeTab);

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
            setEditedValues({
              ...editedValues,
              [setting.setting_key]: e.target.value,
            })
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
          setEditedValues({
            ...editedValues,
            [setting.setting_key]: e.target.value,
          })
        }
        placeholder={setting.description || ""}
      />
    );
  };

  const formatKey = (key: string) => {
    return key
      .replace(/^(assetic_|sso_|email_|app_)/, "")
      .replace(/_/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase());
  };

  return (
    <div className="container">
      <div className="page-header">
        <h2>Settings</h2>
        <p style={{ color: "var(--text-secondary)" }}>
          Configure system settings and integrations
        </p>
      </div>

      {/* Tabs */}
      <div className="tabs">
        {categories.map((cat) => (
          <button
            key={cat}
            className={`tab ${activeTab === cat ? "tab-active" : ""}`}
            onClick={() => setActiveTab(cat)}
          >
            {categoryLabels[cat]}
          </button>
        ))}
      </div>

      {error && (
        <div
          className="error card"
          style={{ padding: "12px", marginTop: "16px" }}
        >
          {error}
        </div>
      )}
      {success && (
        <div
          className="success card"
          style={{ padding: "12px", marginTop: "16px" }}
        >
          {success}
        </div>
      )}

      <div className="card" style={{ marginTop: "16px" }}>
        {loading ? (
          <div className="loading">Loading settings...</div>
        ) : (
          <>
            {filteredSettings.map((setting) => (
              <div key={setting.id} className="form-group">
                <label>{formatKey(setting.setting_key)}</label>
                {setting.description && (
                  <div
                    style={{
                      fontSize: "12px",
                      color: "var(--text-muted)",
                      marginBottom: "4px",
                    }}
                  >
                    {setting.description}
                  </div>
                )}
                {renderInput(setting)}
              </div>
            ))}

            <div style={{ display: "flex", gap: "10px", marginTop: "20px" }}>
              <button onClick={handleSave} disabled={saving}>
                {saving ? "Saving..." : "Save Settings"}
              </button>
              {activeTab === "assetic" && (
                <>
                  <button
                    className="btn-outline"
                    onClick={handleTestAssetic}
                    disabled={testingAssetic}
                  >
                    {testingAssetic ? "Testing..." : "Test Connection"}
                  </button>
                  <button
                    className="btn-outline"
                    onClick={() => fetchAsseticHierarchy(true)}
                    disabled={hierarchyLoading}
                  >
                    {hierarchyLoading
                      ? "Refreshing Hierarchy..."
                      : "Refresh Hierarchy"}
                  </button>
                </>
              )}
            </div>

            {activeTab === "assetic" && (
              <div
                style={{
                  marginTop: "24px",
                  borderTop: "1px solid var(--border)",
                  paddingTop: "16px",
                }}
              >
                <h3 style={{ marginBottom: "10px" }}>
                  Assetic Location Hierarchy Preview
                </h3>
                <p
                  style={{
                    color: "var(--text-muted)",
                    marginBottom: "12px",
                    fontSize: "13px",
                  }}
                >
                  Review the loaded Region/Site/Building/Floor structure pulled
                  from Assetic.
                </p>

                {hierarchyError && (
                  <div
                    className="error card"
                    style={{ padding: "10px", marginBottom: "10px" }}
                  >
                    {hierarchyError}
                  </div>
                )}

                {hierarchyLoading && (
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: "10px",
                      minHeight: "120px",
                      color: "var(--text-muted)",
                    }}
                  >
                    <svg
                      width="22"
                      height="22"
                      viewBox="0 0 50 50"
                      aria-hidden="true"
                    >
                      <circle
                        cx="25"
                        cy="25"
                        r="20"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="4"
                        strokeLinecap="round"
                        strokeDasharray="31.4 31.4"
                      >
                        <animateTransform
                          attributeName="transform"
                          type="rotate"
                          from="0 25 25"
                          to="360 25 25"
                          dur="0.8s"
                          repeatCount="indefinite"
                        />
                      </circle>
                    </svg>
                    <span>Loading hierarchy...</span>
                  </div>
                )}

                {!hierarchyLoading && hierarchyData && (
                  <>
                    <div
                      style={{
                        marginBottom: "10px",
                        fontSize: "12px",
                        color: "var(--text-muted)",
                      }}
                    >
                      Source: <strong>{hierarchyData.source}</strong> | Regions:{" "}
                      <strong>{hierarchyData.regions.length}</strong> | Raw
                      nodes: <strong>{hierarchyData.rawNodeCount}</strong> |
                      Fetched records:{" "}
                      <strong>{hierarchyData.fetchedRecordCount}</strong>
                      {typeof hierarchyData.reportedTotalCount === "number" && (
                        <>
                          {" "}
                          / Reported total:{" "}
                          <strong>{hierarchyData.reportedTotalCount}</strong>
                        </>
                      )}{" "}
                      | Pages:{" "}
                      <strong>
                        {hierarchyData.pagesFetched}/{hierarchyData.pageLimit}
                      </strong>{" "}
                      (size <strong>{hierarchyData.pageSize}</strong>) |
                      Truncated:{" "}
                      <strong>
                        {hierarchyData.isTruncated ? "yes" : "no"}
                      </strong>
                      | Generated:{" "}
                      <strong>
                        {new Date(hierarchyData.generatedAt).toLocaleString()}
                      </strong>
                    </div>
                    {hierarchyData.isTruncated && (
                      <div
                        className="error card"
                        style={{ padding: "10px", marginBottom: "10px" }}
                      >
                        Assetic hierarchy pull hit the configured page limit.
                        Data may be incomplete.
                      </div>
                    )}
                    <div
                      style={{
                        maxHeight: "420px",
                        overflow: "auto",
                        border: "1px solid var(--border)",
                        borderRadius: "8px",
                        padding: "8px",
                      }}
                    >
                      {hierarchyData.regions.length === 0 ? (
                        <div
                          style={{ color: "var(--text-muted)", padding: "8px" }}
                        >
                          No hierarchy records returned.
                        </div>
                      ) : (
                        hierarchyData.regions.map((region) => (
                          <details
                            key={region.id}
                            open
                            style={{ marginBottom: "6px" }}
                          >
                            <summary>
                              <strong>{region.name}</strong> (
                              {region.sites.length} sites)
                            </summary>
                            <div
                              style={{ paddingLeft: "16px", marginTop: "6px" }}
                            >
                              {region.sites.map((site) => (
                                <details
                                  key={site.id}
                                  style={{ marginBottom: "6px" }}
                                >
                                  <summary>
                                    {site.name} ({site.buildings.length}{" "}
                                    buildings)
                                  </summary>
                                  <div
                                    style={{
                                      marginTop: "6px",
                                      paddingLeft: "18px",
                                    }}
                                  >
                                    {site.buildings.map((building) => (
                                      <details
                                        key={building.id}
                                        style={{ marginBottom: "6px" }}
                                      >
                                        <summary>
                                          {building.name} (
                                          {building.floors?.length || 0} floors)
                                        </summary>
                                        {building.floors &&
                                          building.floors.length > 0 && (
                                            <ul
                                              style={{
                                                marginTop: "6px",
                                                paddingLeft: "18px",
                                              }}
                                            >
                                              {building.floors.map((floor) => (
                                                <li key={floor.id}>
                                                  {floor.name}
                                                </li>
                                              ))}
                                            </ul>
                                          )}
                                      </details>
                                    ))}
                                  </div>
                                </details>
                              ))}
                            </div>
                          </details>
                        ))
                      )}
                    </div>

                    <details style={{ marginTop: "12px" }}>
                      <summary>
                        Raw Pulled Data Sample (
                        {hierarchyData.rawRecordsSampleCount} records)
                      </summary>
                      <div
                        style={{
                          marginTop: "8px",
                          border: "1px solid var(--border)",
                          borderRadius: "8px",
                          padding: "8px",
                          maxHeight: "320px",
                          overflow: "auto",
                          background: "rgba(0,0,0,0.15)",
                        }}
                      >
                        <pre
                          style={{
                            margin: 0,
                            fontSize: "11px",
                            lineHeight: 1.45,
                            whiteSpace: "pre-wrap",
                            wordBreak: "break-word",
                          }}
                        >
                          {JSON.stringify(
                            hierarchyData.rawRecordsSample,
                            null,
                            2,
                          )}
                        </pre>
                      </div>
                    </details>
                  </>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default Settings;
