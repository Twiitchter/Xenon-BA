import React, { useEffect, useState } from 'react';
import { authService } from '../services/authService';
import { maintenanceService } from '../services/maintenanceService';

const Dashboard: React.FC = () => {
  const [user, setUser] = useState<any>(null);
  const [stats, setStats] = useState({
    myOpenRequests: 0,
    myInProgressRequests: 0,
    myCompletedRequests: 0,
    recentRequests: [] as any[],
    recentWorkOrders: [] as any[],
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const userData = authService.getUser();
    setUser(userData);
    fetchDashboardData();
  }, []);

  const fetchDashboardData = async () => {
    try {
      const [requestsData, workOrdersData] = await Promise.all([
        maintenanceService.getRequests({ limit: 5 }),
        maintenanceService.getWorkOrders({ limit: 5 }),
      ]);
      
      const requests = requestsData.requests || [];
      setStats({
        myOpenRequests: requests.filter((r: any) => r.status === 'open').length,
        myInProgressRequests: requests.filter((r: any) => r.status === 'in_progress').length,
        myCompletedRequests: requests.filter((r: any) => r.status === 'completed').length,
        recentRequests: requests.slice(0, 5),
        recentWorkOrders: (workOrdersData.workOrders || []).slice(0, 5),
      });
    } catch {
      // Dashboard data is non-critical
    } finally {
      setLoading(false);
    }
  };

  const getStatusBadge = (status: string) => {
    const colors: Record<string, string> = {
      open: 'badge-info',
      pending: 'badge-warning',
      in_progress: 'badge-warning',
      completed: 'badge-success',
      cancelled: 'badge-muted',
    };
    return `badge ${colors[status] || 'badge-muted'}`;
  };

  const getPriorityBadge = (priority: string) => {
    const colors: Record<string, string> = {
      low: 'badge-muted',
      medium: 'badge-info',
      high: 'badge-warning',
      critical: 'badge-error',
    };
    return `badge ${colors[priority] || 'badge-muted'}`;
  };

  return (
    <div className="container">
      <div className="page-header">
        <h2>Dashboard</h2>
        <p style={{ color: 'var(--text-secondary)' }}>Welcome back, {user?.firstName || user?.username || 'User'}</p>
      </div>

      {/* Stats Cards */}
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-value">{stats.myOpenRequests}</div>
          <div className="stat-label">Open Requests</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{stats.myInProgressRequests}</div>
          <div className="stat-label">In Progress</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{stats.myCompletedRequests}</div>
          <div className="stat-label">Completed</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{stats.recentWorkOrders.length}</div>
          <div className="stat-label">Active Work Orders</div>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="card" style={{ marginTop: '20px' }}>
        <h3 style={{ marginBottom: '12px' }}>Quick Actions</h3>
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          <button onClick={() => (window.location.href = '/requests')}>
            New Maintenance Request
          </button>
          <button className="btn-outline" onClick={() => (window.location.href = '/work-orders')}>
            View Work Orders
          </button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', marginTop: '20px' }}>
        {/* Recent Requests */}
        <div className="card">
          <h3 style={{ marginBottom: '12px' }}>Recent Requests</h3>
          {loading ? (
            <div className="loading">Loading...</div>
          ) : stats.recentRequests.length === 0 ? (
            <p style={{ color: 'var(--text-muted)' }}>No maintenance requests yet.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {stats.recentRequests.map((req) => (
                <div key={req.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
                  <div>
                    <div style={{ fontWeight: 500 }}>{req.title}</div>
                    <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                      {req.location || req.category || 'No location'} · {new Date(req.created_at).toLocaleDateString()}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '6px' }}>
                    <span className={getPriorityBadge(req.priority)}>{req.priority}</span>
                    <span className={getStatusBadge(req.status)}>{req.status.replace('_', ' ')}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Recent Work Orders */}
        <div className="card">
          <h3 style={{ marginBottom: '12px' }}>Recent Work Orders</h3>
          {loading ? (
            <div className="loading">Loading...</div>
          ) : stats.recentWorkOrders.length === 0 ? (
            <p style={{ color: 'var(--text-muted)' }}>No work orders yet.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {stats.recentWorkOrders.map((wo) => (
                <div key={wo.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
                  <div>
                    <div style={{ fontWeight: 500 }}>{wo.title}</div>
                    <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                      {wo.craft || 'Unassigned'} · {wo.assigned_to_username || 'Unassigned'}
                    </div>
                  </div>
                  <span className={getStatusBadge(wo.status)}>{wo.status.replace('_', ' ')}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
