import React, { useState, useEffect, useMemo } from "react";
import { maintenanceService } from "../services/maintenanceService";
import { generatePdf, buildWorkRequestTemplate } from "../services/pdfService";
import Modal from "../components/Modal";
import FilterPresetsPanel from "../components/FilterPresetsPanel";

const priorityBadgeClass = (p: string) => {
  const map: Record<string, string> = {
    critical: "badge-error",
    high: "badge-warning",
    medium: "badge-info",
    low: "badge-muted",
  };
  return map[p] || "badge-muted";
};

const statusBadgeClass = (s: string) => {
  const map: Record<string, string> = {
    open: "badge-info",
    in_progress: "badge-warning",
    completed: "badge-success",
    cancelled: "badge-muted",
    pending: "badge-secondary",
  };
  return map[s] || "badge-muted";
};

const toLabel = (s: string) =>
  (s || "").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

// Extracts the craft sub-name from a work group name like "North West - Carpenter" → "Carpenter"
const deriveCraftFromWorkGroup = (name: string): string => {
  const idx = name.lastIndexOf(" - ");
  return idx >= 0 ? name.slice(idx + 3).trim() : "";
};

// Extracts the direction from a work group name: "North West - Carpenter" → "North West"
const directionFromWorkGroup = (name: string): string => {
  const idx = name.indexOf(" - ");
  return idx >= 0 ? name.slice(0, idx).trim() : name.trim();
};

// Extracts the direction from a location string like "North > Hospital > ..."
const regionFromLocation = (location: string): string =>
  location ? location.split(" > ")[0].trim() : "";

