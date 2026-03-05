#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
# XeonB CRM — Codespaces Startup Script
# ═══════════════════════════════════════════════════════════════════════════════
# This script automatically detects if running in Codespaces and starts the
# database service using Docker-in-Docker.
# ═══════════════════════════════════════════════════════════════════════════════

set -e

echo "🚀 Starting XeonB CRM in Codespaces..."

# Check if .env file exists, if not create from example
if [ ! -f .env ]; then
    echo "📝 Creating .env file from .env.example..."
    cp .env.example .env
    # Set default values for Codespaces (works on Linux)
    # Note: These sed commands are Linux-specific
    if command -v sed >/dev/null 2>&1; then
        sed -i 's/DB_HOST=.*/DB_HOST=localhost/' .env 2>/dev/null || true
        sed -i 's/DB_DIALECT=.*/DB_DIALECT=mssql/' .env 2>/dev/null || true
        sed -i 's/DB_PORT=.*/DB_PORT=1433/' .env 2>/dev/null || true
        sed -i 's/DB_USER=.*/DB_USER=sa/' .env 2>/dev/null || true
        sed -i 's/DB_PASSWORD=.*/DB_PASSWORD=YourStrong!Passw0rd/' .env 2>/dev/null || true
    fi
fi

# Start the database container using Docker-in-Docker
echo "🗄️  Starting SQL Server database..."
docker compose -f docker-compose.codespaces.yml up db -d

# Wait for database to be ready
echo "⏳ Waiting for database to be ready..."
sleep 5

# Run migrations
echo "📊 Running database migrations..."
npm run migrate || echo "⚠️  Migration failed. You may need to run 'npm run migrate' manually."

echo "✅ Codespaces environment is ready!"
echo ""
echo "📌 To start the development server, run:"
echo "   npm run dev"
echo ""
echo "📍 The API will be available at: http://localhost:3000"
echo "📍 The client will be available at: http://localhost:3001"
