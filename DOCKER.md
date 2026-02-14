# Docker Development Guide

This project supports running in Docker containers for development, with separate containers for the application (API + React client) and the database.

## Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) installed
- Docker Compose v2+ (included with Docker Desktop)

## Supported Databases

| Database | Dialect Value | Default Port | Docker Image |
|---|---|---|---|
| PostgreSQL | `pg` | 5432 | `postgres:16-alpine` |
| SQL Server | `mssql` | 1433 | `mcr.microsoft.com/mssql/server:2022-latest` |
| MySQL | `mysql` | 3306 | `mysql:8.0` |

---

## Quick Start with Docker (Development)

### 1. Configure Environment

```bash
cp .env.example .env
```

Edit `.env` and set `DB_DIALECT` to your chosen database (`pg`, `mssql`, or `mysql`).

### 2. Start with Docker Compose Profiles

Each database runs under a Docker Compose **profile**. Use the profile matching your `DB_DIALECT`:

#### PostgreSQL (default)

```bash
# Set in .env:
# DB_DIALECT=pg
# DB_HOST=db-postgres
# DB_PORT=5432
# DB_USER=postgres
# DB_PASSWORD=postgres

docker compose -f docker-compose.dev.yml --profile postgres up --build
```

#### SQL Server (MSSQL)

```bash
# Set in .env:
# DB_DIALECT=mssql
# DB_HOST=db-mssql
# DB_PORT=1433
# DB_USER=sa
# DB_PASSWORD=YourStrong!Passw0rd

docker compose -f docker-compose.dev.yml --profile mssql up --build
```

> **Note:** SQL Server requires at least 2GB RAM allocated to Docker.

#### MySQL

```bash
# Set in .env:
# DB_DIALECT=mysql
# DB_HOST=db-mysql
# DB_PORT=3306
# DB_USER=xeonb
# DB_PASSWORD=mysql

docker compose -f docker-compose.dev.yml --profile mysql up --build
```

### 3. Run Migrations

After the containers are running, run the database migration:

```bash
docker compose -f docker-compose.dev.yml exec app npm run migrate
```

### 4. Access the Application

| Service | URL |
|---|---|
| API Server | http://localhost:3000 |
| Vite Dev Server (Client) | http://localhost:3001 |
| Health Check | http://localhost:3000/health |

---

## Stopping

```bash
# Stop containers (preserves data)
docker compose -f docker-compose.dev.yml --profile postgres down

# Stop and delete volumes (reset database)
docker compose -f docker-compose.dev.yml --profile postgres down -v
```

---

## Running Without Docker (Bare Metal)

If you prefer running the database directly on your machine:

### PostgreSQL

```bash
# Install PostgreSQL, then:
createdb xeonb_crm
npm run migrate
npm run dev
```

### SQL Server

```bash
# Install SQL Server or use SQL Server Express
# Create database: CREATE DATABASE xeonb_crm
# Update .env with DB_DIALECT=mssql
npm run migrate
npm run dev
```

### MySQL

```bash
# Install MySQL, then:
mysql -u root -p -e "CREATE DATABASE xeonb_crm"
# Update .env with DB_DIALECT=mysql
npm run migrate
npm run dev
```

---

## Migration Commands

```bash
# Run pending migrations
npm run migrate

# Rollback last migration batch
npm run migrate:rollback
```

---

## Production Docker

For production deployment:

```bash
docker compose up --build -d
```

The production `docker-compose.yml` uses a multi-stage build that compiles TypeScript and bundles the React client. Edit it to uncomment your preferred database service.

---

## Architecture

```
┌─────────────────────────────────┐     ┌──────────────────────────┐
│  App Container                  │     │  DB Container            │
│                                 │     │                          │
│  ┌───────────┐  ┌────────────┐  │     │  PostgreSQL              │
│  │ Express   │  │ Vite Dev   │  │────▶│  — or —                  │
│  │ API :3000 │  │ Server     │  │     │  SQL Server              │
│  │           │  │ :3001      │  │     │  — or —                  │
│  └───────────┘  └────────────┘  │     │  MySQL                   │
│                                 │     │                          │
└─────────────────────────────────┘     └──────────────────────────┘
```
