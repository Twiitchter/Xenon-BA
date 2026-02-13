# XeonB CRM API Documentation

## Base URL

```
http://localhost:3000/api
```

## Authentication

Most endpoints require authentication using JWT tokens. Include the token in the Authorization header:

```
Authorization: Bearer <your-jwt-token>
```

---

## Authentication Endpoints

### Register User

Create a new user account.

**Endpoint:** `POST /auth/register`

**Body:**
```json
{
  "username": "johndoe",
  "email": "john@example.com",
  "password": "securepassword123",
  "firstName": "John",
  "lastName": "Doe"
}
```

**Response:**
```json
{
  "user": {
    "id": 1,
    "username": "johndoe",
    "email": "john@example.com",
    "firstName": "John",
    "lastName": "Doe"
  },
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

**Status Codes:**
- `201` - User created successfully
- `400` - Validation error
- `409` - Username or email already exists
- `500` - Server error

---

### Login

Authenticate with username and password.

**Endpoint:** `POST /auth/login`

**Body:**
```json
{
  "username": "johndoe",
  "password": "securepassword123"
}
```

**Response:**
```json
{
  "user": {
    "id": 1,
    "username": "johndoe",
    "email": "john@example.com",
    "firstName": "John",
    "lastName": "Doe"
  },
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

**Status Codes:**
- `200` - Login successful
- `401` - Invalid credentials
- `500` - Server error

---

### OAuth2 Login

Initiate OAuth2 SSO login flow.

**Endpoint:** `GET /auth/oauth2`

**Response:**
Redirects to OAuth2 provider's login page.

---

### OAuth2 Callback

OAuth2 callback endpoint (handled automatically).

**Endpoint:** `GET /auth/oauth2/callback`

**Response:**
Redirects to frontend with token in URL.

---

### SAML Login

Initiate SAML SSO login flow.

**Endpoint:** `GET /auth/saml`

**Response:**
Redirects to SAML Identity Provider.

---

### SAML Callback

SAML callback endpoint (handled automatically).

**Endpoint:** `POST /auth/saml/callback`

**Response:**
```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": { ... }
}
```

---

### Get Current User

Get information about the currently authenticated user.

**Endpoint:** `GET /auth/me`

**Headers:**
```
Authorization: Bearer <token>
```

**Response:**
```json
{
  "id": 1,
  "username": "johndoe",
  "email": "john@example.com",
  "firstName": "John",
  "lastName": "Doe"
}
```

**Status Codes:**
- `200` - Success
- `401` - Not authenticated
- `404` - User not found

---

## Asset Endpoints

All asset endpoints require authentication.

### List Assets

Get a list of assets from the local database.

**Endpoint:** `GET /assets`

**Query Parameters:**
- `status` (optional) - Filter by status
- `category` (optional) - Filter by category
- `limit` (optional) - Number of results (default: 100)
- `offset` (optional) - Pagination offset (default: 0)

**Example:**
```
GET /assets?status=Active&category=Equipment&limit=50
```

**Response:**
```json
{
  "assets": [
    {
      "id": 1,
      "assetic_id": "AST-001",
      "asset_tag": "EQ-12345",
      "description": "Laptop Computer",
      "category": "Equipment",
      "location": "Office Building A",
      "status": "Active",
      "purchase_date": "2023-01-15",
      "purchase_cost": 1200.00,
      "current_value": 800.00,
      "last_synced_at": "2024-02-13T10:30:00Z",
      "created_at": "2024-01-01T00:00:00Z",
      "updated_at": "2024-02-13T10:30:00Z"
    }
  ],
  "total": 1
}
```

**Status Codes:**
- `200` - Success
- `401` - Not authenticated
- `500` - Server error

---

### Get Asset

Get details of a specific asset.

**Endpoint:** `GET /assets/:id`

**Parameters:**
- `id` - Asset ID (integer)

**Response:**
```json
{
  "id": 1,
  "assetic_id": "AST-001",
  "asset_tag": "EQ-12345",
  "description": "Laptop Computer",
  "category": "Equipment",
  "location": "Office Building A",
  "status": "Active",
  "purchase_date": "2023-01-15",
  "purchase_cost": 1200.00,
  "current_value": 800.00,
  "data": { ... },
  "last_synced_at": "2024-02-13T10:30:00Z",
  "created_at": "2024-01-01T00:00:00Z",
  "updated_at": "2024-02-13T10:30:00Z"
}
```

**Status Codes:**
- `200` - Success
- `401` - Not authenticated
- `404` - Asset not found
- `500` - Server error

---

### Get Asset Changes

Get the change history for a specific asset.

**Endpoint:** `GET /assets/:id/changes`

**Parameters:**
- `id` - Asset ID (integer)

**Query Parameters:**
- `limit` (optional) - Number of results (default: 50)
- `offset` (optional) - Pagination offset (default: 0)

**Response:**
```json
{
  "changes": [
    {
      "id": 1,
      "asset_id": 1,
      "change_type": "update",
      "field_name": "location",
      "old_value": "Office Building A",
      "new_value": "Office Building B",
      "changed_by": "system",
      "changed_at": "2024-02-13T10:30:00Z",
      "synced_at": "2024-02-13T10:35:00Z"
    }
  ],
  "total": 1
}
```

**Status Codes:**
- `200` - Success
- `401` - Not authenticated
- `500` - Server error

---

### Sync Assets

Synchronize assets from Brightly Assetic API to the local database.

**Endpoint:** `POST /assets/sync`

**Response:**
```json
{
  "message": "Sync completed",
  "syncedCount": 150,
  "errorCount": 2,
  "total": 152
}
```

**Status Codes:**
- `200` - Sync completed
- `401` - Not authenticated
- `500` - Server error

---

## Report Endpoints

All report endpoints require authentication.

### Generate Asset Report

Generate a PDF report for assets.

**Endpoint:** `POST /reports/assets`

**Body:**
```json
{
  "status": "Active",
  "category": "Equipment",
  "email": "recipient@example.com"
}
```

**Fields:**
- `status` (optional) - Filter assets by status
- `category` (optional) - Filter assets by category
- `email` (optional) - Email address to send the report to

**Response (without email):**
```json
{
  "message": "Report generated successfully",
  "fileName": "asset-report-1676289600000.pdf",
  "downloadUrl": "/api/reports/download/asset-report-1676289600000.pdf"
}
```

**Response (with email):**
```json
{
  "message": "Report generated and emailed successfully",
  "fileName": "asset-report-1676289600000.pdf"
}
```

**Status Codes:**
- `200` - Report generated
- `401` - Not authenticated
- `500` - Server error

---

### Generate Change Report

Generate a PDF report for asset changes.

**Endpoint:** `POST /reports/changes`

**Body:**
```json
{
  "assetId": 1,
  "startDate": "2024-01-01",
  "endDate": "2024-02-13",
  "email": "recipient@example.com"
}
```

**Fields:**
- `assetId` (optional) - Filter by specific asset
- `startDate` (optional) - Start date for changes (ISO 8601)
- `endDate` (optional) - End date for changes (ISO 8601)
- `email` (optional) - Email address to send the report to

**Response:**
Similar to asset report response.

**Status Codes:**
- `200` - Report generated
- `401` - Not authenticated
- `500` - Server error

---

### Download Report

Download a generated report file.

**Endpoint:** `GET /reports/download/:fileName`

**Parameters:**
- `fileName` - Name of the report file

**Response:**
Binary PDF file download.

**Status Codes:**
- `200` - File downloaded
- `401` - Not authenticated
- `404` - File not found
- `500` - Server error

---

### Send Email

Send an email with optional PDF attachment.

**Endpoint:** `POST /reports/email`

**Body:**
```json
{
  "to": "recipient@example.com",
  "subject": "Asset Report",
  "body": "<h1>Asset Report</h1><p>Please find attached...</p>",
  "attachmentFileName": "asset-report-1676289600000.pdf"
}
```

**Fields:**
- `to` (required) - Recipient email address
- `subject` (required) - Email subject
- `body` (required) - Email body (HTML or plain text)
- `attachmentFileName` (optional) - Name of PDF file to attach

**Response:**
```json
{
  "message": "Email sent successfully"
}
```

**Status Codes:**
- `200` - Email sent
- `400` - Validation error
- `401` - Not authenticated
- `500` - Server error

---

## Maintenance Endpoints

All maintenance endpoints require authentication.

### List Maintenance Requests

Get a list of maintenance requests.

**Endpoint:** `GET /maintenance/requests`

**Query Parameters:**
- `status` (optional) - Filter by status (`open`, `in_progress`, `completed`, `cancelled`)
- `priority` (optional) - Filter by priority (`low`, `medium`, `high`, `critical`)
- `limit` (optional) - Number of results (default: 100)
- `offset` (optional) - Pagination offset (default: 0)

**Response:**
```json
{
  "requests": [
    {
      "id": 1,
      "asset_id": 5,
      "requested_by": 1,
      "requested_by_username": "johndoe",
      "title": "Broken pipe in restroom",
      "description": "Water leaking from ceiling pipe.",
      "priority": "high",
      "status": "open",
      "category": "Plumbing",
      "location": "Building A, Floor 2",
      "created_at": "2024-02-13T10:30:00Z",
      "updated_at": "2024-02-13T10:30:00Z"
    }
  ],
  "total": 1
}
```

---

### Get Maintenance Request

Get details of a specific maintenance request.

**Endpoint:** `GET /maintenance/requests/:id`

**Parameters:**
- `id` - Maintenance request ID (integer)

**Status Codes:**
- `200` - Success
- `404` - Request not found

---

### Create Maintenance Request

Log a new maintenance request.

**Endpoint:** `POST /maintenance/requests`

**Body:**
```json
{
  "title": "Broken pipe in restroom",
  "description": "Water leaking from ceiling pipe.",
  "priority": "high",
  "category": "Plumbing",
  "location": "Building A, Floor 2",
  "assetId": 5
}
```

**Fields:**
- `title` (required) - Short summary
- `description` (optional) - Full details
- `priority` (optional) - `low`, `medium` (default), `high`, `critical`
- `category` (optional) - Maintenance category
- `location` (optional) - Physical location
- `assetId` (optional) - Related asset ID

**Status Codes:**
- `201` - Created
- `400` - Validation error

---

### Update Maintenance Request

Update an existing maintenance request.

**Endpoint:** `PUT /maintenance/requests/:id`

**Body:**
```json
{
  "status": "in_progress",
  "priority": "critical"
}
```

**Fields:**
- `title` (optional)
- `description` (optional)
- `priority` (optional) - `low`, `medium`, `high`, `critical`
- `status` (optional) - `open`, `in_progress`, `completed`, `cancelled`
- `category` (optional)
- `location` (optional)

**Status Codes:**
- `200` - Updated
- `404` - Request not found
- `400` - Validation error

---

### List Work Orders

Get a list of work orders.

**Endpoint:** `GET /maintenance/work-orders`

**Query Parameters:**
- `status` (optional) - Filter by status (`pending`, `in_progress`, `completed`, `cancelled`)
- `craft` (optional) - Filter by craft/trade
- `limit` (optional) - Number of results (default: 100)
- `offset` (optional) - Pagination offset (default: 0)

**Response:**
```json
{
  "workOrders": [
    {
      "id": 1,
      "request_id": 1,
      "assigned_to": 3,
      "assigned_to_username": "plumber1",
      "craft": "Plumbing",
      "title": "Fix broken pipe",
      "description": "Replace ceiling pipe section in restroom.",
      "priority": "high",
      "status": "in_progress",
      "scheduled_date": "2024-02-15",
      "completed_at": null,
      "request_title": "Broken pipe in restroom",
      "created_at": "2024-02-13T11:00:00Z",
      "updated_at": "2024-02-13T11:00:00Z"
    }
  ],
  "total": 1
}
```

---

### Get Work Order

Get details of a specific work order.

**Endpoint:** `GET /maintenance/work-orders/:id`

**Parameters:**
- `id` - Work order ID (integer)

**Status Codes:**
- `200` - Success
- `404` - Work order not found

---

### Create Work Order

Create a work order from a maintenance request.

**Endpoint:** `POST /maintenance/work-orders`

**Body:**
```json
{
  "requestId": 1,
  "title": "Fix broken pipe",
  "description": "Replace ceiling pipe section in restroom.",
  "priority": "high",
  "craft": "Plumbing",
  "assignedTo": 3,
  "scheduledDate": "2024-02-15"
}
```

**Fields:**
- `requestId` (required) - ID of the maintenance request
- `title` (required) - Work order title
- `description` (optional)
- `priority` (optional) - `low`, `medium` (default), `high`, `critical`
- `craft` (optional) - Craft/trade to assign
- `assignedTo` (optional) - User ID of the assignee
- `scheduledDate` (optional) - Scheduled date (ISO 8601)

**Status Codes:**
- `201` - Created (also sets maintenance request status to `in_progress`)
- `400` - Validation error
- `404` - Maintenance request not found

---

### Update Work Order

Update a work order (status, craft assignment, etc.).

**Endpoint:** `PUT /maintenance/work-orders/:id`

**Body:**
```json
{
  "status": "completed",
  "craft": "Plumbing"
}
```

**Fields:**
- `title` (optional)
- `description` (optional)
- `priority` (optional) - `low`, `medium`, `high`, `critical`
- `status` (optional) - `pending`, `in_progress`, `completed`, `cancelled`
- `craft` (optional) - Craft/trade
- `assignedTo` (optional) - User ID
- `scheduledDate` (optional) - ISO 8601 date

**Notes:**
- Setting status to `completed` automatically sets the parent maintenance request status to `completed`

**Status Codes:**
- `200` - Updated
- `404` - Work order not found
- `400` - Validation error

---

### Get Work Order Messages

Get messages for a work order (communication between users and maintenance teams).

**Endpoint:** `GET /maintenance/work-orders/:id/messages`

**Parameters:**
- `id` - Work order ID (integer)

**Query Parameters:**
- `limit` (optional) - Number of results (default: 50)
- `offset` (optional) - Pagination offset (default: 0)

**Response:**
```json
{
  "messages": [
    {
      "id": 1,
      "work_order_id": 1,
      "sender_id": 1,
      "sender_username": "johndoe",
      "message": "Can you provide an ETA?",
      "created_at": "2024-02-13T12:00:00Z"
    }
  ],
  "total": 1
}
```

---

### Send Work Order Message

Add a message to a work order.

**Endpoint:** `POST /maintenance/work-orders/:id/messages`

**Parameters:**
- `id` - Work order ID (integer)

**Body:**
```json
{
  "message": "We will be there by 3pm."
}
```

**Fields:**
- `message` (required) - Message text

**Status Codes:**
- `201` - Message created
- `400` - Validation error
- `404` - Work order not found

---

### List Crafts

Get a list of crafts/trades used in work orders.

**Endpoint:** `GET /maintenance/crafts`

**Response:**
```json
{
  "crafts": ["Electrical", "HVAC", "Plumbing"]
}
```

**Status Codes:**
- `200` - Success

---

## Error Response Format

All error responses follow this format:

```json
{
  "error": {
    "message": "Error description",
    "status": 400
  }
}
```

Or for validation errors:

```json
{
  "errors": [
    {
      "field": "email",
      "message": "Invalid email format"
    }
  ]
}
```

---

## Rate Limiting

Currently, there are no rate limits implemented. Consider implementing rate limiting in production.

---

## Health Check

Check if the API is running.

**Endpoint:** `GET /health`

**Response:**
```json
{
  "status": "ok",
  "timestamp": "2024-02-13T10:30:00.000Z"
}
```

---

## Notes

- All timestamps are in ISO 8601 format (UTC)
- All monetary values are in decimal format
- The API uses JSON for both requests and responses
- Authentication tokens expire after 24 hours (configurable)
- File uploads are not currently supported for asset images
- PDF reports are stored temporarily on the server
