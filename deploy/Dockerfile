# Postpilot API: Express + SQLite + scheduler + ffmpeg video rendering.
# Build from the repository root:  docker build -f deploy/Dockerfile .
FROM node:24-bookworm-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg ca-certificates tini \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app/server
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# The poster renderer is shared with the React client.
COPY shared /app/shared
COPY server /app/server

ENV NODE_ENV=production \
    PORT=4000 \
    DATA_DIR=/app/server/data

# Database, uploads and the voice model cache live on a mounted volume.
VOLUME ["/app/server/data"]
EXPOSE 4000

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "--disable-warning=ExperimentalWarning", "src/index.js"]
