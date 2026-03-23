import React, { useState, useEffect, useMemo } from "react";
import { maintenanceService } from "../services/maintenanceService";
import { generatePdf, buildWorkOrderTemplate, type PdfTemplateConfig } from "../services/pdfService";
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
    pending: "badge-secondary",
    in_progress: "badge-warning",
    completed: "badge-success",
    cancelled: "badge-muted",
    open: "badge-info",
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

const WorkOrders: React.FC = () => {
  const [allWorkOrders, setAllWorkOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [filters, setFilters] = useState({
    status: "",
    craft: "",
    workGroup: "",
    priority: "",
    search: "",
    dateFrom: "",
    dateTo: "",
  });
  const [crafts, setCrafts] = useState<string[]>([]);
  const [workGroups, setWorkGroups] = useState<any[]>([]);

  // Client-side filtered view
  const workOrders = useMemo(() => {
    let list = allWorkOrders;
    if (filters.search) {
      const s = filters.search.toLowerCase();
      list = list.filter(
        (w) =>
          (w.title || "").toLowerCase().includes(s) ||
          (w.craft || "").toLowerCase().includes(s) ||
          (w.work_group || "").toLowerCase().includes(s) ||
          (w.assigned_to_username || "").toLowerCase().includes(s),
      );
    }
    if (filters.priority) {
      list = list.filter((w) => w.priority === filters.priority);
    }
    if (filters.workGroup) {
      const wg = filters.workGroup.toLowerCase();
      list = list.filter((w) => (w.work_group || "").toLowerCase() === wg);
    }
    if (filters.dateFrom) {
      const from = new Date(filters.dateFrom);
      list = list.filter((w) => new Date(w.created_at) >= from);
    }
    if (filters.dateTo) {
      const to = new Date(filters.dateTo + "T23:59:59");
      list = list.filter((w) => new Date(w.created_at) <= to);
    }
    return list;
  }, [
    allWorkOrders,
    filters.search,
    filters.priority,
    filters.workGroup,
    filters.dateFrom,
    filters.dateTo,
  ]);

  // Selected WO for modal
  const [selectedOrder, setSelectedOrder] = useState<any | null>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [newMessage, setNewMessage] = useState("");
  const [messagesLoading, setMessagesLoading] = useState(false);

  // Edit state (inside modal)
  const [editCraft, setEditCraft] = useState("");
  const [editWorkGroup, setEditWorkGroup] = useState("");
  const [editStatus, setEditStatus] = useState("");
  const [editScheduled, setEditScheduled] = useState("");
  const [updating, setUpdating] = useState(false);
  const [cloning, setCloning] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);

  // PDF template config (fetched from server)
  const [pdfTemplateConfig, setPdfTemplateConfig] = useState<PdfTemplateConfig | undefined>(undefined);

  useEffect(() => {
    fetchWorkOrders();
    fetchCrafts();
    fetchWorkGroups();
    fetchPdfTemplateConfig();
  }, []);

  const fetchWorkOrders = async (activeFilters = filters) => {
    setLoading(true);
    setError("");
    try {
      const data = await maintenanceService.getWorkOrders({
        status: activeFilters.status || undefined,
        craft: activeFilters.craft || undefined,
      });
      setAllWorkOrders(data.workOrders || []);
    } catch (err: any) {
      setError(err.response?.data?.error || "Failed to fetch work orders");
    } finally {
      setLoading(false);
    }
  };

  const fetchCrafts = async () => {
    try {
      const data = await maintenanceService.getCrafts();
      setCrafts(data.crafts || []);
    } catch {
      // non-critical
    }
  };

  const fetchWorkGroups = async () => {
    try {
      const data = await maintenanceService.getWorkGroups();
      setWorkGroups(data.workGroups || []);
    } catch {
      // non-critical: work groups are used for display/filter only
    }
  };

  const fetchPdfTemplateConfig = async () => {
    try {
      const data = await maintenanceService.getPdfTemplateConfig("work_order");
      setPdfTemplateConfig(data.config as PdfTemplateConfig);
    } catch {
      // non-critical: PDF will fall back to default template
    }
  };

  const openDetail = async (wo: any) => {
    setSelectedOrder(wo);
    setEditCraft(wo.craft || "");
    setEditWorkGroup(wo.work_group || "");
    setEditStatus(wo.status || "pending");
    setEditScheduled(wo.scheduled_date ? wo.scheduled_date.split("T")[0] : "");
    setMessages([]);
    setMessagesLoading(true);
    try {
      const data = await maintenanceService.getMessages(wo.id);
      setMessages(data.messages || []);
      // Mark as read for staff
      maintenanceService.markWorkOrderMessagesRead(wo.id).catch(() => {});
      // Optimistically clear the unread flag in the local list
      setAllWorkOrders((prev) =>
        prev.map((w) => (w.id === wo.id ? { ...w, unread_staff: false } : w)),
      );
    } catch {
      // non-critical
    } finally {
      setMessagesLoading(false);
    }
  };

  const handleUpdateOrder = async () => {
    if (!selectedOrder) return;
    setUpdating(true);
    try {
      await maintenanceService.updateWorkOrder(selectedOrder.id, {
        craft: editCraft || undefined,
        workGroup: editWorkGroup || undefined,
        status: editStatus || undefined,
        scheduledDate: editScheduled || undefined,
      });
      const data = await maintenanceService.getWorkOrders({
        status: filters.status || undefined,
        craft: filters.craft || undefined,
      });
      setAllWorkOrders(data.workOrders || []);
      const updated = (data.workOrders || []).find(
        (w: any) => w.id === selectedOrder.id,
      );
      if (updated) setSelectedOrder(updated);
    } catch (err: any) {
      setError(err.response?.data?.error || "Failed to update work order");
    } finally {
      setUpdating(false);
    }
  };

  const handleCloneOrder = async () => {
    if (!selectedOrder) return;
    setCloning(true);
    try {
      await maintenanceService.cloneWorkOrder(selectedOrder.id);
      setSelectedOrder(null);
      await fetchWorkOrders();
    } catch (err: any) {
      setError(err.response?.data?.error || "Failed to clone work order");
    } finally {
      setCloning(false);
    }
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedOrder || !newMessage.trim()) return;
    try {
      await maintenanceService.sendMessage(selectedOrder.id, newMessage);
      setNewMessage("");
      const data = await maintenanceService.getMessages(selectedOrder.id);
      setMessages(data.messages || []);
      // Mark own unread flag clear immediately (staff just sent, no self-unread)
      setAllWorkOrders((prev) =>
        prev.map((w) =>
          w.id === selectedOrder.id ? { ...w, unread_staff: false } : w,
        ),
      );
    } catch (err: any) {
      setError(err.response?.data?.error || "Failed to send message");
    }
  };

  const hasActiveFilters = !!(
    filters.status ||
    filters.craft ||
    filters.workGroup ||
    filters.priority ||
    filters.search ||
    filters.dateFrom ||
    filters.dateTo
  );
  const activeFilterCount = [
    filters.status,
    filters.craft,
    filters.workGroup,
    filters.priority,
    filters.dateFrom,
    filters.dateTo,
  ].filter(Boolean).length;

  return (
    <div className="container" style={{ maxWidth: "1600px" }}>
      {/* ── Filter topbar ── */}
      <div className="filter-topbar">
        <h2>Work Orders</h2>
        <div className="filter-topbar-controls">
          <input
            type="text"
            value={filters.search}
            onChange={(e) => setFilters({ ...filters, search: e.target.value })}
            placeholder="Search work orders…"
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
          <button onClick={() => fetchWorkOrders(filters)}>Refresh</button>
          {hasActiveFilters && (
            <button
              className="btn-ghost"
              onClick={() => {
                const cleared = {
                  status: "",
                  craft: "",
                  workGroup: "",
                  priority: "",
                  search: "",
                  dateFrom: "",
                  dateTo: "",
                };
                setFilters(cleared);
                fetchWorkOrders(cleared);
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
                  fetchWorkOrders(f);
                }}
              >
                <option value="">All Statuses</option>
                <option value="pending">Pending</option>
                <option value="in_progress">In Progress</option>
                <option value="completed">Completed</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label>Priority</label>
              <select
                value={filters.priority}
                onChange={(e) =>
                  setFilters({ ...filters, priority: e.target.value })
                }
              >
                <option value="">All Priorities</option>
                <option value="critical">Critical</option>
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
              </select>
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label>Craft / Trade</label>
              <input
                type="text"
                value={filters.craft}
                onChange={(e) => {
                  const f = { ...filters, craft: e.target.value };
                  setFilters(f);
                  fetchWorkOrders(f);
                }}
                placeholder="Filter by craft…"
                list="craft-options"
              />
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label>Work Group</label>
              <select
                value={filters.workGroup}
                onChange={(e) =>
                  setFilters({ ...filters, workGroup: e.target.value })
                }
              >
                <option value="">All Work Groups</option>
                {workGroups.map((g) => (
                  <option
                    key={g.Id || g.id || g.Name || g.name}
                    value={g.Name || g.name || ""}
                  >
                    {g.Name || g.name}
                  </option>
                ))}
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

          {allWorkOrders.length > 0 &&
            workOrders.length !== allWorkOrders.length && (
              <div
                style={{
                  fontSize: "12px",
                  color: "var(--text-muted)",
                  marginBottom: "6px",
                }}
              >
                Showing {workOrders.length} of {allWorkOrders.length} work
                orders
              </div>
            )}

          {/* ── Work Order List ── */}
          <div className="card" style={{ padding: 0, overflow: "hidden" }}>
            {loading ? (
              <div
                style={{
                  padding: "40px",
                  textAlign: "center",
                  color: "var(--text-muted)",
                }}
              >
                Loading work orders…
              </div>
            ) : workOrders.length === 0 ? (
              <div
                style={{
                  textAlign: "center",
                  padding: "40px",
                  color: "var(--text-muted)",
                }}
              >
                No work orders found.
              </div>
            ) : (
              <table className="data-table">
                <thead>
                  <tr>
                    <th style={{ width: "60px" }}>WO #</th>
                    <th>Title</th>
                    <th style={{ width: "90px" }}>Priority</th>
                    <th style={{ width: "120px" }}>Status</th>
                    <th>Craft / Trade</th>
                    <th>Work Group</th>
                    <th>Assigned To</th>
                    <th style={{ width: "100px" }}>Scheduled</th>
                  </tr>
                </thead>
                <tbody>
                  {workOrders.map((wo) => (
                    <tr
                      key={wo.id}
                      onClick={() => openDetail(wo)}
                      style={{
                        cursor: "pointer",
                        background:
                          selectedOrder?.id === wo.id
                            ? "rgba(14,165,233,0.08)"
                            : undefined,
                      }}
                    >
                      <td
                        style={{
                          color: "var(--text-muted)",
                          fontSize: "13px",
                          fontWeight: wo.assetic_friendly_id ? 500 : undefined,
                        }}
                      >
                        {wo.assetic_friendly_id || `#${wo.id}`}
                      </td>
                      <td style={{ fontWeight: 500 }}>
                        {wo.unread_staff && (
                          <span
                            className="unread-dot"
                            title="New message from requester"
                          />
                        )}
                        {wo.title}
                        {wo.description && (
                          <div
                            style={{
                              fontSize: "12px",
                              color: "var(--text-muted)",
                              fontWeight: 400,
                              marginTop: "2px",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                              maxWidth: "320px",
                            }}
                            title={wo.description}
                          >
                            {wo.description}
                          </div>
                        )}
                      </td>
                      <td>
                        <span
                          className={`badge ${priorityBadgeClass(wo.priority)}`}
                        >
                          {wo.priority || "—"}
                        </span>
                      </td>
                      <td>
                        <span
                          className={`badge ${statusBadgeClass(wo.status)}`}
                        >
                          {toLabel(wo.status || "pending")}
                        </span>
                      </td>
                      <td
                        style={{
                          color: "var(--text-secondary)",
                          fontSize: "13px",
                        }}
                      >
                        {wo.craft || (
                          <span style={{ color: "var(--text-muted)" }}>
                            Unassigned
                          </span>
                        )}
                      </td>
                      <td
                        style={{
                          color: "var(--text-secondary)",
                          fontSize: "13px",
                        }}
                      >
                        {wo.work_group || (
                          <span style={{ color: "var(--text-muted)" }}>—</span>
                        )}
                      </td>
                      <td
                        style={{
                          color: "var(--text-secondary)",
                          fontSize: "13px",
                        }}
                      >
                        {wo.assigned_to_username || (
                          <span style={{ color: "var(--text-muted)" }}>—</span>
                        )}
                      </td>
                      <td
                        style={{
                          color: "var(--text-muted)",
                          fontSize: "13px",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {wo.scheduled_date
                          ? new Date(wo.scheduled_date).toLocaleDateString()
                          : "—"}
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
          storageKey="filterPresets_workOrders"
          currentFilters={filters}
          onApply={(f) => {
            const merged = {
              status: "",
              craft: "",
              workGroup: "",
              priority: "",
              search: "",
              dateFrom: "",
              dateTo: "",
              ...f,
            };
            setFilters(merged);
            fetchWorkOrders(merged);
          }}
        />
      </div>{" "}
      {/* admin-page-layout */}
      {/* Datalist for craft suggestions */}
      <datalist id="craft-options">
        {crafts.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>
      {/* Datalist for work group suggestions */}
      <datalist id="workgroup-options">
        {workGroups.map((g) => (
          <option
            key={g.Id || g.id || g.Name || g.name}
            value={g.Name || g.name || ""}
          />
        ))}
      </datalist>
      {/* ── Work Order Modal ── */}
      {selectedOrder && (
        <Modal onClose={() => setSelectedOrder(null)}>
          {/* Header */}
          <div className="modal-header">
            <div>
              <h3>
                {selectedOrder.assetic_friendly_id
                  ? `${selectedOrder.assetic_friendly_id}: ${selectedOrder.title}`
                  : `WO #${selectedOrder.id}: ${selectedOrder.title}`}
              </h3>
              <div
                style={{
                  fontSize: "13px",
                  color: "var(--text-muted)",
                  marginTop: "4px",
                }}
              >
                Priority:{" "}
                <span
                  className={`badge ${priorityBadgeClass(selectedOrder.priority)}`}
                >
                  {selectedOrder.priority || "—"}
                </span>
              </div>
              {selectedOrder.description && (
                <div
                  style={{
                    fontSize: "14px",
                    color: "var(--text-secondary)",
                    lineHeight: "1.6",
                    padding: "10px 12px",
                    background: "var(--bg-secondary)",
                    borderRadius: "var(--radius)",
                    border: "1px solid var(--border)",
                    marginTop: "10px",
                    whiteSpace: "pre-wrap",
                  }}
                >
                  {selectedOrder.description}
                </div>
              )}
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
                onClick={() =>
                  generatePdf(
                    buildWorkOrderTemplate(
                      selectedOrder,
                      pdfTemplateConfig,
                    ),
                  )
                }
                title="Download PDF"
                style={{ fontSize: "13px" }}
              >
                ↓ PDF
              </button>
              <button
                className="btn-ghost"
                onClick={handleCloneOrder}
                disabled={cloning}
                title="Clone this work order into a new pending work order"
                style={{ fontSize: "13px" }}
              >
                {cloning ? "Cloning…" : "⧉ Clone"}
              </button>
              <button
                className="btn-ghost"
                onClick={() => setSelectedOrder(null)}
              >
                ✕
              </button>
            </div>
          </div>

          <div className="modal-body">
            {/* Next-step banner */}
            {selectedOrder.status !== "cancelled" && (
              <div
                className={`next-step-banner ${
                  selectedOrder.status === "completed"
                    ? "next-step-done"
                    : selectedOrder.status === "pending"
                      ? "next-step-new"
                      : "next-step-action"
                }`}
              >
                {selectedOrder.status === "pending" &&
                  "◎ Pending — assign a craft/trade and schedule the work, then set status to In Progress when it begins."}
                {selectedOrder.status === "in_progress" &&
                  "🔧 Work in progress — communicate updates via the messages thread and mark complete when done."}
                {selectedOrder.status === "completed" &&
                  "✓ Work complete — verify with the requester and close if satisfied."}
              </div>
            )}

            {/* Two-column: left = details+edit | right = communication log */}
            <div style={{ display: "flex", gap: "0", minHeight: "380px" }}>
              {/* ── LEFT COLUMN: details + edit ── */}
              <div
                style={{
                  flex: "0 0 44%",
                  paddingRight: "20px",
                  borderRight: "1px solid var(--border)",
                  display: "flex",
                  flexDirection: "column",
                  gap: "16px",
                }}
              >
                <div>
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
                    Details
                  </div>
                  {selectedOrder.craft && (
                    <div style={{ marginBottom: "8px", fontSize: "14px" }}>
                      <span style={{ color: "var(--text-muted)" }}>
                        Craft:{" "}
                      </span>
                      <span>{selectedOrder.craft}</span>
                    </div>
                  )}
                  {selectedOrder.work_group && (
                    <div style={{ marginBottom: "8px", fontSize: "14px" }}>
                      <span style={{ color: "var(--text-muted)" }}>
                        Work Group:{" "}
                      </span>
                      <span>{selectedOrder.work_group}</span>
                    </div>
                  )}
                  {selectedOrder.assigned_to_username && (
                    <div style={{ marginBottom: "8px", fontSize: "14px" }}>
                      <span style={{ color: "var(--text-muted)" }}>
                        Assigned:{" "}
                      </span>
                      <span>{selectedOrder.assigned_to_username}</span>
                    </div>
                  )}
                  {selectedOrder.scheduled_date && (
                    <div style={{ marginBottom: "8px", fontSize: "14px" }}>
                      <span style={{ color: "var(--text-muted)" }}>
                        Scheduled:{" "}
                      </span>
                      <span>
                        {new Date(
                          selectedOrder.scheduled_date,
                        ).toLocaleDateString()}
                      </span>
                    </div>
                  )}
                  <div style={{ marginBottom: "8px", fontSize: "14px" }}>
                    <span style={{ color: "var(--text-muted)" }}>
                      Created:{" "}
                    </span>
                    <span>
                      {new Date(selectedOrder.created_at).toLocaleDateString()}
                    </span>
                  </div>
                </div>

                <div>
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
                    Update
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
                      <label style={{ fontSize: "12px" }}>Status</label>
                      <select
                        value={editStatus}
                        onChange={(e) => setEditStatus(e.target.value)}
                      >
                        <option value="pending">Pending</option>
                        <option value="in_progress">In Progress</option>
                        <option value="completed">Completed</option>
                        <option value="cancelled">Cancelled</option>
                      </select>
                    </div>
                    <div
                      className="form-group"
                      style={{ flex: 1, marginBottom: 0 }}
                    >
                      <label style={{ fontSize: "12px" }}>Scheduled Date</label>
                      <input
                        type="date"
                        value={editScheduled}
                        onChange={(e) => setEditScheduled(e.target.value)}
                      />
                    </div>
                  </div>
                  <div className="form-group" style={{ marginBottom: "10px" }}>
                    <label style={{ fontSize: "12px" }}>Craft / Trade</label>
                    <input
                      type="text"
                      value={editCraft}
                      onChange={(e) => setEditCraft(e.target.value)}
                      placeholder="e.g. Plumbing, HVAC"
                      list="craft-options"
                    />
                  </div>
                  <div className="form-group" style={{ marginBottom: "10px" }}>
                    <label style={{ fontSize: "12px" }}>Work Group</label>
                    <select
                      value={editWorkGroup}
                      onChange={(e) => {
                        const wg = e.target.value;
                        setEditWorkGroup(wg);
                        const derived = deriveCraftFromWorkGroup(wg);
                        if (derived) setEditCraft(derived);
                      }}
                    >
                      <option value="">— Select work group —</option>
                      {workGroups.map((g) => (
                        <option
                          key={g.Id || g.id || g.Name || g.name}
                          value={g.Name || g.name || ""}
                        >
                          {g.Name || g.name}
                        </option>
                      ))}
                    </select>
                    {editWorkGroup &&
                      deriveCraftFromWorkGroup(editWorkGroup) && (
                        <div
                          style={{
                            fontSize: "11px",
                            color: "var(--text-muted)",
                            marginTop: "3px",
                          }}
                        >
                          Craft auto-set to &ldquo;
                          {deriveCraftFromWorkGroup(editWorkGroup)}&rdquo;
                        </div>
                      )}
                  </div>
                  <button
                    onClick={handleUpdateOrder}
                    disabled={updating}
                    style={{ width: "100%" }}
                  >
                    {updating ? "Saving…" : "Save Changes"}
                  </button>
                </div>
              </div>

              {/* ── RIGHT COLUMN: communication log ── */}
              <div
                style={{
                  flex: "1 1 56%",
                  paddingLeft: "20px",
                  display: "flex",
                  flexDirection: "column",
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
                  Communication Log
                </div>
                {messagesLoading ? (
                  <div style={{ color: "var(--text-muted)", fontSize: "14px" }}>
                    Loading messages…
                  </div>
                ) : (
                  <>
                    <div
                      className="messages-box"
                      style={{ flex: 1, marginBottom: "12px" }}
                    >
                      {messages.length === 0 ? (
                        <p
                          style={{
                            color: "var(--text-muted)",
                            fontSize: "13px",
                          }}
                        >
                          No messages yet. Use this thread to communicate
                          updates with the requester.
                        </p>
                      ) : (
                        messages.map((msg) => (
                          <div
                            key={msg.id}
                            className={`message-bubble${msg.is_staff ? " message-bubble-staff" : " message-bubble-reporter"}`}
                          >
                            <div className="message-bubble-header">
                              <strong>
                                {msg.sender_username || "Unknown"}
                              </strong>
                              <span className="message-meta">
                                {new Date(msg.created_at).toLocaleString()}
                              </span>
                            </div>
                            <p style={{ margin: "4px 0 0 0" }}>{msg.message}</p>
                          </div>
                        ))
                      )}
                    </div>
                    <form
                      onSubmit={handleSendMessage}
                      style={{ display: "flex", gap: "8px" }}
                    >
                      <input
                        type="text"
                        value={newMessage}
                        onChange={(e) => setNewMessage(e.target.value)}
                        placeholder="Add a note or update…"
                        style={{ flex: 1 }}
                        required
                      />
                      <button type="submit">Send</button>
                    </form>
                  </>
                )}
              </div>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};

export default WorkOrders;
