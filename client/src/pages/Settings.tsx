import React, { useState, useEffect } from 'react';
import { adminService } from '../services/adminService';

interface SettingItem {
  id: number;
  setting_key: string;
  setting_value: string | null;
  setting_type: string;
  category: string;
  description: string | null;
}

const Settings: React.FC = () => {
  const [settings, setSettings] = useState<SettingItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [activeTab, setActiveTab] = useState('general');
  const [editedValues, setEditedValues] = useState<Record<string, string>>({});
  const [testingAssetic, setTestingAssetic] = useState(false);

  useEffect(() => {
    fetchSettings();
  }, []);

  const fetchSettings = async () => {
    setLoading(true);
    try {
      const data = await adminService.getSettings();
      setSettings(data.settings || []);
      // Initialize edited values
      const vals: Record<string, string> = {};
      for (const s of data.settings || []) {
        vals[s.setting_key] = s.setting_value || '';
      }
      setEditedValues(vals);
    } catch (err: any) {
      setError('Failed to load settings');
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      // Only send values that belong to the active category
      const categorySettings = settings.filter((s) => s.category === activeTab);
      const toSave: Record<string, string> = {};
      for (const s of categorySettings) {
        toSave[s.setting_key] = editedValues[s.setting_key] ?? s.setting_value ?? '';
      }
      await adminService.updateSettings(toSave);
      setSuccess('Settings saved successfully');
      setTimeout(() => setSuccess(''), 3000);
    } catch (err: any) {
      setError('Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  const handleTestAssetic = async () => {
    setTestingAssetic(true);
    setError('');
    setSuccess('');
    try {
      // Save first so test uses latest values
      await handleSave();
      const result = await adminService.testAsseticConnection();
      if (result.success) {
        setSuccess('Assetic connection successful!');
      } else {
        setError(`Assetic connection failed: ${result.message}`);
      }
    } catch (err: any) {
      setError('Connection test failed');
    } finally {
      setTestingAssetic(false);
    }
  };

  const categories = ['general', 'assetic', 'sso', 'email'];
  const categoryLabels: Record<string, string> = {
    general: 'General',
    assetic: 'Assetic API',
    sso: 'SSO / Authentication',
    email: 'Email',
  };

  const filteredSettings = settings.filter((s) => s.category === activeTab);

  const renderInput = (setting: SettingItem) => {
    const value = editedValues[setting.setting_key] ?? '';
    const isSecret = setting.setting_key.includes('secret') || setting.setting_key.includes('password') || setting.setting_key.includes('api_key');

    if (setting.setting_type === 'boolean') {
      return (
        <select
          value={value}
          onChange={(e) => setEditedValues({ ...editedValues, [setting.setting_key]: e.target.value })}
        >
          <option value="true">Enabled</option>
          <option value="false">Disabled</option>
        </select>
      );
    }

    return (
      <input
        type={isSecret ? 'password' : 'text'}
        value={value}
        onChange={(e) => setEditedValues({ ...editedValues, [setting.setting_key]: e.target.value })}
        placeholder={setting.description || ''}
      />
    );
  };

  const formatKey = (key: string) => {
    return key
      .replace(/^(assetic_|sso_|email_|app_)/, '')
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase());
  };

  return (
    <div className="container">
      <div className="page-header">
        <h2>Settings</h2>
        <p style={{ color: 'var(--text-secondary)' }}>Configure system settings and integrations</p>
      </div>

      {/* Tabs */}
      <div className="tabs">
        {categories.map((cat) => (
          <button
            key={cat}
            className={`tab ${activeTab === cat ? 'tab-active' : ''}`}
            onClick={() => setActiveTab(cat)}
          >
            {categoryLabels[cat]}
          </button>
        ))}
      </div>

      {error && <div className="error card" style={{ padding: '12px', marginTop: '16px' }}>{error}</div>}
      {success && <div className="success card" style={{ padding: '12px', marginTop: '16px' }}>{success}</div>}

      <div className="card" style={{ marginTop: '16px' }}>
        {loading ? (
          <div className="loading">Loading settings...</div>
        ) : (
          <>
            {filteredSettings.map((setting) => (
              <div key={setting.id} className="form-group">
                <label>{formatKey(setting.setting_key)}</label>
                {setting.description && (
                  <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '4px' }}>
                    {setting.description}
                  </div>
                )}
                {renderInput(setting)}
              </div>
            ))}

            <div style={{ display: 'flex', gap: '10px', marginTop: '20px' }}>
              <button onClick={handleSave} disabled={saving}>
                {saving ? 'Saving...' : 'Save Settings'}
              </button>
              {activeTab === 'assetic' && (
                <button className="btn-outline" onClick={handleTestAssetic} disabled={testingAssetic}>
                  {testingAssetic ? 'Testing...' : 'Test Connection'}
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default Settings;
