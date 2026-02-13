import React, { useState, useEffect } from 'react';
import { assetService } from '../services/assetService';

const Assets: React.FC = () => {
  const [assets, setAssets] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState('');
  const [filters, setFilters] = useState({
    status: '',
    category: '',
  });

  useEffect(() => {
    fetchAssets();
  }, []);

  const fetchAssets = async () => {
    setLoading(true);
    setError('');
    try {
      const data = await assetService.getAssets(filters);
      setAssets(data.assets || []);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to fetch assets');
    } finally {
      setLoading(false);
    }
  };

  const handleSync = async () => {
    setSyncing(true);
    setError('');
    try {
      const result = await assetService.syncAssets();
      alert(
        `Sync completed: ${result.syncedCount} assets synced, ${result.errorCount} errors`
      );
      fetchAssets();
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to sync assets');
    } finally {
      setSyncing(false);
    }
  };

  const handleFilterChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setFilters({
      ...filters,
      [e.target.name]: e.target.value,
    });
  };

  const applyFilters = () => {
    fetchAssets();
  };

  return (
    <div className="container">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2>Assets</h2>
        <button onClick={handleSync} disabled={syncing}>
          {syncing ? 'Syncing...' : 'Sync from Assetic'}
        </button>
      </div>

      <div className="card">
        <h3>Filters</h3>
        <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-end' }}>
          <div className="form-group" style={{ flex: 1 }}>
            <label>Status</label>
            <select name="status" value={filters.status} onChange={handleFilterChange}>
              <option value="">All</option>
              <option value="Active">Active</option>
              <option value="Inactive">Inactive</option>
              <option value="Retired">Retired</option>
            </select>
          </div>

          <div className="form-group" style={{ flex: 1 }}>
            <label>Category</label>
            <select name="category" value={filters.category} onChange={handleFilterChange}>
              <option value="">All</option>
              <option value="Equipment">Equipment</option>
              <option value="Furniture">Furniture</option>
              <option value="Vehicles">Vehicles</option>
            </select>
          </div>

          <button onClick={applyFilters}>Apply Filters</button>
        </div>
      </div>

      {error && <div className="error card">{error}</div>}

      <div className="card">
        {loading ? (
          <div className="loading">Loading assets...</div>
        ) : assets.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px', color: '#666' }}>
            No assets found. Click "Sync from Assetic" to import assets.
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Asset Tag</th>
                <th>Description</th>
                <th>Category</th>
                <th>Location</th>
                <th>Status</th>
                <th>Last Synced</th>
              </tr>
            </thead>
            <tbody>
              {assets.map((asset) => (
                <tr key={asset.id}>
                  <td>{asset.asset_tag || 'N/A'}</td>
                  <td>{asset.description || 'N/A'}</td>
                  <td>{asset.category || 'N/A'}</td>
                  <td>{asset.location || 'N/A'}</td>
                  <td>{asset.status || 'N/A'}</td>
                  <td>
                    {asset.last_synced_at
                      ? new Date(asset.last_synced_at).toLocaleString()
                      : 'Never'}
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

export default Assets;
