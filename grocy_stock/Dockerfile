ARG BUILD_FROM=ghcr.io/home-assistant/amd64-base:latest

# ── Stage 1: Build the React frontend ──────────────────────────────────────
FROM node:20-alpine AS frontend-builder
WORKDIR /app
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ .
RUN npm run build

# ── Stage 2: Runtime image ──────────────────────────────────────────────────
FROM $BUILD_FROM

RUN apk add --no-cache nginx gettext

# Copy the built React app
COPY --from=frontend-builder /app/dist /var/www/html

# Copy configuration templates and startup script
COPY nginx.conf.template /etc/nginx/nginx.conf.template
COPY run.sh /run.sh
RUN chmod a+x /run.sh

EXPOSE 8099

CMD ["/run.sh"]
