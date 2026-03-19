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

const Maintenance: React.FC = () => {
  const [requests, setRequests] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [filters, setFilters] = useState({ status: "", priority: "" });

  // Selected request for detail panel
  const [selected, setSelected] = useState<any | null>(null);

  // Triage edit state
  const [editStatus, setEditStatus] = useState("");
  const [editPriority, setEditPriority] = useState("");
  const [editCategory, setEditCategory] = useState("");
  const [updating, setUpdating] = useState(false);

  // Work order creation state
  const [woCraft, setWoCraft] = useState("");
  const [woScheduled, setWoScheduled] = useState("");
  const [creatingWo, setCreatingWo] = useState(false);

  // Messages
  const [messages, setMessages] = useState<any[]>([]);
  const [newMessage, setNewMessage] = useState("");
  const [messagesLoading, setMessagesLoading] = useState(false);

  useEffect(() => {
    fetchRequests();
  }, []);

  const fetchRequests = async (activeFilters = filters) => {
    setLoading(true);
    setError("");
    try {
      const data = await maintenanceService.getRequests(
        activeFilters.status || activeFilters.priority ? activeFilters : {},
      );
      setRequests(data.requests || []);
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
    setWoScheduled("");
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
    const data = await maintenanceService.getRequests(
      filters.status || filters.priority ? filters : {},
    );
    setRequests(data.requests || []);
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
        craft: woCraft || undefined,
        scheduledDate: woScheduled || undefined,
      });
      const updated = await refreshAndReselect(selected.id);
      if (updated?.work_order_id) {
        const msgs = await maintenanceService.getMessages(
          updated.work_order_id,
        );
        setMessages(msgs.messages || []);
      }
      setWoCraft("");
      setWoScheduled("");
    } catch (err: any) {
      setError(err.response?.data?.error || "Failed to create work order");
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

  return (
    <div className="container" style={{ maxWidth: "1300px" }}>
      {/* ── Header ── */}
      <div className="page-header">
        <h2>Requests</h2>
        <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
          <select
            value={filters.status}
            onChange={(e) => setFilters({ ...filters, status: e.target.value })}
            style={{ width: "140px" }}
          >
            <option value="">All Statuses</option>
            <option value="open">Open</option>
            <option value="in_progress">In Progress</option>
            <option value="completed">Completed</option>
            <option value="cancelled">Cancelled</option>
          </select>
          <select
            value={filters.priority}
            onChange={(e) =>
              setFilters({ ...filters, priority: e.target.value })
            }
            style={{ width: "140px" }}
          >
            <option value="">All Priorities</option>
            <option value="critical">Critical</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
          <button onClick={() => fetchRequests(filters)}>Refresh</button>
        </div>
      </div>

      {error && <div className="error card">{error}</div>}

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
                <th style={{ width: "40px" }}>#</th>
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
                  <td style={{ color: "var(--text-muted)", fontSize: "13px" }}>
                    {req.id}
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
                    <span className={`badge ${statusBadgeClass(req.status)}`}>
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
                        WO #{req.work_order_id}
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

      {/* ── Detail Modal ── */}
      {selected && (
        <Modal onClose={() => setSelected(null)}>
          {/* Modal header */}
          <div className="modal-header">
            <div>
              <h3>{selected.title}</h3>
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
            <button
              className="btn-ghost"
              onClick={() => setSelected(null)}
              style={{ flexShrink: 0 }}
            >
              ✕
            </button>
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
                          WO #{selected.work_order_id}
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
                            Craft / Trade
                          </label>
                          <input
                            type="text"
                            value={woCraft}
                            onChange={(e) => setWoCraft(e.target.value)}
                            placeholder="e.g. Plumbing, HVAC"
                          />
                        </div>
                        <div
                          className="form-group"
                          style={{ flex: 1, marginBottom: 0 }}
                        >
                          <label style={{ fontSize: "12px" }}>
                            Scheduled Date
                          </label>
                          <input
                            type="date"
                            value={woScheduled}
                            onChange={(e) => setWoScheduled(e.target.value)}
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
