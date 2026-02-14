import React, { useState, useEffect } from 'react';
import { maintenanceService } from '../services/maintenanceService';

const WorkOrders: React.FC = () => {
  const [workOrders, setWorkOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [filters, setFilters] = useState({ status: '', craft: '' });
  const [crafts, setCrafts] = useState<string[]>([]);

  // Detail / messages state
  const [selectedOrder, setSelectedOrder] = useState<any>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [messagesLoading, setMessagesLoading] = useState(false);

  // Assignment state
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editCraft, setEditCraft] = useState('');
  const [editStatus, setEditStatus] = useState('');

  useEffect(() => {
    fetchWorkOrders();
    fetchCrafts();
  }, []);

  const fetchWorkOrders = async () => {
    setLoading(true);
    setError('');
    try {
      const data = await maintenanceService.getWorkOrders(filters);
      setWorkOrders(data.workOrders || []);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to fetch work orders');
    } finally {
      setLoading(false);
    }
  };

  const fetchCrafts = async () => {
    try {
      const data = await maintenanceService.getCrafts();
      setCrafts(data.crafts || []);
    } catch {
      // Silently fail – crafts list is non-critical
    }
  };

  const handleFilterChange = (e: React.ChangeEvent<HTMLSelectElement | HTMLInputElement>) => {
    setFilters({ ...filters, [e.target.name]: e.target.value });
  };

  const openDetail = async (workOrder: any) => {
    setSelectedOrder(workOrder);
    setMessagesLoading(true);
    try {
      const data = await maintenanceService.getMessages(workOrder.id);
      setMessages(data.messages || []);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to fetch messages');
    } finally {
      setMessagesLoading(false);
    }
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedOrder || !newMessage.trim()) return;
    try {
      await maintenanceService.sendMessage(selectedOrder.id, newMessage);
      setNewMessage('');
      const data = await maintenanceService.getMessages(selectedOrder.id);
      setMessages(data.messages || []);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to send message');
    }
  };

  const startEdit = (order: any) => {
    setEditingId(order.id);
    setEditCraft(order.craft || '');
    setEditStatus(order.status || 'pending');
  };

  const saveEdit = async () => {
    if (editingId === null) return;
    try {
      await maintenanceService.updateWorkOrder(editingId, {
        craft: editCraft || undefined,
        status: editStatus || undefined,
      });
      setEditingId(null);
      fetchWorkOrders();
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to update work order');
    }
  };

  return (
    <div className="container">
      <div className="page-header">
        <h2>Work Orders</h2>
      </div>

      <div className="card">
        <h3>Filters</h3>
        <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-end' }}>
          <div className="form-group" style={{ flex: 1 }}>
            <label>Status</label>
            <select name="status" value={filters.status} onChange={handleFilterChange}>
              <option value="">All</option>
              <option value="pending">Pending</option>
              <option value="in_progress">In Progress</option>
              <option value="completed">Completed</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </div>
          <div className="form-group" style={{ flex: 1 }}>
            <label>Craft / Trade</label>
            <input
              type="text"
              name="craft"
              value={filters.craft}
              onChange={handleFilterChange}
              placeholder="Filter by craft"
            />
          </div>
          <button onClick={fetchWorkOrders}>Apply Filters</button>
        </div>
      </div>

      {error && <div className="error card">{error}</div>}

      <div className="card">
        {loading ? (
          <div className="loading">Loading work orders...</div>
        ) : workOrders.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>
            No work orders found.
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>ID</th>
                <th>Title</th>
                <th>Craft</th>
                <th>Priority</th>
                <th>Status</th>
                <th>Assigned To</th>
                <th>Scheduled</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {workOrders.map((wo) => (
                <tr key={wo.id}>
                  <td>{wo.id}</td>
                  <td>{wo.title}</td>
                  <td>
                    {editingId === wo.id ? (
                      <input
                        type="text"
                        value={editCraft}
                        onChange={(e) => setEditCraft(e.target.value)}
                        placeholder="e.g. Plumbing"
                        style={{ width: '100px' }}
                        list="craft-options"
                      />
                    ) : (
                      wo.craft || 'N/A'
                    )}
                  </td>
                  <td>{wo.priority}</td>
                  <td>
                    {editingId === wo.id ? (
                      <select value={editStatus} onChange={(e) => setEditStatus(e.target.value)}>
                        <option value="pending">Pending</option>
                        <option value="in_progress">In Progress</option>
                        <option value="completed">Completed</option>
                        <option value="cancelled">Cancelled</option>
                      </select>
                    ) : (
                      wo.status
                    )}
                  </td>
                  <td>{wo.assigned_to_username || 'Unassigned'}</td>
                  <td>{wo.scheduled_date ? new Date(wo.scheduled_date).toLocaleDateString() : 'N/A'}</td>
                  <td>
                    {editingId === wo.id ? (
                      <div style={{ display: 'flex', gap: '4px' }}>
                        <button className="btn-ghost" onClick={saveEdit}>Save</button>
                        <button className="btn-ghost" onClick={() => setEditingId(null)}>Cancel</button>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', gap: '4px' }}>
                        <button className="btn-ghost" onClick={() => startEdit(wo)}>Edit</button>
                        <button className="btn-ghost" onClick={() => openDetail(wo)}>Messages</button>
                      </div>
                    )}
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

      {/* Messages panel */}
      {selectedOrder && (
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3>Messages – Work Order #{selectedOrder.id}: {selectedOrder.title}</h3>
            <button onClick={() => setSelectedOrder(null)}>Close</button>
          </div>
          {messagesLoading ? (
            <div className="loading">Loading messages...</div>
          ) : (
            <>
              <div className="messages-box">
                {messages.length === 0 ? (
                  <p style={{ color: 'var(--text-muted)' }}>No messages yet.</p>
                ) : (
                  messages.map((msg) => (
                    <div key={msg.id} className="message-bubble">
                      <strong>{msg.sender_username || 'Unknown'}</strong>
                      <span className="message-meta">
                        {new Date(msg.created_at).toLocaleString()}
                      </span>
                      <p style={{ margin: '4px 0 0 0' }}>{msg.message}</p>
                    </div>
                  ))
                )}
              </div>
              <form onSubmit={handleSendMessage} style={{ display: 'flex', gap: '10px' }}>
                <input
                  type="text"
                  value={newMessage}
                  onChange={(e) => setNewMessage(e.target.value)}
                  placeholder="Type a response..."
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

export default WorkOrders;
