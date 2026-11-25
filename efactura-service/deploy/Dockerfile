# Build once, run anywhere the client happens to be: OCI Container Instances,
# OKE, plain Docker on Ubuntu, or Docker Desktop on Windows.
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts && cp -R node_modules /runtime_modules
RUN npm ci --ignore-scripts
COPY tsconfig.json ./
COPY src ./src
COPY mock ./mock
RUN npx tsc -p tsconfig.json

FROM node:22-alpine
# node-oracledb runs in thin mode, so there is no Instant Client to install and
# the image stays small and architecture-independent.
ENV NODE_ENV=production
WORKDIR /app
RUN addgroup -S efactura && adduser -S efactura -G efactura
COPY --from=build /runtime_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
COPY config ./config
COPY sql ./sql
USER efactura
EXPOSE 8090
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD wget -qO- http://127.0.0.1:8090/efactura/v1/health || exit 1
CMD ["node", "dist/src/main.js"]
