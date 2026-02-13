# XeonB CRM Deployment Guide

## Deployment Options

This guide covers deployment for various platforms.

## Table of Contents

1. [Docker Deployment](#docker-deployment)
2. [Traditional Server Deployment](#traditional-server-deployment)
3. [Cloud Platform Deployment](#cloud-platform-deployment)
4. [Environment Configuration](#environment-configuration)
5. [Database Setup](#database-setup)
6. [SSL/HTTPS Configuration](#ssl-https-configuration)
7. [Monitoring and Logging](#monitoring-and-logging)

---

## Docker Deployment

### Docker Compose Setup

Create `docker-compose.yml`:

```yaml
version: '3.8'

services:
  postgres:
    image: postgres:15
    environment:
      POSTGRES_DB: xeonb_crm
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: ${DB_PASSWORD}
    volumes:
      - postgres_data:/var/lib/postgresql/data
    networks:
      - xeonb-network
    restart: unless-stopped

  app:
    build: .
    ports:
      - "3000:3000"
    environment:
      NODE_ENV: production
      DB_HOST: postgres
      DB_PORT: 5432
      DB_NAME: xeonb_crm
      DB_USER: postgres
      DB_PASSWORD: ${DB_PASSWORD}
      JWT_SECRET: ${JWT_SECRET}
      ASSETIC_API_URL: ${ASSETIC_API_URL}
      ASSETIC_API_KEY: ${ASSETIC_API_KEY}
      EMAIL_HOST: ${EMAIL_HOST}
      EMAIL_USER: ${EMAIL_USER}
      EMAIL_PASSWORD: ${EMAIL_PASSWORD}
    depends_on:
      - postgres
    networks:
      - xeonb-network
    restart: unless-stopped
    volumes:
      - ./reports:/app/reports

volumes:
  postgres_data:

networks:
  xeonb-network:
    driver: bridge
```

### Dockerfile

Create `Dockerfile`:

```dockerfile
FROM node:18-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY client/package*.json ./client/

# Install dependencies
RUN npm ci
RUN cd client && npm ci

# Copy source code
COPY . .

# Build application
RUN npm run build

FROM node:18-alpine

WORKDIR /app

# Copy built files
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/client/dist ./client/dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package*.json ./

# Create reports directory
RUN mkdir -p /app/reports

EXPOSE 3000

CMD ["npm", "start"]
```

### Deploy with Docker

```bash
# Build and start services
docker-compose up -d

# Run migrations
docker-compose exec app npm run migrate

# View logs
docker-compose logs -f

# Stop services
docker-compose down
```

---

## Traditional Server Deployment

### Prerequisites

- Ubuntu 20.04+ or similar Linux distribution
- Node.js 18+
- PostgreSQL 12+
- Nginx
- SSL certificate

### 1. Server Setup

```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install Node.js
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt install -y nodejs

# Install PostgreSQL
sudo apt install -y postgresql postgresql-contrib

# Install Nginx
sudo apt install -y nginx

# Install PM2 (process manager)
sudo npm install -g pm2
```

### 2. Database Setup

```bash
# Create database
sudo -u postgres psql
CREATE DATABASE xeonb_crm;
CREATE USER xeonb WITH PASSWORD 'your_secure_password';
GRANT ALL PRIVILEGES ON DATABASE xeonb_crm TO xeonb;
\q
```

### 3. Application Setup

```bash
# Clone repository
cd /var/www
sudo git clone https://github.com/Twiitchter/XeonB.git
cd XeonB

# Install dependencies
npm install
cd client && npm install && cd ..

# Configure environment
sudo cp .env.example .env
sudo nano .env
# Edit with your production values

# Build application
npm run build

# Run migrations
npm run migrate

# Start with PM2
pm2 start dist/server.js --name xeonb-crm
pm2 save
pm2 startup
```

### 4. Nginx Configuration

Create `/etc/nginx/sites-available/xeonb`:

```nginx
server {
    listen 80;
    server_name your-domain.com;

    # Redirect to HTTPS
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name your-domain.com;

    ssl_certificate /etc/letsencrypt/live/your-domain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/your-domain.com/privkey.pem;

    # SSL configuration
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_prefer_server_ciphers on;
    ssl_ciphers ECDHE-RSA-AES256-GCM-SHA512:DHE-RSA-AES256-GCM-SHA512;

    # Security headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;

    # Frontend files
    location / {
        root /var/www/XeonB/client/dist;
        try_files $uri $uri/ /index.html;
    }

    # API proxy
    location /api {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }

    # Report downloads
    location /reports {
        alias /var/www/XeonB/reports;
        internal;
    }
}
```

Enable the site:

```bash
sudo ln -s /etc/nginx/sites-available/xeonb /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
```

### 5. SSL Certificate (Let's Encrypt)

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.com
```

---

## Cloud Platform Deployment

### AWS Elastic Beanstalk

1. Install EB CLI:
```bash
pip install awsebcli
```

2. Initialize:
```bash
eb init -p node.js xeonb-crm
```

3. Create environment:
```bash
eb create xeonb-production
```

4. Deploy:
```bash
eb deploy
```

### Heroku

1. Install Heroku CLI and login:
```bash
heroku login
```

2. Create app:
```bash
heroku create xeonb-crm
```

3. Add PostgreSQL:
```bash
heroku addons:create heroku-postgresql:hobby-dev
```

4. Set environment variables:
```bash
heroku config:set JWT_SECRET=your_secret
heroku config:set ASSETIC_API_URL=your_url
heroku config:set ASSETIC_API_KEY=your_key
```

5. Deploy:
```bash
git push heroku main
```

6. Run migrations:
```bash
heroku run npm run migrate
```

### DigitalOcean App Platform

1. Connect your GitHub repository
2. Configure environment variables
3. Set build command: `npm run build`
4. Set run command: `npm start`
5. Add PostgreSQL database
6. Deploy

---

## Environment Configuration

### Production Environment Variables

```env
# Server
NODE_ENV=production
PORT=3000

# Database
DB_HOST=your-db-host
DB_PORT=5432
DB_NAME=xeonb_crm
DB_USER=your-db-user
DB_PASSWORD=your-secure-password

# JWT (use strong random string)
JWT_SECRET=your-production-secret-min-32-chars
JWT_EXPIRES_IN=24h

# Assetic API
ASSETIC_API_URL=https://your-instance.brightlysoftware.com/api
ASSETIC_API_KEY=your-production-api-key
ASSETIC_API_VERSION=v1

# Email
EMAIL_HOST=smtp.your-provider.com
EMAIL_PORT=587
EMAIL_SECURE=false
EMAIL_USER=your-email@domain.com
EMAIL_PASSWORD=your-email-password
EMAIL_FROM=noreply@your-domain.com

# SSO (if enabled)
SSO_ENABLED=true
OAUTH2_CLIENT_ID=your-client-id
OAUTH2_CLIENT_SECRET=your-client-secret
OAUTH2_CALLBACK_URL=https://your-domain.com/api/auth/oauth2/callback
```

### Generating Secure Secrets

```bash
# Generate JWT secret
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

---

## Database Setup

### Backup Strategy

Create backup script `/usr/local/bin/backup-xeonb.sh`:

```bash
#!/bin/bash
BACKUP_DIR="/backups/xeonb"
DATE=$(date +%Y%m%d_%H%M%S)
mkdir -p $BACKUP_DIR

pg_dump -U xeonb xeonb_crm | gzip > $BACKUP_DIR/xeonb_$DATE.sql.gz

# Keep only last 7 days
find $BACKUP_DIR -name "xeonb_*.sql.gz" -mtime +7 -delete
```

Schedule with cron:
```bash
0 2 * * * /usr/local/bin/backup-xeonb.sh
```

### Restore from Backup

```bash
gunzip < /backups/xeonb/xeonb_20240213.sql.gz | psql -U xeonb xeonb_crm
```

---

## Monitoring and Logging

### PM2 Monitoring

```bash
# View logs
pm2 logs xeonb-crm

# Monitor resources
pm2 monit

# Restart application
pm2 restart xeonb-crm
```

### Nginx Logs

```bash
# Access logs
tail -f /var/log/nginx/access.log

# Error logs
tail -f /var/log/nginx/error.log
```

### Application Logs

Configure log rotation `/etc/logrotate.d/xeonb`:

```
/var/www/XeonB/logs/*.log {
    daily
    missingok
    rotate 14
    compress
    delaycompress
    notifempty
    create 0640 www-data www-data
    sharedscripts
}
```

---

## Security Checklist

- [ ] Use HTTPS/SSL certificates
- [ ] Change default JWT secret
- [ ] Use strong database passwords
- [ ] Enable firewall (ufw)
- [ ] Keep dependencies updated
- [ ] Regular security audits (`npm audit`)
- [ ] Implement rate limiting
- [ ] Use environment variables for secrets
- [ ] Regular database backups
- [ ] Monitor application logs
- [ ] Restrict database access
- [ ] Use security headers in Nginx

---

## Troubleshooting

### Application won't start

```bash
# Check PM2 logs
pm2 logs xeonb-crm --err

# Check if port is in use
sudo lsof -i :3000

# Check environment variables
pm2 env 0
```

### Database connection issues

```bash
# Test database connection
psql -U xeonb -d xeonb_crm -h localhost

# Check PostgreSQL status
sudo systemctl status postgresql
```

### Nginx issues

```bash
# Test configuration
sudo nginx -t

# Check error logs
sudo tail -f /var/log/nginx/error.log
```

---

## Performance Optimization

### Database Indexing

Ensure indexes are created (already in schema.sql):
- Asset IDs
- Status and category fields
- Change timestamps

### Caching

Consider implementing Redis for:
- Session storage
- API response caching
- Rate limiting

### CDN

Use a CDN for static assets:
- Frontend JavaScript/CSS bundles
- Images and fonts

---

## Maintenance

### Update Application

```bash
cd /var/www/XeonB
git pull origin main
npm install
cd client && npm install && cd ..
npm run build
pm2 restart xeonb-crm
```

### Database Migration

```bash
npm run migrate
```

### Clear Old Reports

```bash
# Clear reports older than 30 days
find /var/www/XeonB/reports -name "*.pdf" -mtime +30 -delete
```

---

## Support

For deployment issues:
- GitHub Issues: https://github.com/Twiitchter/XeonB/issues
- Check logs for error details
- Verify all environment variables are set correctly
