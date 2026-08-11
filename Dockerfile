# Node 22.13+ required: the DIRECT_SQL_USERS path uses node:sqlite
# (unflagged from 22.13; --experimental-sqlite needed on older 22.x).
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY scripts/cleanup-expired.mjs ./scripts/cleanup-expired.mjs
# Live schema sync (idempotent) — run via: docker compose run --rm thay-auth node scripts/sync-live-schema.mjs
COPY scripts/sync-live-schema.mjs ./scripts/sync-live-schema.mjs
USER node
EXPOSE 3749
CMD ["node", "dist/index.js"]
