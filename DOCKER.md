# Docker Development Guide

Development runs as three separate containers:

- `frontend` (Vite on port `3001`)
- `backend` (Express API on port `3000`)
- `mssql` (SQL Server on port `1433`)

## Quick Start

```bash
# Start all 3 containers
./docker-dev.sh up --build

# View logs
./docker-dev.sh logs -f

# Stop containers
./docker-dev.sh down
```

## Environment

Create your env file if needed:

```bash
cp .env.example .env
```

Ensure these values are set:

```bash
DB_DIALECT=mssql
DB_PASSWORD=YourStrong!Passw0rd
```

Optional if host port `1433` is already in use:

```bash
MSSQL_HOST_PORT=11433
```

In GitHub Codespaces, `docker-dev.sh` now defaults to `MSSQL_HOST_PORT=11433`
automatically (unless you override it) to avoid collisions with the
Codespaces helper DB container that can already reserve `1433`.

Notes:

- `DB_HOST` in `.env` can stay as `localhost` for bare-metal development.
- In Docker, `docker-compose.dev.yml` overrides DB host to `mssql` for the backend container.
- SQL Server requires a strong SA password and enough Docker memory (2GB+ recommended).

## Direct Compose Commands

```bash
# Start stack
docker compose -f docker-compose.dev.yml up --build

# Run migrations manually (usually handled on backend startup)
docker compose -f docker-compose.dev.yml exec backend npm run migrate

# Stop stack
docker compose -f docker-compose.dev.yml down

# Stop and reset DB volume
docker compose -f docker-compose.dev.yml down -v
```

## Endpoints

- Frontend: `http://localhost:3001`
- Backend API: `http://localhost:3000`
- DB health: `http://localhost:3000/api/health/db`
- SQL Server: `localhost:${MSSQL_HOST_PORT:-11433}`

## Codespaces

Codespaces uses `docker-compose.codespaces.yml` and starts the database container separately while the app runs in the devcontainer shell. See `CODESPACES.md`.

## Architecture

```text
Frontend (3001) --/api proxy--> Backend (3000) --> MSSQL (1433)
```
