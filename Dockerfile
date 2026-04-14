# ── Stage 1: Install production dependencies ──────────────
FROM node:20-slim AS deps

WORKDIR /usr/src/app

COPY package.json ./
RUN npm install --production --no-audit --no-fund && npm cache clean --force

# ── Stage 2: Lean production image ────────────────────────
FROM node:20-slim AS runner

WORKDIR /usr/src/app

# Copy only production node_modules from deps stage
COPY --from=deps /usr/src/app/node_modules ./node_modules

# Bundle application source (no dev files)
COPY package.json ./
COPY server.js ./
COPY public/ ./public/

# Non-root user for container security (principle of least privilege)
USER node

ENV PORT=8080
ENV NODE_ENV=production

EXPOSE 8080

CMD ["node", "server.js"]