const Maintenance: React.FC = () => {
  const [allRequests, setAllRequests] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [filters, setFilters] = useState({
    status: "",
    priority: "",
    search: "",
    dateFrom: "",
    dateTo: "",
  });

  // Client-side filtered view (search + date applied locally)
  const requests = useMemo(() => {
    let list = allRequests;
    if (filters.search) {
      const s = filters.search.toLowerCase();
      list = list.filter(
        (r) =>
          (r.title || "").toLowerCase().includes(s) ||
          (r.requestor_display_name || r.requested_by_username || "")
            .toLowerCase()
            .includes(s) ||
          (r.location || "").toLowerCase().includes(s),
      );
    }
    if (filters.dateFrom) {
      const from = new Date(filters.dateFrom);
      list = list.filter((r) => new Date(r.created_at) >= from);
    }
    if (filters.dateTo) {
      const to = new Date(filters.dateTo + "T23:59:59");
      list = list.filter((r) => new Date(r.created_at) <= to);
    }
    return list;
  }, [allRequests, filters.search, filters.dateFrom, filters.dateTo]);

  // Selected request for detail panel
  const [selected, setSelected] = useState<any | null>(null);

  // Triage edit state
  const [editStatus, setEditStatus] = useState("");
  const [editPriority, setEditPriority] = useState("");
  const [editCategory, setEditCategory] = useState("");
  const [updating, setUpdating] = useState(false);

  // Work order creation state
  const [woCraft, setWoCraft] = useState("");
  const [woWorkGroup, setWoWorkGroup] = useState("");
  const [woScheduled, setWoScheduled] = useState("");
  const [woEstimatedDuration, setWoEstimatedDuration] = useState("");
  const [creatingWo, setCreatingWo] = useState(false);
  const [workGroups, setWorkGroups] = useState<any[]>([]);

  // Messages
  const [messages, setMessages] = useState<any[]>([]);
  const [newMessage, setNewMessage] = useState("");
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);

  useEffect(() => {
    fetchRequests();
    fetchWorkGroups();
  }, []);

  const fetchWorkGroups = async () => {
    try {
      const data = await maintenanceService.getWorkGroups();
      setWorkGroups(data.workGroups || []);
    } catch {
      // non-critical
    }
  };

  const fetchRequests = async (activeFilters = filters) => {
    setLoading(true);
    setError("");
    try {
      const data = await maintenanceService.getRequests({
        status: activeFilters.status || undefined,
        priority: activeFilters.priority || undefined,
      });
      setAllRequests(data.requests || []);
    } catch (err: any) {
      setError(err.response?.data?.error || "Failed to fetch requests");
    } finally {
      setLoading(false);
    }
  };

  const selectRequest = async (req: any) => {
    if (selected?.id === req.id) {
      setSelected(null);
      return;
    }
    setSelected(req);
    setEditStatus(req.status || "open");
    setEditPriority(req.priority || "medium");
    setEditCategory(req.category || "");
    setWoCraft("");
    setWoWorkGroup("");
    setWoScheduled("");
    setWoEstimatedDuration("");
    setMessages([]);
    setNewMessage("");

    if (req.work_order_id) {
      setMessagesLoading(true);
      try {
        const data = await maintenanceService.getMessages(req.work_order_id);
        setMessages(data.messages || []);
      } catch {
        // messages are non-critical
      } finally {
        setMessagesLoading(false);
      }
    }
  };

  const refreshAndReselect = async (requestId: number) => {
    const data = await maintenanceService.getRequests({
      status: filters.status || undefined,
      priority: filters.priority || undefined,
    });
    setAllRequests(data.requests || []);
    const updated = (data.requests || []).find((r: any) => r.id === requestId);
    if (updated) setSelected(updated);
    return updated;
  };

  const handleUpdate = async () => {
    if (!selected) return;
    setUpdating(true);
    try {
      await maintenanceService.updateRequest(selected.id, {
        status: editStatus,
        priority: editPriority,
        category: editCategory,
      });
      await refreshAndReselect(selected.id);
    } catch (err: any) {
      setError(err.response?.data?.error || "Failed to update request");
    } finally {
      setUpdating(false);
    }
  };

  const handleCreateWorkOrder = async () => {
    if (!selected) return;
    setCreatingWo(true);
    try {
      await maintenanceService.createWorkOrder({
        requestId: selected.id,
        title: selected.title,
        description: selected.description || undefined,
        priority: selected.priority,
        craft: woCraft || deriveCraftFromWorkGroup(woWorkGroup) || undefined,
        workGroup: woWorkGroup || undefined,
        scheduledDate: woScheduled || undefined,
        estimatedDuration: woEstimatedDuration
          ? Number(woEstimatedDuration)
          : undefined,
      });
      const updated = await refreshAndReselect(selected.id);
      if (updated?.work_order_id) {
        const msgs = await maintenanceService.getMessages(
          updated.work_order_id,
        );
        setMessages(msgs.messages || []);
      }
      setWoCraft("");
      setWoWorkGroup("");
      setWoScheduled("");
      setWoEstimatedDuration("");
    } catch (err: any) {
      const data = err.response?.data;
      const baseMsg = data?.error || "Failed to create work order";
      const assetInfo = data?.resolvedAsset
        ? ` (Asset attempted: "${data.resolvedAsset.name}" — ${data.resolvedAsset.guid})`
        : "";
      setError(baseMsg + assetInfo);
    } finally {
      setCreatingWo(false);
    }
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selected?.work_order_id || !newMessage.trim()) return;
    try {
      await maintenanceService.sendMessage(selected.work_order_id, newMessage);
      setNewMessage("");
      const data = await maintenanceService.getMessages(selected.work_order_id);
      setMessages(data.messages || []);
    } catch (err: any) {
      setError(err.response?.data?.error || "Failed to send message");
    }
  };

  const hasActiveFilters = !!(
    filters.status ||
    filters.priority ||
    filters.search ||
    filters.dateFrom ||
    filters.dateTo
  );
  const activeFilterCount = [
    filters.status,
    filters.priority,
    filters.dateFrom,
    filters.dateTo,
  ].filter(Boolean).length;

  return (
    <div className="container" style={{ maxWidth: "1600px" }}>
      {/* ── Filter topbar ── */}
      <div className="filter-topbar">
        <h2>Requests</h2>
        <div className="filter-topbar-controls">
          <input
            type="text"
            value={filters.search}
            onChange={(e) => setFilters({ ...filters, search: e.target.value })}
            placeholder="Search requests…"
            className="filter-search"
          />
          <button
            className={`filter-toggle-btn${
              filtersOpen ? " filter-toggle-open" : ""
            }${activeFilterCount > 0 ? " filter-toggle-active" : ""}`}
            onClick={() => setFiltersOpen((o) => !o)}
          >
            ⚙ Filters
            {activeFilterCount > 0 && (
              <span className="filter-badge">{activeFilterCount}</span>
            )}
          </button>
          <button onClick={() => fetchRequests(filters)}>Refresh</button>
          {hasActiveFilters && (
            <button
              className="btn-ghost"
              onClick={() => {
                const cleared = {
                  status: "",
                  priority: "",
                  search: "",
                  dateFrom: "",
                  dateTo: "",
                };
                setFilters(cleared);
                fetchRequests(cleared);
              }}
            >
              Clear
            </button>
          )}
        </div>
      </div>
      {/* ── Expandable filter panel ── */}
      {filtersOpen && (
        <div className="filter-panel card">
          <div className="filter-grid">
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label>Status</label>
              <select
                value={filters.status}
                onChange={(e) => {
                  const f = { ...filters, status: e.target.value };
                  setFilters(f);
                  fetchRequests(f);
                }}
              >
                <option value="">All Statuses</option>
                <option value="open">Open</option>
                <option value="in_progress">In Progress</option>
                <option value="completed">Completed</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label>Priority</label>
              <select
                value={filters.priority}
                onChange={(e) => {
                  const f = { ...filters, priority: e.target.value };
                  setFilters(f);
                  fetchRequests(f);
                }}
              >
                <option value="">All Priorities</option>
                <option value="critical">Critical</option>
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
              </select>
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label>Date From</label>
              <input
                type="date"
                value={filters.dateFrom}
                onChange={(e) =>
                  setFilters({ ...filters, dateFrom: e.target.value })
                }
              />
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label>Date To</label>
              <input
                type="date"
                value={filters.dateTo}
                onChange={(e) =>
                  setFilters({ ...filters, dateTo: e.target.value })
                }
              />
            </div>
          </div>
        </div>
      )}
      {/* ── Main: data table + presets sidebar ── */}
      <div className="admin-page-layout">
        <div className="admin-page-main">
          {error && <div className="error card">{error}</div>}

          {allRequests.length > 0 && requests.length !== allRequests.length && (
            <div
              style={{
                fontSize: "12px",
                color: "var(--text-muted)",
                marginBottom: "6px",
              }}
            >
              Showing {requests.length} of {allRequests.length} requests
            </div>
          )}

          {/* ── Request List ── */}
          <div className="card" style={{ padding: 0, overflow: "hidden" }}>
            {loading ? (
              <div
                style={{
                  padding: "40px",
                  textAlign: "center",
                  color: "var(--text-muted)",
                }}
              >
                Loading requests…
              </div>
            ) : requests.length === 0 ? (
              <div
                style={{
                  textAlign: "center",
                  padding: "40px",
                  color: "var(--text-muted)",
                }}
              >
                No requests found.
              </div>
            ) : (
              <table className="data-table">
                <thead>
                  <tr>
                    <th style={{ width: "60px" }}>WR #</th>
                    <th>Title</th>
                    <th>Submitted By</th>
                    <th style={{ width: "90px" }}>Priority</th>
                    <th style={{ width: "110px" }}>Status</th>
                    <th>Location</th>
                    <th style={{ width: "110px" }}>Work Order</th>
                    <th style={{ width: "90px" }}>Date</th>
                  </tr>
                </thead>
                <tbody>
                  {requests.map((req) => (
                    <tr
                      key={req.id}
                      onClick={() => selectRequest(req)}
                      style={{
                        cursor: "pointer",
                        background:
                          selected?.id === req.id
                            ? "rgba(14,165,233,0.08)"
                            : undefined,
                      }}
                    >
                      <td
                        style={{ color: "var(--text-muted)", fontSize: "13px" }}
                        title={`Local ID: ${req.id}`}
                      >
                        {req.assetic_friendly_id || `WR-${req.id}`}
                      </td>
                      <td style={{ fontWeight: 500 }}>{req.title}</td>
                      <td
                        style={{
                          color: "var(--text-secondary)",
                          fontSize: "13px",
                        }}
                      >
                        {req.requestor_display_name ||
                          req.requested_by_username ||
                          "—"}
                      </td>
                      <td>
                        <span
                          className={`badge ${priorityBadgeClass(req.priority)}`}
                        >
                          {req.priority || "—"}
                        </span>
                      </td>
                      <td>
                        <span
                          className={`badge ${statusBadgeClass(req.status)}`}
                        >
                          {toLabel(req.status || "open")}
                        </span>
                      </td>
                      <td
                        style={{
                          color: "var(--text-secondary)",
                          fontSize: "13px",
                          maxWidth: "200px",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {req.location || "—"}
                      </td>
                      <td>
                        {req.work_order_id ? (
                          <span
                            className={`badge ${statusBadgeClass(req.work_order_status || "pending")}`}
                          >
                            {req.work_order_friendly_id ||
                              `WO #${req.work_order_id}`}
                          </span>
                        ) : (
                          <span
                            style={{
                              color: "var(--text-muted)",
                              fontSize: "13px",
                            }}
                          >
                            —
                          </span>
                        )}
                      </td>
                      <td
                        style={{
                          color: "var(--text-muted)",
                          fontSize: "13px",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {new Date(req.created_at).toLocaleDateString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>{" "}
        {/* admin-page-main */}
        <FilterPresetsPanel
          storageKey="filterPresets_requests"
          currentFilters={filters}
          onApply={(f) => {
            const merged = {
              status: "",
              priority: "",
              search: "",
              dateFrom: "",
              dateTo: "",
              ...f,
            };
            setFilters(merged);
            fetchRequests(merged);
          }}
        />
      </div>{" "}
      {/* admin-page-layout */}
      {/* ── Detail Modal ── */}
      {selected && (
        <Modal onClose={() => setSelected(null)}>
          {/* Modal header */}
          <div className="modal-header">
            <div>
              <h3>
                {selected.assetic_friendly_id
                  ? `${selected.assetic_friendly_id}: ${selected.title}`
                  : selected.title}
              </h3>
              <div style={{ fontSize: "13px", color: "var(--text-muted)" }}>
                Submitted by{" "}
                <strong style={{ color: "var(--text-secondary)" }}>
                  {selected.requestor_display_name ||
                    selected.requested_by_username ||
                    "Unknown"}
                </strong>
                {selected.requestor_email && ` — ${selected.requestor_email}`}
                {selected.requestor_phone &&
                  ` · Phone: ${selected.requestor_phone}`}
                {selected.requestor_mobile &&
                  ` · Mobile: ${selected.requestor_mobile}`}
                {" · "}
                {new Date(selected.created_at).toLocaleString()}
              </div>
            </div>
            <div
              style={{
                display: "flex",
                gap: "8px",
                alignItems: "center",
                flexShrink: 0,
              }}
            >
              <button
                className="btn-ghost"
                onClick={() => generatePdf(buildWorkRequestTemplate(selected))}
                title="Download PDF"
                style={{ fontSize: "13px" }}
              >
                ↓ PDF
              </button>
              <button className="btn-ghost" onClick={() => setSelected(null)}>
                ✕
              </button>
            </div>
          </div>

          <div className="modal-body">
            {/* ── Next-step guidance banner ── */}
            {selected.status !== "completed" &&
              selected.status !== "cancelled" && (
                <div
                  className={`next-step-banner ${
                    selected.work_order_id
                      ? selected.work_order_status === "completed"
                        ? "next-step-done"
                        : "next-step-action"
                      : "next-step-new"
                  }`}
                >
                  {!selected.work_order_id &&
                    (selected.status === "in_progress"
                      ? "▶ In progress but no work order yet — create a Work Order below to formally assign a craft/trade."
                      : "◎ New report — review the issue, set priority and category, then create a Work Order when ready.")}
                  {selected.work_order_id &&
                    selected.work_order_status === "pending" &&
                    "⏳ Work order raised — assign a craft/trade, schedule the work, then update the status when it starts."}
                  {selected.work_order_id &&
                    selected.work_order_status === "in_progress" &&
                    "🔧 Work is underway — use the messages thread below to communicate updates and notes."}
                  {selected.work_order_id &&
                    selected.work_order_status === "completed" &&
                    "✓ Work complete — review and close this request, or add a final note."}
                </div>
              )}

            {/* Two-column body */}
            <div style={{ display: "flex", gap: "24px", flexWrap: "wrap" }}>
              {/* Left — reported issue */}
              <div style={{ flex: "1 1 300px" }}>
                <div
                  style={{
                    fontSize: "11px",
                    fontWeight: 700,
                    color: "var(--text-muted)",
                    textTransform: "uppercase",
                    letterSpacing: "0.6px",
                    marginBottom: "10px",
                  }}
                >
                  Reported Issue
                </div>

                {selected.location && (
                  <div style={{ marginBottom: "8px", fontSize: "14px" }}>
                    <span style={{ color: "var(--text-muted)" }}>
                      Location:{" "}
                    </span>
                    <span style={{ color: "var(--text-secondary)" }}>
                      {selected.location}
                    </span>
                  </div>
                )}

                {selected.category && (
                  <div style={{ marginBottom: "8px", fontSize: "14px" }}>
                    <span style={{ color: "var(--text-muted)" }}>
                      Category:{" "}
                    </span>
                    <span>{selected.category}</span>
                  </div>
                )}

                {selected.description ? (
                  <div
                    style={{
                      fontSize: "14px",
                      color: "var(--text-secondary)",
                      lineHeight: "1.6",
                      padding: "12px",
                      background: "var(--bg-secondary)",
                      borderRadius: "var(--radius)",
                      border: "1px solid var(--border)",
                      marginBottom: "8px",
                      whiteSpace: "pre-wrap",
                    }}
                  >
                    {selected.description}
                  </div>
                ) : (
                  <div
                    style={{
                      fontSize: "13px",
                      color: "var(--text-muted)",
                      fontStyle: "italic",
                      marginBottom: "8px",
                    }}
                  >
                    No description provided.
                  </div>
                )}

                {selected.supporting_information && (
                  <div
                    style={{
                      fontSize: "13px",
                      color: "var(--text-muted)",
                      fontStyle: "italic",
                    }}
                  >
                    {selected.supporting_information}
                  </div>
                )}
              </div>

              {/* Right — triage + work order */}
              <div style={{ flex: "1 1 300px" }}>
                <div
                  style={{
                    fontSize: "11px",
                    fontWeight: 700,
                    color: "var(--text-muted)",
                    textTransform: "uppercase",
                    letterSpacing: "0.6px",
                    marginBottom: "10px",
                  }}
                >
                  Triage
                </div>

                <div
                  style={{
                    display: "flex",
                    gap: "10px",
                    marginBottom: "10px",
                  }}
                >
                  <div
                    className="form-group"
                    style={{ flex: 1, marginBottom: 0 }}
                  >
                    <label style={{ fontSize: "12px" }}>Priority</label>
                    <select
                      value={editPriority}
                      onChange={(e) => setEditPriority(e.target.value)}
                    >
                      <option value="low">Low</option>
                      <option value="medium">Medium</option>
                      <option value="high">High</option>
                      <option value="critical">Critical</option>
                    </select>
                  </div>
                  <div
                    className="form-group"
                    style={{ flex: 1, marginBottom: 0 }}
                  >
                    <label style={{ fontSize: "12px" }}>Status</label>
                    <select
                      value={editStatus}
                      onChange={(e) => setEditStatus(e.target.value)}
                    >
                      <option value="open">Open</option>
                      <option value="in_progress">In Progress</option>
                      <option value="completed">Completed</option>
                      <option value="cancelled">Cancelled</option>
                    </select>
                  </div>
                </div>

                <div className="form-group" style={{ marginBottom: "10px" }}>
                  <label style={{ fontSize: "12px" }}>Category</label>
                  <input
                    type="text"
                    value={editCategory}
                    onChange={(e) => setEditCategory(e.target.value)}
                    placeholder="e.g. Plumbing, Electrical, HVAC"
                  />
                </div>

                <button
                  onClick={handleUpdate}
                  disabled={updating}
                  style={{ width: "100%", marginBottom: "20px" }}
                >
                  {updating ? "Saving…" : "Update Request"}
                </button>

                {/* Work Order section */}
                <div
                  style={{
                    paddingTop: "16px",
                    borderTop: "1px solid var(--border)",
                  }}
                >
                  <div
                    style={{
                      fontSize: "11px",
                      fontWeight: 700,
                      color: "var(--text-muted)",
                      textTransform: "uppercase",
                      letterSpacing: "0.6px",
                      marginBottom: "10px",
                    }}
                  >
                    Work Order
                  </div>

                  {selected.work_order_id ? (
                    <div
                      style={{
                        padding: "12px",
                        background: "var(--bg-secondary)",
                        borderRadius: "var(--radius)",
                        border: "1px solid var(--border)",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          marginBottom: "6px",
                        }}
                      >
                        <span style={{ fontWeight: 600 }}>
                          {selected.work_order_friendly_id ||
                            `WO #${selected.work_order_id}`}
                        </span>
                        <span
                          className={`badge ${statusBadgeClass(selected.work_order_status || "pending")}`}
                        >
                          {toLabel(selected.work_order_status || "pending")}
                        </span>
                      </div>
                      {selected.work_order_craft && (
                        <div
                          style={{
                            fontSize: "13px",
                            color: "var(--text-secondary)",
                          }}
                        >
                          Craft: {selected.work_order_craft}
                        </div>
                      )}
                      <div
                        style={{
                          fontSize: "12px",
                          color: "var(--text-muted)",
                          marginTop: "6px",
                        }}
                      >
                        Manage this work order from the Work Orders list.
                      </div>
                    </div>
                  ) : (
                    <>
                      <div
                        className="form-group"
                        style={{ marginBottom: "8px" }}
                      >
                        <label style={{ fontSize: "12px" }}>Work Group</label>
                        <select
                          value={woWorkGroup}
                          onChange={(e) => {
                            const wg = e.target.value;
                            setWoWorkGroup(wg);
                            const derived = deriveCraftFromWorkGroup(wg);
                            if (derived) setWoCraft(derived);
                          }}
                        >
                          <option value="">— Select work group —</option>
                          {(() => {
                            const region = regionFromLocation(
                              selected?.location || "",
                            );
                            // Exact-match the direction prefix of each work group
                            // name (e.g. "North") against the location's direction
                            // so "North" only shows North groups, not North West.
                            const filtered = region
                              ? workGroups.filter((g) => {
                                  const name: string = g.Name || g.name || "";
                                  return (
                                    directionFromWorkGroup(
                                      name,
                                    ).toLowerCase() === region.toLowerCase()
                                  );
                                })
                              : workGroups;
                            return (
                              filtered.length > 0 ? filtered : workGroups
                            ).map((g) => (
                              <option
                                key={g.Id || g.id || g.Name || g.name}
                                value={g.Name || g.name || ""}
                              >
                                {g.Name || g.name}
                              </option>
                            ));
                          })()}
                        </select>
                        {selected?.location &&
                          regionFromLocation(selected.location) && (
                            <div
                              style={{
                                fontSize: "11px",
                                color: "var(--text-muted)",
                                marginTop: "3px",
                              }}
                            >
                              Showing {regionFromLocation(selected.location)}{" "}
                              work groups
                            </div>
                          )}
                        {woWorkGroup &&
                          deriveCraftFromWorkGroup(woWorkGroup) && (
                            <div
                              style={{
                                fontSize: "11px",
                                color: "var(--text-muted)",
                                marginTop: "3px",
                              }}
                            >
                              Craft auto-set to &ldquo;
                              {deriveCraftFromWorkGroup(woWorkGroup)}&rdquo;
                            </div>
                          )}
                      </div>
                      <div
                        style={{
                          display: "flex",
                          gap: "10px",
                          marginBottom: "8px",
                        }}
                      >
                        <div
                          className="form-group"
                          style={{ flex: 1, marginBottom: 0 }}
                        >
                          <label style={{ fontSize: "12px" }}>
                            Scheduled Start
                          </label>
                          <input
                            type="datetime-local"
                            value={woScheduled}
                            onChange={(e) => setWoScheduled(e.target.value)}
                          />
                        </div>
                        <div
                          className="form-group"
                          style={{ flex: 1, marginBottom: 0 }}
                        >
                          <label style={{ fontSize: "12px" }}>
                            Est. Duration (hrs)
                          </label>
                          <input
                            type="number"
                            min="0.5"
                            step="0.5"
                            value={woEstimatedDuration}
                            onChange={(e) =>
                              setWoEstimatedDuration(e.target.value)
                            }
                            placeholder="e.g. 2"
                          />
                        </div>
                      </div>
                      <button
                        onClick={handleCreateWorkOrder}
                        disabled={creatingWo}
                        style={{
                          width: "100%",
                          background: "rgba(34,197,94,0.15)",
                          color: "#4ade80",
                          border: "1px solid rgba(34,197,94,0.3)",
                        }}
                      >
                        {creatingWo ? "Creating…" : "↑ Create Work Order"}
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>

            {/* Messages — shown once a work order exists */}
            {selected.work_order_id && (
              <div
                style={{
                  marginTop: "4px",
                  paddingTop: "16px",
                  borderTop: "1px solid var(--border)",
                }}
              >
                <div
                  style={{
                    fontSize: "11px",
                    fontWeight: 700,
                    color: "var(--text-muted)",
                    textTransform: "uppercase",
                    letterSpacing: "0.6px",
                    marginBottom: "10px",
                  }}
                >
                  Work Order Messages
                </div>
                {messagesLoading ? (
                  <div style={{ color: "var(--text-muted)", fontSize: "14px" }}>
                    Loading messages…
                  </div>
                ) : (
                  <>
                    <div className="messages-box">
                      {messages.length === 0 ? (
                        <p style={{ color: "var(--text-muted)" }}>
                          No messages yet.
                        </p>
                      ) : (
                        messages.map((msg) => (
                          <div key={msg.id} className="message-bubble">
                            <strong>{msg.sender_username || "Unknown"}</strong>
                            <span className="message-meta">
                              {new Date(msg.created_at).toLocaleString()}
                            </span>
                            <p style={{ margin: "4px 0 0 0" }}>{msg.message}</p>
                          </div>
                        ))
                      )}
                    </div>
                    <form
                      onSubmit={handleSendMessage}
                      style={{ display: "flex", gap: "10px" }}
                    >
                      <input
                        type="text"
                        value={newMessage}
                        onChange={(e) => setNewMessage(e.target.value)}
                        placeholder="Add a note or message…"
                        style={{ flex: 1 }}
                        required
                      />
                      <button type="submit">Send</button>
                    </form>
                  </>
                )}
              </div>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
};

export default Maintenance;
