# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS deps
WORKDIR /app
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

FROM node:22-bookworm-slim
ENV NODE_ENV=production \
    KOLEJKA_HOST=0.0.0.0 \
    KOLEJKA_PORT=5432
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY package.json config.json ./
COPY src ./src
COPY scripts ./scripts
COPY public ./public

RUN mkdir -p /app/data && chown node:node /app/data
USER node

EXPOSE 3000
VOLUME ["/app/data"]

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + process.env.KOLEJKA_PORT + '/api/queue').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "src/index.js"]
