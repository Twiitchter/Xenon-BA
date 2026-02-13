# XeonB CRM System Architecture

## System Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                           XeonB CRM System                          │
└─────────────────────────────────────────────────────────────────────┘

┌───────────────────┐
│   Web Browser     │
│  (Port 3001)      │
└─────────┬─────────┘
          │
          │ HTTP/HTTPS
          │
          ▼
┌─────────────────────────────────────────────────────────────────────┐
│                         Frontend Layer                               │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │              React Application (Vite)                        │   │
│  │  ┌────────────┐ ┌────────────┐ ┌────────────┐ ┌──────────┐ │   │
│  │  │   Login    │ │ Dashboard  │ │   Assets   │ │ Reports  │ │   │
│  │  │    Page    │ │    Page    │ │    Page    │ │   Page   │ │   │
│  │  └────────────┘ └────────────┘ └────────────┘ └──────────┘ │   │
│  │                                                               │   │
│  │  ┌────────────┐ ┌────────────┐ ┌────────────┐              │   │
│  │  │   Auth     │ │   Asset    │ │   Report   │              │   │
│  │  │  Service   │ │  Service   │ │  Service   │              │   │
│  │  └────────────┘ └────────────┘ └────────────┘              │   │
│  └─────────────────────────────────────────────────────────────┘   │
└────────────────────────────┬────────────────────────────────────────┘
                             │
                             │ REST API
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│                        Backend Layer                                 │
│                   Express Server (Port 3000)                         │
│                                                                      │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │                    API Routes                                 │  │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐                   │  │
│  │  │  /auth   │  │ /assets  │  │ /reports │                   │  │
│  │  └──────────┘  └──────────┘  └──────────┘                   │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                             ▲                                        │
│                             │                                        │
│  ┌──────────────────────────┴────────────────────────────────────┐ │
│  │                    Middleware Layer                            │ │
│  │  ┌───────────────────┐  ┌────────────────────┐               │ │
│  │  │  Authentication   │  │   Input Validation │               │ │
│  │  │  (JWT/Passport)   │  │   Error Handling   │               │ │
│  │  └───────────────────┘  └────────────────────┘               │ │
│  └────────────────────────────────────────────────────────────────┘ │
│                                                                      │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │                    Services Layer                             │  │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐       │  │
│  │  │   Assetic    │  │     PDF      │  │    Email     │       │  │
│  │  │    Client    │  │   Service    │  │   Service    │       │  │
│  │  └──────────────┘  └──────────────┘  └──────────────┘       │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                             │         │                              │
└─────────────────────────────┼─────────┼──────────────────────────────┘
                              │         │
             ┌────────────────┘         └────────────────┐
             │                                           │
             ▼                                           ▼
┌─────────────────────────┐                  ┌─────────────────────┐
│  Brightly Assetic API   │                  │   SMTP Email Server │
│  (External Service)     │                  │    (e.g., Gmail)    │
│                         │                  │                     │
│  • Asset Management     │                  │  • Send Emails      │
│  • Change Tracking      │                  │  • PDF Attachments  │
│  • Asset History        │                  │                     │
└─────────────────────────┘                  └─────────────────────┘

             ▲
             │
             │ Sync & Monitor
             │
┌────────────┴──────────────────────────────────────────────────────┐
│                      Database Layer                                │
│                    PostgreSQL Database                             │
│                                                                    │
│  ┌──────────┐  ┌──────────┐  ┌───────────────┐  ┌─────────────┐ │
│  │  users   │  │  assets  │  │ asset_changes │  │ email_logs  │ │
│  └──────────┘  └──────────┘  └───────────────┘  └─────────────┘ │
│                                                                    │
│  ┌──────────────┐                                                 │
│  │ report_logs  │                                                 │
│  └──────────────┘                                                 │
└────────────────────────────────────────────────────────────────────┘
```

## Authentication Flow

```
┌──────────┐                                    ┌──────────┐
│  Client  │                                    │  Server  │
└────┬─────┘                                    └────┬─────┘
     │                                               │
     │  1. POST /api/auth/login                     │
     │  { username, password }                      │
     ├──────────────────────────────────────────────>
     │                                               │
     │                    2. Validate credentials    │
     │                       (bcrypt password check) │
     │                                               │
     │  3. Return JWT token                          │
     │  { token, user }                              │
     <──────────────────────────────────────────────┤
     │                                               │
     │  4. Store token in localStorage               │
     │                                               │
     │                                               │
     │  5. API Request with token                    │
     │  Authorization: Bearer <token>                │
     ├──────────────────────────────────────────────>
     │                                               │
     │                    6. Verify JWT              │
     │                       Extract user info       │
     │                                               │
     │  7. Return protected resource                 │
     <──────────────────────────────────────────────┤
     │                                               │
