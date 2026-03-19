import React, { useState, useEffect } from "react";
import { maintenanceService } from "../services/maintenanceService";
import Modal from "../components/Modal";

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

const WorkOrders: React.FC = () => {
  const [workOrders, setWorkOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [filters, setFilters] = useState({ status: "", craft: "" });
  const [crafts, setCrafts] = useState<string[]>([]);

  // Selected WO for modal
  const [selectedOrder, setSelectedOrder] = useState<any | null>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [newMessage, setNewMessage] = useState("");
  const [messagesLoading, setMessagesLoading] = useState(false);

  // Edit state (inside modal)
  const [editCraft, setEditCraft] = useState("");
  const [editStatus, setEditStatus] = useState("");
  const [editScheduled, setEditScheduled] = useState("");
  const [updating, setUpdating] = useState(false);

  useEffect(() => {
    fetchWorkOrders();
    fetchCrafts();
  }, []);

  const fetchWorkOrders = async () => {
    setLoading(true);
    setError("");
    try {
      const data = await maintenanceService.getWorkOrders(filters);
      setWorkOrders(data.workOrders || []);
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

  const handleFilterChange = (
    e: React.ChangeEvent<HTMLSelectElement | HTMLInputElement>,
  ) => {
    setFilters({ ...filters, [e.target.name]: e.target.value });
  };

  const openDetail = async (wo: any) => {
    setSelectedOrder(wo);
    setEditCraft(wo.craft || "");
    setEditStatus(wo.status || "pending");
    setEditScheduled(wo.scheduled_date ? wo.scheduled_date.split("T")[0] : "");
    setMessages([]);
    setMessagesLoading(true);
    try {
      const data = await maintenanceService.getMessages(wo.id);
      setMessages(data.messages || []);
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
        status: editStatus || undefined,
        scheduledDate: editScheduled || undefined,
      });
      const data = await maintenanceService.getWorkOrders(filters);
      setWorkOrders(data.workOrders || []);
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

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedOrder || !newMessage.trim()) return;
    try {
      await maintenanceService.sendMessage(selectedOrder.id, newMessage);
      setNewMessage("");
      const data = await maintenanceService.getMessages(selectedOrder.id);
      setMessages(data.messages || []);
    } catch (err: any) {
      setError(err.response?.data?.error || "Failed to send message");
    }
  };

  return (
    <div className="container" style={{ maxWidth: "1300px" }}>
      {/* ── Header ── */}
      <div className="page-header">
        <h2>Work Orders</h2>
        <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
          <select
            name="status"
            value={filters.status}
            onChange={handleFilterChange}
            style={{ width: "140px" }}
          >
            <option value="">All Statuses</option>
            <option value="pending">Pending</option>
            <option value="in_progress">In Progress</option>
            <option value="completed">Completed</option>
            <option value="cancelled">Cancelled</option>
          </select>
          <input
            type="text"
            name="craft"
            value={filters.craft}
            onChange={handleFilterChange}
            placeholder="Filter by craft"
            style={{ width: "140px" }}
          />
          <button onClick={fetchWorkOrders}>Refresh</button>
        </div>
      </div>

      {error && <div className="error card">{error}</div>}

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
                <th style={{ width: "40px" }}>#</th>
                <th>Title</th>
                <th style={{ width: "90px" }}>Priority</th>
                <th style={{ width: "120px" }}>Status</th>
                <th>Craft / Trade</th>
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
                  <td style={{ color: "var(--text-muted)", fontSize: "13px" }}>
                    {wo.id}
                  </td>
                  <td style={{ fontWeight: 500 }}>{wo.title}</td>
                  <td>
                    <span
                      className={`badge ${priorityBadgeClass(wo.priority)}`}
                    >
                      {wo.priority || "—"}
                    </span>
                  </td>
                  <td>
                    <span className={`badge ${statusBadgeClass(wo.status)}`}>
                      {toLabel(wo.status || "pending")}
                    </span>
                  </td>
                  <td
                    style={{ color: "var(--text-secondary)", fontSize: "13px" }}
                  >
                    {wo.craft || (
                      <span style={{ color: "var(--text-muted)" }}>
                        Unassigned
                      </span>
                    )}
                  </td>
                  <td
                    style={{ color: "var(--text-secondary)", fontSize: "13px" }}
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

      {/* Datalist for craft suggestions */}
      <datalist id="craft-options">
        {crafts.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>

      {/* ── Work Order Modal ── */}
      {selectedOrder && (
        <Modal onClose={() => setSelectedOrder(null)}>
          {/* Header */}
          <div className="modal-header">
            <div>
              <h3>
                WO #{selectedOrder.id}: {selectedOrder.title}
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
                {selectedOrder.description && (
                  <span style={{ marginLeft: "12px" }}>
                    {selectedOrder.description}
                  </span>
                )}
              </div>
            </div>
            <button
              className="btn-ghost"
              onClick={() => setSelectedOrder(null)}
              style={{ flexShrink: 0 }}
            >
              ✕
            </button>
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

            {/* Two-column: details + edit */}
            <div
              style={{
                display: "flex",
                gap: "24px",
                flexWrap: "wrap",
                marginBottom: "24px",
              }}
            >
              {/* Left — summary */}
              <div style={{ flex: "1 1 220px" }}>
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
                    <span style={{ color: "var(--text-muted)" }}>Craft: </span>
                    <span>{selectedOrder.craft}</span>
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
                  <span style={{ color: "var(--text-muted)" }}>Created: </span>
                  <span>
                    {new Date(selectedOrder.created_at).toLocaleDateString()}
                  </span>
                </div>
              </div>

              {/* Right — edit */}
              <div style={{ flex: "1 1 280px" }}>
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
                  style={{ display: "flex", gap: "10px", marginBottom: "10px" }}
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
                <button
                  onClick={handleUpdateOrder}
                  disabled={updating}
                  style={{ width: "100%" }}
                >
                  {updating ? "Saving…" : "Save Changes"}
                </button>
              </div>
            </div>

            {/* Messages */}
            <div
              style={{
                borderTop: "1px solid var(--border)",
                paddingTop: "16px",
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
                Messages
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
        </Modal>
      )}
    </div>
  );
};

export default WorkOrders;
