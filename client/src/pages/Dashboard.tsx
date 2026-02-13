import React, { useEffect, useState } from 'react';
import { authService } from '../services/authService';

const Dashboard: React.FC = () => {
  const [user, setUser] = useState<any>(null);

  useEffect(() => {
    const userData = authService.getUser();
    setUser(userData);
  }, []);

  return (
    <div className="container">
      <h2>Dashboard</h2>

      <div className="card">
        <h3>Welcome, {user?.firstName || user?.username}!</h3>
        <p>Email: {user?.email}</p>
      </div>

      <div className="card">
        <h3>Quick Actions</h3>
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          <button onClick={() => (window.location.href = '/assets')}>View Assets</button>
          <button onClick={() => (window.location.href = '/reports')}>Generate Reports</button>
        </div>
      </div>

      <div className="card">
        <h3>System Overview</h3>
        <p>
          XeonB CRM provides comprehensive asset management capabilities integrated with Brightly's
          Assetic API. Use this portal to:
        </p>
        <ul style={{ marginLeft: '20px', marginTop: '10px' }}>
          <li>View and manage assets synced from Assetic</li>
          <li>Track asset changes and history</li>
          <li>Generate PDF reports</li>
          <li>Send email notifications with or without attachments</li>
        </ul>
      </div>

      <div className="card">
        <h3>Getting Started</h3>
        <ol style={{ marginLeft: '20px', marginTop: '10px' }}>
          <li>Configure your Assetic API credentials in the .env file</li>
          <li>Navigate to Assets and click "Sync from Assetic" to import your assets</li>
          <li>View asset details and change history</li>
          <li>Generate reports from the Reports page</li>
        </ol>
      </div>
    </div>
  );
};

export default Dashboard;
