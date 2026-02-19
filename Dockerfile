# ─────────────────────────────────────────────────────────────────────────────
# Stage 1: Build backend TypeScript
# ─────────────────────────────────────────────────────────────────────────────
FROM node:20-alpine AS backend-builder
WORKDIR /app

COPY package*.json ./
RUN npm ci --ignore-scripts

COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

# ─────────────────────────────────────────────────────────────────────────────
# Stage 2: Build frontend React app
# ─────────────────────────────────────────────────────────────────────────────
FROM node:20-alpine AS frontend-builder
WORKDIR /app/site

COPY site/package*.json ./
RUN npm ci

COPY site/ ./
RUN npm run build

# ─────────────────────────────────────────────────────────────────────────────
# Stage 3: Runtime image
# ─────────────────────────────────────────────────────────────────────────────
FROM node:20-alpine AS runtime

# Install docker CLI so Node.js can spawn Python worker containers
RUN apk add --no-cache docker-cli wget

WORKDIR /app

# Production dependencies only
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts

# Copy compiled backend
COPY --from=backend-builder /app/dist ./dist

# Copy compiled frontend SPA
COPY --from=frontend-builder /app/site/dist ./site/dist

# Create runtime directories
RUN mkdir -p /data/reports /app/logs /app/keys

EXPOSE 3000

# Default: run the app server
# Override with: command: ["node", "dist/server/workers/scanWorker.js"]
CMD ["node", "dist/server/app.js"]
