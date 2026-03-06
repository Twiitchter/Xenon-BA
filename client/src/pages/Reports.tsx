import React, { useState } from "react";
import { reportService } from "../services/reportService";
import { maintenanceService } from "../services/maintenanceService";
import LocationHierarchyPicker, {
  EMPTY_LOCATION_SELECTION,
  LocationSelection,
  buildLocationPath,
} from "../components/LocationHierarchyPicker";

const Reports: React.FC = () => {
  const [activeTab, setActiveTab] = useState<"assets" | "changes">("assets");
  const [assetFilters, setAssetFilters] = useState({
    status: "",
    category: "",
    email: "",
  });
  const [changeFilters, setChangeFilters] = useState({
    assetId: "",
    startDate: "",
    endDate: "",
    email: "",
  });
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [locationHierarchy, setLocationHierarchy] = useState<any | null>(null);
  const [locationSelection, setLocationSelection] = useState<LocationSelection>(
    EMPTY_LOCATION_SELECTION,
  );

  React.useEffect(() => {
    void (async () => {
      try {
        const data = await maintenanceService.getLocationHierarchy();
        setLocationHierarchy(data);
      } catch {
        // Optional enhancement only.
      }
    })();
  }, []);

  const handleAssetReportGenerate = async () => {
    setLoading(true);
    setMessage("");
    setError("");

    try {
      const selectedPath = buildLocationPath(
        locationHierarchy,
        locationSelection,
      );
      const result = await reportService.generateAssetReport({
        ...assetFilters,
        location: selectedPath || undefined,
      });
      setMessage(result.message);

      if (result.downloadUrl && !assetFilters.email) {
        // Open download URL in new tab
        window.open(result.downloadUrl, "_blank");
      }
    } catch (err: any) {
      setError(err.response?.data?.error || "Failed to generate report");
    } finally {
      setLoading(false);
    }
  };

  const handleChangeReportGenerate = async () => {
    setLoading(true);
    setMessage("");
    setError("");

    try {
      const result = await reportService.generateChangeReport({
        ...changeFilters,
        assetId: changeFilters.assetId
          ? Number(changeFilters.assetId)
          : undefined,
      });
      setMessage(result.message);

      if (result.downloadUrl && !changeFilters.email) {
        // Open download URL in new tab
        window.open(result.downloadUrl, "_blank");
      }
    } catch (err: any) {
      setError(err.response?.data?.error || "Failed to generate report");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="container">
      <h2>Reports</h2>

      <div className="card">
        <div style={{ display: "flex", gap: "10px", marginBottom: "20px" }}>
          <button
            onClick={() => setActiveTab("assets")}
            style={{
              backgroundColor: activeTab === "assets" ? "#007bff" : "#6c757d",
            }}
          >
            Asset Reports
          </button>
          <button
            onClick={() => setActiveTab("changes")}
            style={{
              backgroundColor: activeTab === "changes" ? "#007bff" : "#6c757d",
            }}
          >
            Change Reports
          </button>
        </div>

        {activeTab === "assets" && (
          <div>
            <h3>Generate Asset Report</h3>
            <p>Create a PDF report of assets with optional filters.</p>

            <div className="form-group">
              <label>Status Filter</label>
              <select
                value={assetFilters.status}
                onChange={(e) =>
                  setAssetFilters({ ...assetFilters, status: e.target.value })
                }
              >
                <option value="">All</option>
                <option value="Active">Active</option>
                <option value="Inactive">Inactive</option>
                <option value="Retired">Retired</option>
              </select>
            </div>

            <div className="form-group">
              <label>Category Filter</label>
              <select
                value={assetFilters.category}
                onChange={(e) =>
                  setAssetFilters({ ...assetFilters, category: e.target.value })
                }
              >
                <option value="">All</option>
                <option value="Equipment">Equipment</option>
                <option value="Furniture">Furniture</option>
                <option value="Vehicles">Vehicles</option>
              </select>
            </div>

            <div className="form-group">
              <label>Location Filter (optional)</label>
              {locationHierarchy ? (
                <>
                  <LocationHierarchyPicker
                    hierarchy={locationHierarchy}
                    selection={locationSelection}
                    onChange={setLocationSelection}
                  />
                  {buildLocationPath(locationHierarchy, locationSelection) && (
                    <div
                      className="settings-muted"
                      style={{ marginBottom: "8px" }}
                    >
                      Selected path:{" "}
                      <strong>
                        {buildLocationPath(
                          locationHierarchy,
                          locationSelection,
                        )}
                      </strong>
                    </div>
                  )}
                </>
              ) : (
                <div className="settings-muted">Hierarchy not available.</div>
              )}
            </div>

            <div className="form-group">
              <label>Email (optional - leave empty to download directly)</label>
              <input
                type="email"
                value={assetFilters.email}
                onChange={(e) =>
                  setAssetFilters({ ...assetFilters, email: e.target.value })
                }
                placeholder="recipient@example.com"
              />
            </div>

            <button onClick={handleAssetReportGenerate} disabled={loading}>
              {loading ? "Generating..." : "Generate Report"}
            </button>
          </div>
        )}

        {activeTab === "changes" && (
          <div>
            <h3>Generate Change Report</h3>
            <p>Create a PDF report of asset changes with optional filters.</p>

            <div className="form-group">
              <label>Asset ID (optional)</label>
              <input
                type="number"
                value={changeFilters.assetId}
                onChange={(e) =>
                  setChangeFilters({
                    ...changeFilters,
                    assetId: e.target.value,
                  })
                }
                placeholder="Leave empty for all assets"
              />
            </div>

            <div className="form-group">
              <label>Start Date (optional)</label>
              <input
                type="date"
                value={changeFilters.startDate}
                onChange={(e) =>
                  setChangeFilters({
                    ...changeFilters,
                    startDate: e.target.value,
                  })
                }
              />
            </div>

            <div className="form-group">
              <label>End Date (optional)</label>
              <input
                type="date"
                value={changeFilters.endDate}
                onChange={(e) =>
                  setChangeFilters({
                    ...changeFilters,
                    endDate: e.target.value,
                  })
                }
              />
            </div>

            <div className="form-group">
              <label>Email (optional - leave empty to download directly)</label>
              <input
                type="email"
                value={changeFilters.email}
                onChange={(e) =>
                  setChangeFilters({ ...changeFilters, email: e.target.value })
                }
                placeholder="recipient@example.com"
              />
            </div>

            <button onClick={handleChangeReportGenerate} disabled={loading}>
              {loading ? "Generating..." : "Generate Report"}
            </button>
          </div>
        )}

        {message && (
          <div className="success" style={{ marginTop: "20px" }}>
            {message}
          </div>
        )}
        {error && (
          <div className="error" style={{ marginTop: "20px" }}>
            {error}
          </div>
        )}
      </div>

      <div className="card">
        <h3>About Reports</h3>
        <ul style={{ marginLeft: "20px" }}>
          <li>Reports are generated as PDF files</li>
          <li>You can download reports directly or have them emailed to you</li>
          <li>Asset reports include current asset information</li>
          <li>Change reports track modifications to assets over time</li>
        </ul>
      </div>
    </div>
  );
};

export default Reports;
