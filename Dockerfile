# Chronos web: the browser build served by Caddy. All user data stays in the
# visitor's browser; this image only serves static files. See docs/WEB.md.

# The build output is plain static files, so it's built once on the native
# platform even when producing images for other architectures.
FROM --platform=$BUILDPLATFORM docker.io/library/node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY index.html tsconfig.json tsconfig.node.json vite.config.ts ./
COPY public ./public
COPY src ./src
RUN npm run build:web

FROM docker.io/library/caddy:2-alpine
COPY docker/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/dist-web /srv
# Plain HTTP by default; set CHRONOS_ADDRESS to a domain for automatic HTTPS.
ENV CHRONOS_ADDRESS=:80
EXPOSE 80 443 443/udp
