import React, { useCallback, useEffect, useState } from "react";
import { adminService } from "../services/adminService";

interface FailedRequest {
  id: number;
  requested_by: number | null;
  title: string;
  description: string | null;
  priority: string | null;
  category: string | null;
  location: string | null;
  assetic_asset_guid: string | null;
  work_request_source_id: string | null;
  requestor_display_name: string | null;
  requestor_first_name: string | null;
  requestor_surname: string | null;
  requestor_email: string | null;
  requestor_phone: string | null;
  requestor_mobile: string | null;
  supporting_information: string | null;
  external_identifier: string | null;
  assetic_payload: string | null;
  error_message: string | null;
  admin_notes: string | null;
  retry_count: number;
  last_retry_at: string | null;
  status: "pending" | "resolved" | "dismissed";
  resolved_request_id: number | null;
  submitter_name: string | null;
  submitter_email: string | null;
  created_at: string;
  updated_at: string;
}

const statusBadge = (status: string) => {
  const map: Record<string, string> = {
    pending: "var(--warning, #f59e0b)",
    resolved: "var(--success, #22c55e)",
    dismissed: "var(--text-secondary, #6b7280)",
  };
  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 8px",
        borderRadius: 12,
        fontSize: 12,
        fontWeight: 600,
        background: map[status] ?? "#6b7280",
        color: "#fff",
        textTransform: "capitalize",
      }}
    >
      {status}
    </span>
  );
};

