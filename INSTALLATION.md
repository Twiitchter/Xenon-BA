# XeonB CRM - Installation & Setup Guide

## Overview

XeonB CRM is a comprehensive Customer Relationship Management system integrated with Brightly's Assetic Asset Management API. It provides:

1. **Authentication** - Simple username/password and SSO authentication (OAuth2/SAML)
2. **Middleware API** - Integration with Brightly Assetic API
3. **Database** - PostgreSQL, SQL Server (MSSQL), or MySQL to track and monitor asset changes
4. **PDF Generation** - Create PDF reports for assets and changes
5. **Email Service** - Send emails with or without PDF attachments
6. **Docker Support** - Containerised dev and production environments

## Prerequisites

- Node.js 18+ and npm
- One of the following databases:
  - PostgreSQL 12+
  - Microsoft SQL Server 2019+ (or SQL Server Express)
  - MySQL 8.0+
- Brightly Assetic API credentials
- (Optional) Docker Desktop for containerised development

## Installation

### 1. Clone the Repository

```bash
git clone https://github.com/Twiitchter/XeonB.git
cd XeonB
```

### 2. Install Dependencies

```bash
# Install server dependencies
npm install

# Install client dependencies
cd client
npm install
cd ..
```

### 3. Database Setup

Choose one of the following databases:

#### Option A: PostgreSQL

```bash
createdb xeonb_crm
```

#### Option B: SQL Server (MSSQL)

```sql
CREATE DATABASE xeonb_crm;
```

#### Option C: MySQL

```bash
mysql -u root -p -e "CREATE DATABASE xeonb_crm"
```

### 4. Environment Configuration

Copy the example environment file and configure it:

```bash
cp .env.example .env
```

Edit `.env` and set the database dialect + credentials:

```env
# Server Configuration
PORT=3000
NODE_ENV=development

# Database Configuration — set DB_DIALECT to: pg, mssql, or mysql
DB_DIALECT=pg
DB_HOST=localhost
DB_PORT=5432
DB_NAME=xeonb_crm
DB_USER=postgres
DB_PASSWORD=yourpassword

# JWT Configuration
JWT_SECRET=your-secret-key-change-in-production
JWT_EXPIRES_IN=24h

# Brightly Assetic API Configuration
ASSETIC_API_URL=https://your-instance.brightlysoftware.com/api
ASSETIC_API_KEY=your-api-key
ASSETIC_API_VERSION=v1

# Email Configuration (SMTP)
EMAIL_HOST=smtp.gmail.com
EMAIL_PORT=587
EMAIL_SECURE=false
EMAIL_USER=your-email@example.com
EMAIL_PASSWORD=your-email-password
EMAIL_FROM=noreply@xeonb.com
```

**Database-specific settings:**

| Dialect | DB_PORT | DB_USER        | Notes                                                      |
| ------- | ------- | -------------- | ---------------------------------------------------------- |
| `pg`    | 5432    | postgres       | Default                                                    |
| `mssql` | 1433    | sa             | Set `DB_ENCRYPT=false`, `DB_TRUST_CERT=true` for local dev |
| `mysql` | 3306    | root or custom | —                                                          |

### 5. Run Database Migrations

```bash
npm run migrate
```

This will create all necessary tables in your database.

### 6. Start the Application

Development mode (runs both server and client):

```bash
npm run dev
```

Or run separately:

```bash
# Terminal 1 - Server
npm run dev:server

# Terminal 2 - Client
npm run dev:client
```

The application will be available at:

- Frontend: http://localhost:3001
- Backend API: http://localhost:3000

## Docker Development (Recommended)

The easiest way to get started is with Docker, which runs frontend, backend, and SQL Server in separate containers with zero local setup (apart from Docker Desktop).

```bash
# 1. Copy and edit your .env
cp .env.example .env

# 2. Start the 3-container stack
docker compose -f docker-compose.dev.yml up --build

# 3. Run migrations (in another terminal)
docker compose -f docker-compose.dev.yml exec backend npm run migrate
```

> **Important:** In Docker, backend DB host is set to `mssql` by compose overrides. Keep `DB_PASSWORD` in `.env` aligned with SQL Server SA password requirements.

See [DOCKER.md](DOCKER.md) for full details.

## Production Deployment

### 1. Build the Application

```bash
npm run build
```

### 2. Start Production Server

```bash
NODE_ENV=production npm start
```

### 3. Serve Static Files

Configure your web server (nginx/apache) to serve the built client files from `client/dist/` and proxy API requests to the Node.js server.

Example nginx configuration:

