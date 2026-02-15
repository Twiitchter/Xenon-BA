# GitHub Codespaces Support

This repository is configured to work seamlessly with GitHub Codespaces using Docker-in-Docker (DinD).

## What is Docker-in-Docker?

Docker-in-Docker allows you to run Docker containers inside a container. In the context of Codespaces, this means:
- Your development environment runs in a container (the devcontainer)
- You can run Docker commands inside that container
- Database and other services run as sibling containers managed by Docker-in-Docker

## Quick Start with Codespaces

1. **Open in Codespaces**
   - Click the "Code" button on GitHub
   - Select "Codespaces" tab
   - Click "Create codespace on main" (or your branch)

2. **Wait for Setup**
   - The devcontainer will automatically build and configure your environment
   - Dependencies will be installed
   - The database will start automatically
   - Migrations will run automatically

3. **Start Development**
   ```bash
   npm run dev
   ```

4. **Access Your Application**
   - API: Port 3000 will be automatically forwarded
   - Client: Port 3001 will be automatically forwarded
   - Click on the "Ports" tab in VS Code to see forwarded ports

## Architecture in Codespaces

```
┌─────────────────────────────────────────────────────────────┐
│  GitHub Codespaces (Cloud VM)                               │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  Devcontainer (Your Development Environment)         │  │
│  │                                                       │  │
│  │  - Node.js 20                                        │  │
│  │  - TypeScript                                        │  │
│  │  - Docker-in-Docker enabled                          │  │
│  │  - Your code at /workspace                           │  │
│  │                                                       │  │
│  │  ┌─────────────────┐                                 │  │
│  │  │  npm run dev    │  ← You run this to start app   │  │
│  │  │  Express :3000  │                                 │  │
│  │  │  Vite :3001     │                                 │  │
│  │  └─────────────────┘                                 │  │
│  └──────────────────────────────────────────────────────┘  │
│                           │                                 │
│                           │ Docker-in-Docker                │
│                           ▼                                 │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  PostgreSQL Container (Sibling)                      │  │
│  │  postgres:16-alpine                                  │  │
│  │  Port 5432                                           │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

## Local Development vs Codespaces

### Local Development (Two-Container Setup)
```bash
./docker-dev.sh up --build
# Runs: app container + database container side-by-side
```

### Codespaces (Docker-in-Docker)
```bash
./docker-dev.sh up
# Detects Codespaces, only starts database container
# App runs directly in devcontainer with access to DinD
```

The `docker-dev.sh` script automatically detects your environment and uses the appropriate configuration!

## Manual Database Management in Codespaces

If you need to manually manage the database:

```bash
# Start database
docker compose -f docker-compose.codespaces.yml up db -d

# Stop database
docker compose -f docker-compose.codespaces.yml down

# View logs
docker compose -f docker-compose.codespaces.yml logs db

# Reset database (WARNING: deletes all data)
docker compose -f docker-compose.codespaces.yml down -v
```

## Configuration Files

| File | Purpose |
|------|---------|
| `.devcontainer/devcontainer.json` | Codespaces configuration |
| `.devcontainer/start.sh` | Automatic startup script |
| `docker-compose.codespaces.yml` | Docker-in-Docker compose file |
| `docker-dev.sh` | Smart launcher (detects environment) |

## Environment Variables

The startup script automatically creates a `.env` file with defaults for Codespaces:
- `DB_HOST=localhost` (database is accessible on localhost)
- `DB_DIALECT=pg` (PostgreSQL)
- `DB_PORT=5432`
- `DB_USER=postgres`
- `DB_PASSWORD=postgres`

You can modify these values in `.env` after the codespace is created.

## Troubleshooting

### Database Connection Issues
```bash
# Check if database is running
docker ps

# View database logs
docker compose -f docker-compose.codespaces.yml logs db

# Restart database
docker compose -f docker-compose.codespaces.yml restart db
```

### Port Forwarding Issues
- Check the "Ports" tab in VS Code
- Make sure ports 3000, 3001, and 5432 are forwarded
- Try making the port "Public" if you need to share it

### Docker-in-Docker Not Working
```bash
# Check Docker is available
docker --version

# Check Docker daemon is running
docker ps

# If issues persist, rebuild the codespace
```

## Benefits of This Setup

✅ **Automatic Setup**: Everything configures itself when you open Codespaces  
✅ **Consistent Environment**: Same setup for all developers  
✅ **No Local Dependencies**: No need to install Docker, Node, PostgreSQL locally  
✅ **Fast Startup**: Codespaces start in seconds  
✅ **Free Tier Available**: GitHub provides free Codespaces hours  
✅ **Seamless Local Dev**: Same codebase works locally with `./docker-dev.sh`  

## Switching Between Codespaces and Local Development

The repository works seamlessly in both environments:

1. **Clone the repo locally**
   ```bash
   git clone https://github.com/Twiitchter/XeonB.git
   cd XeonB
   ```

2. **Use the smart launcher**
   ```bash
   # Detects your environment automatically
   ./docker-dev.sh up --build
   ```

3. **Or open in Codespaces**
   - Just click "Open in Codespaces" on GitHub
   - Everything sets up automatically

No configuration changes needed! 🎉
