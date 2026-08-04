# ─────────────────────────────────────────────────────────────────────────────
# Stage 1: Build backend TypeScript
# ─────────────────────────────────────────────────────────────────────────────
FROM node:24-alpine AS backend-builder
RUN apk add --no-cache python3 make g++ && ln -sf /usr/bin/python3 /usr/bin/python
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build
# tsc only compiles .ts files — copy migration SQL/meta files so Drizzle can find them at runtime
RUN if [ -d src/db/migrations ]; then cp -r src/db/migrations dist/db/migrations; fi

# ─────────────────────────────────────────────────────────────────────────────
# Stage 2: Build frontend React app
# ─────────────────────────────────────────────────────────────────────────────
FROM node:24-alpine AS frontend-builder
WORKDIR /app/site

COPY site/package*.json ./
RUN npm ci

COPY site/ ./
RUN npm run build

# ─────────────────────────────────────────────────────────────────────────────
# Stage 2.5: Production dependencies (with native module compilation)
# ─────────────────────────────────────────────────────────────────────────────
FROM node:24-alpine AS prod-deps
RUN apk add --no-cache python3 make g++ && ln -sf /usr/bin/python3 /usr/bin/python
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

# ─────────────────────────────────────────────────────────────────────────────
# Stage 3: Runtime image
# ─────────────────────────────────────────────────────────────────────────────
FROM node:24-alpine AS runtime

# docker CLI so Node.js can spawn Python worker containers (over the socket
# proxy, not a mounted socket); su-exec to drop privileges in the entrypoint.
RUN apk add --no-cache docker-cli wget su-exec

# Non-root runtime user.
RUN addgroup -S eart && adduser -S -G eart -H eart

WORKDIR /app

# package.json is needed at runtime so Node.js sees "type": "module"
COPY package.json ./

# Copy pre-built production node_modules (native bindings already compiled)
COPY --from=prod-deps /app/node_modules ./node_modules

# Copy compiled backend
COPY --from=backend-builder /app/dist ./dist

# Copy compiled frontend SPA
COPY --from=frontend-builder /app/site/dist ./site/dist

# Entrypoint fixes volume ownership then drops to the eart user.
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# Create runtime directories owned by the runtime user
RUN mkdir -p /data/reports /app/logs && chown -R eart:eart /data /app/logs

EXPOSE 3000

# The entrypoint drops to the non-root `eart` user before running the CMD.
ENTRYPOINT ["docker-entrypoint.sh"]

# Default: run the app server
# Override with: command: ["node", "dist/server/workers/scanWorker.js"]
CMD ["node", "dist/server/app.js"]
