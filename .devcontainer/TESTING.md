# Testing Docker-in-Docker Setup

This document shows how to test the Docker-in-Docker setup in both local and Codespaces environments.

## Local Environment Testing

### Test 1: Smart Launcher Detection
```bash
# Should detect local environment
./docker-dev.sh ps
# Expected output: "💻 Detected local development environment"
```

### Test 2: Start Services
```bash
# Start with PostgreSQL
./docker-dev.sh up -d

# Check containers are running
docker ps

# Expected: 2 containers running (app + db-postgres)
```

### Test 3: Check Database Profile Selection
```bash
# Test PostgreSQL (default)
DB_DIALECT=pg ./docker-dev.sh config | grep "profile"

# Test MySQL
DB_DIALECT=mysql ./docker-dev.sh config | grep "profile"

# Test MSSQL
DB_DIALECT=mssql ./docker-dev.sh config | grep "profile"
```

### Test 4: Run Migrations
```bash
./docker-dev.sh exec app npm run migrate
# Expected: Migrations should run successfully
```

### Test 5: Stop Services
```bash
./docker-dev.sh down
# Expected: Containers stopped and removed
```

## Codespaces Environment Testing

### Test 1: Environment Detection (Simulated)
```bash
# Simulate Codespaces environment
CODESPACES=true ./docker-dev.sh ps
# Expected output: "🌐 Detected GitHub Codespaces environment"
```

### Test 2: Check Configuration
```bash
# Verify devcontainer.json is valid JSON
cat .devcontainer/devcontainer.json | jq . > /dev/null
echo $?  # Should be 0
```

### Test 3: Check Docker Compose File
```bash
# Validate Codespaces compose file
docker compose -f docker-compose.codespaces.yml config > /dev/null
echo $?  # Should be 0
```

### Test 4: Start Database Only (Codespaces Mode)
```bash
# In Codespaces, only database starts via Docker
CODESPACES=true ./docker-dev.sh up
# Expected: Only db container starts
```

## Manual Testing in Real Codespaces

To test in a real GitHub Codespaces environment:

1. **Create a Codespace**
   - Go to the GitHub repository
   - Click "Code" → "Codespaces" → "Create codespace on main"

2. **Wait for Setup**
   - The devcontainer will build
   - Dependencies will install
   - Database will start automatically
   - Migrations will run

3. **Verify Database**
   ```bash
   # Check database is running
   docker ps
   
   # Should see postgres:16-alpine container
   ```

4. **Start Development Server**
   ```bash
   npm run dev
   ```

5. **Test Ports**
   - Check the "Ports" tab in VS Code
   - Port 3000 should be forwarded (API)
   - Port 3001 should be forwarded (Client)
   - Port 5432 should be available (Database)

6. **Access Application**
   - Click on the forwarded port links
   - API health check: `http://localhost:3000/health`
   - Client: `http://localhost:3001`

## Integration Tests

### Test Database Connection
```bash
# From within the container/codespace
npm run migrate
# Should connect to database and run migrations

# Check database
docker exec $(docker ps -q -f name=db) psql -U postgres -d xeonb_crm -c "\dt"
# Should list tables
```

### Test Environment Variables
```bash
# Check .env was created
cat .env | grep DB_HOST
# In Codespaces: DB_HOST=localhost
# In Docker: DB_HOST=db-postgres
```

## Troubleshooting Tests

### Test 1: Docker-in-Docker Feature
```bash
# In Codespaces, verify Docker is available
docker --version
docker ps
```

### Test 2: Network Connectivity
```bash
# Test database connection
docker run --rm --network host postgres:16-alpine \
  psql -h localhost -U postgres -d xeonb_crm -c "SELECT 1"
```

### Test 3: Volume Persistence
```bash
# Create test data
docker compose -f docker-compose.codespaces.yml exec db \
  psql -U postgres -d xeonb_crm -c "CREATE TABLE test (id INT)"

# Restart database
docker compose -f docker-compose.codespaces.yml restart db

# Check data persists
docker compose -f docker-compose.codespaces.yml exec db \
  psql -U postgres -d xeonb_crm -c "\dt"
```

## Success Criteria

✅ Smart launcher correctly detects environment  
✅ Codespaces mode starts only database container  
✅ Local mode starts both app and database containers  
✅ Database profiles (postgres/mysql/mssql) work correctly  
✅ Migrations run successfully  
✅ Ports are forwarded correctly in Codespaces  
✅ Docker-in-Docker feature is enabled and working  
✅ Volume data persists across container restarts  

## Performance Benchmarks

### Startup Time Comparison

| Environment | Initial Setup | Subsequent Starts |
|-------------|---------------|-------------------|
| Codespaces  | ~2-3 minutes  | ~10 seconds       |
| Local Docker| ~30 seconds   | ~5 seconds        |
| Bare Metal  | ~10 seconds   | ~5 seconds        |

### Resource Usage

| Environment | CPU | Memory | Disk |
|-------------|-----|--------|------|
| Codespaces  | Low | ~2 GB  | ~5 GB |
| Local Docker| Med | ~3 GB  | ~5 GB |
| Bare Metal  | Low | ~1 GB  | ~2 GB |
