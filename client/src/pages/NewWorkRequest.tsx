import React, { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import {
  LocationHierarchyResponse,
  maintenanceService,
} from "../services/maintenanceService";
import { authService } from "../services/authService";
import { assetService } from "../services/assetService";
import LocationHierarchyPicker, {
  EMPTY_LOCATION_SELECTION,
  LocationSelection,
  buildLocationPath,
} from "../components/LocationHierarchyPicker";

interface WorkRequestSource {
  id: string;
  name: string;
}

interface WorkRequestType {
  Id: string;
  Name: string;
}

const NewWorkRequest: React.FC = () => {
  const navigate = useNavigate();
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formData, setFormData] = useState({
    title: "",
    description: "",
    priority: "medium",
    category: "",
    location: "",
    requestorDisplayName: "",
    requestorEmail: "",
    requestorPhone: "",
    requestorMobile: "",
    supportingInformation: "",
    workRequestSourceId: "",
    workRequestSubtypeId: "",
  });

  // Asset picker state
  const [assetSearch, setAssetSearch] = useState("");
  const [assetResults, setAssetResults] = useState<any[]>([]);
  const [assetSearchLoading, setAssetSearchLoading] = useState(false);
  const [selectedAsset, setSelectedAsset] = useState<any | null>(null);
  const assetDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Assetic integration state
  const [workRequestSources, setWorkRequestSources] = useState<
    WorkRequestSource[]
  >([]);
  const [workRequestTypes, setWorkRequestTypes] = useState<WorkRequestType[]>(
    [],
  );
  const [asseticEnabled, setAsseticEnabled] = useState(false);
  const [locationHierarchy, setLocationHierarchy] =
    useState<LocationHierarchyResponse | null>(null);
  const [locationSelection, setLocationSelection] = useState<LocationSelection>(
    EMPTY_LOCATION_SELECTION,
  );

  useEffect(() => {
    prefillFromUser();
    fetchAsseticData();
  }, []);

  const handleAssetSearchChange = (value: string) => {
    setAssetSearch(value);
    if (!value || value.length < 2) {
      setAssetResults([]);
      return;
    }
    if (assetDebounce.current) clearTimeout(assetDebounce.current);
    assetDebounce.current = setTimeout(async () => {
      setAssetSearchLoading(true);
      try {
        const data = await assetService.searchAssets(value);
        setAssetResults(data.assets || []);
      } catch {
        setAssetResults([]);
      } finally {
        setAssetSearchLoading(false);
      }
    }, 300);
  };

  const selectAsset = (asset: any) => {
    setSelectedAsset(asset);
    setAssetSearch(asset.asset_name || asset.asset_id || "");
    setAssetResults([]);
  };

  const clearAsset = () => {
    setSelectedAsset(null);
    setAssetSearch("");
    setAssetResults([]);
  };

  const prefillFromUser = async () => {
    const user = await authService.getCurrentUser();
    if (!user) return;
    setFormData((prev) => ({
      ...prev,
      requestorDisplayName:
        user.displayName ||
        [user.firstName, user.lastName].filter(Boolean).join(" ") ||
        prev.requestorDisplayName,
      requestorEmail: user.email || prev.requestorEmail,
      requestorPhone: user.phone || prev.requestorPhone,
    }));
    if (user.prefRegionId) {
      setLocationSelection({
        regionId: user.prefRegionId || "",
        siteId: user.prefSiteId || "",
        buildingId: user.prefBuildingId || "",
        floorId: user.prefFloorId || "",
      });
    }
  };

  const fetchAsseticData = async () => {
    try {
      const [sourcesRes, typesRes, hierarchyRes] = await Promise.allSettled([
        maintenanceService.getWorkRequestSources(),
        maintenanceService.getWorkRequestTypes(),
        maintenanceService.getLocationHierarchy(),
      ]);

      if (sourcesRes.status === "fulfilled" && sourcesRes.value?.sources) {
        setWorkRequestSources(sourcesRes.value.sources);
        setAsseticEnabled(true);
      }

      if (typesRes.status === "fulfilled" && typesRes.value?.ResourceList) {
        setWorkRequestTypes(typesRes.value.ResourceList);
      }

      if (hierarchyRes.status === "fulfilled" && hierarchyRes.value?.regions) {
        setLocationHierarchy(hierarchyRes.value);
        setAsseticEnabled(true);
      }
    } catch (err) {
      console.log("Assetic integration not available");
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      const selectedPath = buildLocationPath(
        locationHierarchy,
        locationSelection,
      );
      const freeTextLocation = formData.location.trim();
      const combinedLocation = selectedPath
        ? freeTextLocation
          ? `${selectedPath} - ${freeTextLocation}`
          : selectedPath
        : freeTextLocation;

      await maintenanceService.createRequest({
        ...formData,
        location: combinedLocation,
        asseticAssetGuid: selectedAsset?.assetic_guid || undefined,
      });
      navigate("/my-requests");
    } catch (err: any) {
      setError(err.response?.data?.error || "Failed to create request");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="container">
      <div className="page-header">
        <h2>New Work Request</h2>
      </div>

      {error && <div className="error card">{error}</div>}

      <div className="card">
        <h3>Log a Maintenance Request</h3>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>Title *</label>
            <input
              type="text"
              value={formData.title}
              onChange={(e) =>
                setFormData({ ...formData, title: e.target.value })
              }
              required
              aria-required="true"
            />
          </div>
          <div className="form-group">
            <label>Description</label>
            <textarea
              value={formData.description}
              onChange={(e) =>
                setFormData({ ...formData, description: e.target.value })
              }
              rows={3}
            />
          </div>

          <h4
            style={{
              marginTop: "20px",
              marginBottom: "10px",
              fontSize: "16px",
            }}
          >
            Contact Information
          </h4>
          <div style={{ display: "flex", gap: "10px" }}>
            <div className="form-group" style={{ flex: 1 }}>
              <label>Contact Name *</label>
              <input
                type="text"
                value={formData.requestorDisplayName}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    requestorDisplayName: e.target.value,
                  })
                }
                placeholder="Your full name"
                required
                aria-required="true"
              />
            </div>
            <div className="form-group" style={{ flex: 1 }}>
              <label>Email</label>
              <input
                type="email"
                value={formData.requestorEmail}
                onChange={(e) =>
                  setFormData({ ...formData, requestorEmail: e.target.value })
                }
                placeholder="contact@example.com"
              />
            </div>
          </div>
          <div style={{ display: "flex", gap: "10px" }}>
            <div className="form-group" style={{ flex: 1 }}>
              <label>Phone</label>
              <input
                type="tel"
                value={formData.requestorPhone}
                onChange={(e) =>
                  setFormData({ ...formData, requestorPhone: e.target.value })
                }
                placeholder="Office phone"
              />
            </div>
            <div className="form-group" style={{ flex: 1 }}>
              <label>Mobile</label>
              <input
                type="tel"
                value={formData.requestorMobile}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    requestorMobile: e.target.value,
                  })
                }
                placeholder="Mobile phone"
              />
            </div>
          </div>

          <h4
            style={{
              marginTop: "20px",
              marginBottom: "10px",
              fontSize: "16px",
            }}
          >
            Request Details
          </h4>

          {/* ── Asset picker ── */}
          <div className="form-group">
            <label>
              Asset{" "}
              {asseticEnabled && (
                <span style={{ color: "var(--accent)", fontWeight: 700 }}>
                  *
                </span>
              )}
            </label>
            {selectedAsset ? (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "10px",
                  padding: "8px 12px",
                  background: "rgba(14,165,233,0.08)",
                  border: "1px solid var(--accent)",
                  borderRadius: "var(--radius)",
                }}
              >
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: "14px" }}>
                    {selectedAsset.asset_name}
                  </div>
                  <div style={{ fontSize: "12px", color: "var(--text-muted)" }}>
                    {selectedAsset.asset_id}
                    {selectedAsset.asset_type
                      ? ` · ${selectedAsset.asset_type}`
                      : ""}
                    {selectedAsset.asset_category
                      ? ` · ${selectedAsset.asset_category}`
                      : ""}
                  </div>
                </div>
                <button
                  type="button"
                  className="btn-ghost"
                  onClick={clearAsset}
                  style={{ fontSize: "12px" }}
                >
                  ✕ Change
                </button>
              </div>
            ) : (
              <div style={{ position: "relative" }}>
                <input
                  type="text"
                  value={assetSearch}
                  onChange={(e) => handleAssetSearchChange(e.target.value)}
                  placeholder="Search by asset name or code…"
                  autoComplete="off"
                />
                {asseticEnabled && !selectedAsset && (
                  <div
                    style={{
                      fontSize: "11px",
                      color: "var(--text-muted)",
                      marginTop: "3px",
                    }}
                  >
                    Required — type at least 2 characters to search synced
                    assets.
                  </div>
                )}
                {assetSearchLoading && (
                  <div
                    style={{
                      fontSize: "12px",
                      color: "var(--text-muted)",
                      marginTop: "4px",
                    }}
                  >
                    Searching…
                  </div>
                )}
                {assetResults.length > 0 && (
                  <div
                    style={{
                      position: "absolute",
                      zIndex: 100,
                      top: "100%",
                      left: 0,
                      right: 0,
                      background: "var(--bg-card)",
                      border: "1px solid var(--border)",
                      borderRadius: "var(--radius)",
                      maxHeight: "220px",
                      overflowY: "auto",
                      boxShadow: "0 4px 16px rgba(0,0,0,0.3)",
                    }}
                  >
                    {assetResults.map((a) => (
                      <div
                        key={a.assetic_guid || a.id}
                        onClick={() => selectAsset(a)}
                        style={{
                          padding: "9px 14px",
                          cursor: "pointer",
                          borderBottom: "1px solid var(--border)",
                        }}
                        onMouseEnter={(e) =>
                          ((
                            e.currentTarget as HTMLDivElement
                          ).style.background = "rgba(14,165,233,0.1)")
                        }
                        onMouseLeave={(e) =>
                          ((
                            e.currentTarget as HTMLDivElement
                          ).style.background = "")
                        }
                      >
                        <div style={{ fontWeight: 500, fontSize: "14px" }}>
                          {a.asset_name}
                        </div>
                        <div
                          style={{
                            fontSize: "11px",
                            color: "var(--text-muted)",
                          }}
                        >
                          {a.asset_id}
                          {a.asset_type ? ` · ${a.asset_type}` : ""}
                          {a.asset_category ? ` · ${a.asset_category}` : ""}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          <div style={{ display: "flex", gap: "10px" }}>
            <div className="form-group" style={{ flex: 1 }}>
              <label>Priority</label>
              <select
                value={formData.priority}
                onChange={(e) =>
                  setFormData({ ...formData, priority: e.target.value })
                }
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="critical">Critical</option>
              </select>
            </div>
            <div className="form-group" style={{ flex: 1 }}>
              <label>Category</label>
              <input
                type="text"
                value={formData.category}
                onChange={(e) =>
                  setFormData({ ...formData, category: e.target.value })
                }
                placeholder="e.g. Plumbing, Electrical"
              />
            </div>
          </div>

          {asseticEnabled && workRequestSources.length > 0 && (
            <div style={{ display: "flex", gap: "10px" }}>
              <div className="form-group" style={{ flex: 1 }}>
                <label>Request Source</label>
                <select
                  value={formData.workRequestSourceId}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      workRequestSourceId: e.target.value,
                    })
                  }
                >
                  <option value="">Select a source...</option>
                  {workRequestSources.map((source) => (
                    <option key={source.id} value={source.id}>
                      {source.name}
                    </option>
                  ))}
                </select>
              </div>
              {workRequestTypes.length > 0 && (
                <div className="form-group" style={{ flex: 1 }}>
                  <label>Request Type</label>
                  <select
                    value={formData.workRequestSubtypeId}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        workRequestSubtypeId: e.target.value,
                      })
                    }
                  >
                    <option value="">Select a type...</option>
                    {workRequestTypes.map((type: any) => (
                      <option key={type.Id} value={type.Id}>
                        {type.Name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          )}

          <h4
            style={{
              marginTop: "20px",
              marginBottom: "10px",
              fontSize: "16px",
            }}
          >
            Location Information
          </h4>
          {locationHierarchy && (
            <div
              style={{
                marginBottom: "10px",
                fontSize: "12px",
                color: "var(--text-muted)",
              }}
            >
              Loaded {locationHierarchy.regions.length} regions from Assetic (
              {locationHierarchy.source}).
            </div>
          )}
          {locationHierarchy && (
            <>
              <LocationHierarchyPicker
                hierarchy={locationHierarchy}
                selection={locationSelection}
                onChange={setLocationSelection}
              />
              {buildLocationPath(locationHierarchy, locationSelection) && (
                <div className="settings-muted" style={{ marginBottom: "8px" }}>
                  Selected hierarchy path:{" "}
                  <strong>
                    {buildLocationPath(locationHierarchy, locationSelection)}
                  </strong>
                </div>
              )}
            </>
          )}
          <div className="form-group">
            <label>Additional Location Details</label>
            <input
              type="text"
              value={formData.location}
              onChange={(e) =>
                setFormData({ ...formData, location: e.target.value })
              }
              placeholder="e.g. Room 101, opposite reception"
            />
          </div>

          <div className="form-group">
            <label>Supporting Information</label>
            <textarea
              value={formData.supportingInformation}
              onChange={(e) =>
                setFormData({
                  ...formData,
                  supportingInformation: e.target.value,
                })
              }
              rows={2}
              placeholder="Any additional details that might be helpful"
            />
          </div>

          <button type="submit" disabled={submitting}>
            {submitting ? "Submitting..." : "Submit Request"}
          </button>
        </form>
      </div>
    </div>
  );
};

export default NewWorkRequest;
