import React, { useState, useEffect } from "react";
import {
  BrowserRouter as Router,
  Routes,
  Route,
  Navigate,
  Link,
  useLocation,
} from "react-router-dom";
import Login from "./pages/Login";
import Maintenance from "./pages/Maintenance";
import MyRequests from "./pages/MyRequests";
import WorkOrders from "./pages/WorkOrders";
import WorkGroups from "./pages/WorkGroups";
import NewWorkRequest from "./pages/NewWorkRequest";
import Settings from "./pages/Settings";
import Users from "./pages/Users";
import MyProfile from "./pages/MyProfile";
import { authService } from "./services/authService";
import { ToastProvider } from "./contexts/ToastContext";
import ToastContainer from "./components/ToastContainer";
import { useAsseticRateLimitMonitor } from "./components/useAsseticRateLimitMonitor";
import DatabaseGate from "./components/DatabaseGate";

function NavLink({ to, children }: { to: string; children: React.ReactNode }) {
  const location = useLocation();
  const isActive = location.pathname === to;
  return (
    <Link to={to} className={`nav-link ${isActive ? "nav-link-active" : ""}`}>
      {children}
    </Link>
  );
}

function AppContent() {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(true);
  const [user, setUser] = useState<any>(null);
  const [adminViewMode, setAdminViewMode] = useState<"front-end" | "back-end">(
    "back-end",
  );

  useEffect(() => {
    void checkAuth();
    // Load admin view preference from localStorage
    const savedMode = localStorage.getItem("adminViewMode") as
      | "front-end"
      | "back-end";
    if (savedMode) {
      setAdminViewMode(savedMode);
    }
  }, []);

  const checkAuth = async () => {
    const token = authService.getToken();

    if (!token) {
      setIsAuthenticated(false);
      setUser(null);
      setLoading(false);
      return;
    }

    const userData = await authService.getCurrentUser();
    setIsAuthenticated(!!userData);
    setUser(userData);
    setLoading(false);
  };

  const handleLogout = () => {
    authService.logout();
    setIsAuthenticated(false);
    setUser(null);
  };

  const handleLoginSuccess = () => {
    setIsAuthenticated(true);
    setUser(authService.getUser());
  };

  const isAdmin = user?.role === "admin";
  const landingPath = isAuthenticated
    ? isAdmin && adminViewMode === "back-end"
      ? "/requests"
      : "/my-requests"
    : "/login";

  const toggleAdminView = () => {
    const newMode = adminViewMode === "back-end" ? "front-end" : "back-end";
    setAdminViewMode(newMode);
    localStorage.setItem("adminViewMode", newMode);
  };

  // Monitor Assetic rate-limit status and show toasts when throttled
  useAsseticRateLimitMonitor(isAdmin);

  if (loading) {
    return <div className="loading">Loading...</div>;
  }

  return (
    <div className="app">
      {isAuthenticated && (
        <div className="sidebar">
          <div className="sidebar-header">
            <div className="sidebar-logo">
              <svg
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                <polyline points="9 22 9 12 15 12 15 22" />
              </svg>
              <span>FM Portal</span>
            </div>
          </div>

          <nav className="sidebar-nav">
            <div className="nav-section">
              <div className="nav-section-title">Main</div>
              {isAdmin && adminViewMode === "back-end" ? (
                <>
                  <NavLink to="/requests">
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                      <polyline points="14 2 14 8 20 8" />
                      <line x1="16" y1="13" x2="8" y2="13" />
                      <line x1="16" y1="17" x2="8" y2="17" />
                    </svg>
                    Requests
                  </NavLink>
                  <NavLink to="/work-orders">
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
                    </svg>
                    Work Orders
                  </NavLink>
                  <NavLink to="/work-groups">
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                      <circle cx="9" cy="7" r="4" />
                      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                    </svg>
                    Work Groups
                  </NavLink>
                </>
              ) : (
                <>
                  <NavLink to="/my-requests">
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                      <polyline points="14 2 14 8 20 8" />
                      <line x1="16" y1="13" x2="8" y2="13" />
                      <line x1="16" y1="17" x2="8" y2="17" />
                    </svg>
                    My Requests
                  </NavLink>
                  <NavLink to="/new-request">
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <circle cx="12" cy="12" r="10" />
                      <line x1="12" y1="8" x2="12" y2="16" />
                      <line x1="8" y1="12" x2="16" y2="12" />
                    </svg>
                    New Work Request
                  </NavLink>
                  <NavLink to="/my-profile">
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <circle cx="12" cy="12" r="3" />
                      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
                    </svg>
                    My Settings
                  </NavLink>
                </>
              )}
            </div>

            {isAdmin && (
              <>
                <div className="nav-section">
                  <div className="nav-section-title">
                    Admin View
                    <button
                      onClick={toggleAdminView}
                      className="btn-ghost"
                      style={{
                        marginLeft: "auto",
                        padding: "4px 8px",
                        fontSize: "12px",
                        display: "flex",
                        alignItems: "center",
                        gap: "4px",
                      }}
                      title={`Switch to ${adminViewMode === "back-end" ? "front-end" : "back-end"} view`}
                    >
                      {adminViewMode === "back-end" ? (
                        <>
                          <svg
                            width="14"
                            height="14"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                          >
                            <rect
                              x="2"
                              y="3"
                              width="20"
                              height="14"
                              rx="2"
                              ry="2"
                            />
                            <line x1="8" y1="21" x2="16" y2="21" />
                            <line x1="12" y1="17" x2="12" y2="21" />
                          </svg>
                          Back-End
                        </>
                      ) : (
                        <>
                          <svg
                            width="14"
                            height="14"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                          >
                            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                            <circle cx="9" cy="7" r="4" />
                          </svg>
                          Front-End
                        </>
                      )}
                    </button>
                  </div>
                </div>

                <div className="nav-section">
                  <div className="nav-section-title">Administration</div>
                  <NavLink to="/admin/users">
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                      <circle cx="9" cy="7" r="4" />
                      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                    </svg>
                    Users
                  </NavLink>
                  <NavLink to="/admin/settings">
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <circle cx="12" cy="12" r="3" />
                      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
                    </svg>
                    Settings
                  </NavLink>
                </div>
              </>
            )}
          </nav>

          <div className="sidebar-footer">
            <div className="sidebar-user">
              <div className="sidebar-user-avatar">
                {(
                  user?.firstName?.[0] ||
                  user?.email?.[0] ||
                  "?"
                ).toUpperCase()}
              </div>
              <div className="sidebar-user-info">
                <div className="sidebar-user-name">
                  {user?.firstName || user?.username || "User"}
                </div>
                <div className="sidebar-user-role">{user?.role || "user"}</div>
              </div>
            </div>
            <button
              onClick={handleLogout}
              className="btn-ghost"
              title="Sign out"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <polyline points="16 17 21 12 16 7" />
                <line x1="21" y1="12" x2="9" y2="12" />
              </svg>
            </button>
          </div>
        </div>
      )}

      <div className={isAuthenticated ? "main-content" : ""}>
        <Routes>
          <Route
            path="/login"
            element={
              isAuthenticated ? (
                <Navigate to={landingPath} replace />
              ) : (
                <Login onLoginSuccess={handleLoginSuccess} />
              )
            }
          />
          <Route
            path="/dashboard"
            element={<Navigate to={landingPath} replace />}
          />
          <Route
            path="/my-requests"
            element={
              isAuthenticated ? (
                <MyRequests />
              ) : (
                <Navigate to="/login" replace />
              )
            }
          />
          <Route
            path="/new-request"
            element={
              isAuthenticated ? (
                <NewWorkRequest />
              ) : (
                <Navigate to="/login" replace />
              )
            }
          />
          <Route
            path="/requests"
            element={
              isAuthenticated && isAdmin ? (
                <Maintenance />
              ) : (
                <Navigate to="/my-requests" replace />
              )
            }
          />
          <Route
            path="/work-orders"
            element={
              isAuthenticated && isAdmin ? (
                <WorkOrders />
              ) : (
                <Navigate to="/my-requests" replace />
              )
            }
          />
          <Route
            path="/work-groups"
            element={
              isAuthenticated && isAdmin ? (
                <WorkGroups />
              ) : (
                <Navigate to="/my-requests" replace />
              )
            }
          />
          {/* Admin routes */}
          <Route
            path="/admin/settings"
            element={
              isAuthenticated && isAdmin ? (
                <Settings />
              ) : (
                <Navigate
                  to={isAuthenticated ? "/my-requests" : "/login"}
                  replace
                />
              )
            }
          />
          <Route
            path="/admin/users"
            element={
              isAuthenticated && isAdmin ? (
                <Users />
              ) : (
                <Navigate
                  to={isAuthenticated ? "/my-requests" : "/login"}
                  replace
                />
              )
            }
          />
          <Route
            path="/my-profile"
            element={
              isAuthenticated ? <MyProfile /> : <Navigate to="/login" replace />
            }
          />
          <Route path="/" element={<Navigate to={landingPath} replace />} />
          <Route path="*" element={<Navigate to={landingPath} replace />} />
        </Routes>
      </div>

      <ToastContainer />
    </div>
  );
}

function App() {
  return (
    <DatabaseGate>
      <Router>
        <ToastProvider>
          <AppContent />
        </ToastProvider>
      </Router>
    </DatabaseGate>
  );
}

export default App;