const FailedRequests: React.FC = () => {
  const [records, setRecords] = useState<FailedRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("pending");

  // Currently expanded / editing record
  const [editing, setEditing] = useState<FailedRequest | null>(null);
  const [editDraft, setEditDraft] = useState<Partial<FailedRequest>>({});
  const [saving, setSaving] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [dismissing, setDismissing] = useState(false);

  const fetchRecords = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params: { status?: string } = {};
      if (statusFilter !== "all") params.status = statusFilter;
      const data = await adminService.getFailedRequests(params);
      setRecords(data.failed_requests || []);
    } catch (err: any) {
      setError(err?.response?.data?.error || "Failed to load records");
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    void fetchRecords();
  }, [fetchRecords]);

  const openEdit = (record: FailedRequest) => {
    setEditing(record);
    setEditDraft({
      title: record.title,
      description: record.description ?? "",
      priority: record.priority ?? "medium",
      category: record.category ?? "",
      location: record.location ?? "",
      assetic_asset_guid: record.assetic_asset_guid ?? "",
      work_request_source_id: record.work_request_source_id ?? "",
      requestor_display_name: record.requestor_display_name ?? "",
      requestor_first_name: record.requestor_first_name ?? "",
      requestor_surname: record.requestor_surname ?? "",
      requestor_email: record.requestor_email ?? "",
      requestor_phone: record.requestor_phone ?? "",
      requestor_mobile: record.requestor_mobile ?? "",
      supporting_information: record.supporting_information ?? "",
      external_identifier: record.external_identifier ?? "",
      assetic_payload: record.assetic_payload ?? "",
      admin_notes: record.admin_notes ?? "",
    });
    setSuccess("");
    setError("");
  };

  const closeEdit = () => {
    setEditing(null);
    setEditDraft({});
  };

  const handleSave = async () => {
    if (!editing) return;
    setSaving(true);
    setError("");
    try {
      const updated = await adminService.updateFailedRequest(
        editing.id,
        editDraft,
      );
      setRecords((prev) =>
        prev.map((r) => (r.id === editing.id ? updated.failed_request : r)),
      );
      setEditing(updated.failed_request);
      setSuccess("Changes saved.");
      setTimeout(() => setSuccess(""), 3000);
    } catch (err: any) {
      setError(err?.response?.data?.error || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const handleRetry = async () => {
    if (!editing) return;
    if (
      !confirm(
        "Retry sending this work request to Assetic now?\n\nMake sure any edits have been saved first.",
      )
    ) {
      return;
    }
    setRetrying(true);
    setError("");
    try {
      const result = await adminService.retryFailedRequest(editing.id);
      setSuccess(
        `Retry succeeded! Maintenance request #${result.maintenance_request_id} created.`,
      );
      setTimeout(() => setSuccess(""), 6000);
      // Refresh list and close editor
      await fetchRecords();
      closeEdit();
    } catch (err: any) {
      const msg =
        err?.response?.data?.error ||
        "Retry failed — Assetic rejected the request.";
      setError(msg);
      // Refresh to see updated retry_count / error_message
      await fetchRecords();
    } finally {
      setRetrying(false);
    }
  };

  const handleDismiss = async (id: number) => {
    if (
      !confirm(
        "Permanently delete this failed request record? This cannot be undone.",
      )
    )
      return;
    setDismissing(true);
    setError("");
    try {
      await adminService.deleteFailedRequest(id);
      setRecords((prev) => prev.filter((r) => r.id !== id));
      if (editing?.id === id) closeEdit();
      setSuccess("Record dismissed and deleted.");
      setTimeout(() => setSuccess(""), 3000);
    } catch (err: any) {
      setError(err?.response?.data?.error || "Delete failed");
    } finally {
      setDismissing(false);
    }
  };

  const field = (
    label: string,
    key: keyof FailedRequest,
    multiline = false,
  ) => (
    <div style={{ marginBottom: 12 }}>
      <label
        style={{
          display: "block",
          fontSize: 12,
          fontWeight: 600,
          marginBottom: 4,
          color: "var(--text-secondary)",
          textTransform: "uppercase",
          letterSpacing: "0.05em",
        }}
      >
        {label}
      </label>
      {multiline ? (
        <textarea
          value={(editDraft[key] as string) ?? ""}
          onChange={(e) =>
            setEditDraft((d) => ({ ...d, [key]: e.target.value }))
          }
          rows={key === "assetic_payload" ? 8 : 3}
          style={{
            width: "100%",
            fontFamily: key === "assetic_payload" ? "monospace" : undefined,
            fontSize: key === "assetic_payload" ? 12 : undefined,
          }}
        />
      ) : (
        <input
          type="text"
          value={(editDraft[key] as string) ?? ""}
          onChange={(e) =>
            setEditDraft((d) => ({ ...d, [key]: e.target.value }))
          }
          style={{ width: "100%" }}
        />
      )}
    </div>
  );

  return (
    <div className="container">
      <div className="page-header">
        <h2>Failed Work Requests</h2>
        <p style={{ color: "var(--text-secondary)" }}>
          Work requests that failed to submit to Assetic. Edit and retry, or
          dismiss.
        </p>
      </div>

      {error && (
        <div className="error card" style={{ marginBottom: 16 }}>
          {error}
        </div>
      )}
      {success && (
        <div className="success card" style={{ marginBottom: 16 }}>
          {success}
        </div>
      )}

      {/* Filter toolbar */}
      <div
        className="card"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          marginBottom: 16,
          padding: "12px 16px",
        }}
      >
        <label style={{ fontWeight: 600, fontSize: 14 }}>Status:</label>
        {["all", "pending", "resolved", "dismissed"].map((s) => (
          <button
            key={s}
            className={
              statusFilter === s ? "btn btn-primary" : "btn btn-secondary"
            }
            style={{ padding: "4px 14px", fontSize: 13 }}
            onClick={() => setStatusFilter(s)}
          >
            {s.charAt(0).toUpperCase() + s.slice(1)}
          </button>
        ))}
        <button
          className="btn btn-secondary"
          style={{ marginLeft: "auto", padding: "4px 14px", fontSize: 13 }}
          onClick={() => void fetchRecords()}
        >
          Refresh
        </button>
      </div>

      {/* Table */}
      {loading ? (
        <div
          className="card"
          style={{
            padding: 32,
            textAlign: "center",
            color: "var(--text-secondary)",
          }}
        >
          Loading…
        </div>
      ) : records.length === 0 ? (
        <div
          className="card"
          style={{
            padding: 32,
            textAlign: "center",
            color: "var(--text-secondary)",
          }}
        >
          No{statusFilter !== "all" ? ` ${statusFilter}` : ""} failed work
          requests.
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <table
            style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}
          >
            <thead>
              <tr
                style={{
                  background: "var(--bg-secondary, #f9fafb)",
                  borderBottom: "1px solid var(--border)",
                }}
              >
                {[
                  "Title",
                  "Requestor",
                  "Location",
                  "Error",
                  "Retries",
                  "Status",
                  "Date",
                  "",
                ].map((h) => (
                  <th
                    key={h}
                    style={{
                      padding: "10px 14px",
                      textAlign: "left",
                      fontWeight: 600,
                      whiteSpace: "nowrap",
                      fontSize: 12,
                      textTransform: "uppercase",
                      letterSpacing: "0.05em",
                      color: "var(--text-secondary)",
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {records.map((r, i) => (
                <tr
                  key={r.id}
                  style={{
                    borderBottom: "1px solid var(--border)",
                    background:
                      i % 2 === 0
                        ? "transparent"
                        : "var(--bg-secondary, #f9fafb)",
                  }}
                >
                  <td style={{ padding: "10px 14px", maxWidth: 200 }}>
                    <div style={{ fontWeight: 500 }}>{r.title}</div>
                    {r.category && (
                      <div
                        style={{ fontSize: 12, color: "var(--text-secondary)" }}
                      >
                        {r.category}
                      </div>
                    )}
                  </td>
                  <td style={{ padding: "10px 14px", maxWidth: 180 }}>
                    <div>
                      {r.requestor_display_name ||
                        [r.requestor_first_name, r.requestor_surname]
                          .filter(Boolean)
                          .join(" ") ||
                        r.submitter_name ||
                        "—"}
                    </div>
                    {r.requestor_email && (
                      <div
                        style={{ fontSize: 12, color: "var(--text-secondary)" }}
                      >
                        {r.requestor_email}
                      </div>
                    )}
                  </td>
                  <td
                    style={{
                      padding: "10px 14px",
                      maxWidth: 160,
                      fontSize: 13,
                      color: "var(--text-secondary)",
                    }}
                  >
                    {r.location || "—"}
                  </td>
                  <td
                    style={{
                      padding: "10px 14px",
                      maxWidth: 260,
                      fontSize: 12,
                      color: "var(--error, #ef4444)",
                    }}
                  >
                    <div
                      style={{
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        maxWidth: 260,
                      }}
                      title={r.error_message ?? ""}
                    >
                      {r.error_message || "Unknown error"}
                    </div>
                  </td>
                  <td style={{ padding: "10px 14px", textAlign: "center" }}>
                    {r.retry_count}
                  </td>
                  <td style={{ padding: "10px 14px" }}>
                    {statusBadge(r.status)}
                  </td>
                  <td
                    style={{
                      padding: "10px 14px",
                      fontSize: 12,
                      color: "var(--text-secondary)",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {new Date(r.created_at).toLocaleDateString()}
                  </td>
                  <td style={{ padding: "10px 14px", whiteSpace: "nowrap" }}>
                    <button
                      className="btn btn-secondary"
                      style={{
                        padding: "3px 10px",
                        fontSize: 12,
                        marginRight: 6,
                      }}
                      onClick={() => openEdit(r)}
                    >
                      Edit / Retry
                    </button>
                    <button
                      className="btn btn-danger"
                      style={{ padding: "3px 10px", fontSize: 12 }}
                      disabled={dismissing}
                      onClick={() => void handleDismiss(r.id)}
                    >
                      Dismiss
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Edit drawer / modal */}
      {editing && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.4)",
            zIndex: 1000,
            display: "flex",
            justifyContent: "flex-end",
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) closeEdit();
          }}
        >
          <div
            style={{
              width: "min(680px, 100vw)",
              height: "100%",
              background: "var(--bg-primary, #fff)",
              overflowY: "auto",
              padding: 28,
              boxShadow: "-4px 0 24px rgba(0,0,0,0.15)",
              display: "flex",
              flexDirection: "column",
              gap: 0,
            }}
          >
            {/* Header */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: 20,
              }}
            >
              <div>
                <h3 style={{ margin: 0 }}>Edit Failed Request #{editing.id}</h3>
                <div
                  style={{
                    fontSize: 13,
                    color: "var(--text-secondary)",
                    marginTop: 4,
                  }}
                >
                  Failed {new Date(editing.created_at).toLocaleString()}{" "}
                  &nbsp;·&nbsp;
                  {editing.retry_count} retr
                  {editing.retry_count === 1 ? "y" : "ies"}
                  &nbsp;·&nbsp; {statusBadge(editing.status)}
                </div>
              </div>
              <button className="btn btn-secondary" onClick={closeEdit}>
                ✕ Close
              </button>
            </div>

            {/* Error message from last attempt */}
            {editing.error_message && (
              <div
                className="error card"
                style={{ marginBottom: 16, fontSize: 13 }}
              >
                <strong>Last error:</strong> {editing.error_message}
              </div>
            )}

            {/* Fields */}
            <div style={{ flex: 1 }}>
              <h4
                style={{
                  marginTop: 0,
                  marginBottom: 12,
                  color: "var(--text-secondary)",
                  fontSize: 13,
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                }}
              >
                Work Request Details
              </h4>
              {field("Title", "title")}
              {field("Description", "description", true)}
              {field("Location", "location")}
              {field("Category", "category")}
              {field("Priority", "priority")}
              {field("External Identifier", "external_identifier")}
              {field("Supporting Information", "supporting_information", true)}

              <h4
                style={{
                  marginTop: 20,
                  marginBottom: 12,
                  color: "var(--text-secondary)",
                  fontSize: 13,
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                }}
              >
                Requestor
              </h4>
              {field("Display Name", "requestor_display_name")}
              {field("First Name", "requestor_first_name")}
              {field("Surname", "requestor_surname")}
              {field("Email", "requestor_email")}
              {field("Phone", "requestor_phone")}
              {field("Mobile", "requestor_mobile")}

              <h4
                style={{
                  marginTop: 20,
                  marginBottom: 12,
                  color: "var(--text-secondary)",
                  fontSize: 13,
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                }}
              >
                Assetic
              </h4>
              {field("Asset GUID", "assetic_asset_guid")}
              {field("Work Request Source ID", "work_request_source_id")}
              {field("Assetic Payload (JSON)", "assetic_payload", true)}

              <h4
                style={{
                  marginTop: 20,
                  marginBottom: 12,
                  color: "var(--text-secondary)",
                  fontSize: 13,
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                }}
              >
                Admin Notes
              </h4>
              {field("Notes", "admin_notes", true)}
            </div>

            {/* Action bar */}
            <div
              style={{
                display: "flex",
                gap: 10,
                paddingTop: 20,
                borderTop: "1px solid var(--border)",
                marginTop: 8,
              }}
            >
              <button
                className="btn btn-primary"
                disabled={saving}
                onClick={() => void handleSave()}
              >
                {saving ? "Saving…" : "Save Changes"}
              </button>
              {editing.status !== "resolved" && (
                <button
                  className="btn btn-success"
                  disabled={retrying || saving}
                  onClick={() => void handleRetry()}
                  style={{
                    background: "var(--success, #22c55e)",
                    color: "#fff",
                    border: "none",
                  }}
                >
                  {retrying ? "Retrying…" : "Retry → Assetic"}
                </button>
              )}
              <button
                className="btn btn-danger"
                disabled={dismissing || saving}
                style={{ marginLeft: "auto" }}
                onClick={() => void handleDismiss(editing.id)}
              >
                Dismiss &amp; Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default FailedRequests;
