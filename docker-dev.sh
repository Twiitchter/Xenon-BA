#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
# XeonB CRM — Smart Docker Compose Launcher
# ═══════════════════════════════════════════════════════════════════════════════
# This script automatically detects if running in GitHub Codespaces and uses
# the appropriate Docker Compose configuration:
#   - Codespaces: Uses Docker-in-Docker with docker-compose.codespaces.yml
#   - Local Dev: Uses standard two-container setup with docker-compose.dev.yml
# ═══════════════════════════════════════════════════════════════════════════════

set -e

# Detect if running in Codespaces
if [ -n "$CODESPACES" ] || [ -n "$CODESPACE_NAME" ]; then
    echo "🌐 Detected GitHub Codespaces environment"
    echo "📦 Using Docker-in-Docker configuration..."
    COMPOSE_FILE="docker-compose.codespaces.yml"
    
    # In Codespaces, we only start the database via Docker
    # The app runs directly in the devcontainer
    if [ "$1" == "up" ]; then
        echo "🐘 Starting database container..."
        docker compose -f $COMPOSE_FILE up db -d
        echo "✅ Database started. Run 'npm run dev' to start the application."
    elif [ "$1" == "down" ]; then
        docker compose -f $COMPOSE_FILE down "${@:2}"
    else
        docker compose -f $COMPOSE_FILE "$@"
    fi
else
    echo "💻 Detected local development environment"
    echo "📦 Using standard two-container setup..."
    
    # Check if DB_DIALECT is set to determine which profile to use
    if [ -f .env ]; then
        source .env
    fi
    
    # Default to postgres if not set
    DB_DIALECT=${DB_DIALECT:-pg}
    
    # Map dialect to profile
    case "$DB_DIALECT" in
        pg|postgres)
            PROFILE="postgres"
            ;;
        mssql|sqlserver)
            PROFILE="mssql"
            ;;
        mysql)
            PROFILE="mysql"
            ;;
        *)
            echo "⚠️  Unknown DB_DIALECT: $DB_DIALECT, defaulting to postgres"
            PROFILE="postgres"
            ;;
    esac
    
    echo "🗄️  Using database profile: $PROFILE"
    docker compose -f docker-compose.dev.yml --profile $PROFILE "$@"
fi
