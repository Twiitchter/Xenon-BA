# ── Build stage ──────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Install root dependencies
COPY package.json package-lock.json* ./
RUN npm install

# Install client dependencies
COPY client/package.json client/package-lock.json* ./client/
RUN cd client && npm install

# Copy source
COPY tsconfig.json tsconfig.server.json ./
COPY src/ ./src/
COPY client/ ./client/
COPY knexfile.ts ./

# Build server and client
RUN npm run build:server
RUN npm run build:client

# ── Production stage ────────────────────────────────────────────────────────
FROM node:20-alpine AS production

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --omit=dev

# Copy built server
COPY --from=builder /app/dist ./dist

# Copy built client into public folder for static serving
COPY --from=builder /app/client/dist ./public

# Copy migration files (needed at runtime)
COPY --from=builder /app/src/server/database/migrations ./dist/server/database/migrations
COPY --from=builder /app/knexfile.ts ./

# Copy FL parent mapping data (needed at runtime for hierarchy building)
COPY --from=builder /app/src/server/data ./dist/server/data

EXPOSE 3000

CMD ["node", "dist/server/index.js"]
