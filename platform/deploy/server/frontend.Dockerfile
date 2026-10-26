FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
ARG PUBLIC_ORIGIN
ENV VITE_API_BASE="" VITE_WIDGET_BASE=$PUBLIC_ORIGIN
RUN npm run build
FROM nginx:1.28-alpine
COPY deploy/server/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 8080
