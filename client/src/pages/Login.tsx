import React, { useState } from 'react';
import { authService } from '../services/authService';

interface LoginProps {
  onLoginSuccess: () => void;
}

const Login: React.FC<LoginProps> = ({ onLoginSuccess }) => {
  const [isRegister, setIsRegister] = useState(false);
  const [formData, setFormData] = useState({
    username: '',
    password: '',
    email: '',
    firstName: '',
    lastName: '',
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value,
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      if (isRegister) {
        await authService.register(formData);
      } else {
        await authService.login({
          username: formData.username,
          password: formData.password,
        });
      }
      onLoginSuccess();
    } catch (err: any) {
      setError(err.response?.data?.error || 'Authentication failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="container" style={{ maxWidth: '400px', marginTop: '50px' }}>
      <div className="card">
        <h2 style={{ marginBottom: '20px', textAlign: 'center' }}>
          {isRegister ? 'Register' : 'Login'}
        </h2>

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>Username</label>
            <input
              type="text"
              name="username"
              value={formData.username}
              onChange={handleChange}
              required
            />
          </div>

          {isRegister && (
            <>
              <div className="form-group">
                <label>Email</label>
                <input
                  type="email"
                  name="email"
                  value={formData.email}
                  onChange={handleChange}
                  required
                />
              </div>

              <div className="form-group">
                <label>First Name</label>
                <input
                  type="text"
                  name="firstName"
                  value={formData.firstName}
                  onChange={handleChange}
                />
              </div>

              <div className="form-group">
                <label>Last Name</label>
                <input
                  type="text"
                  name="lastName"
                  value={formData.lastName}
                  onChange={handleChange}
                />
              </div>
            </>
          )}

          <div className="form-group">
            <label>Password</label>
            <input
              type="password"
              name="password"
              value={formData.password}
              onChange={handleChange}
              required
            />
          </div>

          {error && <div className="error">{error}</div>}

          <button type="submit" disabled={loading} style={{ width: '100%', marginTop: '10px' }}>
            {loading ? 'Please wait...' : isRegister ? 'Register' : 'Login'}
          </button>
        </form>

        <div style={{ marginTop: '20px', textAlign: 'center' }}>
          <button
            type="button"
            onClick={() => setIsRegister(!isRegister)}
            style={{ background: 'transparent', color: '#007bff', textDecoration: 'underline' }}
          >
            {isRegister ? 'Already have an account? Login' : "Don't have an account? Register"}
          </button>
        </div>

        <div style={{ marginTop: '20px', paddingTop: '20px', borderTop: '1px solid #ddd' }}>
          <h4 style={{ marginBottom: '10px' }}>SSO Login Options</h4>
          <button
            type="button"
            onClick={() => (window.location.href = '/api/auth/oauth2')}
            style={{ width: '100%', marginBottom: '10px' }}
          >
            Login with OAuth2/SSO
          </button>
          <button
            type="button"
            onClick={() => (window.location.href = '/api/auth/saml')}
            style={{ width: '100%' }}
          >
            Login with SAML
          </button>
        </div>
      </div>
    </div>
  );
};

export default Login;
