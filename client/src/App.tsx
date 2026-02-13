import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, Link } from 'react-router-dom';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Assets from './pages/Assets';
import Reports from './pages/Reports';
import { authService } from './services/authService';

function App() {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    checkAuth();
  }, []);

  const checkAuth = () => {
    const token = authService.getToken();
    setIsAuthenticated(!!token);
    setLoading(false);
  };

  const handleLogout = () => {
    authService.logout();
    setIsAuthenticated(false);
  };

  if (loading) {
    return <div className="loading">Loading...</div>;
  }

  return (
    <Router>
      <div className="app">
        {isAuthenticated && (
          <div className="header">
            <div className="container">
              <h1>XeonB CRM - Asset Management</h1>
              <nav>
                <Link to="/dashboard">Dashboard</Link>
                <Link to="/assets">Assets</Link>
                <Link to="/reports">Reports</Link>
                <button onClick={handleLogout} style={{ marginLeft: '20px' }}>
                  Logout
                </button>
              </nav>
            </div>
          </div>
        )}

        <Routes>
          <Route
            path="/login"
            element={
              isAuthenticated ? (
                <Navigate to="/dashboard" replace />
              ) : (
                <Login onLoginSuccess={() => setIsAuthenticated(true)} />
              )
            }
          />
          <Route
            path="/dashboard"
            element={isAuthenticated ? <Dashboard /> : <Navigate to="/login" replace />}
          />
          <Route
            path="/assets"
            element={isAuthenticated ? <Assets /> : <Navigate to="/login" replace />}
          />
          <Route
            path="/reports"
            element={isAuthenticated ? <Reports /> : <Navigate to="/login" replace />}
          />
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </div>
    </Router>
  );
}

export default App;
