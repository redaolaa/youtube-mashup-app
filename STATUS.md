# YouTube Mashup App — What Works & What Doesn’t

## What works

### Server
- **GET /api/video-info?url=…** — Returns video duration for a YouTube URL (uses yt-dlp `--dump-json`). Used to show the trim bar and clip length.
- **POST /api/mashup** — Full pipeline: download audio (yt-dlp → MP3), trim to WAV per clip, gapless mix with crossfade (atrim + adelay + afade + amix), encode final MP3. Returns `filename`, `streamUrl`, `downloadUrl`.
- **Preview mode** — Same as above with `preview: true` and `maxClips` (default 3, max 10). Only processes the first N clips and saves as `preview_mix_*.mp3`.
- **GET /api/stream/:filename** — Streams an existing mashup/preview file (audio/mpeg).
- **GET /api/download/:filename** — Sends the file as a download. Safe filename check so only files in `server/downloads` can be served.
- **YouTube URL handling** — Accepts youtube.com and youtu.be; normalizes and validates.
- **Trim** — `trimToSegment()` trims each download to start/duration and outputs WAV for mixing (avoids MP3 padding between clips).
- **Gapless mix** — `concatWithCrossfade()` uses explicit overlap (adelay + afade + amix) so transitions have no silence.

### Client
- **URL list** — Add/remove rows, paste one or multiple URLs per field (newline/comma separated).
- **Trim bar** — Draggable start/end on each row when duration is available; uses `/api/video-info` for duration.
- **▶ Play** — Opens the YouTube video in a new tab.
- **Overlap (crossfade)** — Input 2500–6000 ms; sent to server and used in the mix.
- **Smart shuffle** — Randomizes clip order (URLs + trim state together); only when 2+ rows.
- **Preview (converts to MP3, then mixes)** — Calls `/api/mashup` with `preview: true` and `maxClips: 5`. Shows loading, then plays the mixed preview in an `<audio>` element (no file download to user).
- **Generate MP3** — Submits full clip list to `/api/mashup` (no preview flag). On success, shows success view with play + download links.
- **Success screen** — In-page audio player + “Download MP3” + “Make another mashup”.
- **Error display** — API errors and validation messages shown on the form.
- **Vite proxy** — `/api` proxied to `http://localhost:5175` so the client talks to the Node server.

---

## What doesn’t work / limitations

### Dependencies (must be installed)
- **yt-dlp** — Required for download and video-info. If missing: “yt-dlp not found” (and 503 from video-info). Install: `brew install yt-dlp`.
- **ffmpeg** — Required for trim and mix. If missing, spawnSync will fail with a system error. Install: `brew install ffmpeg`.
- **Node** — Server uses ES modules and `fluent-ffmpeg`; client uses React + Vite.

### Server / backend
- **No cleanup of old files** — `downloads/` keeps all `clip_*`, `trim_*`, `final_mix_*`, `preview_mix_*` files. Disk can fill up over time.
- **Synchronous download/mix** — All work is sync (spawnSync). Long mashups block the event loop; no job queue or background workers.
- **Single process** — Only one mashup at a time per server; concurrent requests will both run and may contend for resources.
- **ffmpeg failure details** — On filter/encode failure, the code throws a generic “ffmpeg crossfade failed” and does not surface ffmpeg stderr to the client.

### Client / UX
- **Loading during preview/generate** — Same “Generating…” state for both. No distinction like “Building preview…” vs “Generating full mashup…”.
- **Preview = server download** — Preview still downloads and converts clips on the server (first 5); it does not “preview without downloading.”
- **No progress** — No per-clip or percentage progress; user only sees elapsed time and must check server logs for “Downloading clip 1/N”.
- **Form vs state for submit** — “Generate MP3” builds the clip list from the form DOM (`urlInputs` + indices). If React state and DOM get out of sync, wrong data could be sent.

### Edge cases / possible failures
- **Very short clips** — If a clip duration is shorter than the crossfade (2.5–6 s), the mix math still runs; behavior at the boundary (e.g. `overlapStart`) is clamped but could be odd for &lt; 1 s clips.
- **Mono vs stereo** — `adelay` uses `delayMs|delayMs`. For mono input, some ffmpeg builds may expect one value; if you see wrong timing on mono sources, adelay may need to be conditional.
- **YouTube changes / geo-blocking** — yt-dlp can break or return errors for some videos or regions; no special handling beyond showing the error message.
- **Large clip count** — Many clips (e.g. 20+) mean many downloads and a large filter graph; timeouts or memory are possible.

### Not implemented
- **Auth / rate limiting** — Anyone who can hit the server can request mashups; no login or per-user limits.
- **Persistence** — No DB; files are only on disk and identified by filename.
- **Mobile/accessibility** — Trim bar and layout are not tuned for small screens or screen readers.

---

## Quick checklist

| Feature                         | Works | Notes                                      |
|---------------------------------|-------|--------------------------------------------|
| Get video duration              | ✅    | Needs yt-dlp                               |
| Download audio from YouTube     | ✅    | yt-dlp → MP3                               |
| Trim per clip (WAV)             | ✅    | fluent-ffmpeg                              |
| Gapless crossfade mix           | ✅    | atrim + adelay + afade + amix              |
| Generate full MP3               | ✅    | Stream + download links                    |
| Preview (first 5, mixed)        | ✅    | Same pipeline, preview flag                |
| Play in browser                 | ✅    | Success + preview use &lt;audio&gt;          |
| Download MP3 file               | ✅    | Via /api/download/:filename               |
| Smart shuffle order             | ✅    | Client-side only                           |
| Multiple URLs per field         | ✅    | Split by newline/comma                     |
| Cleanup old files               | ❌    | Manual or cron                             |
| Progress indicator (per clip)   | ❌    | Only elapsed time                          |
| Preview without server download | ❌    | Preview still converts on server           |
