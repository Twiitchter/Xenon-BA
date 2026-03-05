import React, { useState, useEffect } from "react";
import {
  LocationHierarchyResponse,
  maintenanceService,
} from "../services/maintenanceService";

interface WorkRequestSource {
  id: string;
  name: string;
}

interface WorkRequestType {
  Id: string;
  Name: string;
}

const Maintenance: React.FC = () => {
  const [requests, setRequests] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [filters, setFilters] = useState({ status: "", priority: "" });
  const [formData, setFormData] = useState({
    title: "",
    description: "",
    priority: "medium",
    category: "",
    location: "",
    // Requestor information
    requestorDisplayName: "",
    requestorEmail: "",
    requestorPhone: "",
    requestorMobile: "",
    // Physical location details
    streetAddress: "",
    citySuburb: "",
    state: "",
    zipPostcode: "",
    country: "",
    // Optional fields
    supportingInformation: "",
    // Assetic fields
    workRequestSourceId: "",
    workRequestSubtypeId: "",
  });

  // Assetic integration state
  const [workRequestSources, setWorkRequestSources] = useState<
    WorkRequestSource[]
  >([]);
  const [workRequestTypes, setWorkRequestTypes] = useState<WorkRequestType[]>(
    [],
  );
  const [asseticEnabled, setAsseticEnabled] = useState(false);
  const [locationHierarchy, setLocationHierarchy] =
    useState<LocationHierarchyResponse | null>(null);

  // Messages state
  const [selectedWorkOrderId, setSelectedWorkOrderId] = useState<number | null>(
    null,
  );
  const [messages, setMessages] = useState<any[]>([]);
  const [newMessage, setNewMessage] = useState("");
  const [messagesLoading, setMessagesLoading] = useState(false);

  useEffect(() => {
    fetchRequests();
    fetchAsseticData();
  }, []);

  const fetchAsseticData = async () => {
    try {
      // Try to fetch Assetic data, but don't fail if integration is not enabled
      const [sourcesRes, typesRes, hierarchyRes] = await Promise.allSettled([
        maintenanceService.getWorkRequestSources(),
        maintenanceService.getWorkRequestTypes(),
        maintenanceService.getLocationHierarchy(),
      ]);

      if (sourcesRes.status === "fulfilled" && sourcesRes.value?.sources) {
        setWorkRequestSources(sourcesRes.value.sources);
        setAsseticEnabled(true);
      }

      if (typesRes.status === "fulfilled" && typesRes.value?.ResourceList) {
        setWorkRequestTypes(typesRes.value.ResourceList);
      }

      if (hierarchyRes.status === "fulfilled" && hierarchyRes.value?.regions) {
        setLocationHierarchy(hierarchyRes.value);
        setAsseticEnabled(true);
      }
    } catch (err) {
      // Silently fail - Assetic integration may not be enabled
      console.log("Assetic integration not available");
    }
  };

  const fetchRequests = async () => {
    setLoading(true);
    setError("");
    try {
      const data = await maintenanceService.getRequests(filters);
      setRequests(data.requests || []);
    } catch (err: any) {
      setError(
        err.response?.data?.error || "Failed to fetch maintenance requests",
      );
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    try {
      await maintenanceService.createRequest(formData);
      setShowForm(false);
      setFormData({
        title: "",
        description: "",
        priority: "medium",
        category: "",
        location: "",
        requestorDisplayName: "",
        requestorEmail: "",
        requestorPhone: "",
        requestorMobile: "",
        streetAddress: "",
        citySuburb: "",
        state: "",
        zipPostcode: "",
        country: "",
        supportingInformation: "",
        workRequestSourceId: "",
        workRequestSubtypeId: "",
      });
      fetchRequests();
    } catch (err: any) {
      setError(err.response?.data?.error || "Failed to create request");
    }
  };

  const handleFilterChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setFilters({ ...filters, [e.target.name]: e.target.value });
  };

  const openMessages = async (workOrderId: number) => {
    setSelectedWorkOrderId(workOrderId);
    setMessagesLoading(true);
    try {
      const data = await maintenanceService.getMessages(workOrderId);
      setMessages(data.messages || []);
    } catch (err: any) {
      setError(err.response?.data?.error || "Failed to fetch messages");
    } finally {
      setMessagesLoading(false);
    }
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedWorkOrderId || !newMessage.trim()) return;
    try {
      await maintenanceService.sendMessage(selectedWorkOrderId, newMessage);
      setNewMessage("");
      openMessages(selectedWorkOrderId);
    } catch (err: any) {
      setError(err.response?.data?.error || "Failed to send message");
    }
  };

  return (
    <div className="container">
      <div className="page-header">
        <h2>Work Requests</h2>
        <button onClick={() => setShowForm(!showForm)}>
          {showForm ? "Cancel" : "+ New Request"}
        </button>
      </div>

      {showForm && (
        <div className="card">
          <h3>Log a Maintenance Request</h3>
          <form onSubmit={handleCreate}>
            <div className="form-group">
              <label>Title *</label>
              <input
                type="text"
                value={formData.title}
                onChange={(e) =>
                  setFormData({ ...formData, title: e.target.value })
                }
                required
                aria-required="true"
              />
            </div>
            <div className="form-group">
              <label>Description</label>
              <textarea
                value={formData.description}
                onChange={(e) =>
                  setFormData({ ...formData, description: e.target.value })
                }
                rows={3}
              />
            </div>

            <h4
              style={{
                marginTop: "20px",
                marginBottom: "10px",
                fontSize: "16px",
              }}
            >
              Contact Information
            </h4>
            <div style={{ display: "flex", gap: "10px" }}>
              <div className="form-group" style={{ flex: 1 }}>
                <label>Contact Name *</label>
                <input
                  type="text"
                  value={formData.requestorDisplayName}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      requestorDisplayName: e.target.value,
                    })
                  }
                  placeholder="Your full name"
                  required
                  aria-required="true"
                />
              </div>
              <div className="form-group" style={{ flex: 1 }}>
                <label>Email</label>
                <input
                  type="email"
                  value={formData.requestorEmail}
                  onChange={(e) =>
                    setFormData({ ...formData, requestorEmail: e.target.value })
                  }
                  placeholder="contact@example.com"
                />
              </div>
            </div>
            <div style={{ display: "flex", gap: "10px" }}>
              <div className="form-group" style={{ flex: 1 }}>
                <label>Phone</label>
                <input
                  type="tel"
                  value={formData.requestorPhone}
                  onChange={(e) =>
                    setFormData({ ...formData, requestorPhone: e.target.value })
                  }
                  placeholder="Office phone"
                />
              </div>
              <div className="form-group" style={{ flex: 1 }}>
                <label>Mobile</label>
                <input
                  type="tel"
                  value={formData.requestorMobile}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      requestorMobile: e.target.value,
                    })
                  }
                  placeholder="Mobile phone"
                />
              </div>
            </div>

            <h4
              style={{
                marginTop: "20px",
                marginBottom: "10px",
                fontSize: "16px",
              }}
            >
              Request Details
            </h4>
            <div style={{ display: "flex", gap: "10px" }}>
              <div className="form-group" style={{ flex: 1 }}>
                <label>Priority</label>
                <select
                  value={formData.priority}
                  onChange={(e) =>
                    setFormData({ ...formData, priority: e.target.value })
                  }
                >
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                  <option value="critical">Critical</option>
                </select>
              </div>
              <div className="form-group" style={{ flex: 1 }}>
                <label>Category</label>
                <input
                  type="text"
                  value={formData.category}
                  onChange={(e) =>
                    setFormData({ ...formData, category: e.target.value })
                  }
                  placeholder="e.g. Plumbing, Electrical"
                />
              </div>
            </div>

            {asseticEnabled && workRequestSources.length > 0 && (
              <div style={{ display: "flex", gap: "10px" }}>
                <div className="form-group" style={{ flex: 1 }}>
                  <label>Request Source</label>
                  <select
                    value={formData.workRequestSourceId}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        workRequestSourceId: e.target.value,
                      })
                    }
                  >
                    <option value="">Select a source...</option>
                    {workRequestSources.map((source) => (
                      <option key={source.id} value={source.id}>
                        {source.name}
                      </option>
                    ))}
                  </select>
                </div>
                {workRequestTypes.length > 0 && (
                  <div className="form-group" style={{ flex: 1 }}>
                    <label>Request Type</label>
                    <select
                      value={formData.workRequestSubtypeId}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          workRequestSubtypeId: e.target.value,
                        })
                      }
                    >
                      <option value="">Select a type...</option>
                      {workRequestTypes.map((type: any) => (
                        <option key={type.Id} value={type.Id}>
                          {type.Name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
            )}

            <h4
              style={{
                marginTop: "20px",
                marginBottom: "10px",
                fontSize: "16px",
              }}
            >
              Location Information
            </h4>
            {locationHierarchy && (
              <div
                style={{
                  marginBottom: "10px",
                  fontSize: "12px",
                  color: "var(--text-muted)",
                }}
              >
                Loaded {locationHierarchy.regions.length} regions from Assetic (
                {locationHierarchy.source}).
              </div>
            )}
            <div className="form-group">
              <label>General Location</label>
              <input
                type="text"
                value={formData.location}
                onChange={(e) =>
                  setFormData({ ...formData, location: e.target.value })
                }
                placeholder="e.g. Building A, Room 101"
              />
            </div>
            <div style={{ display: "flex", gap: "10px" }}>
              <div className="form-group" style={{ flex: 2 }}>
                <label>Street Address</label>
                <input
                  type="text"
                  value={formData.streetAddress}
                  onChange={(e) =>
                    setFormData({ ...formData, streetAddress: e.target.value })
                  }
                  placeholder="Street address"
                />
              </div>
              <div className="form-group" style={{ flex: 1 }}>
                <label>City/Suburb</label>
                <input
                  type="text"
                  value={formData.citySuburb}
                  onChange={(e) =>
                    setFormData({ ...formData, citySuburb: e.target.value })
                  }
                  placeholder="City"
                />
              </div>
            </div>
            <div style={{ display: "flex", gap: "10px" }}>
              <div className="form-group" style={{ flex: 1 }}>
                <label>State</label>
                <input
                  type="text"
                  value={formData.state}
                  onChange={(e) =>
                    setFormData({ ...formData, state: e.target.value })
                  }
                  placeholder="State"
                />
              </div>
              <div className="form-group" style={{ flex: 1 }}>
                <label>Zip/Postcode</label>
                <input
                  type="text"
                  value={formData.zipPostcode}
                  onChange={(e) =>
                    setFormData({ ...formData, zipPostcode: e.target.value })
                  }
                  placeholder="Postcode"
                />
              </div>
              <div className="form-group" style={{ flex: 1 }}>
                <label>Country</label>
                <input
                  type="text"
                  value={formData.country}
                  onChange={(e) =>
                    setFormData({ ...formData, country: e.target.value })
                  }
                  placeholder="Country"
                />
              </div>
            </div>

            <div className="form-group">
              <label>Supporting Information</label>
              <textarea
                value={formData.supportingInformation}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    supportingInformation: e.target.value,
                  })
                }
                rows={2}
                placeholder="Any additional details that might be helpful"
              />
            </div>

            <button type="submit">Submit Request</button>
          </form>
        </div>
      )}

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
          <button onClick={fetchRequests}>Apply Filters</button>
        </div>
      </div>

      {error && <div className="error card">{error}</div>}

      <div className="card">
        {loading ? (
          <div className="loading">Loading requests...</div>
        ) : requests.length === 0 ? (
          <div
            style={{
              textAlign: "center",
              padding: "40px",
              color: "var(--text-muted)",
            }}
          >
            No work requests found. Click "+ New Request" to create one.
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>ID</th>
                <th>Title</th>
                <th>Priority</th>
                <th>Status</th>
                <th>Category</th>
                <th>Location</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {requests.map((req) => (
                <tr key={req.id}>
                  <td>{req.id}</td>
                  <td>{req.title}</td>
                  <td>{req.priority}</td>
                  <td>{req.status}</td>
                  <td>{req.category || "N/A"}</td>
                  <td>{req.location || "N/A"}</td>
                  <td>{new Date(req.created_at).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Messages panel */}
      {selectedWorkOrderId && (
        <div className="card">
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <h3>Work Order #{selectedWorkOrderId} Messages</h3>
            <button onClick={() => setSelectedWorkOrderId(null)}>Close</button>
          </div>
          {messagesLoading ? (
            <div className="loading">Loading messages...</div>
          ) : (
            <>
              <div className="messages-box">
                {messages.length === 0 ? (
                  <p style={{ color: "var(--text-muted)" }}>No messages yet.</p>
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
                  placeholder="Type a message..."
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
  );
};

export default Maintenance;
