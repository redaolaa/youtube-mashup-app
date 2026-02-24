# Deploy & GitHub

## Deploying the app

The server needs **Node.js**, **ffmpeg**, and **yt-dlp**. Many app hosts don’t include the last two by default, so you either use a host that supports them or use Docker.

### Option A: Railway (recommended)

1. Go to [railway.app](https://railway.app) and sign in with GitHub.
2. **New Project** → **Deploy from GitHub repo** → choose your repo.
3. Add **ffmpeg** and **yt-dlp**:
   - In the project, add a **nixpacks.toml** at the repo root with:

   ```toml
   [phases.setup]
   nixPkgs = ["nodejs_20", "ffmpeg", "yt-dlp"]
   ```

   Or use a **Dockerfile** (see Option B) and Railway will build from it.

4. **Settings** → set **Root Directory** to blank (or `/`), **Build Command** to `npm run build`, **Start Command** to `npm start` (or `cd server && node index.js`). Railway sets `PORT` automatically.
5. Install deps in build: in **Settings** → Build, you can use **Build Command**: `cd client && npm ci && npm run build && cd ../server && npm ci`. **Start Command**: `cd server && node index.js`. (Adjust if your root `package.json` has a different `start`.)

### Option B: Docker (works on Railway, Render, Fly, etc.)

Add a **Dockerfile** in the repo root so the host installs ffmpeg and yt-dlp. Example:

```dockerfile
FROM node:20-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg python3-pip && pip3 install yt-dlp && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json ./
COPY server/package*.json ./server/
COPY client/package*.json ./client/
RUN cd client && npm ci && npm run build && cd ../server && npm ci
COPY server ./server
COPY client/dist ./client/dist
ENV NODE_ENV=production
EXPOSE 5175
CMD ["node", "server/index.js"]
```

Then set **Start Command** to `node server/index.js` and ensure `PORT` is used (your server already uses `process.env.PORT`).

### Option C: Render

1. [render.com](https://render.com) → New → **Web Service** → connect your GitHub repo.
2. **Environment**: Node.
3. **Build Command**: `npm run build` (and ensure both client and server deps are installed — you may need a root script that runs `cd client && npm ci && npm run build` and `cd server && npm ci`).
4. **Start Command**: `cd server && node index.js` or `npm start`.
5. Render doesn’t install ffmpeg/yt-dlp by default; use a **Docker** deploy or a **Background Worker** with a custom image that includes them.

---

**Summary:** The repo is **not** on GitHub until you create a repo there and run `git remote add origin ...` and `git push`. After that, you can connect the repo to Railway, Render, or another host and deploy; the server must have ffmpeg and yt-dlp available (via Nixpacks, Docker, or the host’s stack).
