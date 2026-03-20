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

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.split(",")[1]); // strip the data-URL prefix
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

const NewWorkRequest: React.FC = () => {
  const navigate = useNavigate();
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [attachmentStatus, setAttachmentStatus] = useState<string>("");
  const [formData, setFormData] = useState({
    title: "",
    priority: "medium",
    category: "",
    location: "",
    requestorDisplayName: "",
    requestorEmail: "",
    requestorPhone: "",
    requestorMobile: "",
    supportingInformation: "",
    workRequestSourceId: "3",
  });

  // Asset is resolved automatically from the selected building — not shown in UI
  const [selectedAsset, setSelectedAsset] = useState<any | null>(null);

  // Assetic integration state
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
      const hierarchyRes = await maintenanceService.getLocationHierarchy();
      if (hierarchyRes?.regions) {
        setLocationHierarchy(hierarchyRes);
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

      const created = await maintenanceService.createRequest({
        ...formData,
        description: formData.title,
        workRequestSubtypeId: "",
        location: combinedLocation,
        asseticAssetGuid: selectedAsset?.assetic_guid || undefined,
      });

      // Upload any pending attachments after the WR is created
      if (pendingFiles.length > 0 && created?.id) {
        setAttachmentStatus(
          `Uploading ${pendingFiles.length} attachment(s)...`,
        );
        let uploaded = 0;
        for (const file of pendingFiles) {
          try {
            const contentBase64 = await readFileAsBase64(file);
            await maintenanceService.uploadAttachment(created.id, {
              filename: file.name,
              mimeType: file.type || "application/octet-stream",
              contentBase64,
              fileSizeBytes: file.size,
            });
            uploaded++;
            setAttachmentStatus(
              `Uploaded ${uploaded}/${pendingFiles.length} attachment(s)...`,
            );
          } catch {
            // Attachment upload failure is non-blocking — the WR was created
          }
        }
      }

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
            <label>Title / Brief Summary *</label>
            <input
              type="text"
              value={formData.title}
              onChange={(e) =>
                setFormData({ ...formData, title: e.target.value })
              }
              placeholder="e.g. Leaking tap in Level 2 bathroom"
              required
              aria-required="true"
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
            <label>Description</label>
            <textarea
              value={formData.supportingInformation}
              onChange={(e) =>
                setFormData({
                  ...formData,
                  supportingInformation: e.target.value,
                })
              }
              rows={4}
              placeholder="Describe the issue in detail — what is happening, where exactly, and how long it has been occurring"
            />
          </div>

          <h4
            style={{
              marginTop: "20px",
              marginBottom: "10px",
              fontSize: "16px",
            }}
          >
            Attachments (Optional)
          </h4>
          <div className="form-group">
            <label style={{ marginBottom: "6px", display: "block" }}>
              Upload photos or documents to help describe the issue
            </label>
            <input
              type="file"
              accept="image/*,application/pdf"
              multiple
              onChange={(e) => {
                const files = Array.from(e.target.files || []);
                setPendingFiles((prev) => {
                  const existing = new Set(prev.map((f) => f.name + f.size));
                  return [
                    ...prev,
                    ...files.filter((f) => !existing.has(f.name + f.size)),
                  ];
                });
                e.target.value = ""; // allow re-selecting same file
              }}
              style={{ display: "block" }}
            />
          </div>
          {pendingFiles.length > 0 && (
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: "10px",
                marginBottom: "14px",
              }}
            >
              {pendingFiles.map((file, idx) => (
                <div
                  key={idx}
                  style={{
                    position: "relative",
                    border: "1px solid var(--border)",
                    borderRadius: "6px",
                    padding: "6px",
                    background: "var(--surface)",
                    maxWidth: "120px",
                    textAlign: "center",
                  }}
                >
                  {file.type.startsWith("image/") ? (
                    <img
                      src={URL.createObjectURL(file)}
                      alt={file.name}
                      style={{
                        width: "90px",
                        height: "70px",
                        objectFit: "cover",
                        borderRadius: "4px",
                        display: "block",
                        margin: "0 auto 4px",
                      }}
                    />
                  ) : (
                    <div
                      style={{
                        width: "90px",
                        height: "70px",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: "28px",
                        margin: "0 auto 4px",
                      }}
                    >
                      📄
                    </div>
                  )}
                  <div
                    style={{
                      fontSize: "11px",
                      color: "var(--text-muted)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      maxWidth: "100px",
                    }}
                    title={file.name}
                  >
                    {file.name}
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      setPendingFiles((prev) =>
                        prev.filter((_, i) => i !== idx),
                      )
                    }
                    style={{
                      position: "absolute",
                      top: "2px",
                      right: "2px",
                      background: "rgba(0,0,0,0.5)",
                      color: "#fff",
                      border: "none",
                      borderRadius: "50%",
                      width: "18px",
                      height: "18px",
                      cursor: "pointer",
                      fontSize: "11px",
                      lineHeight: "18px",
                      padding: 0,
                    }}
                    aria-label={`Remove ${file.name}`}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}

          <button type="submit" disabled={submitting}>
            {submitting && attachmentStatus
              ? attachmentStatus
              : submitting
                ? "Submitting..."
                : "Submit Request"}
          </button>
        </form>
      </div>
    </div>
  );
};

export default NewWorkRequest;
