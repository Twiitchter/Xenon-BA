import React, { useState, useEffect } from "react";
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
    workRequestSourceId: "3",
    workRequestSubtypeId: "",
  });

  // Asset is resolved automatically from the selected building — not shown in UI
  const [selectedAsset, setSelectedAsset] = useState<any | null>(null);

  // Assetic integration state
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

  // When the building selection changes, silently look up its linked Assetic asset
  useEffect(() => {
    if (!locationSelection.buildingId) {
      setSelectedAsset(null);
      return;
    }
    void assetService
      .getAssetByFunctionalLocation(locationSelection.buildingId)
      .then((res) => setSelectedAsset(res.asset || null))
      .catch(() => setSelectedAsset(null));
  }, [locationSelection.buildingId]);

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
      const [typesRes, hierarchyRes] = await Promise.allSettled([
        maintenanceService.getWorkRequestTypes(),
        maintenanceService.getLocationHierarchy(),
      ]);

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

          {asseticEnabled && workRequestTypes.length > 0 && (
            <div className="form-group">
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