```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        root /path/to/XeonB/client/dist;
        try_files $uri $uri/ /index.html;
    }

    location /api {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

## SSO Configuration

### OAuth2 Setup

1. Register your application with your OAuth2 provider
2. Get your Client ID and Client Secret
3. Configure in `.env`:

```env
SSO_ENABLED=true
OAUTH2_CLIENT_ID=your-client-id
OAUTH2_CLIENT_SECRET=your-client-secret
OAUTH2_CALLBACK_URL=http://localhost:3000/auth/oauth2/callback
OAUTH2_AUTH_URL=https://your-provider.com/oauth/authorize
OAUTH2_TOKEN_URL=https://your-provider.com/oauth/token
OAUTH2_USER_INFO_URL=https://your-provider.com/oauth/userinfo
```

### SAML Setup

1. Get SAML configuration from your Identity Provider
2. Configure in `.env`:

```env
SAML_ENABLED=true
SAML_ENTRY_POINT=https://your-idp.com/saml/sso
SAML_ISSUER=xeonb-crm
SAML_CALLBACK_URL=http://localhost:3000/auth/saml/callback
SAML_CERT=path/to/cert.pem
```

## Brightly Assetic API Integration

### API Documentation

Refer to Brightly's official documentation:
https://help.brightlysoftware.com/Content/Documentation/Assetic/Integration/Assetic%20REST%20API%20Introduction/REST%20API%20Introduction.html

### Obtaining API Credentials

1. Log in to your Brightly Assetic instance
2. Navigate to Settings > API Keys
3. Generate a new API key
4. Copy the API key to your `.env` file

### Testing API Connection

After configuring your API credentials:

1. Start the application
2. Log in to the web interface
3. Navigate to Assets page
4. Click "Sync from Assetic" to test the connection

## Email Configuration

### Gmail Setup

If using Gmail:

1. Enable 2-factor authentication on your Google account
2. Generate an App Password: https://myaccount.google.com/apppasswords
3. Use the App Password in your `.env` file

### Other SMTP Providers

Configure your SMTP provider's settings:

```env
EMAIL_HOST=smtp.your-provider.com
EMAIL_PORT=587
EMAIL_SECURE=false  # true for port 465, false for others
EMAIL_USER=your-email@example.com
EMAIL_PASSWORD=your-password
```

## Usage

### 1. User Registration

- Navigate to http://localhost:3001
- Click "Register" to create a new account
- Or use SSO login options

### 2. Sync Assets

- Log in and navigate to "Assets"
- Click "Sync from Assetic" to import assets from Brightly Assetic API
- Assets will be stored in your local database

### 3. Generate Reports

- Navigate to "Reports"
- Choose between Asset Reports or Change Reports
- Apply filters as needed
- Generate PDF and download or email it

### 4. Monitor Changes

- Asset changes are automatically tracked when syncing
- View change history for each asset
- Generate change reports for auditing

## API Endpoints

### Authentication

- `POST /api/auth/register` - Register new user
- `POST /api/auth/login` - Login with credentials
- `GET /api/auth/oauth2` - OAuth2 login
- `GET /api/auth/saml` - SAML login
- `GET /api/auth/me` - Get current user info

### Assets

- `GET /api/assets` - List all assets
- `GET /api/assets/:id` - Get specific asset
- `GET /api/assets/:id/changes` - Get asset change history
- `POST /api/assets/sync` - Sync from Assetic API

### Reports

- `POST /api/reports/assets` - Generate asset PDF report
- `POST /api/reports/changes` - Generate change PDF report
- `GET /api/reports/download/:fileName` - Download report
- `POST /api/reports/email` - Send email with attachment

## Troubleshooting

### Database Connection Issues

1. Verify PostgreSQL is running: `pg_isready`
2. Check database credentials in `.env`
3. Ensure database exists: `psql -l`

### Assetic API Connection Issues

1. Verify API credentials are correct
2. Test API endpoint with curl:
   ```bash
   curl -H "Authorization: Bearer YOUR_API_KEY" \
        https://your-instance.brightlysoftware.com/api/v1/assets
   ```
3. Check firewall settings

### Email Sending Issues

1. Verify SMTP credentials
2. Check if port is blocked by firewall
3. For Gmail, ensure App Password is used, not regular password

### Build Issues

1. Clear node_modules and reinstall:

   ```bash
   rm -rf node_modules client/node_modules
   npm install
   cd client && npm install
   ```

2. Clear build cache:
   ```bash
   rm -rf dist client/dist
   npm run build
   ```

## Security Best Practices

1. **Change default JWT secret** in production
2. **Use HTTPS** in production
3. **Restrict database access** to application server only
4. **Regular backups** of the database
5. **Keep dependencies updated**: `npm audit` and `npm update`
6. **Use environment-specific configurations**
7. **Secure API keys** - never commit `.env` to version control

## Support

For issues and questions:

- GitHub Issues: https://github.com/Twiitchter/XeonB/issues
- Brightly Assetic API: https://help.brightlysoftware.com/

## License

ISC
