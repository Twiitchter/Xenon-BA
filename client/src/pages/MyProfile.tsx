import React, { useState, useEffect } from "react";
import LocationHierarchyPicker, {
  EMPTY_LOCATION_SELECTION,
  LocationSelection,
  buildLocationPath,
  HierarchyTree,
  HierarchyRegion,
} from "../components/LocationHierarchyPicker";
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

      if (user?.prefRegionId) {
        setLocationSelection({
          regionId: user.prefRegionId || "",
          siteId: user.prefSiteId || "",
          buildingId: user.prefBuildingId || "",
          floorId: user.prefFloorId || "",
        });
      }
    } catch {
      setErrorMsg("Failed to load location data.");
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
