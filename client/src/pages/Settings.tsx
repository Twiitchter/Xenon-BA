import React, { useEffect, useMemo, useState } from "react";
import {
  AdminHierarchyResponse,
  adminService,
  Contractor,
} from "../services/adminService";
import PdfTemplateEditor from "../components/PdfTemplateEditor";
import FailedRequests from "./FailedRequests";
import FailedWorkOrders from "./FailedWorkOrders";

interface SettingItem {
  id: number;
  setting_key: string;
  setting_value: string | null;
  setting_type: string;
  category: string;
  description: string | null;
}

const categories = [
  "general",
  "assetic",
  "hierarchy",
  "sync",
  "sso",
  "email",
  "contractors",
  "pdf_templates",
  "failed_requests",
  "failed_work_orders",
];
const categoryLabels: Record<string, string> = {
  general: "General",
  assetic: "Assetic API",
  hierarchy: "Location Hierarchy",
  sync: "Asset Sync",
  sso: "SSO / Authentication",
  email: "Email",
  contractors: "Contractors",
  pdf_templates: "PDF Templates",
  failed_requests: "Failed Requests",
  failed_work_orders: "Failed Work Orders",
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

  // ─── Contractors ───────────────────────────────────────────────────────────
  const [contractors, setContractors] = useState<Contractor[]>([]);
  const [contractorLoading, setContractorLoading] = useState(false);
  const [contractorSaving, setContractorSaving] = useState(false);
  const [editingContractor, setEditingContractor] =
    useState<Partial<Contractor> | null>(null);
  const [isNewContractor, setIsNewContractor] = useState(false);
  // tradesInput is a comma-separated string for the UI
  const [tradesInput, setTradesInput] = useState("");

  useEffect(() => {
    void fetchSettings();
  }, []);

  useEffect(() => {
    if (activeCategory === "contractors") {
      void fetchContractors();
    }
  }, [activeCategory]);

  const categorySettings = useMemo(
    () =>
      activeCategory === "hierarchy" ||
      activeCategory === "sync" ||
      activeCategory === "contractors" ||
      activeCategory === "pdf_templates" ||
      activeCategory === "failed_requests" ||
      activeCategory === "failed_work_orders"
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

  // ─── Contractor helpers ────────────────────────────────────────────────────

  const fetchContractors = async () => {
    setContractorLoading(true);
    try {
      const data = await adminService.getContractors();
      setContractors(data.contractors);
    } catch (err: any) {
      setError(err?.response?.data?.error || "Failed to load contractors");
    } finally {
      setContractorLoading(false);
    }
  };

  const openNewContractor = () => {
    setEditingContractor({
      name: "",
      email: "",
      phone: "",
      company: "",
      trades: [],
      receives_work_orders: false,
      is_active: true,
      email_template: "",
      notes: "",
    });
    setTradesInput("");
    setIsNewContractor(true);
  };

  const openEditContractor = (c: Contractor) => {
    setEditingContractor({ ...c });
    setTradesInput((c.trades || []).join(", "));
    setIsNewContractor(false);
  };

  const handleSaveContractor = async () => {
    if (!editingContractor) return;
    setContractorSaving(true);
    setError("");
    try {
      const trades = tradesInput
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
      const payload = { ...editingContractor, trades };
      if (isNewContractor) {
        await adminService.createContractor(
          payload as Omit<Contractor, "id" | "created_at" | "updated_at">,
        );
      } else {
        await adminService.updateContractor(editingContractor.id!, payload);
      }
      setEditingContractor(null);
      await fetchContractors();
      setSuccess(isNewContractor ? "Contractor added" : "Contractor updated");
      setTimeout(() => setSuccess(""), 3000);
    } catch (err: any) {
      setError(err?.response?.data?.error || "Failed to save contractor");
    } finally {
      setContractorSaving(false);
    }
  };

  const handleDeleteContractor = async (id: number) => {
    if (!confirm("Delete this contractor? This cannot be undone.")) return;
    try {
      await adminService.deleteContractor(id);
      setContractors((prev) => prev.filter((c) => c.id !== id));
      setSuccess("Contractor deleted");
      setTimeout(() => setSuccess(""), 3000);
    } catch (err: any) {
      setError(err?.response?.data?.error || "Failed to delete contractor");
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
          activeCategory !== "sync" &&
          activeCategory !== "contractors" &&
          activeCategory !== "pdf_templates" &&
          activeCategory !== "failed_requests" &&
          activeCategory !== "failed_work_orders" ? (
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
          ) : activeCategory === "pdf_templates" ? (
            /* ── PDF Templates section ── */
            <PdfTemplateEditor />
          ) : activeCategory === "failed_requests" ? (
            /* ── Failed Requests section ── */
            <FailedRequests embedded />
          ) : activeCategory === "failed_work_orders" ? (
            /* ── Failed Work Orders section ── */
            <FailedWorkOrders embedded />
          ) : categorySettings.length === 0 &&
            activeCategory !== "contractors" ? (
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
          ) : activeCategory === "contractors" ? (
            /* ── Contractors ── */
            <>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: "16px",
                }}
              >
                <div>
                  <h3 style={{ margin: 0 }}>Contractors</h3>
                  <p className="settings-muted" style={{ margin: "4px 0 0" }}>
                    Manage external contractors who can receive work order
                    notifications by email. Assign trades to filter which work
                    orders they are notified about (leave empty to receive all).
                  </p>
                </div>
                <button
                  onClick={openNewContractor}
                  style={{ whiteSpace: "nowrap", flexShrink: 0 }}
                >
                  + Add Contractor
                </button>
              </div>

              {/* Inline add/edit form */}
              {editingContractor && (
                <div
                  style={{
                    border: "1px solid var(--border)",
                    borderRadius: "8px",
                    padding: "16px 20px",
                    marginBottom: "20px",
                    background: "var(--bg-secondary)",
                  }}
                >
                  <h4 style={{ margin: "0 0 14px" }}>
                    {isNewContractor ? "New Contractor" : "Edit Contractor"}
                  </h4>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr 1fr",
                      gap: "12px",
                    }}
                  >
                    <div className="form-group" style={{ marginBottom: 0 }}>
                      <label>Name *</label>
                      <input
                        type="text"
                        value={editingContractor.name || ""}
                        onChange={(e) =>
                          setEditingContractor((p) => ({
                            ...p!,
                            name: e.target.value,
                          }))
                        }
                        placeholder="Full name"
                      />
                    </div>
                    <div className="form-group" style={{ marginBottom: 0 }}>
                      <label>Email *</label>
                      <input
                        type="email"
                        value={editingContractor.email || ""}
                        onChange={(e) =>
                          setEditingContractor((p) => ({
                            ...p!,
                            email: e.target.value,
                          }))
                        }
                        placeholder="contractor@example.com"
                      />
                    </div>
                    <div className="form-group" style={{ marginBottom: 0 }}>
                      <label>Phone</label>
                      <input
                        type="text"
                        value={editingContractor.phone || ""}
                        onChange={(e) =>
                          setEditingContractor((p) => ({
                            ...p!,
                            phone: e.target.value,
                          }))
                        }
                        placeholder="+61 4xx xxx xxx"
                      />
                    </div>
                    <div className="form-group" style={{ marginBottom: 0 }}>
                      <label>Company</label>
                      <input
                        type="text"
                        value={editingContractor.company || ""}
                        onChange={(e) =>
                          setEditingContractor((p) => ({
                            ...p!,
                            company: e.target.value,
                          }))
                        }
                        placeholder="ABC Maintenance Pty Ltd"
                      />
                    </div>
                    <div className="form-group" style={{ marginBottom: 0 }}>
                      <label>Trades (comma-separated)</label>
                      <input
                        type="text"
                        value={tradesInput}
                        onChange={(e) => setTradesInput(e.target.value)}
                        placeholder="Carpenter, Painter, Plumber — blank = all trades"
                      />
                      <div className="settings-muted" style={{ marginTop: 3 }}>
                        Leave blank to receive work orders for any trade.
                      </div>
                    </div>
                    <div
                      style={{
                        display: "flex",
                        gap: "20px",
                        alignItems: "center",
                        paddingTop: "6px",
                      }}
                    >
                      <label
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "8px",
                          cursor: "pointer",
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={!!editingContractor.receives_work_orders}
                          onChange={(e) =>
                            setEditingContractor((p) => ({
                              ...p!,
                              receives_work_orders: e.target.checked,
                            }))
                          }
                        />
                        Receives WO notifications
                      </label>
                      {!isNewContractor && (
                        <label
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "8px",
                            cursor: "pointer",
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={!!editingContractor.is_active}
                            onChange={(e) =>
                              setEditingContractor((p) => ({
                                ...p!,
                                is_active: e.target.checked,
                              }))
                            }
                          />
                          Active
                        </label>
                      )}
                    </div>
                  </div>

                  <div className="form-group" style={{ marginTop: "12px" }}>
                    <label>Email Template</label>
                    <div className="settings-muted" style={{ marginBottom: 4 }}>
                      Optional custom HTML/text body. Leave blank to use the
                      default system template. Available variables:{" "}
                      <code>
                        {
                          "{{work_order_id}} {{title}} {{description}} {{location}} {{priority}} {{craft}} {{work_group}} {{requestor_name}} {{portal_url}} {{app_name}}"
                        }
                      </code>
                    </div>
                    <textarea
                      rows={6}
                      value={editingContractor.email_template || ""}
                      onChange={(e) =>
                        setEditingContractor((p) => ({
                          ...p!,
                          email_template: e.target.value,
                        }))
                      }
                      placeholder="Hi {{requestor_name}},&#10;&#10;A new work order ({{work_order_id}}) has been raised: {{title}}&#10;&#10;Location: {{location}}&#10;Trade: {{craft}}"
                      style={{ width: "100%", boxSizing: "border-box" }}
                    />
                  </div>

                  <div className="form-group" style={{ marginTop: "8px" }}>
                    <label>Notes</label>
                    <textarea
                      rows={2}
                      value={editingContractor.notes || ""}
                      onChange={(e) =>
                        setEditingContractor((p) => ({
                          ...p!,
                          notes: e.target.value,
                        }))
                      }
                      placeholder="Internal notes about this contractor"
                      style={{ width: "100%", boxSizing: "border-box" }}
                    />
                  </div>

                  <div
                    style={{ display: "flex", gap: "10px", marginTop: "8px" }}
                  >
                    <button
                      onClick={handleSaveContractor}
                      disabled={contractorSaving}
                    >
                      {contractorSaving
                        ? "Saving…"
                        : isNewContractor
                          ? "Add Contractor"
                          : "Save Changes"}
                    </button>
                    <button
                      className="btn-outline"
                      onClick={() => setEditingContractor(null)}
                      type="button"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {/* Contractor list */}
              {contractorLoading ? (
                <div className="loading">Loading contractors…</div>
              ) : contractors.length === 0 ? (
                <div
                  style={{
                    padding: "24px",
                    textAlign: "center",
                    color: "var(--text-muted)",
                    border: "1px dashed var(--border, #444)",
                    borderRadius: "8px",
                  }}
                >
                  No contractors yet. Click <strong>+ Add Contractor</strong> to
                  get started.
                </div>
              ) : (
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr
                      style={{
                        borderBottom: "1px solid var(--border, #444)",
                        fontSize: "11px",
                        textTransform: "uppercase",
                        color: "var(--text-muted)",
                      }}
                    >
                      <th style={{ textAlign: "left", padding: "6px 8px" }}>
                        Name / Company
                      </th>
                      <th style={{ textAlign: "left", padding: "6px 8px" }}>
                        Email
                      </th>
                      <th style={{ textAlign: "left", padding: "6px 8px" }}>
                        Trades
                      </th>
                      <th style={{ textAlign: "center", padding: "6px 8px" }}>
                        WO Alerts
                      </th>
                      <th style={{ textAlign: "center", padding: "6px 8px" }}>
                        Active
                      </th>
                      <th style={{ padding: "6px 8px" }} />
                    </tr>
                  </thead>
                  <tbody>
                    {contractors.map((c) => (
                      <tr
                        key={c.id}
                        style={{
                          borderBottom: "1px solid var(--border, #33333388)",
                        }}
                      >
                        <td style={{ padding: "8px" }}>
                          <div style={{ fontWeight: 600 }}>{c.name}</div>
                          {c.company && (
                            <div
                              style={{
                                fontSize: "12px",
                                color: "var(--text-muted)",
                              }}
                            >
                              {c.company}
                            </div>
                          )}
                        </td>
                        <td style={{ padding: "8px", fontSize: "13px" }}>
                          {c.email}
                          {c.phone && (
                            <div
                              style={{
                                fontSize: "12px",
                                color: "var(--text-muted)",
                              }}
                            >
                              {c.phone}
                            </div>
                          )}
                        </td>
                        <td style={{ padding: "8px", fontSize: "12px" }}>
                          {c.trades?.length ? (
                            c.trades.join(", ")
                          ) : (
                            <span style={{ color: "var(--text-muted)" }}>
                              All trades
                            </span>
                          )}
                        </td>
                        <td style={{ padding: "8px", textAlign: "center" }}>
                          <span
                            className={
                              c.receives_work_orders
                                ? "badge badge-success"
                                : "badge badge-muted"
                            }
                          >
                            {c.receives_work_orders ? "Yes" : "No"}
                          </span>
                        </td>
                        <td style={{ padding: "8px", textAlign: "center" }}>
                          <span
                            className={
                              c.is_active
                                ? "badge badge-success"
                                : "badge badge-muted"
                            }
                          >
                            {c.is_active ? "Active" : "Inactive"}
                          </span>
                        </td>
                        <td
                          style={{
                            padding: "8px",
                            display: "flex",
                            gap: "6px",
                            justifyContent: "flex-end",
                          }}
                        >
                          <button
                            className="btn-outline"
                            style={{ fontSize: "12px", padding: "4px 10px" }}
                            onClick={() => openEditContractor(c)}
                          >
                            Edit
                          </button>
                          <button
                            className="btn-outline"
                            style={{
                              fontSize: "12px",
                              padding: "4px 10px",
                              color: "var(--color-error, #f87171)",
                              borderColor: "var(--color-error, #f87171)",
                            }}
                            onClick={() => handleDeleteContractor(c.id)}
                          >
                            Delete
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </>
          ) : activeCategory === "email" ? (
            /* ── Email settings – condensed smart form ── */
            (() => {
              const get = (key: string) => editedValues[key] ?? "";
              const set = (key: string, val: string) =>
                setEditedValues((prev) => ({ ...prev, [key]: val }));

              const provider = get("email_provider") || "smtp";
              const apiProvider = get("email_api_provider") || "sendgrid";

              // SMTP presets: common providers
              const smtpPresets: Record<
                string,
                { host: string; port: string; secure: string; label: string }
              > = {
                "": {
                  host: "",
                  port: "587",
                  secure: "false",
                  label: "— Custom —",
                },
                office365: {
                  host: "smtp.office365.com",
                  port: "587",
                  secure: "false",
                  label: "Office 365",
                },
                gmail: {
                  host: "smtp.gmail.com",
                  port: "587",
                  secure: "false",
                  label: "Gmail (App Password)",
                },
                sendgrid_smtp: {
                  host: "smtp.sendgrid.net",
                  port: "587",
                  secure: "false",
                  label: "SendGrid (SMTP)",
                },
                mailgun_smtp: {
                  host: "smtp.mailgun.org",
                  port: "587",
                  secure: "false",
                  label: "Mailgun (SMTP)",
                },
                ses: {
                  host: "email-smtp.us-east-1.amazonaws.com",
                  port: "587",
                  secure: "false",
                  label: "Amazon SES",
                },
              };

              const applySmtpPreset = (key: string) => {
                const p = smtpPresets[key];
                if (!p) return;
                set("email_smtp_host", p.host);
                set("email_smtp_port", p.port);
                set("email_smtp_secure", p.secure);
              };

              return (
                <>
                  {/* ── Provider Toggle ── */}
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr 1fr",
                      gap: "12px",
                      marginBottom: "20px",
                    }}
                  >
                    <div className="form-group" style={{ marginBottom: 0 }}>
                      <label>Provider Type</label>
                      <div className="settings-muted">How emails are sent</div>
                      <div
                        style={{
                          display: "flex",
                          gap: "8px",
                          marginTop: "6px",
                        }}
                      >
                        {["smtp", "api"].map((p) => (
                          <button
                            key={p}
                            type="button"
                            onClick={() => set("email_provider", p)}
                            style={{
                              flex: 1,
                              padding: "8px",
                              borderRadius: "6px",
                              border: `2px solid ${provider === p ? "var(--accent, #0ea5e9)" : "var(--border, #444)"}`,
                              background:
                                provider === p
                                  ? "var(--accent-subtle, rgba(14,165,233,0.1))"
                                  : "transparent",
                              color:
                                provider === p
                                  ? "var(--accent, #0ea5e9)"
                                  : "var(--text-secondary)",
                              fontWeight: provider === p ? 600 : 400,
                              cursor: "pointer",
                              fontSize: "13px",
                            }}
                          >
                            {p === "smtp" ? "SMTP" : "API"}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="form-group" style={{ marginBottom: 0 }}>
                      <label>Notifications Enabled</label>
                      <div className="settings-muted">
                        Send email notifications
                      </div>
                      <select
                        style={{ marginTop: "6px" }}
                        value={get("email_notifications_enabled") || "true"}
                        onChange={(e) =>
                          set("email_notifications_enabled", e.target.value)
                        }
                      >
                        <option value="true">Enabled</option>
                        <option value="false">Disabled</option>
                      </select>
                    </div>
                  </div>

                  {/* ── Common fields ── */}
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr 1fr",
                      gap: "12px",
                      marginBottom: "20px",
                    }}
                  >
                    <div className="form-group" style={{ marginBottom: 0 }}>
                      <label>
                        From Address{" "}
                        <span style={{ color: "var(--error, #ef4444)" }}>
                          *
                        </span>
                      </label>
                      <div className="settings-muted">
                        Default sender (From) email address
                      </div>
                      <input
                        type="email"
                        value={get("email_from_address")}
                        onChange={(e) =>
                          set("email_from_address", e.target.value)
                        }
                        placeholder="noreply@example.com"
                      />
                    </div>
                    <div className="form-group" style={{ marginBottom: 0 }}>
                      <label>From Name</label>
                      <div className="settings-muted">
                        Default sender display name
                      </div>
                      <input
                        type="text"
                        value={get("email_from_name")}
                        onChange={(e) => set("email_from_name", e.target.value)}
                        placeholder="Facilities Management Portal"
                      />
                    </div>
                  </div>

                  <div className="form-group" style={{ marginBottom: "20px" }}>
                    <label>Portal URL</label>
                    <div className="settings-muted">
                      Public URL used in email links (e.g.
                      https://portal.example.com)
                    </div>
                    <input
                      type="url"
                      value={get("email_portal_url")}
                      onChange={(e) => set("email_portal_url", e.target.value)}
                      placeholder="https://portal.example.com"
                    />
                  </div>

                  {/* ── SMTP section ── */}
                  {provider === "smtp" && (
                    <div
                      style={{
                        borderTop: "1px solid var(--border, #444)",
                        paddingTop: "16px",
                        marginBottom: "20px",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          marginBottom: "12px",
                        }}
                      >
                        <h4 style={{ margin: 0 }}>SMTP Configuration</h4>
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "8px",
                          }}
                        >
                          <label
                            style={{
                              fontSize: "12px",
                              color: "var(--text-secondary)",
                              marginBottom: 0,
                            }}
                          >
                            Quick preset:
                          </label>
                          <select
                            style={{
                              fontSize: "12px",
                              padding: "4px 8px",
                              width: "auto",
                            }}
                            defaultValue=""
                            onChange={(e) => applySmtpPreset(e.target.value)}
                          >
                            {Object.entries(smtpPresets).map(([key, val]) => (
                              <option key={key} value={key}>
                                {val.label}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>

                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "2fr 1fr",
                          gap: "12px",
                          marginBottom: "12px",
                        }}
                      >
                        <div className="form-group" style={{ marginBottom: 0 }}>
                          <label>
                            SMTP Host{" "}
                            <span style={{ color: "var(--error, #ef4444)" }}>
                              *
                            </span>
                          </label>
                          <input
                            type="text"
                            value={get("email_smtp_host")}
                            onChange={(e) =>
                              set("email_smtp_host", e.target.value)
                            }
                            placeholder="smtp.example.com"
                          />
                        </div>
                        <div className="form-group" style={{ marginBottom: 0 }}>
                          <label>Port</label>
                          <input
                            type="number"
                            value={get("email_smtp_port")}
                            onChange={(e) =>
                              set("email_smtp_port", e.target.value)
                            }
                            placeholder="587"
                          />
                        </div>
                      </div>

                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "1fr 1fr 1fr",
                          gap: "12px",
                        }}
                      >
                        <div className="form-group" style={{ marginBottom: 0 }}>
                          <label>Username</label>
                          <input
                            type="text"
                            value={get("email_smtp_user")}
                            onChange={(e) =>
                              set("email_smtp_user", e.target.value)
                            }
                            placeholder="SMTP username"
                          />
                        </div>
                        <div className="form-group" style={{ marginBottom: 0 }}>
                          <label>Password</label>
                          <input
                            type="password"
                            value={get("email_smtp_password")}
                            onChange={(e) =>
                              set("email_smtp_password", e.target.value)
                            }
                            placeholder="SMTP password"
                          />
                        </div>
                        <div className="form-group" style={{ marginBottom: 0 }}>
                          <label>Encryption</label>
                          <select
                            value={get("email_smtp_secure")}
                            onChange={(e) =>
                              set("email_smtp_secure", e.target.value)
                            }
                          >
                            <option value="false">None / STARTTLS</option>
                            <option value="true">TLS / SSL</option>
                          </select>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* ── API section ── */}
                  {provider === "api" && (
                    <div
                      style={{
                        borderTop: "1px solid var(--border, #444)",
                        paddingTop: "16px",
                        marginBottom: "20px",
                      }}
                    >
                      <h4 style={{ margin: "0 0 12px" }}>API Configuration</h4>

                      <div
                        className="form-group"
                        style={{ marginBottom: "12px" }}
                      >
                        <label>
                          API Provider{" "}
                          <span style={{ color: "var(--error, #ef4444)" }}>
                            *
                          </span>
                        </label>
                        <div className="settings-muted">
                          Choose your transactional email provider
                        </div>
                        <div
                          style={{
                            display: "flex",
                            gap: "8px",
                            marginTop: "6px",
                            flexWrap: "wrap",
                          }}
                        >
                          {[
                            {
                              id: "sendgrid",
                              label: "SendGrid",
                              hint: "Reliable, great deliverability",
                            },
                            {
                              id: "mailgun",
                              label: "Mailgun",
                              hint: "Requires domain verification",
                            },
                          ].map((ap) => (
                            <button
                              key={ap.id}
                              type="button"
                              onClick={() => set("email_api_provider", ap.id)}
                              title={ap.hint}
                              style={{
                                padding: "8px 16px",
                                borderRadius: "6px",
                                border: `2px solid ${apiProvider === ap.id ? "var(--accent, #0ea5e9)" : "var(--border, #444)"}`,
                                background:
                                  apiProvider === ap.id
                                    ? "var(--accent-subtle, rgba(14,165,233,0.1))"
                                    : "transparent",
                                color:
                                  apiProvider === ap.id
                                    ? "var(--accent, #0ea5e9)"
                                    : "var(--text-secondary)",
                                fontWeight: apiProvider === ap.id ? 600 : 400,
                                cursor: "pointer",
                                fontSize: "13px",
                              }}
                            >
                              {ap.label}
                            </button>
                          ))}
                        </div>
                        {apiProvider === "sendgrid" && (
                          <div
                            className="settings-muted"
                            style={{ marginTop: "6px" }}
                          >
                            Get your API key from{" "}
                            <span style={{ color: "var(--accent)" }}>
                              app.sendgrid.com → Settings → API Keys
                            </span>
                          </div>
                        )}
                        {apiProvider === "mailgun" && (
                          <div
                            className="settings-muted"
                            style={{ marginTop: "6px" }}
                          >
                            Get your API key from{" "}
                            <span style={{ color: "var(--accent)" }}>
                              app.mailgun.com → Sending → Domains → API Keys
                            </span>
                          </div>
                        )}
                      </div>

                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns:
                            apiProvider === "mailgun" ? "1fr 1fr" : "1fr",
                          gap: "12px",
                        }}
                      >
                        <div className="form-group" style={{ marginBottom: 0 }}>
                          <label>
                            API Key{" "}
                            <span style={{ color: "var(--error, #ef4444)" }}>
                              *
                            </span>
                          </label>
                          <input
                            type="password"
                            value={get("email_api_key")}
                            onChange={(e) =>
                              set("email_api_key", e.target.value)
                            }
                            placeholder={
                              apiProvider === "sendgrid"
                                ? "SG.xxxx..."
                                : "key-xxxx..."
                            }
                          />
                        </div>
                        {apiProvider === "mailgun" && (
                          <div
                            className="form-group"
                            style={{ marginBottom: 0 }}
                          >
                            <label>
                              Mailgun Domain{" "}
                              <span style={{ color: "var(--error, #ef4444)" }}>
                                *
                              </span>
                            </label>
                            <div className="settings-muted">
                              Your verified sending domain
                            </div>
                            <input
                              type="text"
                              value={get("email_api_domain")}
                              onChange={(e) =>
                                set("email_api_domain", e.target.value)
                              }
                              placeholder="mg.yourdomain.com"
                            />
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* ── Test email + Save ── */}
                  <div
                    style={{
                      borderTop: "1px solid var(--border, #444)",
                      marginTop: "8px",
                      paddingTop: "16px",
                      display: "flex",
                      gap: "12px",
                      alignItems: "flex-end",
                      flexWrap: "wrap",
                    }}
                  >
                    <div style={{ flex: 1, minWidth: "200px" }}>
                      <label
                        style={{
                          fontSize: "13px",
                          display: "block",
                          marginBottom: "4px",
                        }}
                      >
                        Test Email Address
                      </label>
                      <input
                        type="email"
                        placeholder="Recipient for test email"
                        value={testEmailAddress}
                        onChange={(e) => setTestEmailAddress(e.target.value)}
                      />
                    </div>
                    <button
                      className="btn-outline"
                      onClick={handleTestEmail}
                      disabled={testingEmail}
                      type="button"
                      style={{ whiteSpace: "nowrap" }}
                    >
                      {testingEmail ? "Sending..." : "Send Test"}
                    </button>
                    <button
                      onClick={handleSave}
                      disabled={saving}
                      style={{ whiteSpace: "nowrap" }}
                    >
                      {saving ? "Saving..." : "Save Settings"}
                    </button>
                  </div>
                </>
              );
            })()
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