```

## SSO Authentication Flow (OAuth2)

```
┌──────────┐          ┌──────────┐          ┌─────────────┐
│  Client  │          │  Server  │          │ OAuth2 IdP  │
└────┬─────┘          └────┬─────┘          └──────┬──────┘
     │                     │                        │
     │  1. Click "SSO Login"                        │
     ├────────────────────>│                        │
     │                     │                        │
     │  2. Redirect to IdP │                        │
     <────────────────────┤                        │
     │                     │                        │
     │  3. Redirect                                 │
     ├─────────────────────────────────────────────>
     │                     │                        │
     │  4. User authenticates                       │
     │                     │                        │
     │  5. Callback with code                       │
     ├────────────────────>│                        │
     │                     │  6. Exchange code      │
     │                     ├───────────────────────>
     │                     │                        │
     │                     │  7. Access token       │
     │                     <───────────────────────┤
     │                     │                        │
     │                     │  8. Get user profile   │
     │                     ├───────────────────────>
     │                     │                        │
     │                     │  9. User info          │
     │                     <───────────────────────┤
     │                     │                        │
     │                     │ 10. Create/update user │
     │                     │     in database        │
     │                     │                        │
     │ 11. Return JWT      │                        │
     <────────────────────┤                        │
     │                     │                        │
```

## Asset Synchronization Flow

```
┌──────────┐          ┌──────────┐          ┌──────────────┐          ┌──────────┐
│  Client  │          │  Server  │          │ Assetic API  │          │ Database │
└────┬─────┘          └────┬─────┘          └──────┬───────┘          └────┬─────┘
     │                     │                        │                       │
     │  1. Click "Sync"    │                        │                       │
     ├────────────────────>│                        │                       │
     │                     │                        │                       │
     │                     │  2. Fetch assets       │                       │
     │                     ├───────────────────────>│                       │
     │                     │                        │                       │
     │                     │  3. Return assets      │                       │
     │                     <───────────────────────┤                       │
     │                     │                        │                       │
     │                     │  4. For each asset     │                       │
     │                     │     Check if exists    │                       │
     │                     ├───────────────────────────────────────────────>
     │                     │                        │                       │
     │                     │  5. Existing data      │                       │
     │                     <───────────────────────────────────────────────┤
     │                     │                        │                       │
     │                     │  6. Compare & detect   │                       │
     │                     │     changes            │                       │
     │                     │                        │                       │
     │                     │  7. Update asset       │                       │
     │                     ├───────────────────────────────────────────────>
     │                     │                        │                       │
     │                     │  8. Log changes        │                       │
     │                     ├───────────────────────────────────────────────>
     │                     │                        │                       │
     │  9. Sync complete   │                        │                       │
     │  { syncedCount,     │                        │                       │
     │    errorCount }     │                        │                       │
     <────────────────────┤                        │                       │
     │                     │                        │                       │
```

## PDF Report Generation Flow

```
┌──────────┐          ┌──────────┐          ┌──────────┐          ┌──────────┐
│  Client  │          │  Server  │          │ Database │          │  Email   │
└────┬─────┘          └────┬─────┘          └────┬─────┘          └────┬─────┘
     │                     │                      │                     │
     │  1. Generate Report │                      │                     │
     │  { filters, email } │                      │                     │
     ├────────────────────>│                      │                     │
     │                     │                      │                     │
     │                     │  2. Fetch data       │                     │
     │                     ├─────────────────────>│                     │
     │                     │                      │                     │
     │                     │  3. Return data      │                     │
     │                     <─────────────────────┤                     │
     │                     │                      │                     │
     │                     │  4. Generate PDF     │                     │
     │                     │     using PDFKit     │                     │
     │                     │                      │                     │
     │                     │  5. Save PDF file    │                     │
     │                     │                      │                     │
     │                     │  6. Log report       │                     │
     │                     ├─────────────────────>│                     │
     │                     │                      │                     │
     │                     │  If email provided:  │                     │
     │                     │                      │                     │
     │                     │  7. Send email with  │                     │
     │                     │     PDF attachment   │                     │
     │                     ├─────────────────────────────────────────────>
     │                     │                      │                     │
     │                     │  8. Log email        │                     │
     │                     ├─────────────────────>│                     │
     │                     │                      │                     │
     │  9. Success response│                      │                     │
     │  { fileName,        │                      │                     │
     │    downloadUrl }    │                      │                     │
     <────────────────────┤                      │                     │
     │                     │                      │                     │
