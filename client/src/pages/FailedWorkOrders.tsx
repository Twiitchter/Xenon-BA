import React, { useCallback, useEffect, useState } from "react";
import { adminService } from "../services/adminService";

interface FailedWorkOrder {
  id: number;
  work_order_id: number | null;
  assetic_work_order_guid: string | null;
  from_status: string | null;
  to_status: string | null;
  assetic_payload: string | null;
  error_message: string | null;
  assetic_error_response: string | null;
  assetic_http_status: number | null;
  admin_notes: string | null;
  retry_count: number;
  last_retry_at: string | null;
  status: "pending" | "resolved" | "dismissed";
  work_order_title?: string | null;
  work_order_location?: string | null;
  work_order_work_group?: string | null;
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

const FailedWorkOrders: React.FC = () => {
  const [records, setRecords] = useState<FailedWorkOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("pending");

  const [editing, setEditing] = useState<FailedWorkOrder | null>(null);
  const [editDraft, setEditDraft] = useState<{
    assetic_payload: string;
    admin_notes: string;
    status: FailedWorkOrder["status"];
  } | null>(null);
  const [saving, setSaving] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [dismissing, setDismissing] = useState(false);

  const fetchRecords = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params: { status?: string } = {};
      if (statusFilter !== "all") params.status = statusFilter;
      const data = await adminService.getFailedWorkOrders(params);
      setRecords(data.failed_work_orders || []);
    } catch (err: any) {
      setError(err?.response?.data?.error || "Failed to load records");
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    void fetchRecords();
  }, [fetchRecords]);

  const openEdit = (record: FailedWorkOrder) => {
    setEditing(record);
    setEditDraft({
      assetic_payload: record.assetic_payload ?? "",
      admin_notes: record.admin_notes ?? "",
      status: record.status,
    });
    setSuccess("");
    setError("");
  };

  const closeEdit = () => {
    setEditing(null);
    setEditDraft(null);
  };

  const handleSave = async () => {
    if (!editing || !editDraft) return;
    setSaving(true);
    setError("");
    try {
      const updated = await adminService.updateFailedWorkOrder(editing.id, {
        assetic_payload: editDraft.assetic_payload,
        admin_notes: editDraft.admin_notes,
        status: editDraft.status,
      });
      setRecords((prev) =>
        prev.map((r) =>
          r.id === editing.id
            ? ({ ...r, ...updated.failed_work_order } as FailedWorkOrder)
            : r,
        ),
      );
      setEditing((prev) =>
        prev ? ({ ...prev, ...updated.failed_work_order } as FailedWorkOrder) : prev,
      );
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
        "Retry sending this work-order status change to Assetic now?\n\nMake sure any payload edits are saved first.",
      )
    ) {
      return;
    }

    setRetrying(true);
    setError("");
    try {
      const result = await adminService.retryFailedWorkOrder(editing.id);
      setSuccess(
        `Retry succeeded! Work order ${result.assetic_work_order_guid} transitioned successfully.`,
      );
      setTimeout(() => setSuccess(""), 6000);
      await fetchRecords();
      closeEdit();
    } catch (err: any) {
      const msg =
        err?.response?.data?.error ||
        "Retry failed — Assetic rejected the transition.";
      setError(msg);
      await fetchRecords();
    } finally {
      setRetrying(false);
    }
  };

  const handleDismiss = async (id: number) => {
    if (
      !confirm(
        "Permanently delete this failed work order record? This cannot be undone.",
      )
    ) {
      return;
    }

    setDismissing(true);
    setError("");
    try {
      await adminService.deleteFailedWorkOrder(id);
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

  return (
    <div className="container">
      <div className="page-header">
        <h2>Failed Work Orders</h2>
        <p style={{ color: "var(--text-secondary)" }}>
          Work order status transitions that failed in Assetic. Edit payload and
          notes, retry, or dismiss.
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

      {loading ? (
        <div
          className="card"
          style={{ padding: 32, textAlign: "center", color: "var(--text-secondary)" }}
        >
          Loading...
        </div>
      ) : records.length === 0 ? (
        <div
          className="card"
          style={{ padding: 32, textAlign: "center", color: "var(--text-secondary)" }}
        >
          No{statusFilter !== "all" ? ` ${statusFilter}` : ""} failed work
          orders.
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
            <thead>
              <tr
                style={{
                  background: "var(--bg-secondary, #f9fafb)",
                  borderBottom: "1px solid var(--border)",
                }}
              >
                {[
                  "Work Order",
                  "Transition",
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
                      i % 2 === 0 ? "transparent" : "var(--bg-secondary, #f9fafb)",
                  }}
                >
                  <td style={{ padding: "10px 14px", maxWidth: 260 }}>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>
                      {r.work_order_title || r.assetic_work_order_guid || "Unknown WO"}
                    </div>
                    <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                      Local #{r.work_order_id ?? "-"}
                      {r.work_order_work_group ? ` | ${r.work_order_work_group}` : ""}
                    </div>
                  </td>
                  <td style={{ padding: "10px 14px", whiteSpace: "nowrap" }}>
                    {(r.from_status || "?").toUpperCase()} {"->"} {(r.to_status || "?").toUpperCase()}
                  </td>
                  <td
                    style={{
                      padding: "10px 14px",
                      maxWidth: 320,
                      fontSize: 12,
                      color: "var(--error, #ef4444)",
                    }}
                  >
                    <div
                      style={{
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                      title={r.error_message ?? ""}
                    >
                      {r.error_message || "Unknown error"}
                    </div>
                  </td>
                  <td style={{ padding: "10px 14px", textAlign: "center" }}>
                    {r.retry_count}
                  </td>
                  <td style={{ padding: "10px 14px" }}>{statusBadge(r.status)}</td>
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
                      style={{ padding: "3px 10px", fontSize: 12, marginRight: 6 }}
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

      {editing && editDraft && (
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
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: 20,
              }}
            >
              <div>
                <h3 style={{ margin: 0 }}>Edit Failed Work Order #{editing.id}</h3>
                <div
                  style={{ fontSize: 13, color: "var(--text-secondary)", marginTop: 4 }}
                >
                  {editing.from_status?.toUpperCase() || "?"} {"->"} {editing.to_status?.toUpperCase() || "?"}
                  &nbsp;·&nbsp; {editing.retry_count} retr
                  {editing.retry_count === 1 ? "y" : "ies"}
                  &nbsp;·&nbsp; {statusBadge(editing.status)}
                </div>
              </div>
              <button className="btn btn-secondary" onClick={closeEdit}>
                X Close
              </button>
            </div>

            {(editing.error_message || editing.assetic_error_response) && (
              <div className="error card" style={{ marginBottom: 16, fontSize: 13 }}>
                <div>
                  <strong>
                    Last error
                    {editing.assetic_http_status
                      ? ` (HTTP ${editing.assetic_http_status})`
                      : ""}
                    :
                  </strong>{" "}
                  {editing.error_message || "(no message)"}
                </div>
                {editing.assetic_error_response && (
                  <details style={{ marginTop: 8 }}>
                    <summary style={{ cursor: "pointer", fontWeight: 600, fontSize: 12 }}>
                      Raw Assetic response body
                    </summary>
                    <pre
                      style={{
                        marginTop: 8,
                        padding: 10,
                        background: "rgba(0,0,0,0.15)",
                        borderRadius: 6,
                        fontSize: 11,
                        fontFamily: "monospace",
                        whiteSpace: "pre-wrap",
                        wordBreak: "break-all",
                        maxHeight: 260,
                        overflow: "auto",
                      }}
                    >
                      {(() => {
                        try {
                          return JSON.stringify(
                            JSON.parse(editing.assetic_error_response as string),
                            null,
                            2,
                          );
                        } catch {
                          return editing.assetic_error_response;
                        }
                      })()}
                    </pre>
                  </details>
                )}
              </div>
            )}

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
                Status
              </label>
              <select
                value={editDraft.status}
                onChange={(e) =>
                  setEditDraft((d) =>
                    d
                      ? {
                          ...d,
                          status: e.target.value as FailedWorkOrder["status"],
                        }
                      : d,
                  )
                }
                style={{ width: "100%" }}
              >
                <option value="pending">Pending</option>
                <option value="resolved">Resolved</option>
                <option value="dismissed">Dismissed</option>
              </select>
            </div>

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
                Assetic Payload (JSON)
              </label>
              <textarea
                rows={10}
                value={editDraft.assetic_payload}
                onChange={(e) =>
                  setEditDraft((d) => (d ? { ...d, assetic_payload: e.target.value } : d))
                }
                style={{ width: "100%", fontFamily: "monospace", fontSize: 12 }}
              />
            </div>

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
                Admin Notes
              </label>
              <textarea
                rows={4}
                value={editDraft.admin_notes}
                onChange={(e) =>
                  setEditDraft((d) => (d ? { ...d, admin_notes: e.target.value } : d))
                }
                style={{ width: "100%" }}
              />
            </div>

            <div
              style={{
                display: "flex",
                gap: 10,
                paddingTop: 20,
                borderTop: "1px solid var(--border)",
              }}
            >
              <button className="btn btn-primary" disabled={saving} onClick={() => void handleSave()}>
                {saving ? "Saving..." : "Save Changes"}
              </button>
              {editing.status !== "resolved" && (
                <button
                  className="btn btn-success"
                  disabled={retrying || saving}
                  onClick={() => void handleRetry()}
                  style={{ background: "var(--success, #22c55e)", color: "#fff", border: "none" }}
                >
                  {retrying ? "Retrying..." : "Retry -> Assetic"}
                </button>
              )}
              <button
                className="btn btn-danger"
                disabled={dismissing || saving}
                style={{ marginLeft: "auto" }}
                onClick={() => void handleDismiss(editing.id)}
              >
                Dismiss and Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default FailedWorkOrders;
