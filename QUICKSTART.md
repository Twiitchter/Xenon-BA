# XeonB CRM - Quick Start Guide

Get up and running with XeonB CRM in 5 minutes!

## Prerequisites

- Node.js 18+ installed
- PostgreSQL 12+ installed
- Git installed

## 1. Clone and Install (2 minutes)

```bash
# Clone the repository
git clone https://github.com/Twiitchter/XeonB.git
cd XeonB

# Install backend dependencies
npm install

# Install frontend dependencies
cd clientnpm
npm install
cd ..
```

## 2. Database Setup (1 minute)

```bash
# Create PostgreSQL database
createdb xeonb_crm

# Or using psql
psql -U postgres
CREATE DATABASE xeonb_crm;
\q
```

## 3. Configuration (1 minute)

```bash
# Copy environment template
cp .env.example .env

# Edit .env with your settings
nano .env  # or your preferred editor
```

**Minimum required configuration:**
```env
# Database
DB_HOST=localhost
DB_NAME=xeonb_crm
DB_USER=postgres
DB_PASSWORD=your_password

# JWT Secret (generate random string)
JWT_SECRET=your-secret-key-min-32-chars

# Assetic API (get from Brightly)
ASSETIC_API_URL=https://your-instance.brightlysoftware.com/api
ASSETIC_API_KEY=your-api-key

# Email (for Gmail)
EMAIL_HOST=smtp.gmail.com
EMAIL_PORT=587
EMAIL_USER=your-email@gmail.com
EMAIL_PASSWORD=your-app-password
```

## 4. Initialize Database (30 seconds)

```bash
npm run migrate
```

## 5. Start Application (30 seconds)

```bash
# Development mode (runs both frontend and backend)
npm run dev
```

The application will be available at:
- **Frontend:** http://localhost:3001
- **Backend API:** http://localhost:3000

## 6. First Login

1. Open http://localhost:3001 in your browser
2. Click "Register" to create an account
3. Fill in your details:
   - Username
   - Email
   - Password (min 8 characters)
   - First Name (optional)
   - Last Name (optional)
4. Click "Register"

You're now logged in!

## 7. Sync Assets from Assetic

1. Navigate to "Assets" page
2. Click "Sync from Assetic" button
3. Wait for synchronization to complete
4. View your assets in the table

## 8. Generate Your First Report

1. Navigate to "Reports" page
2. Choose "Asset Reports" tab
3. Select filters (optional)
4. Click "Generate Report"
5. Report will download automatically

## 9. Send Email with PDF

1. On Reports page
2. Enter an email address in the "Email" field
3. Click "Generate Report"
4. Report will be emailed to the recipient

## Common Commands

```bash
# Development mode (both frontend and backend)
npm run dev

# Run only backend
npm run dev:server

# Run only frontend
npm run dev:client

# Build for production
npm run build

# Start production server
npm start

# Run database migrations
npm run migrate
```

## Troubleshooting

### Database connection failed
```bash
# Check PostgreSQL is running
sudo systemctl status postgresql

# Verify database exists
psql -l
```

### Port already in use
```bash
# Check what's using port 3000
lsof -i :3000

# Kill the process
kill -9 <PID>
```

### NPM install errors
```bash
# Clear cache and reinstall
rm -rf node_modules client/node_modules
npm cache clean --force
npm install
cd client && npm install
```

## Next Steps

- **Configure SSO:** See [INSTALLATION.md](INSTALLATION.md#sso-configuration)
- **Production Deployment:** See [DEPLOYMENT.md](DEPLOYMENT.md)
- **API Reference:** See [API_DOCUMENTATION.md](API_DOCUMENTATION.md)
- **Architecture Overview:** See [ARCHITECTURE.md](ARCHITECTURE.md)

## Documentation Quick Links

| Document | Description |
|----------|-------------|
| [README.md](README.md) | Project overview and features |
| [INSTALLATION.md](INSTALLATION.md) | Detailed installation guide |
| [API_DOCUMENTATION.md](API_DOCUMENTATION.md) | Complete API reference |
| [DEPLOYMENT.md](DEPLOYMENT.md) | Production deployment guide |
| [ARCHITECTURE.md](ARCHITECTURE.md) | System architecture |
| [IMPLEMENTATION_SUMMARY.md](IMPLEMENTATION_SUMMARY.md) | Requirements verification |

## Key Features

✅ **Authentication**
- Username/password login
- OAuth2 SSO
- SAML SSO

✅ **Asset Management**
- Sync from Assetic API
- Track changes automatically
- View history

✅ **Reports**
- Generate PDF reports
- Email with attachments
- Custom filters

✅ **Email**
- Send notifications
- Attach PDF reports
- Track delivery

## Default User Credentials

There are no default credentials. You must register a new account.

## API Testing

You can test the API using curl or Postman:

```bash
# Health check
curl http://localhost:3000/health

# Register user
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"username":"testuser","email":"test@example.com","password":"password123"}'

# Login
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"testuser","password":"password123"}'
```

## Environment Variables Reference

| Variable | Required | Description |
|----------|----------|-------------|
| `PORT` | No | Server port (default: 3000) |
| `NODE_ENV` | No | Environment (development/production) |
| `DB_HOST` | Yes | PostgreSQL host |
| `DB_PORT` | No | PostgreSQL port (default: 5432) |
| `DB_NAME` | Yes | Database name |
| `DB_USER` | Yes | Database user |
| `DB_PASSWORD` | Yes | Database password |
| `JWT_SECRET` | Yes | JWT signing secret |
| `JWT_EXPIRES_IN` | No | Token expiration (default: 24h) |
| `ASSETIC_API_URL` | Yes | Brightly Assetic API URL |
| `ASSETIC_API_KEY` | Yes | Assetic API key |
| `EMAIL_HOST` | Yes | SMTP host |
| `EMAIL_PORT` | Yes | SMTP port |
| `EMAIL_USER` | Yes | SMTP username |
| `EMAIL_PASSWORD` | Yes | SMTP password |

## Support

- **Issues:** https://github.com/Twiitchter/XeonB/issues
- **Brightly API Docs:** https://help.brightlysoftware.com/Content/Documentation/Assetic/Integration/Assetic%20REST%20API%20Introduction/REST%20API%20Introduction.html

## License

ISC
