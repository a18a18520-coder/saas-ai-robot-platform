FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY backend/package*.json ./
RUN npm ci
COPY backend/ ./
RUN npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production PORT=3001
WORKDIR /app
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --chown=node:node ops/ragas ./ops/ragas
RUN mkdir -p /app/uploads && chown node:node /app/uploads
USER node
EXPOSE 3001
CMD ["node", "dist/main.js"]

# Optional evaluation image. Select BACKEND_TARGET=ragas in .env and rebuild.
FROM runtime AS ragas
USER root
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-venv \
    && python3 -m venv /opt/ragas \
    && /opt/ragas/bin/pip install --no-cache-dir -r /app/ops/ragas/requirements.txt \
    && rm -rf /var/lib/apt/lists/*
ENV RAGAS_PYTHON=/opt/ragas/bin/python RAGAS_DO_NOT_TRACK=true
USER node
