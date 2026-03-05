#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
# XeonB CRM — Docker Compose Launcher
# ═══════════════════════════════════════════════════════════════════════════════
# Default behavior:
#   - Always use the three-container dev stack (frontend + backend + mssql)
# Optional behavior:
#   - Pass --codespaces-db to run DB-only mode via docker-compose.codespaces.yml
# ═══════════════════════════════════════════════════════════════════════════════

set -e

if [ "$1" = "--codespaces-db" ]; then
    shift
    COMPOSE_FILE="docker-compose.codespaces.yml"
    echo "🌐 Codespaces DB-only mode"

    if [ "$1" = "up" ]; then
        echo "🐘 Starting database container..."
        docker compose -f "$COMPOSE_FILE" up db -d
        echo "✅ Database started. Run 'npm run dev' to start the application."
    elif [ "$1" = "down" ]; then
        docker compose -f "$COMPOSE_FILE" down "${@:2}"
    else
        docker compose -f "$COMPOSE_FILE" "$@"
    fi
    exit 0
fi

echo "📦 Using three-container dev stack (frontend + backend + mssql)..."

# In Codespaces, another helper DB container may already publish 1433.
# Default to a non-conflicting host port unless explicitly overridden.
if [ -n "$CODESPACES" ] && [ -z "$MSSQL_HOST_PORT" ]; then
    export MSSQL_HOST_PORT=11433
    echo "🛠️  Codespaces detected: using MSSQL host port ${MSSQL_HOST_PORT} to avoid 1433 conflicts"
fi

docker compose -f docker-compose.dev.yml "$@"
