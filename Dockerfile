# ── Build stage ──────────────────────────────────────────────────────────────
FROM node:24-alpine AS builder

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --prefer-offline

COPY . .
RUN npx ng build --configuration=production

# ── Runtime stage — serve with nginx ─────────────────────────────────────────
FROM nginx:1.27-alpine

COPY --from=builder /app/dist/neteye-frontend/browser /usr/share/nginx/html

# nginx config: serve SPA + reverse-proxy /api and /ws to the center
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
