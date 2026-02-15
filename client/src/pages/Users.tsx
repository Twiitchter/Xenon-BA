import React, { useState, useEffect } from 'react';
import { adminService } from '../services/adminService';

interface User {
  id: number;
  username: string;
  email: string;
  role: string;
  department?: string;
  phone?: string;
  is_active: boolean;
  created_at: string;
  last_login?: string;
}

const Users: React.FC = () => {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [form, setForm] = useState({
    username: '',
    email: '',
    password: '',
    role: 'user',
    department: '',
    phone: '',
  });

  useEffect(() => {
    fetchUsers();
  }, []);

  const fetchUsers = async () => {
    setLoading(true);
    try {
      const data = await adminService.getUsers();
      setUsers(data.users || []);
    } catch (err: any) {
      setError('Failed to load users');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    try {
      if (editingUser) {
        const payload: any = { ...form };
        if (!payload.password) delete payload.password;
        await adminService.updateUser(editingUser.id, payload);
        setSuccess('User updated');
      } else {
        await adminService.createUser(form);
        setSuccess('User created');
      }
      setShowForm(false);
      setEditingUser(null);
      setForm({ username: '', email: '', password: '', role: 'user', department: '', phone: '' });
      fetchUsers();
      setTimeout(() => setSuccess(''), 3000);
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Operation failed');
    }
  };

  const handleEdit = (user: User) => {
    setEditingUser(user);
    setForm({
      username: user.username,
      email: user.email,
      password: '',
      role: user.role,
      department: user.department || '',
      phone: user.phone || '',
    });
    setShowForm(true);
  };

  const handleToggleActive = async (user: User) => {
    try {
      await adminService.updateUser(user.id, { is_active: !user.is_active });
      fetchUsers();
    } catch {
      setError('Failed to update user status');
    }
  };

  const handleDelete = async (user: User) => {
    if (!confirm(`Delete user ${user.username}? This cannot be undone.`)) return;
    try {
      await adminService.deactivateUser(user.id);
      fetchUsers();
      setSuccess('User deleted');
      setTimeout(() => setSuccess(''), 3000);
    } catch {
      setError('Failed to delete user');
    }
  };

  const cancelForm = () => {
    setShowForm(false);
    setEditingUser(null);
    setForm({ username: '', email: '', password: '', role: 'user', department: '', phone: '' });
  };

  const roleBadge = (role: string) => {
    const cls = role === 'admin' ? 'badge-error' : role === 'manager' ? 'badge-warning' : 'badge-info';
    return <span className={`badge ${cls}`}>{role}</span>;
  };

  return (
    <div className="container">
      <div className="page-header">
        <div>
          <h2>Users</h2>
          <p style={{ color: 'var(--text-secondary)' }}>Manage user accounts and roles</p>
        </div>
        <button onClick={() => { cancelForm(); setShowForm(true); }}>+ New User</button>
      </div>

      {error && <div className="error card" style={{ padding: '12px', marginBottom: '12px' }}>{error}</div>}
      {success && <div className="success card" style={{ padding: '12px', marginBottom: '12px' }}>{success}</div>}

      {showForm && (
        <div className="card" style={{ marginBottom: '20px' }}>
          <h3 style={{ marginBottom: '16px' }}>{editingUser ? 'Edit User' : 'Create User'}</h3>
          <form onSubmit={handleSubmit}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <div className="form-group">
                <label>Username</label>
                <input
                  required
                  value={form.username}
                  onChange={(e) => setForm({ ...form, username: e.target.value })}
                />
              </div>
              <div className="form-group">
                <label>Email</label>
                <input
                  type="email"
                  required
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                />
              </div>
              <div className="form-group">
                <label>Password {editingUser && '(leave blank to keep)'}</label>
                <input
                  type="password"
                  required={!editingUser}
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                />
              </div>
              <div className="form-group">
                <label>Role</label>
                <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                  <option value="user">User</option>
                  <option value="manager">Manager</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
              <div className="form-group">
                <label>Department</label>
                <input
                  value={form.department}
                  onChange={(e) => setForm({ ...form, department: e.target.value })}
                />
              </div>
              <div className="form-group">
                <label>Phone</label>
                <input
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                />
              </div>
            </div>
            <div style={{ display: 'flex', gap: '10px', marginTop: '16px' }}>
              <button type="submit">{editingUser ? 'Update' : 'Create'}</button>
              <button type="button" className="btn-outline" onClick={cancelForm}>Cancel</button>
            </div>
          </form>
        </div>
      )}

      <div className="card">
        {loading ? (
          <div className="loading">Loading users...</div>
        ) : users.length === 0 ? (
          <p style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '20px' }}>No users found</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Username</th>
                <th>Email</th>
                <th>Role</th>
                <th>Department</th>
                <th>Status</th>
                <th>Last Login</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td><strong>{u.username}</strong></td>
                  <td>{u.email}</td>
                  <td>{roleBadge(u.role)}</td>
                  <td>{u.department || '—'}</td>
                  <td>
                    <span className={`badge ${u.is_active ? 'badge-success' : 'badge-muted'}`}>
                      {u.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td>{u.last_login ? new Date(u.last_login).toLocaleDateString() : 'Never'}</td>
                  <td>
                    <div style={{ display: 'flex', gap: '6px' }}>
                      <button className="btn-ghost" onClick={() => handleEdit(u)}>Edit</button>
                      <button className="btn-ghost" onClick={() => handleToggleActive(u)}>
                        {u.is_active ? 'Disable' : 'Enable'}
                      </button>
                      <button className="btn-ghost btn-danger-ghost" onClick={() => handleDelete(u)}>Delete</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};

export default Users;
