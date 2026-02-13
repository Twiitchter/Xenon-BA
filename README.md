# XeonB CRM

A comprehensive Customer Relationship Management system for Brightly's Assetic Asset Management API. Integrating CRM and portal logging and management services for front-end users.

## Features

✅ **Authentication System**
- Simple username/password authentication
- SSO support via OAuth2
- SSO support via SAML
- JWT-based token management

✅ **Brightly Assetic API Integration**
- Middleware API to communicate with Assetic API
- Asset synchronization
- Change tracking and monitoring
- Real-time data updates

✅ **Database Management**
- PostgreSQL database for asset tracking
- Asset change history and audit logs
- Email and report logging
- Optimized indexes for performance

✅ **PDF Report Generation**
- Asset reports with customizable filters
- Change reports for auditing
- Professional PDF formatting
- Automated report generation

✅ **Email Capabilities**
- SMTP email service
- Email with PDF attachments
- Change notifications
- Customizable email templates

## Quick Start

```bash
# Install dependencies
npm install
cd client && npm install && cd ..

# Configure environment
cp .env.example .env
# Edit .env with your configuration

# Run database migrations
npm run migrate

# Start development server
npm run dev
```

The application will be available at:
- Frontend: http://localhost:3001
- Backend API: http://localhost:3000

## Documentation

- [Installation Guide](INSTALLATION.md) - Detailed setup instructions
- [API Reference](INSTALLATION.md#api-endpoints) - Complete API documentation
- [Brightly Assetic API](https://help.brightlysoftware.com/Content/Documentation/Assetic/Integration/Assetic%20REST%20API%20Introduction/REST%20API%20Introduction.html)

## Architecture

```
XeonB/
├── src/server/           # Backend Node.js/Express server
│   ├── routes/          # API routes
│   ├── services/        # Business logic (Assetic, PDF, Email)
│   ├── database/        # Database configuration and migrations
│   ├── config/          # Passport and authentication config
│   └── middleware/      # Authentication middleware
├── client/              # React frontend
│   ├── src/
│   │   ├── pages/      # React pages (Login, Dashboard, Assets, Reports)
│   │   ├── services/   # API service clients
│   │   └── components/ # Reusable React components
└── docs/               # Documentation

```

## Technology Stack

**Backend:**
- Node.js & Express
- TypeScript
- PostgreSQL
- Passport.js (Authentication)
- PDFKit (PDF generation)
- Nodemailer (Email)
- Axios (HTTP client)

**Frontend:**
- React 18
- TypeScript
- Vite (Build tool)
- React Router

## Requirements

- Node.js 18 or higher
- PostgreSQL 12 or higher
- Brightly Assetic API credentials

## License

ISC
