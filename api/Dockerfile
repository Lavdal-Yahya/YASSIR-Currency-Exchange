# Multi-stage: build with dev deps, run with only prod deps + prisma
# client. Node 20-slim keeps the final image small without giving up
# glibc (native argon2 refuses to compile against musl reliably).

FROM node:20-slim AS deps
WORKDIR /app

# Root workspace bootstrapping: copy the manifests only, so `npm ci`
# is cached until a dep actually changes.
COPY package.json package-lock.json ./
COPY api/package.json ./api/package.json
COPY web/package.json ./web/package.json
RUN npm ci --workspaces --include-workspace-root

FROM deps AS build
WORKDIR /app
COPY tsconfig.base.json ./
COPY api ./api
RUN npm --workspace api run prisma:generate
RUN npm --workspace api run build

FROM node:20-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
# Copy the *production* node_modules — reinstalling with --omit=dev
# would drop the prisma engines picked up at build time.
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/api/dist ./api/dist
COPY --from=build /app/api/prisma ./api/prisma
COPY --from=build /app/api/package.json ./api/package.json
COPY --from=build /app/package.json ./package.json

WORKDIR /app/api
EXPOSE 3000
# migrate deploy is idempotent; runs any pending migrations then boots.
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main.js"]
