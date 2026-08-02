# Vite builds static files; nginx serves them. Traefik terminates TLS
# in front of this — nginx here is plain HTTP inside the docker network.

FROM node:20-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY api/package.json ./api/package.json
COPY web/package.json ./web/package.json
RUN npm ci --workspaces --include-workspace-root

FROM deps AS build
WORKDIR /app
COPY tsconfig.base.json ./
COPY web ./web
RUN npm --workspace web run build

FROM nginx:1.27-alpine AS runtime
COPY web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/web/dist /usr/share/nginx/html
EXPOSE 80
