# ─────────────────────────────────────────────────────────────────────────────
# Stage 1: Build backend TypeScript
# ─────────────────────────────────────────────────────────────────────────────
FROM node:22-alpine AS backend-builder
RUN apk add --no-cache python3 make g++
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

# ─────────────────────────────────────────────────────────────────────────────
# Stage 2: Build frontend React app
# ─────────────────────────────────────────────────────────────────────────────
FROM node:22-alpine AS frontend-builder
WORKDIR /app/site

COPY site/package*.json ./
RUN npm ci

COPY site/ ./
RUN npm run build

# ─────────────────────────────────────────────────────────────────────────────
# Stage 2.5: Production dependencies (with native module compilation)
# ─────────────────────────────────────────────────────────────────────────────
FROM node:22-alpine AS prod-deps
RUN apk add --no-cache python3 make g++
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

# ─────────────────────────────────────────────────────────────────────────────
# Stage 3: Runtime image
# ─────────────────────────────────────────────────────────────────────────────
FROM node:22-alpine AS runtime

# Install docker CLI so Node.js can spawn Python worker containers
RUN apk add --no-cache docker-cli wget

WORKDIR /app

# Copy pre-built production node_modules (native bindings already compiled)
COPY --from=prod-deps /app/node_modules ./node_modules

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
