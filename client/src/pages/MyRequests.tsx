import React, { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
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
}

interface Message {
  id: number;
  sender_username: string;
  created_at: string;
  message: string;
}

const MyRequests: React.FC = () => {
  const navigate = useNavigate();
  const [items, setItems] = useState<MyItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [filters, setFilters] = useState({ status: "", priority: "" });

  // Detail view state
  const [selectedItem, setSelectedItem] = useState<MyItem | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState("");
  const [messagesLoading, setMessagesLoading] = useState(false);

  useEffect(() => {
    fetchMyItems();
  }, []);

  const fetchMyItems = async () => {
    setLoading(true);
    setError("");
    try {
      const data = await maintenanceService.getMyItems(filters);
      setItems(data.items || []);
    } catch (err: any) {
      setError(err.response?.data?.error || "Failed to fetch your requests");
    } finally {
      setLoading(false);
    }
  };

  const handleFilterChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setFilters({ ...filters, [e.target.name]: e.target.value });
  };

  const openDetail = async (item: MyItem) => {
    setSelectedItem(item);

    // Fetch messages if there's a work order
    const workOrderId =
      item.work_order_id || (item.item_type === "work_order" ? item.id : null);
    if (workOrderId) {
      setMessagesLoading(true);
      try {
        const data = await maintenanceService.getMessages(workOrderId);
        setMessages(data.messages || []);
      } catch (err: any) {
        setError(err.response?.data?.error || "Failed to fetch messages");
      } finally {
        setMessagesLoading(false);
      }
    } else {
      setMessages([]);
    }
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedItem || !newMessage.trim()) return;

    const workOrderId =
      selectedItem.work_order_id ||
      (selectedItem.item_type === "work_order" ? selectedItem.id : null);
    if (!workOrderId) {
      setError(
        "Cannot send message - no work order associated with this request yet",
      );
      return;
    }

    try {
      await maintenanceService.sendMessage(workOrderId, newMessage);
      setNewMessage("");
      const data = await maintenanceService.getMessages(workOrderId);
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
      <div className="page-header">
        <h2>My Requests & Work Orders</h2>
        <Link to="/new-request" className="button">
          + New Request
        </Link>
      </div>

      <div className="card">
        <h3>Filters</h3>
        <div style={{ display: "flex", gap: "10px", alignItems: "flex-end" }}>
          <div className="form-group" style={{ flex: 1 }}>
            <label>Status</label>
            <select
              name="status"
              value={filters.status}
              onChange={handleFilterChange}
            >
              <option value="">All</option>
              <option value="open">Open</option>
              <option value="pending">Pending</option>
              <option value="in_progress">In Progress</option>
              <option value="completed">Completed</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </div>
          <div className="form-group" style={{ flex: 1 }}>
            <label>Priority</label>
            <select
              name="priority"
              value={filters.priority}
              onChange={handleFilterChange}
            >
              <option value="">All</option>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="critical">Critical</option>
            </select>
          </div>
          <button onClick={fetchMyItems}>Apply Filters</button>
        </div>
      </div>

      {error && <div className="error card">{error}</div>}

      <div className="card">
        {loading ? (
          <div className="loading">Loading your requests...</div>
        ) : items.length === 0 ? (
          <div
            style={{
              textAlign: "center",
              padding: "40px",
              color: "var(--text-muted)",
            }}
          >
            You haven't submitted any requests yet.
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
              {items.map((item) => (
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
                    ) : (
                      <>WR-{item.id}</>
                    )}
                  </td>
                  <td>{item.title}</td>
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
                Submitted{" "}
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
                "◎ Your request is awaiting review — we’ll notify you when a work order is raised and work begins."}
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

            <div style={{ marginBottom: "20px" }}>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: "16px",
                }}
              >
                <div>
                  <strong>Description:</strong>
                  <p style={{ marginTop: "4px" }}>
                    {selectedItem.description || "No description provided"}
                  </p>
                </div>
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
                    <p style={{ marginTop: "4px" }}>{selectedItem.location}</p>
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
            </div>

            {/* Messages section */}
            <div
              style={{
                borderTop: "1px solid var(--border)",
                paddingTop: "20px",
              }}
            >
              <h4>Updates & Comments</h4>
              {selectedItem.work_order_id ||
              selectedItem.item_type === "work_order" ? (
                <>
                  {messagesLoading ? (
                    <div className="loading">Loading messages...</div>
                  ) : (
                    <>
                      <div
                        className="messages-box"
                        style={{ marginBottom: "16px" }}
                      >
                        {messages.length === 0 ? (
                          <p style={{ color: "var(--text-muted)" }}>
                            No updates yet.
                          </p>
                        ) : (
                          messages.map((msg) => (
                            <div key={msg.id} className="message-bubble">
                              <strong>{msg.sender_username || "System"}</strong>
                              <span className="message-meta">
                                {new Date(msg.created_at).toLocaleString()}
                              </span>
                              <p style={{ margin: "4px 0 0 0" }}>
                                {msg.message}
                              </p>
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
                          placeholder="Add a comment or update..."
                          style={{ flex: 1 }}
                          required
                        />
                        <button type="submit">Send</button>
                      </form>
                    </>
                  )}
                </>
              ) : (
                <p style={{ color: "var(--text-muted)", fontStyle: "italic" }}>
                  Comments will be available once a work order is created for
                  this request.
                </p>
              )}
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};

export default MyRequests;