```

## Data Models

### User
```
users
├── id (PK)
├── username (unique)
├── email (unique)
├── password_hash
├── first_name
├── last_name
├── auth_provider (local/oauth2/saml)
├── external_id
├── is_active
├── created_at
└── updated_at
```

### Asset
```
assets
├── id (PK)
├── assetic_id (unique, FK to Assetic)
├── asset_tag
├── description
├── category
├── location
├── status
├── purchase_date
├── purchase_cost
├── current_value
├── data (JSONB - full Assetic data)
├── last_synced_at
├── created_at
└── updated_at
```

### Asset Change
```
asset_changes
├── id (PK)
├── asset_id (FK to assets)
├── change_type
├── field_name
├── old_value
├── new_value
├── changed_by
├── changed_at
├── synced_at
└── created_at
```

## Technology Stack

### Backend
- **Runtime:** Node.js 18+
- **Framework:** Express 4.x
- **Language:** TypeScript 5.x
- **Database:** PostgreSQL 12+
- **ORM/Query:** pg (node-postgres)
- **Authentication:** Passport.js, JWT
- **PDF Generation:** PDFKit
- **Email:** Nodemailer
- **HTTP Client:** Axios
- **Security:** Helmet, bcrypt

### Frontend
- **Framework:** React 18
- **Language:** TypeScript 5.x
- **Build Tool:** Vite 4.x
- **Routing:** React Router 6
- **HTTP Client:** Axios
- **State:** Local component state

### DevOps
- **Package Manager:** npm
- **Process Manager:** PM2 (production)
- **Web Server:** Nginx (production)
- **Containerization:** Docker (optional)
- **Version Control:** Git

## Security Measures

1. **Authentication**
   - Bcrypt password hashing (10 salt rounds)
   - JWT tokens with expiration
   - Secure token storage

2. **API Security**
   - Helmet.js security headers
   - CORS configuration
   - Input validation (express-validator)
   - SQL injection prevention (parameterized queries)

3. **Data Security**
   - Environment variable configuration
   - Sensitive data not logged
   - Secure database connections

4. **Transport Security**
   - HTTPS in production
   - Secure cookies
   - HSTS headers

## Deployment Architecture

```
┌────────────────────────────────────────────────────┐
│                Internet (HTTPS)                    │
└──────────────────┬─────────────────────────────────┘
                   │
                   ▼
┌────────────────────────────────────────────────────┐
│              Nginx (Reverse Proxy)                 │
│  • SSL Termination                                 │
│  • Static file serving                             │
│  • API proxy to backend                            │
└──────────────────┬─────────────────────────────────┘
                   │
         ┌─────────┴─────────┐
         │                   │
         ▼                   ▼
┌──────────────┐    ┌──────────────┐
│   Frontend   │    │   Backend    │
│  (React App) │    │  (Node.js)   │
│              │    │              │
│  Port 3001   │    │  Port 3000   │
└──────────────┘    └──────┬───────┘
                           │
                           ▼
                  ┌────────────────┐
                  │   PostgreSQL   │
                  │    Database    │
                  │                │
                  │   Port 5432    │
                  └────────────────┘
```

## Monitoring and Logging

- **Application Logs:** Console output captured by PM2
- **Access Logs:** Nginx access logs
- **Error Logs:** Nginx error logs + application error handling
- **Database Logs:** PostgreSQL logs
- **Email Logs:** Stored in `email_logs` table
- **Report Logs:** Stored in `report_logs` table
- **Change Logs:** Stored in `asset_changes` table

## Performance Considerations

1. **Database**
   - Indexed columns for fast queries
   - Connection pooling (max 20 connections)
   - Query optimization

2. **API**
   - Pagination for large datasets
   - Efficient data transfer (JSON)
   - Gzip compression

3. **Frontend**
   - Code splitting with Vite
   - Lazy loading routes
   - Optimized bundle size

4. **Caching**
   - Static assets cached by browser
   - API responses can be cached (future enhancement)
