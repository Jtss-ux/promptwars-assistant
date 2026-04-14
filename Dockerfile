# ── Stage 1: Install production dependencies ──────────────
FROM node:20-slim AS builder

WORKDIR /usr/src/app

COPY package*.json ./
RUN npm ci --production && npm cache clean --force

# ── Stage 2: Production image ─────────────────────────────
FROM node:20-slim

WORKDIR /usr/src/app

# Copy only production node_modules from builder
COPY --from=builder /usr/src/app/node_modules ./node_modules

# Bundle application source
COPY package*.json ./
COPY server.js ./
COPY public/ ./public/

# Run as non-root user for security (CIS Benchmark)
USER node

EXPOSE 8080
ENV PORT=8080
ENV NODE_ENV=production

# Cloud Run health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:8080/health').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))"

CMD ["node", "server.js"]
