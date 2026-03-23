import React, { useState, useEffect } from "react";
import LocationHierarchyPicker, {
  EMPTY_LOCATION_SELECTION,
  LocationSelection,
  buildLocationPath,
  HierarchyTree,
  HierarchyRegion,
} from "../components/LocationHierarchyPicker";
import ThemeSelector from "../components/ThemeSelector";
import { maintenanceService } from "../services/maintenanceService";
import { authService } from "../services/authService";

const MyProfile: React.FC = () => {
  const [hierarchy, setHierarchy] = useState<HierarchyTree | null>(null);
  const [locationSelection, setLocationSelection] = useState<LocationSelection>(
    EMPTY_LOCATION_SELECTION,
  );
  const [saving, setSaving] = useState(false);
  const [successMsg, setSuccessMsg] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [hierarchyLoading, setHierarchyLoading] = useState(true);

  const [displayName, setDisplayName] = useState("");
  const [phone, setPhone] = useState("");
  const [mobile, setMobile] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [department, setDepartment] = useState("");
  const [contactSaving, setContactSaving] = useState(false);
  const [contactSuccessMsg, setContactSuccessMsg] = useState("");
  const [contactErrorMsg, setContactErrorMsg] = useState("");

  useEffect(() => {
    void loadData();
  }, []);

  const loadData = async () => {
    setHierarchyLoading(true);
    try {
      const [user, hier] = await Promise.all([
        authService.getCurrentUser(),
        maintenanceService.getLocationHierarchy(),
      ]);

      if (hier) {
        setHierarchy(hier);
      }

      if (user) {
        setDisplayName(user.displayName || "");
        setPhone(user.phone || "");
        setMobile(user.mobile || "");
        setContactEmail(user.contactEmail || "");
        setDepartment(user.department || "");

        if (user.prefRegionId) {
          setLocationSelection({
            regionId: user.prefRegionId || "",
            siteId: user.prefSiteId || "",
            buildingId: user.prefBuildingId || "",
            floorId: user.prefFloorId || "",
          });
        }
      }
    } catch {
      setErrorMsg("Failed to load profile data.");
    } finally {
      setHierarchyLoading(false);
    }
  };

  const resolveName = (
    regions: HierarchyRegion[],
    sel: LocationSelection,
  ): {
    regionName: string;
    siteName: string;
    buildingName: string;
    floorName: string;
  } => {
    const region = regions.find((r) => r.id === sel.regionId);
    const site = region?.sites.find((s) => s.id === sel.siteId);
    const building = site?.buildings.find((b) => b.id === sel.buildingId);
    const floor = building?.floors?.find((f) => f.id === sel.floorId);
    return {
      regionName: region?.name || "",
      siteName: site?.name || "",
      buildingName: building?.name || "",
      floorName: floor?.name || "",
    };
  };

  const handleContactSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setContactSaving(true);
    setContactSuccessMsg("");
    setContactErrorMsg("");
    try {
      await authService.updateProfile({
        displayName: displayName || undefined,
        phone: phone || undefined,
        mobile: mobile || undefined,
        contactEmail: contactEmail || undefined,
        department: department || undefined,
      });
      setContactSuccessMsg("Contact information saved successfully.");
    } catch {
      setContactErrorMsg("Failed to save contact information. Please try again.");
    } finally {
      setContactSaving(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setSuccessMsg("");
    setErrorMsg("");

    const names = resolveName(hierarchy?.regions || [], locationSelection);

    try {
      await authService.updateProfile({
        prefRegionId: locationSelection.regionId || undefined,
        prefRegionName: names.regionName || undefined,
        prefSiteId: locationSelection.siteId || undefined,
        prefSiteName: names.siteName || undefined,
        prefBuildingId: locationSelection.buildingId || undefined,
        prefBuildingName: names.buildingName || undefined,
        prefFloorId: locationSelection.floorId || undefined,
        prefFloorName: names.floorName || undefined,
      });
      setSuccessMsg("Default location saved successfully.");
    } catch {
      setErrorMsg("Failed to save settings. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const handleClear = async () => {
    setSaving(true);
    setSuccessMsg("");
    setErrorMsg("");
    try {
      await authService.updateProfile({
        prefRegionId: undefined,
        prefRegionName: undefined,
        prefSiteId: undefined,
        prefSiteName: undefined,
        prefBuildingId: undefined,
        prefBuildingName: undefined,
        prefFloorId: undefined,
        prefFloorName: undefined,
      });
      setLocationSelection(EMPTY_LOCATION_SELECTION);
      setSuccessMsg("Default location cleared.");
    } catch {
      setErrorMsg("Failed to clear settings. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const selectedPath = buildLocationPath(hierarchy, locationSelection);

  return (
    <div className="container">
      <div className="page-header">
        <h2>My Settings</h2>
      </div>

      <div className="card">
        <h3>Contact Information</h3>
        <p
          style={{
            color: "var(--text-muted)",
            marginBottom: "16px",
            fontSize: "14px",
          }}
        >
          Update your contact details. These may be used when submitting work
          requests or for notifications.
        </p>
        <form onSubmit={handleContactSave}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: "16px",
            }}
          >
            <div>
              <label
                style={{
                  display: "block",
                  marginBottom: "4px",
                  fontSize: "14px",
                  fontWeight: 500,
                }}
              >
                Display Name
              </label>
              <input
                type="text"
                className="form-input"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Your display name"
                maxLength={255}
              />
            </div>
            <div>
              <label
                style={{
                  display: "block",
                  marginBottom: "4px",
                  fontSize: "14px",
                  fontWeight: 500,
                }}
              >
                Department
              </label>
              <input
                type="text"
                className="form-input"
                value={department}
                onChange={(e) => setDepartment(e.target.value)}
                placeholder="Your department"
                maxLength={255}
              />
            </div>
            <div>
              <label
                style={{
                  display: "block",
                  marginBottom: "4px",
                  fontSize: "14px",
                  fontWeight: 500,
                }}
              >
                Phone
              </label>
              <input
                type="tel"
                className="form-input"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="Phone number"
                maxLength={50}
              />
            </div>
            <div>
              <label
                style={{
                  display: "block",
                  marginBottom: "4px",
                  fontSize: "14px",
                  fontWeight: 500,
                }}
              >
                Mobile
              </label>
              <input
                type="tel"
                className="form-input"
                value={mobile}
                onChange={(e) => setMobile(e.target.value)}
                placeholder="Mobile number"
                maxLength={50}
              />
            </div>
            <div style={{ gridColumn: "1 / -1" }}>
              <label
                style={{
                  display: "block",
                  marginBottom: "4px",
                  fontSize: "14px",
                  fontWeight: 500,
                }}
              >
                Contact Email
              </label>
              <input
                type="email"
                className="form-input"
                value={contactEmail}
                onChange={(e) => setContactEmail(e.target.value)}
                placeholder="Contact email address"
                maxLength={255}
              />
            </div>
          </div>

          {contactSuccessMsg && (
            <div className="alert alert-success" style={{ marginTop: "16px" }}>
              {contactSuccessMsg}
            </div>
          )}
          {contactErrorMsg && (
            <div className="alert alert-error" style={{ marginTop: "16px" }}>
              {contactErrorMsg}
            </div>
          )}

          <div style={{ marginTop: "24px" }}>
            <button
              type="submit"
              className="btn-primary"
              disabled={contactSaving}
            >
              {contactSaving ? "Saving…" : "Save Contact Information"}
            </button>
          </div>
        </form>
      </div>

      <div className="card">
        <h3>Appearance</h3>
        <p
          style={{
            color: "var(--text-muted)",
            marginBottom: "4px",
            fontSize: "14px",
          }}
        >
          Choose a colour theme for the application. Your preference is saved
          locally and takes effect immediately.
        </p>
        <ThemeSelector />
      </div>

      <div className="card">
        <h3>Default Location</h3>
        <p
          style={{
            color: "var(--text-muted)",
            marginBottom: "16px",
            fontSize: "14px",
          }}
        >
          Set your default location so it is pre-filled automatically when you
          log a new work request.
        </p>

        {hierarchyLoading ? (
          <p style={{ color: "var(--text-muted)" }}>Loading location data…</p>
        ) : hierarchy ? (
          <form onSubmit={handleSave}>
            <LocationHierarchyPicker
              hierarchy={hierarchy}
              selection={locationSelection}
              onChange={setLocationSelection}
            />

            {selectedPath && (
              <p
                style={{
                  marginTop: "8px",
                  fontSize: "13px",
                  color: "var(--text-muted)",
                }}
              >
                Selected path: <strong>{selectedPath}</strong>
              </p>
            )}

            {successMsg && (
              <div
                className="alert alert-success"
                style={{ marginTop: "16px" }}
              >
                {successMsg}
              </div>
            )}
            {errorMsg && (
              <div className="alert alert-error" style={{ marginTop: "16px" }}>
                {errorMsg}
              </div>
            )}

            <div style={{ display: "flex", gap: "12px", marginTop: "24px" }}>
              <button type="submit" className="btn-primary" disabled={saving}>
                {saving ? "Saving…" : "Save Default Location"}
              </button>
              {selectedPath && (
                <button
                  type="button"
                  className="btn-ghost"
                  onClick={handleClear}
                  disabled={saving}
                >
                  Clear
                </button>
              )}
            </div>
          </form>
        ) : (
          <p style={{ color: "var(--text-muted)" }}>
            Location hierarchy is not available. Please contact your
            administrator.
          </p>
        )}
      </div>
    </div>
  );
};

export default MyProfile;
