import React, { useState, useEffect } from "react";
import { maintenanceService } from "../services/maintenanceService";

const WorkGroups: React.FC = () => {
  const [workGroups, setWorkGroups] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");

  useEffect(() => {
    fetchWorkGroups();
  }, []);

  const fetchWorkGroups = async () => {
    setLoading(true);
    setError("");
    try {
      const data = await maintenanceService.getWorkGroups();
      setWorkGroups(data.workGroups || []);
    } catch (err: any) {
      setError(
        err.response?.data?.error ||
          "Failed to fetch work groups from Assetic. Check that Assetic integration is enabled.",
      );
    } finally {
      setLoading(false);
    }
  };

  const filtered = search
    ? workGroups.filter(
        (g) =>
          (g.Name || g.name || "")
            .toLowerCase()
            .includes(search.toLowerCase()) ||
          (g.Code || g.GroupCode || g.code || "")
            .toLowerCase()
            .includes(search.toLowerCase()) ||
          (g.Description || g.description || "")
            .toLowerCase()
            .includes(search.toLowerCase()),
      )
    : workGroups;

  return (
    <div className="container" style={{ maxWidth: "1200px" }}>
      <div className="page-header">
        <div>
          <h2>Work Groups</h2>
          <div
            style={{
              fontSize: "13px",
              color: "var(--text-muted)",
              marginTop: "2px",
            }}
          >
            Labour / trade groups from Assetic — assign one per work order to
            route work to the right team.
          </div>
        </div>
        <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search work groups…"
            style={{ width: "200px" }}
          />
          <button onClick={fetchWorkGroups}>Refresh</button>
        </div>
      </div>

      {error && <div className="error card">{error}</div>}

      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        {loading ? (
          <div
            style={{
              padding: "40px",
              textAlign: "center",
              color: "var(--text-muted)",
            }}
          >
            Loading work groups from Assetic…
          </div>
        ) : filtered.length === 0 ? (
          <div
            style={{
              textAlign: "center",
              padding: "40px",
              color: "var(--text-muted)",
            }}
          >
            {workGroups.length === 0
              ? "No work groups found. Ensure Assetic integration is configured and enabled."
              : "No results match your search."}
          </div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th style={{ width: "130px" }}>Code</th>
                <th>Description</th>
                <th style={{ width: "80px" }}>Active</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((g, i) => (
                <tr key={g.Id || g.id || i}>
                  <td style={{ fontWeight: 500 }}>{g.Name || g.name || "—"}</td>
                  <td
                    style={{
                      color: "var(--text-muted)",
                      fontSize: "13px",
                      fontFamily: "monospace",
                      letterSpacing: "0.4px",
                    }}
                  >
                    {g.Code || g.GroupCode || g.code || "—"}
                  </td>
                  <td
                    style={{
                      color: "var(--text-secondary)",
                      fontSize: "13px",
                    }}
                  >
                    {g.Description || g.description || (
                      <span
                        style={{
                          color: "var(--text-muted)",
                          fontStyle: "italic",
                        }}
                      >
                        No description
                      </span>
                    )}
                  </td>
                  <td>
                    {g.IsActive !== undefined || g.isActive !== undefined ? (
                      <span
                        className={`badge ${(g.IsActive ?? g.isActive) ? "badge-success" : "badge-muted"}`}
                      >
                        {(g.IsActive ?? g.isActive) ? "Active" : "Inactive"}
                      </span>
                    ) : (
                      <span style={{ color: "var(--text-muted)" }}>—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {!loading && workGroups.length > 0 && (
        <div
          style={{
            marginTop: "8px",
            fontSize: "12px",
            color: "var(--text-muted)",
          }}
        >
          {workGroups.length} work group{workGroups.length !== 1 ? "s" : ""}{" "}
          loaded from Assetic
          {search && filtered.length !== workGroups.length
            ? ` · ${filtered.length} match your search`
            : ""}
          .
        </div>
      )}
    </div>
  );
};

export default WorkGroups;
