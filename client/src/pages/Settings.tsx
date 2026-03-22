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

const categories = ["general", "assetic", "hierarchy", "sync", "sso", "email"];
const categoryLabels: Record<string, string> = {
  general: "General",
  assetic: "Assetic API",
  hierarchy: "Location Hierarchy",
  sync: "Asset Sync",
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
  const [hierarchyRebuildLoading, setHierarchyRebuildLoading] = useState(false);
  const [hierarchyFlushLoading, setHierarchyFlushLoading] = useState(false);
  const [hierarchyError, setHierarchyError] = useState("");
  const [hierarchyData, setHierarchyData] =
    useState<AdminHierarchyResponse | null>(null);
  const [syncStatus, setSyncStatus] = useState<any>(null);
  const [syncLogs, setSyncLogs] = useState<any[]>([]);
  const [syncLoading, setSyncLoading] = useState(false);
  const [syncTriggering, setSyncTriggering] = useState<string | null>(null);
  const [testEmailAddress, setTestEmailAddress] = useState("");
  const [testingEmail, setTestingEmail] = useState(false);

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

  useEffect(() => {
    if (activeCategory === "sync") {
      void fetchSyncStatus();
    }
  }, [activeCategory]);

  // Auto-refresh sync status while running
  useEffect(() => {
    if (activeCategory !== "sync" || !syncStatus?.isRunning) return;
    const timer = setInterval(() => void fetchSyncStatus(), 3000);
    return () => clearInterval(timer);
  }, [activeCategory, syncStatus?.isRunning]);

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

  const handleRebuildFromDb = async () => {
    setHierarchyRebuildLoading(true);
    setHierarchyError("");
    try {
      const data = await adminService.rebuildHierarchyFromDb();
      setHierarchyData(data);
    } catch (err: any) {
      setHierarchyError(
        err?.response?.data?.error || "Failed to rebuild hierarchy from DB",
      );
    } finally {
      setHierarchyRebuildLoading(false);
    }
  };

  const handleFlushAndRebuild = async () => {
    if (
      !confirm(
        "This will DELETE all synced assets and functional locations then re-fetch everything from the Assetic API.\n\nThe asset sync will run in the background and may take several hours.\n\nContinue?",
      )
    )
      return;
    setHierarchyFlushLoading(true);
    setHierarchyError("");
    try {
      const data = await adminService.flushAndRebuild();
      setHierarchyData(data);
      setSuccess(
        data.message || "Flush complete. Asset sync running in background.",
      );
      setTimeout(() => setSuccess(""), 8000);
    } catch (err: any) {
      setHierarchyError(
        err?.response?.data?.error || "Flush and rebuild failed",
      );
    } finally {
      setHierarchyFlushLoading(false);
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

  const fetchSyncStatus = async () => {
    setSyncLoading(true);
    try {
      const [status, logs] = await Promise.all([
        adminService.getAssetSyncStatus(),
        adminService.getAssetSyncLogs(10),
      ]);
      setSyncStatus(status);
      setSyncLogs(logs);
    } catch {
      // ignore
    } finally {
      setSyncLoading(false);
    }
  };

  const handleTriggerStep = async (
    step: "full" | "fls" | "assets" | "enrichment",
  ) => {
    setSyncTriggering(step);
    setError("");
    setSuccess("");
    const labels: Record<string, string> = {
      full: "Full sync",
      fls: "Functional location sync",
      assets: "Asset sync",
      enrichment: "FL enrichment",
    };
    try {
      if (step === "full") await adminService.triggerAssetSync();
      else if (step === "fls") await adminService.triggerFlSync();
      else if (step === "assets") await adminService.triggerAssetOnlySync();
      else await adminService.triggerFlEnrichment();
      setSuccess(
        `${labels[step]} started. Progress will update automatically.`,
      );
      setTimeout(() => setSuccess(""), 5000);
      setTimeout(() => void fetchSyncStatus(), 2000);
    } catch (err: any) {
      setError(err?.response?.data?.error || `Failed to start ${labels[step]}`);
    } finally {
      setSyncTriggering(null);
    }
  };

  const formatKey = (key: string) =>
    key
      .replace(/^(assetic_|sso_|email_|app_)/, "")
      .replace(/_/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase());

  const handleTestEmail = async () => {
    if (!testEmailAddress) {
      setError("Please enter a recipient email address");
      return;
    }
    setTestingEmail(true);
    setError("");
    setSuccess("");
    try {
      await handleSave();
      const result = await adminService.testEmail(testEmailAddress);
      if (result.success) {
        setSuccess(result.message);
      } else {
        setError(`Test email failed: ${result.message}`);
      }
    } catch (err: any) {
      setError(err?.response?.data?.error || "Test email failed");
    } finally {
      setTestingEmail(false);
    }
  };

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
          {loading &&
          activeCategory !== "hierarchy" &&
          activeCategory !== "sync" ? (
            <div className="loading">Loading settings...</div>
          ) : activeCategory === "sync" ? (
            /* ── Asset Sync section ── */
            <>
              <h3 style={{ marginTop: 0 }}>Asset Sync</h3>
              <p className="settings-muted">
                Sync all assets from the Assetic API into the local database.
                The system checks hourly if the API asset count differs from the
                local count and triggers a sync automatically. After syncing
                assets, each asset's functional location is fetched to build the
                location hierarchy.
              </p>

              {/* Running banner */}
              {syncStatus?.isRunning && (
                <div
                  style={{
                    padding: "8px 12px",
                    marginBottom: "12px",
                    background: "var(--bg-tertiary, #2a2a2a)",
                    borderRadius: "6px",
                    fontSize: "0.9em",
                  }}
                >
                  ⏳ <strong>{syncStatus.syncType}</strong> running…{" "}
                  {syncStatus.progress != null && `${syncStatus.progress}%`}
                  {syncStatus.syncedCount != null &&
                    syncStatus.totalCount != null &&
                    ` (${syncStatus.syncedCount.toLocaleString()} / ${syncStatus.totalCount.toLocaleString()})`}
                </div>
              )}

              {/* Step buttons */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
                  gap: "8px",
                  marginBottom: "16px",
                }}
              >
                <button
                  onClick={() => handleTriggerStep("full")}
                  disabled={!!syncTriggering || syncStatus?.isRunning}
                  title="Run all three steps in sequence"
                >
                  {syncTriggering === "full" ? "Starting…" : "Full Sync"}
                </button>
                <button
                  className="btn-outline"
                  onClick={() => handleTriggerStep("fls")}
                  disabled={!!syncTriggering || syncStatus?.isRunning}
                  title="Fetch all functional locations from /functionallocations"
                >
                  {syncTriggering === "fls" ? "Starting…" : "Sync FL List"}
                </button>
                <button
                  className="btn-outline"
                  onClick={() => handleTriggerStep("assets")}
                  disabled={!!syncTriggering || syncStatus?.isRunning}
                  title="Fetch all assets from /assets"
                >
                  {syncTriggering === "assets" ? "Starting…" : "Sync Assets"}
                </button>
                <button
                  className="btn-outline"
                  onClick={() => handleTriggerStep("enrichment")}
                  disabled={!!syncTriggering || syncStatus?.isRunning}
                  title="Fetch FL relationship per asset from /assets/{guid}/functionallocation"
                >
                  {syncTriggering === "enrichment"
                    ? "Starting…"
                    : "FL Enrichment"}
                </button>
                <button
                  className="btn-outline"
                  onClick={() => void fetchSyncStatus()}
                  disabled={syncLoading}
                >
                  {syncLoading ? "Refreshing…" : "Refresh Status"}
                </button>
              </div>

              {syncStatus && (
                <div
                  className="card"
                  style={{ marginBottom: "16px", padding: "16px" }}
                >
                  <h4 style={{ marginTop: 0 }}>Current Status</h4>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr 1fr",
                      gap: "8px",
                    }}
                  >
                    <div>
                      <span className="settings-muted">API Assets:</span>{" "}
                      <strong>{syncStatus.apiAssetCount ?? "–"}</strong>
                    </div>
                    <div>
                      <span className="settings-muted">DB Assets:</span>{" "}
                      <strong>{syncStatus.dbAssetCount ?? 0}</strong>
                    </div>
                    <div>
                      <span className="settings-muted">Running:</span>{" "}
                      <strong>
                        {syncStatus.isRunning
                          ? `Yes (${syncStatus.syncType})`
                          : "No"}
                      </strong>
                    </div>
                    {syncStatus.isRunning && (
                      <div>
                        <span className="settings-muted">Progress:</span>{" "}
                        <strong>
                          {syncStatus.syncedCount ?? 0} /{" "}
                          {syncStatus.totalCount ?? "?"} (
                          {syncStatus.progress ?? 0}%)
                        </strong>
                      </div>
                    )}
                  </div>

                  {syncStatus.isRunning && syncStatus.progress != null && (
                    <div
                      style={{
                        marginTop: "12px",
                        background: "var(--bg-tertiary, #333)",
                        borderRadius: "4px",
                        height: "8px",
                        overflow: "hidden",
                      }}
                    >
                      <div
                        style={{
                          width: `${syncStatus.progress}%`,
                          height: "100%",
                          background: "var(--accent, #4f8eff)",
                          transition: "width 0.3s ease",
                        }}
                      />
                    </div>
                  )}

                  {syncStatus.lastSync && (
                    <div style={{ marginTop: "12px" }}>
                      <span className="settings-muted">Last sync:</span>{" "}
                      <strong>{syncStatus.lastSync.type}</strong> —{" "}
                      {syncStatus.lastSync.status} (
                      {syncStatus.lastSync.syncedCount ?? 0} synced
                      {syncStatus.lastSync.errorCount
                        ? `, ${syncStatus.lastSync.errorCount} errors`
                        : ""}
                      )
                      {syncStatus.lastSync.completedAt &&
                        ` — ${new Date(syncStatus.lastSync.completedAt).toLocaleString()}`}
                    </div>
                  )}
                </div>
              )}

              {syncLogs.length > 0 && (
                <div>
                  <h4>Recent Sync Logs</h4>
                  <table style={{ width: "100%", fontSize: "0.85em" }}>
                    <thead>
                      <tr>
                        <th>Type</th>
                        <th>Status</th>
                        <th>Synced</th>
                        <th>Errors</th>
                        <th>Started</th>
                        <th>Completed</th>
                      </tr>
                    </thead>
                    <tbody>
                      {syncLogs.map((log: any) => (
                        <tr key={log.id}>
                          <td>{log.sync_type}</td>
                          <td>
                            <span
                              style={{
                                color:
                                  log.status === "completed"
                                    ? "var(--success, #4caf50)"
                                    : log.status === "failed"
                                      ? "var(--error, #f44336)"
                                      : "var(--warning, #ff9800)",
                              }}
                            >
                              {log.status}
                            </span>
                          </td>
                          <td>{log.synced_count ?? "–"}</td>
                          <td>{log.error_count ?? 0}</td>
                          <td>
                            {log.started_at
                              ? new Date(log.started_at).toLocaleString()
                              : "–"}
                          </td>
                          <td>
                            {log.completed_at
                              ? new Date(log.completed_at).toLocaleString()
                              : "–"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
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
                  disabled={hierarchyLoading || hierarchyRebuildLoading}
                >
                  {hierarchyLoading ? "Refreshing..." : "Refresh Hierarchy"}
                </button>
                <button
                  className="btn-outline"
                  onClick={() => void handleRebuildFromDb()}
                  disabled={
                    hierarchyLoading ||
                    hierarchyRebuildLoading ||
                    hierarchyFlushLoading
                  }
                  title="Sync region assignments from asset data then rebuild the hierarchy from the local database — no Assetic API call"
                >
                  {hierarchyRebuildLoading
                    ? "Rebuilding..."
                    : "Rebuild from DB"}
                </button>
                <button
                  className="btn-outline btn-danger-outline"
                  onClick={() => void handleFlushAndRebuild()}
                  disabled={
                    hierarchyLoading ||
                    hierarchyRebuildLoading ||
                    hierarchyFlushLoading
                  }
                  title="DESTRUCTIVE: Wipe all synced data and re-fetch everything fresh from Assetic. Use when assets or buildings are missing."
                >
                  {hierarchyFlushLoading
                    ? "Flushing..."
                    : "Flush & Full Rebuild"}
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
          ) : activeCategory === "assetic" ? (
            /* ── Assetic API: custom layout with dynamic worker fields ── */
            (() => {
              const workerKeyPattern =
                /^assetic_worker_\d+_(username|api_key)$/;
              const coreSettings = categorySettings.filter(
                (s) =>
                  s.setting_key !== "assetic_worker_count" &&
                  !workerKeyPattern.test(s.setting_key),
              );
              const workerCountVal = parseInt(
                editedValues["assetic_worker_count"] || "1",
                10,
              );
              const workerCount = Math.max(
                1,
                Math.min(10, workerCountVal || 1),
              );

              return (
                <>
                  {/* Core Assetic settings */}
                  {coreSettings.map((setting) => (
                    <div
                      className="form-group"
                      key={setting.setting_key}
                      style={{ marginBottom: "16px" }}
                    >
                      <label>{formatKey(setting.setting_key)}</label>
                      {setting.description && (
                        <div className="settings-muted">
                          {setting.description}
                        </div>
                      )}
                      {renderInput(setting)}
                    </div>
                  ))}

                  {/* Worker Pool section */}
                  <hr
                    style={{
                      border: "none",
                      borderTop: "1px solid var(--border, #444)",
                      margin: "24px 0 16px",
                    }}
                  />
                  <h4 style={{ margin: "0 0 4px" }}>Worker Pool</h4>
                  <p
                    className="settings-muted"
                    style={{ marginBottom: "16px" }}
                  >
                    Each worker uses a separate Assetic API account with its own
                    250 req/min rate limit. Total throughput = workers × 250
                    req/min.
                  </p>

                  <div className="form-group" style={{ marginBottom: "20px" }}>
                    <label>Number of Workers</label>
                    <select
                      value={String(workerCount)}
                      onChange={(e) =>
                        setEditedValues((prev) => ({
                          ...prev,
                          assetic_worker_count: e.target.value,
                        }))
                      }
                      style={{ maxWidth: "120px" }}
                    >
                      {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
                        <option key={n} value={String(n)}>
                          {n}
                        </option>
                      ))}
                    </select>
                    <div
                      className="settings-muted"
                      style={{ marginTop: "4px" }}
                    >
                      Capacity: <strong>{workerCount * 250}</strong> req/min
                    </div>
                  </div>

                  {/* Dynamic worker credential fields */}
                  {Array.from({ length: workerCount }, (_, i) => i + 1).map(
                    (n) => {
                      const uKey = `assetic_worker_${n}_username`;
                      const kKey = `assetic_worker_${n}_api_key`;
                      return (
                        <div
                          key={n}
                          style={{
                            border: "1px solid var(--border, #444)",
                            borderRadius: "6px",
                            padding: "12px 16px",
                            marginBottom: "12px",
                          }}
                        >
                          <div
                            style={{
                              fontWeight: 600,
                              marginBottom: "8px",
                              fontSize: "0.9em",
                            }}
                          >
                            Worker {n}
                          </div>
                          <div
                            className="form-group"
                            style={{ marginBottom: "10px" }}
                          >
                            <label style={{ fontSize: "0.85em" }}>
                              Username
                            </label>
                            <input
                              type="text"
                              value={editedValues[uKey] ?? ""}
                              onChange={(e) =>
                                setEditedValues((prev) => ({
                                  ...prev,
                                  [uKey]: e.target.value,
                                }))
                              }
                              placeholder="Leave blank to use default"
                            />
                          </div>
                          <div className="form-group">
                            <label style={{ fontSize: "0.85em" }}>
                              API Key
                            </label>
                            <input
                              type="password"
                              value={editedValues[kKey] ?? ""}
                              onChange={(e) =>
                                setEditedValues((prev) => ({
                                  ...prev,
                                  [kKey]: e.target.value,
                                }))
                              }
                              placeholder="Leave blank to use default"
                            />
                          </div>
                        </div>
                      );
                    },
                  )}

                  <div
                    style={{ display: "flex", gap: "10px", marginTop: "20px" }}
                  >
                    <button onClick={handleSave} disabled={saving}>
                      {saving ? "Saving..." : "Save Settings"}
                    </button>
                    <button
                      className="btn-outline"
                      onClick={handleTestAssetic}
                      disabled={testingAssetic}
                      type="button"
                    >
                      {testingAssetic ? "Testing..." : "Test Connection"}
                    </button>
                  </div>
                </>
              );
            })()
          ) : activeCategory === "email" ? (
            /* ── Email settings with test button ── */
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

              <div
                style={{
                  borderTop: "1px solid var(--border, #444)",
                  marginTop: "20px",
                  paddingTop: "16px",
                }}
              >
                <h4 style={{ margin: "0 0 8px" }}>Send Test Email</h4>
                <p className="settings-muted">
                  Save your settings then send a test email to verify the
                  configuration.
                </p>
                <div
                  style={{ display: "flex", gap: "10px", alignItems: "center" }}
                >
                  <input
                    type="email"
                    placeholder="Recipient email address"
                    value={testEmailAddress}
                    onChange={(e) => setTestEmailAddress(e.target.value)}
                    style={{ flex: 1 }}
                  />
                  <button
                    className="btn-outline"
                    onClick={handleTestEmail}
                    disabled={testingEmail}
                    type="button"
                  >
                    {testingEmail ? "Sending..." : "Send Test"}
                  </button>
                </div>
              </div>

              <div style={{ display: "flex", gap: "10px", marginTop: "20px" }}>
                <button onClick={handleSave} disabled={saving}>
                  {saving ? "Saving..." : "Save Settings"}
                </button>
              </div>
            </>
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
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
};

export default Settings;
