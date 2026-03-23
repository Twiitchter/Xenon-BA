import React, { useState, useEffect, useMemo } from "react";
import { Link } from "react-router-dom";
import { maintenanceService } from "../services/maintenanceService";
import Modal from "../components/Modal";

interface MyItem {
  id: number;
  title: string;
  description: string;
  priority: string;
  status: string;
  category?: string;
  location?: string;
  assetic_work_request_id?: string | null;
  assetic_friendly_id?: string | null;
  requestor_display_name?: string | null;
  created_at: string;
  updated_at: string;
  item_type: "request" | "work_order";
  work_order_id?: number;
  work_order_status?: string;
  work_order_craft?: string;
  display_type: "request" | "work_order";
  display_status: string;
  assigned_to_username?: string;
  scheduled_date?: string;
  unread_reporter?: boolean;
}

interface Message {
  id: number;
  sender_username: string;
  created_at: string;
  message: string;
  is_staff?: boolean;
}

interface AttachmentRecord {
  id: number;
  original_filename: string;
  mime_type?: string;
  file_size?: number;
  assetic_document_id?: string | null;
  assetic_upload_status: string;
  created_at: string;
}

const STATUS_CHIPS = [
  { value: "open", label: "Open", color: "#0ea5e9" },
  { value: "pending", label: "Pending", color: "#94a3b8" },
  { value: "in_progress", label: "In Progress", color: "#f59e0b" },
  { value: "completed", label: "Completed", color: "#22c55e" },
  { value: "cancelled", label: "Cancelled", color: "#64748b" },
];

const PRIORITY_CHIPS = [
  { value: "critical", label: "Critical", color: "#ef4444" },
  { value: "high", label: "High", color: "#f59e0b" },
  { value: "medium", label: "Medium", color: "#0ea5e9" },
  { value: "low", label: "Low", color: "#94a3b8" },
];

