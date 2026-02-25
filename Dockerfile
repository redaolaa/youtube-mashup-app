# Render (and others): Node + ffmpeg + yt-dlp so the app can run for others
FROM node:20-bookworm-slim

# Install ffmpeg and yt-dlp (required for YouTube download + mix)
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    ca-certificates \
    curl \
    && curl -sSL https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp \
    && chmod +x /usr/local/bin/yt-dlp \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install deps
COPY package.json ./
COPY server/package*.json ./server/
COPY client/package*.json ./client/
RUN cd client && npm ci && cd ../server && npm ci

# Copy source and build client
COPY client ./client
COPY server ./server
RUN cd client && npm run build

ENV NODE_ENV=production
EXPOSE 5175

# Render sets PORT; server uses process.env.PORT
CMD ["node", "server/index.js"]
