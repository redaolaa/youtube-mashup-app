# YouTube Mashup Generator

React + Express app: paste YouTube links, set clip length and crossfade, then generate one MP3. You can play it in the browser before downloading.

## Requirements

- **Node.js** 18+
- **FFmpeg** (`brew install ffmpeg`)
- **yt-dlp** (`brew install yt-dlp`)

## Setup

```bash
# Backend
cd server
npm install
npm run dev

# In another terminal — frontend
cd client
npm install
npm run dev
```

## Run

1. Start the **server**: `cd server && npm run dev` (runs on http://localhost:5175).
2. Start the **client**: `cd client && npm run dev` (runs on http://localhost:5173).
3. Open http://localhost:5173 and paste YouTube URLs, then click **Generate MP3**.

The Vite dev server proxies `/api` to the Express server, so the React app talks to the backend automatically.

## Deploy (production)

```bash
npm run build          # from repo root — builds client into client/dist
cd server && npm start # serve app + API on PORT (default 5175)
```

The app is **mobile-friendly**. Set `PORT` in the environment if needed; the server serves the React app from `client/dist` when that folder exists.

## YouTube → MP3 conversion (API option)

By default the server uses **yt-dlp** to convert YouTube links to MP3. You can instead use the **Cobalt API** (or any compatible API) by setting:

- **`COBALT_API_URL`** – base URL of the API (e.g. your own Cobalt instance). When set, the server uses this for YouTube → MP3 first and falls back to yt-dlp if the request fails.
- **`COBALT_API_KEY`** – optional; if your instance requires it, set this to your API key (sent as `Authorization: Api-Key <key>`).

Example (optional):

```bash
export COBALT_API_URL=https://your-cobalt-instance.example.com
export COBALT_API_KEY=your-key-if-required
cd server && npm run dev
```

If `COBALT_API_URL` is not set, only yt-dlp is used (no API calls).

## Notes

- Clips are processed in the order you enter the URLs.
- Temp files are stored in `server/downloads/`. You can delete that folder to free space.
- Respect YouTube’s terms of service and copyright when using this app.
