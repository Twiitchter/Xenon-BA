-- Users table for authentication
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username VARCHAR(255) UNIQUE NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255),
  first_name VARCHAR(255),
  last_name VARCHAR(255),
  auth_provider VARCHAR(50) DEFAULT 'local',
  external_id VARCHAR(255),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Assets table to track Assetic assets
CREATE TABLE IF NOT EXISTS assets (
  id SERIAL PRIMARY KEY,
  assetic_id VARCHAR(255) UNIQUE NOT NULL,
  asset_tag VARCHAR(255),
  description TEXT,
  category VARCHAR(255),
  location VARCHAR(255),
  status VARCHAR(100),
  purchase_date DATE,
  purchase_cost DECIMAL(10, 2),
  current_value DECIMAL(10, 2),
  data JSONB,
  last_synced_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Asset change log to track changes from Assetic API
CREATE TABLE IF NOT EXISTS asset_changes (
  id SERIAL PRIMARY KEY,
  asset_id INTEGER REFERENCES assets(id) ON DELETE CASCADE,
  change_type VARCHAR(50) NOT NULL,
  field_name VARCHAR(255),
  old_value TEXT,
  new_value TEXT,
  changed_by VARCHAR(255),
  changed_at TIMESTAMP NOT NULL,
  synced_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Email logs to track sent emails
CREATE TABLE IF NOT EXISTS email_logs (
  id SERIAL PRIMARY KEY,
  recipient VARCHAR(255) NOT NULL,
  subject VARCHAR(500) NOT NULL,
  body TEXT,
  has_attachment BOOLEAN DEFAULT false,
  attachment_name VARCHAR(255),
  status VARCHAR(50) NOT NULL,
  error_message TEXT,
  sent_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- PDF reports tracking
CREATE TABLE IF NOT EXISTS report_logs (
  id SERIAL PRIMARY KEY,
  report_type VARCHAR(100) NOT NULL,
  generated_by INTEGER REFERENCES users(id),
  file_name VARCHAR(255),
  parameters JSONB,
  status VARCHAR(50) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_assets_assetic_id ON assets(assetic_id);
CREATE INDEX IF NOT EXISTS idx_assets_status ON assets(status);
CREATE INDEX IF NOT EXISTS idx_asset_changes_asset_id ON asset_changes(asset_id);
CREATE INDEX IF NOT EXISTS idx_asset_changes_changed_at ON asset_changes(changed_at);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