const MyRequests: React.FC = () => {
  const [items, setItems] = useState<MyItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filters, setFilters] = useState({
    statuses: [] as string[],
    priorities: [] as string[],
    search: "",
  });

  // Detail view state
  const [selectedItem, setSelectedItem] = useState<MyItem | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState("");
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [attachments, setAttachments] = useState<AttachmentRecord[]>([]);

  useEffect(() => {
    fetchMyItems();
  }, []);

  const fetchMyItems = async () => {
    setLoading(true);
    setError("");
    try {
      const data = await maintenanceService.getMyItems({});
      setItems(data.items || []);
    } catch (err: any) {
      setError(err.response?.data?.error || "Failed to fetch your requests");
    } finally {
      setLoading(false);
    }
  };

  const filteredItems = useMemo(() => {
    let list = items;
    if (filters.search) {
      const s = filters.search.toLowerCase();
      list = list.filter(
        (i) =>
          (i.title || "").toLowerCase().includes(s) ||
          (i.description || "").toLowerCase().includes(s) ||
          (i.location || "").toLowerCase().includes(s),
      );
    }
    if (filters.statuses.length) {
      list = list.filter((i) => filters.statuses.includes(i.display_status));
    }
    if (filters.priorities.length) {
      list = list.filter((i) => filters.priorities.includes(i.priority));
    }
    return list;
  }, [items, filters.search, filters.statuses, filters.priorities]);

  const toggleStatus = (s: string) =>
    setFilters((f) => ({
      ...f,
      statuses: f.statuses.includes(s)
        ? f.statuses.filter((x) => x !== s)
        : [...f.statuses, s],
    }));

  const togglePriority = (p: string) =>
    setFilters((f) => ({
      ...f,
      priorities: f.priorities.includes(p)
        ? f.priorities.filter((x) => x !== p)
        : [...f.priorities, p],
    }));

  const hasActiveFilters = !!(
    filters.statuses.length ||
    filters.priorities.length ||
    filters.search
  );
  const activeFilterCount = [
    filters.statuses.length > 0,
    filters.priorities.length > 0,
  ].filter(Boolean).length;

  const openDetail = async (item: MyItem) => {
    setSelectedItem(item);
    setAttachments([]);
    setMessages([]);

    // Fetch attachments
    try {
      const attachData = await maintenanceService.getAttachments(item.id);
      setAttachments(attachData.attachments || []);
    } catch {
      // Non-critical
    }

    // Always load request-level messages (available even before a WO exists)
    setMessagesLoading(true);
    try {
      const data = await maintenanceService.getRequestMessages(item.id);
      setMessages(data.messages || []);
      // Mark as read for the reporter
      maintenanceService.markRequestMessagesRead(item.id).catch(() => {});
      // Optimistically clear unread flag in local list
      setItems((prev) =>
        prev.map((i) =>
          i.id === item.id ? { ...i, unread_reporter: false } : i,
        ),
      );
    } catch {
      // Non-critical
    } finally {
      setMessagesLoading(false);
    }
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedItem || !newMessage.trim()) return;

    try {
      await maintenanceService.sendRequestMessage(selectedItem.id, newMessage);
      setNewMessage("");
      const data = await maintenanceService.getRequestMessages(selectedItem.id);
      setMessages(data.messages || []);
    } catch (err: any) {
      setError(err.response?.data?.error || "Failed to send message");
    }
  };

  const getStatusBadgeClass = (status: string) => {
    switch (status) {
      case "open":
      case "pending":
        return "badge-warning";
      case "in_progress":
        return "badge-info";
      case "completed":
        return "badge-success";
      case "cancelled":
        return "badge-danger";
      default:
        return "badge-secondary";
    }
  };

  const getPriorityBadgeClass = (priority: string) => {
    switch (priority) {
      case "critical":
        return "badge-danger";
      case "high":
        return "badge-warning";
      case "medium":
        return "badge-info";
      case "low":
        return "badge-secondary";
      default:
        return "badge-secondary";
    }
  };

  return (
    <div className="container">
      {/* ── Unified header card: title + search + collapsible filters ── */}
      <div className="card filter-header-card">
        <div className="filter-topbar">
          <h2>My Requests &amp; Work Orders</h2>
          <div className="filter-topbar-controls">
            <Link
              to="/new-request"
              className="button"
              style={{ fontSize: "13px", padding: "6px 14px" }}
            >
              + New Request
            </Link>
            <input
              type="text"
              value={filters.search}
              onChange={(e) =>
                setFilters({ ...filters, search: e.target.value })
              }
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
            <button onClick={fetchMyItems}>Refresh</button>
            {hasActiveFilters && (
              <button
                className="btn-ghost"
                onClick={() =>
                  setFilters({ statuses: [], priorities: [], search: "" })
                }
              >
                Clear
              </button>
            )}
          </div>

          {filtersOpen && (
            <div className="filter-expand">
              <div className="filter-chip-row">
                <label>Status</label>
                <div className="filter-chip-group">
                  {STATUS_CHIPS.map(({ value, label, color }) => {
                    const on = filters.statuses.includes(value);
                    return (
                      <button
                        key={value}
                        className="filter-chip"
                        style={
                          on
                            ? {
                                background: color,
                                borderColor: color,
                                color: "#fff",
                              }
                            : {}
                        }
                        onClick={() => toggleStatus(value)}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="filter-chip-row" style={{ marginBottom: 0 }}>
                <label>Priority</label>
                <div className="filter-chip-group">
                  {PRIORITY_CHIPS.map(({ value, label, color }) => {
                    const on = filters.priorities.includes(value);
                    return (
                      <button
                        key={value}
                        className="filter-chip"
                        style={
                          on
                            ? {
                                background: color,
                                borderColor: color,
                                color: "#fff",
                              }
                            : {}
                        }
                        onClick={() => togglePriority(value)}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </div>
        {/* filter-topbar */}
      </div>
      {/* filter-header-card */}

      {error && <div className="error card">{error}</div>}

      <div className="card">
        {items.length > 0 && filteredItems.length !== items.length && (
          <div
            style={{
              fontSize: "12px",
              color: "var(--text-muted)",
              marginBottom: "6px",
            }}
          >
            Showing {filteredItems.length} of {items.length} requests
          </div>
        )}
        {loading ? (
          <div className="loading">Loading your requests...</div>
        ) : filteredItems.length === 0 ? (
          <div
            style={{
              textAlign: "center",
              padding: "40px",
              color: "var(--text-muted)",
            }}
          >
            {items.length === 0
              ? "You haven't submitted any requests yet."
              : "No requests match the selected filters."}
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Type</th>
                <th>ID</th>
                <th>Title</th>
                <th>Priority</th>
                <th>Status</th>
                <th>Category/Craft</th>
                <th>Location</th>
                <th>Created</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredItems.map((item) => (
                <tr key={`${item.item_type}-${item.id}`}>
                  <td>
                    <span
                      className={`badge ${item.display_type === "work_order" ? "badge-info" : "badge-secondary"}`}
                    >
                      {item.display_type === "work_order"
                        ? "Work Order"
                        : "Request"}
                    </span>
                  </td>
                  <td>
                    {item.display_type === "work_order" &&
                    item.work_order_id ? (
                      <>WO-{item.work_order_id}</>
                    ) : item.assetic_friendly_id ? (
                      <span title={`Local ID: ${item.id}`}>
                        {item.assetic_friendly_id}
                      </span>
                    ) : (
                      <>WR-{item.id}</>
                    )}
                  </td>
                  <td>
                    {item.unread_reporter && (
                      <span
                        className="unread-dot"
                        title="New update from the team"
                      />
                    )}
                    {item.title}
                    {item.description && (
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
                        title={item.description}
                      >
                        {item.description}
                      </div>
                    )}
                  </td>
                  <td>
                    <span
                      className={`badge ${getPriorityBadgeClass(item.priority)}`}
                    >
                      {item.priority}
                    </span>
                  </td>
                  <td>
                    <span
                      className={`badge ${getStatusBadgeClass(item.display_status)}`}
                    >
                      {item.display_status}
                    </span>
                  </td>
                  <td>{item.work_order_craft || item.category || "N/A"}</td>
                  <td title={item.location || undefined}>
                    {item.location ? item.location.split(" > ").pop() : "N/A"}
                  </td>
                  <td>{new Date(item.created_at).toLocaleDateString()}</td>
                  <td>
                    <button
                      className="btn-ghost"
                      onClick={() => openDetail(item)}
                    >
                      View Details
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Detail modal */}
      {selectedItem && (
        <Modal onClose={() => setSelectedItem(null)}>
          {/* Modal header */}
          <div className="modal-header">
            <div>
              <h3>
                {selectedItem.display_type === "work_order" &&
                selectedItem.work_order_id
                  ? `Work Order #${selectedItem.work_order_id}`
                  : selectedItem.assetic_friendly_id
                    ? `Work Request ${selectedItem.assetic_friendly_id}`
                    : `Work Request #${selectedItem.id}`}
                : {selectedItem.title}
              </h3>
              <div
                style={{
                  fontSize: "13px",
                  color: "var(--text-muted)",
                  marginTop: "4px",
                }}
              >
                {selectedItem.requestor_display_name
                  ? `Submitted by ${selectedItem.requestor_display_name}`
                  : "Submitted"}{" "}
                {new Date(selectedItem.created_at).toLocaleDateString()}
                {selectedItem.location && ` · ${selectedItem.location}`}
              </div>
            </div>
            <button
              className="btn-ghost"
              onClick={() => setSelectedItem(null)}
              style={{ flexShrink: 0 }}
            >
              ✕
            </button>
          </div>

          <div className="modal-body">
            {/* User-facing next-step banner */}
            <div
              className={`next-step-banner ${
                selectedItem.display_status === "completed"
                  ? "next-step-done"
                  : selectedItem.display_status === "cancelled"
                    ? "next-step-action"
                    : selectedItem.work_order_id &&
                        selectedItem.work_order_status === "in_progress"
                      ? "next-step-action"
                      : selectedItem.work_order_id
                        ? "next-step-action"
                        : "next-step-new"
              }`}
            >
              {!selectedItem.work_order_id &&
                selectedItem.display_status !== "completed" &&
                selectedItem.display_status !== "cancelled" &&
                "◎ Your request is awaiting review — we'll notify you when a work order is raised and work begins."}
              {selectedItem.work_order_id &&
                selectedItem.work_order_status === "pending" &&
                "⏳ A work order has been created for your request — our team will schedule the work shortly."}
              {selectedItem.work_order_id &&
                selectedItem.work_order_status === "in_progress" &&
                "🔧 Work is currently underway — add a comment below if you have any updates or questions."}
              {(selectedItem.display_status === "completed" ||
                selectedItem.work_order_status === "completed") &&
                "✓ This work has been completed — thank you for reporting. Contact us if anything else is needed."}
              {selectedItem.display_status === "cancelled" &&
                "This request has been cancelled."}
            </div>

            {/* Two-column: left = request info | right = communication log */}
            <div style={{ display: "flex", gap: "0", minHeight: "340px" }}>
              {/* ── LEFT COLUMN: request details ── */}
              <div
                style={{
                  flex: "0 0 44%",
                  paddingRight: "20px",
                  borderRight: "1px solid var(--border)",
                  overflowY: "auto",
                }}
              >
                <div style={{ marginBottom: "16px" }}>
                  <div
                    style={{
                      fontSize: "11px",
                      fontWeight: 700,
                      color: "var(--text-muted)",
                      textTransform: "uppercase",
                      letterSpacing: "0.6px",
                      marginBottom: "6px",
                    }}
                  >
                    Description
                  </div>
                  {selectedItem.description ? (
                    <div
                      style={{
                        fontSize: "14px",
                        color: "var(--text-secondary)",
                        lineHeight: "1.6",
                        padding: "10px 12px",
                        background: "var(--bg-secondary)",
                        borderRadius: "var(--radius)",
                        border: "1px solid var(--border)",
                        whiteSpace: "pre-wrap",
                      }}
                    >
                      {selectedItem.description}
                    </div>
                  ) : (
                    <p
                      style={{
                        fontSize: "13px",
                        color: "var(--text-muted)",
                        fontStyle: "italic",
                        margin: 0,
                      }}
                    >
                      No description provided
                    </p>
                  )}
                </div>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    gap: "12px",
                    marginBottom: "16px",
                  }}
                >
                  <div>
                    <strong>Priority:</strong>
                    <p style={{ marginTop: "4px" }}>
                      <span
                        className={`badge ${getPriorityBadgeClass(selectedItem.priority)}`}
                      >
                        {selectedItem.priority}
                      </span>
                    </p>
                  </div>
                  <div>
                    <strong>Status:</strong>
                    <p style={{ marginTop: "4px" }}>
                      <span
                        className={`badge ${getStatusBadgeClass(selectedItem.display_status)}`}
                      >
                        {selectedItem.display_status}
                      </span>
                    </p>
                  </div>
                  <div>
                    <strong>Category/Craft:</strong>
                    <p style={{ marginTop: "4px" }}>
                      {selectedItem.work_order_craft ||
                        selectedItem.category ||
                        "N/A"}
                    </p>
                  </div>
                  {selectedItem.location && (
                    <div>
                      <strong>Location:</strong>
                      <p style={{ marginTop: "4px" }}>
                        {selectedItem.location}
                      </p>
                    </div>
                  )}
                  {selectedItem.assigned_to_username && (
                    <div>
                      <strong>Assigned To:</strong>
                      <p style={{ marginTop: "4px" }}>
                        {selectedItem.assigned_to_username}
                      </p>
                    </div>
                  )}
                  {selectedItem.scheduled_date && (
                    <div>
                      <strong>Scheduled Date:</strong>
                      <p style={{ marginTop: "4px" }}>
                        {new Date(
                          selectedItem.scheduled_date,
                        ).toLocaleDateString()}
                      </p>
                    </div>
                  )}
                  <div>
                    <strong>Created:</strong>
                    <p style={{ marginTop: "4px" }}>
                      {new Date(selectedItem.created_at).toLocaleString()}
                    </p>
                  </div>
                </div>

                {/* Attachments */}
                {attachments.length > 0 && (
                  <div
                    style={{
                      borderTop: "1px solid var(--border)",
                      paddingTop: "12px",
                    }}
                  >
                    <h4 style={{ marginBottom: "10px" }}>Attachments</h4>
                    <div
                      style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}
                    >
                      {attachments.map((att) => (
                        <div
                          key={att.id}
                          style={{
                            border: "1px solid var(--border)",
                            borderRadius: "6px",
                            padding: "8px 10px",
                            background: "var(--surface)",
                            minWidth: "120px",
                            maxWidth: "160px",
                          }}
                        >
                          <div
                            style={{
                              fontSize: "18px",
                              marginBottom: "4px",
                              textAlign: "center",
                            }}
                          >
                            {att.mime_type?.startsWith("image/") ? "🖼️" : "📄"}
                          </div>
                          <div
                            style={{
                              fontSize: "11px",
                              fontWeight: 500,
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                            title={att.original_filename}
                          >
                            {att.original_filename}
                          </div>
                          <div
                            style={{
                              fontSize: "10px",
                              color: "var(--text-muted)",
                              marginTop: "2px",
                            }}
                          >
                            {att.file_size != null
                              ? att.file_size > 1048576
                                ? `${(att.file_size / 1048576).toFixed(1)} MB`
                                : `${Math.ceil(att.file_size / 1024)} KB`
                              : att.mime_type || ""}
                          </div>
                          <div
                            style={{
                              fontSize: "10px",
                              marginTop: "3px",
                              color:
                                att.assetic_upload_status === "uploaded"
                                  ? "var(--success, #16a34a)"
                                  : att.assetic_upload_status === "failed"
                                    ? "var(--danger, #dc2626)"
                                    : "var(--text-muted)",
                            }}
                          >
                            {att.assetic_upload_status === "uploaded"
                              ? "✓ Synced"
                              : att.assetic_upload_status === "failed"
                                ? "⚠ Sync failed"
                                : "⏳ Pending"}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
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
                  Updates &amp; Communication
                </div>
                {messagesLoading ? (
                  <div className="loading">Loading messages...</div>
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
                            fontStyle: "italic",
                            fontSize: "13px",
                          }}
                        >
                          No messages yet. Leave a note below and the team will
                          respond here.
                        </p>
                      ) : (
                        messages.map((msg) => (
                          <div
                            key={msg.id}
                            className={`message-bubble${msg.is_staff ? " message-bubble-staff" : " message-bubble-reporter"}`}
                          >
                            <div className="message-bubble-header">
                              <strong>
                                {msg.is_staff
                                  ? msg.sender_username || "Support Team"
                                  : "You"}
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
                        placeholder="Leave a note or question for the team..."
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

export default MyRequests;
