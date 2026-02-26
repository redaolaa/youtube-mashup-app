import express from "express";
import cors from "cors";
import { spawnSync, execSync } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";
import { fileURLToPath } from "url";
import { v4 as uuidv4 } from "uuid";
import ffmpeg from "fluent-ffmpeg";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const DOWNLOAD_DIR = path.join(__dirname, "downloads");
if (!fs.existsSync(DOWNLOAD_DIR)) {
  fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });
}

function cleanupOldFiles() {
  try {
    const maxAgeMs = 2 * 60 * 60 * 1000;
    const now = Date.now();
    for (const name of fs.readdirSync(DOWNLOAD_DIR)) {
      const full = path.join(DOWNLOAD_DIR, name);
      try {
        if (name.startsWith("preview_mix_") && name.endsWith(".mp3")) fs.unlinkSync(full);
        else if ((name.startsWith("clip_") && name.endsWith(".mp3")) || (name.startsWith("trim_") && name.endsWith(".wav"))) fs.unlinkSync(full);
        else if (name.startsWith("final_mix_") && name.endsWith(".mp3")) {
          const stat = fs.statSync(full);
          if (now - stat.mtimeMs > maxAgeMs) fs.unlinkSync(full);
        }
      } catch (_) {}
    }
  } catch (_) {}
}
cleanupOldFiles();

app.use(cors());
app.use(express.json());

app.get("/api/health", (req, res) => {
  res.json({ ok: true, message: "Server running" });
});

app.get("/api/status", (req, res) => {
  const fromEnv = !!(process.env.YTDLP_COOKIES && process.env.YTDLP_COOKIES.trim());
  const fromFile = !!(process.env.YTDLP_COOKIES_FILE && fs.existsSync(process.env.YTDLP_COOKIES_FILE));
  res.json({ ok: true, cookiesConfigured: fromEnv || fromFile });
});

function isYouTubeUrl(s) {
  if (typeof s !== "string" || !s.trim()) return false;
  try {
    const raw = s.trim();
    const u = new URL(raw.startsWith("http") ? raw : "https://" + raw);
    const host = u.hostname.toLowerCase();
    return host === "youtu.be" || host.includes("youtube");
  } catch {
    return false;
  }
}

function normalizeYouTubeUrl(s) {
  if (typeof s !== "string" || !s.trim()) return s;
  try {
    const raw = s.trim();
    const u = new URL(raw.startsWith("http") ? raw : "https://" + raw);
    const host = u.hostname.toLowerCase();
    if (host === "youtu.be") {
      const id = u.pathname.slice(1).split("/")[0].split("?")[0];
      return id ? `https://www.youtube.com/watch?v=${id}` : raw;
    }
    if (host.includes("youtube")) {
      const v = u.searchParams.get("v");
      if (v) return `https://www.youtube.com/watch?v=${v}`;
      const match = u.pathname.match(/^\/(?:shorts|live)\/([a-zA-Z0-9_-]{10,})/);
      if (match) return `https://www.youtube.com/watch?v=${match[1]}`;
    }
  } catch (_) {}
  return s;
}

function safeFilename(name) {
  const base = path.basename(name);
  if (base !== name || base.includes("..")) return null;
  const full = path.join(DOWNLOAD_DIR, base);
  const dirAbs = path.resolve(DOWNLOAD_DIR);
  if (!path.resolve(full).startsWith(dirAbs) || !fs.existsSync(full)) return null;
  return full;
}

const FALLBACK_PATH = process.platform === "win32"
  ? "C:\\Windows\\System32\\cmd.exe"
  : "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin";

function findYtDlp() {
  const name = process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp";
  const pathEnv = process.env.PATH || "";
  const pathSep = process.platform === "win32" ? ";" : ":";
  const dirs = [
    ...pathEnv.split(pathSep),
    "/opt/homebrew/bin",
    "/usr/local/bin",
  ].filter(Boolean);
  for (const dir of dirs) {
    const exe = path.join(dir, name);
    if (fs.existsSync(exe)) return exe;
  }
  try {
    const fullPath = execSync(`which ${name}`, {
      encoding: "utf8",
      env: { ...process.env, PATH: pathEnv || FALLBACK_PATH },
    }).trim();
    if (fullPath && fs.existsSync(fullPath)) return fullPath;
  } catch (_) {}
  return name;
}

function friendlyYouTubeError(rawMessage) {
  if (!rawMessage || typeof rawMessage !== "string") return rawMessage;
  const lower = rawMessage.toLowerCase();
  if (lower.includes("sign in") || lower.includes("not a bot") || (lower.includes("cookies") && lower.includes("bot"))) {
    const hasCookies = !!(process.env.YTDLP_COOKIES || (process.env.YTDLP_COOKIES_FILE && fs.existsSync(process.env.YTDLP_COOKIES_FILE)));
    if (!hasCookies) {
      return "This video couldn’t be loaded (YouTube is blocking the server). Fix: In Render → Environment, add YTDLP_COOKIES with base64 of your YouTube cookies (export from Chrome, base64 the file, paste). Or try another video / run the app locally.";
    }
    return "This video couldn’t be loaded from our server. Your cookies may have expired — export fresh cookies and update YTDLP_COOKIES on Render. Or try another video.";
  }
  if (lower.includes("requested format is not available") || lower.includes("format is not available")) {
    return "This video’s audio format isn’t available. Try another video.";
  }
  return rawMessage.slice(0, 500);
}

const YOUTUBE_PLAYER_CLIENTS = ["android,web", "ios", "tv_embedded", "mweb"];

function getYtDlpBaseArgs(playerClient = null) {
  const args = ["--no-warnings", "--no-check-certificate"];
  const hasCookies = !!(process.env.YTDLP_COOKIES || (process.env.YTDLP_COOKIES_FILE && fs.existsSync(process.env.YTDLP_COOKIES_FILE)));
  if (!hasCookies && playerClient) {
    args.push("--extractor-args", `youtube:player_client=${playerClient}`);
  } else if (!hasCookies) {
    args.push("--extractor-args", "youtube:player_client=android,web");
  }
  const cookiesPath = process.env.YTDLP_COOKIES_FILE;
  const cookiesB64 = process.env.YTDLP_COOKIES;
  if (cookiesPath && fs.existsSync(cookiesPath)) {
    args.push("--cookies", cookiesPath);
    console.log("[Cookies] Using cookie file:", cookiesPath);
  } else if (cookiesB64) {
    try {
      const decoded = Buffer.from(cookiesB64.trim(), "base64").toString("utf8");
      const withHeader = decoded.startsWith("#") ? decoded : "# Netscape HTTP Cookie File\n" + decoded;
      const cookiePath = path.join(os.tmpdir(), "ytdlp_cookies.txt");
      fs.writeFileSync(cookiePath, withHeader, { mode: 0o600 });
      args.push("--cookies", cookiePath);
      console.log("[Cookies] Using cookie file (from YTDLP_COOKIES)");
    } catch (e) {
      console.error("[Cookies] Failed to write cookie file:", e.message);
    }
  }
  return args;
}

function isBotOrSignInError(errMsg) {
  if (!errMsg || typeof errMsg !== "string") return false;
  const lower = errMsg.toLowerCase();
  return lower.includes("sign in") || lower.includes("not a bot") || (lower.includes("cookies") && lower.includes("bot"));
}

function isFormatNotAvailableError(errMsg) {
  if (!errMsg || typeof errMsg !== "string") return false;
  return errMsg.toLowerCase().includes("requested format is not available") || errMsg.toLowerCase().includes("format is not available");
}

const DOWNLOAD_FORMAT_FALLBACKS = ["best", "bestaudio/best", "worst"];

function downloadAudio(url, outPath, opts = {}) {
  const base = path.basename(outPath, ".mp3");
  const outTmpl = path.join(DOWNLOAD_DIR, `${base}.%(ext)s`);
  const ytdlp = findYtDlp();
  const hasCookies = !!(process.env.YTDLP_COOKIES || (process.env.YTDLP_COOKIES_FILE && fs.existsSync(process.env.YTDLP_COOKIES_FILE)));
  const clientsToTry = hasCookies ? [null] : [null, ...YOUTUBE_PLAYER_CLIENTS];
  let lastError = null;
  for (const client of clientsToTry) {
    for (const formatStr of DOWNLOAD_FORMAT_FALLBACKS) {
      for (const ext of ["m4a", "webm", "opus", "mp3"]) {
        const alt = path.join(DOWNLOAD_DIR, `${base}.${ext}`);
        try { if (fs.existsSync(alt)) fs.unlinkSync(alt); } catch (_) {}
      }
      const args = [
        "--extract-audio",
        "-f", formatStr,
        "-o", outTmpl,
        ...getYtDlpBaseArgs(client),
        url,
      ];
      const result = spawnSync(ytdlp, args, {
        encoding: "utf8",
        maxBuffer: 50 * 1024 * 1024,
        env: { ...process.env, PATH: process.env.PATH || "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin" },
      });
      if (result.error) {
        if (result.error.code === "ENOENT") {
          throw new Error("yt-dlp not found. Install it with: brew install yt-dlp");
        }
        lastError = result.error.message;
        if (isFormatNotAvailableError(lastError)) {
          if (formatStr !== DOWNLOAD_FORMAT_FALLBACKS[DOWNLOAD_FORMAT_FALLBACKS.length - 1]) continue;
          break;
        }
        if (isBotOrSignInError(lastError) && client !== clientsToTry[clientsToTry.length - 1]) break;
        throw new Error(lastError || "yt-dlp failed to run");
      }
      if (result.status === 0) {
        if (fs.existsSync(outPath)) return;
        for (const ext of ["m4a", "webm", "opus", "mp3"]) {
          const alt = path.join(DOWNLOAD_DIR, `${base}.${ext}`);
          if (fs.existsSync(alt)) {
            if (ext === "mp3") {
              fs.renameSync(alt, outPath);
              return;
            }
            const conv = spawnSync("ffmpeg", ["-y", "-i", alt, "-acodec", "libmp3lame", "-q:a", "2", outPath], {
              encoding: "utf8",
              maxBuffer: 50 * 1024 * 1024,
            });
            fs.unlinkSync(alt);
            if (conv.status !== 0) throw new Error(conv.stderr || "ffmpeg conversion failed");
            return;
          }
        }
      }
      const out = [result.stderr, result.stdout].filter(Boolean).join("\n").trim();
      lastError = out || "yt-dlp exited with an error";
      if (isFormatNotAvailableError(lastError)) {
        if (formatStr !== DOWNLOAD_FORMAT_FALLBACKS[DOWNLOAD_FORMAT_FALLBACKS.length - 1]) continue;
        break;
      }
      if (isBotOrSignInError(lastError) && client !== clientsToTry[clientsToTry.length - 1]) break;
      throw new Error(lastError.slice(0, 800));
    }
  }
  throw new Error(lastError || "yt-dlp did not produce an audio file");
}

function trimToDuration(inputPath, outputPath, durationSec) {
  return trimToSegment(inputPath, outputPath, 0, durationSec);
}

function trimToSegment(inputPath, outputPath, startSec, durationSec) {
  return new Promise((resolve, reject) => {
    const chain = ffmpeg(inputPath);
    if (startSec > 0) chain.setStartTime(startSec);
    chain.setDuration(durationSec);
    if (outputPath.toLowerCase().endsWith(".wav")) {
      chain.format("wav").outputOptions(["-acodec", "pcm_s16le"]);
    }
    chain.output(outputPath).on("end", () => resolve(outputPath)).on("error", reject).run();
  });
}

function concatWithCrossfade(inputPaths, durationsSec, outputPath, crossfadeMs) {
  const n = inputPaths.length;
  const numericDurations = durationsSec.map((x) => Number(x) || 0);
  const minHalf = Math.max(0.5, Math.min(...numericDurations.map((v) => v > 0 ? v / 2 : Infinity)));
  const baseD = Math.max(0.5, Math.min(6, crossfadeMs / 1000));
  const dSec = Math.min(baseD, minHalf);
  const d = dSec.toFixed(3);
  const L = numericDurations.map((x) => x.toFixed(3));

  if (n === 1) {
    const args = ["-y", "-i", inputPaths[0], "-acodec", "libmp3lame", "-q:a", "2", "-write_xing", "0", outputPath];
    const result = spawnSync("ffmpeg", args, { stdio: "pipe", maxBuffer: 50 * 1024 * 1024 });
    if (result.status !== 0) {
      const errOut = [result.stderr, result.stdout].filter(Boolean).join("\n").trim();
      throw new Error(errOut ? `ffmpeg failed: ${errOut.slice(0, 500)}` : "ffmpeg failed. Is ffmpeg installed? (brew install ffmpeg)");
    }
    return;
  }

  const parts = [];
  for (let i = 0; i < n; i++) {
    parts.push(`[${i}:a]atrim=0:${L[i]},aresample=44100[a${i}]`);
  }
  let cumul = parseFloat(L[0]);
  parts.push(`[a0]afade=t=out:st=${(parseFloat(L[0]) - dSec).toFixed(3)}:d=${d}[a0f]`);
  const delay1Ms = (parseFloat(L[0]) - dSec) * 1000;
  parts.push(`[a1]adelay=${delay1Ms.toFixed(0)}|${delay1Ms.toFixed(0)},afade=t=in:d=${d}[a1f]`);
  parts.push(`[a0f][a1f]amix=inputs=2:duration=longest[o1]`);
  cumul = parseFloat(L[0]) + parseFloat(L[1]) - dSec;

  for (let i = 2; i < n; i++) {
    const delaySec = cumul - dSec;
    const delayMs = delaySec * 1000;
    const outStart = cumul - dSec;
    parts.push(`[o${i - 1}]afade=t=out:st=${outStart.toFixed(3)}:d=${d}[o${i - 1}f]`);
    parts.push(`[a${i}]adelay=${delayMs.toFixed(0)}|${delayMs.toFixed(0)},afade=t=in:d=${d}[a${i}f]`);
    parts.push(`[o${i - 1}f][a${i}f]amix=inputs=2:duration=longest[o${i}]`);
    cumul += parseFloat(L[i]) - dSec;
  }

  const filterStr = parts.join(";");
  const args = [
    "-y", "-fflags", "+genpts", "-avoid_negative_ts", "make_zero",
    ...inputPaths.flatMap((p) => ["-i", p]),
    "-filter_complex", filterStr,
    "-map", `[o${n - 1}]`,
    "-acodec", "libmp3lame", "-q:a", "2", "-write_xing", "0",
    outputPath,
  ];
  const result = spawnSync("ffmpeg", args, { stdio: "pipe", maxBuffer: 50 * 1024 * 1024 });
  if (result.status !== 0) {
    const errOut = [result.stderr, result.stdout].filter(Boolean).join("\n").trim();
    throw new Error(errOut ? `ffmpeg mix failed: ${errOut.slice(0, 500)}` : "ffmpeg failed. Is ffmpeg installed? (brew install ffmpeg)");
  }
}

app.get("/api/video-info", (req, res) => {
  const url = req.query.url;
  if (!url || !isYouTubeUrl(url)) {
    return res.status(400).json({ error: "Valid YouTube URL required." });
  }
  const cleanUrl = normalizeYouTubeUrl(url);
  const hasCookies = !!(process.env.YTDLP_COOKIES || (process.env.YTDLP_COOKIES_FILE && fs.existsSync(process.env.YTDLP_COOKIES_FILE)));
  const clientsToTry = hasCookies ? [null] : [null, ...YOUTUBE_PLAYER_CLIENTS];
  let lastErrMsg = "";
  try {
    const ytdlp = findYtDlp();
    for (const client of clientsToTry) {
      const result = spawnSync(ytdlp, ["--dump-json", "-s", "-f", "bestaudio[ext=m4a]/bestaudio[ext=webm]/bestaudio/best", ...getYtDlpBaseArgs(client), cleanUrl], {
        encoding: "utf8",
        maxBuffer: 2 * 1024 * 1024,
        env: { ...process.env, PATH: process.env.PATH || FALLBACK_PATH },
      });
      if (result.error && result.error.code === "ENOENT") {
        return res.status(503).json({ error: "yt-dlp not found." });
      }
      if (result.status === 0) {
        const data = JSON.parse(result.stdout || "{}");
        const duration = data.duration;
        const title = data.title;
        if (duration != null && typeof duration === "number" && duration > 0) {
          return res.json({ duration: Math.floor(duration), title: typeof title === "string" ? title : null });
        }
      }
      lastErrMsg = [result.stderr, result.stdout].filter(Boolean).join("\n").trim();
      if (!isBotOrSignInError(lastErrMsg)) break;
    }
    const friendly = friendlyYouTubeError(lastErrMsg) || "Could not get video info. The video may be private, region-locked, or unavailable.";
    console.error("[video-info] yt-dlp failed:", lastErrMsg.slice(0, 400));
    return res.status(502).json({ error: friendly });
  } catch (e) {
    return res.status(500).json({ error: e.message || "Failed to get video info." });
  }
});

app.post("/api/mashup", async (req, res) => {
  const { urls = [], clips: clipsBody, duration = 10, crossfade = 1000, preview = false, maxClips = 3 } = req.body;
  const defaultDuration = Math.max(1, Math.min(120, Number(duration) || 10));
  const crossfadeMs = Math.max(2500, Math.min(6000, Number(crossfade) || 2500));

  let list;
  const urlList = Array.isArray(urls) ? urls.flatMap((u) => String(u).trim().split(/[\n,\s]+/).map((s) => s.trim()).filter(Boolean)) : [];
  if (Array.isArray(clipsBody) && clipsBody.length > 0) {
    list = clipsBody.flatMap((c) => {
      const start = Math.max(0, Number(c.start) || 0);
      const duration = Math.max(1, Math.min(120, Number(c.duration) || defaultDuration));
      const raw = String(c.url || "").trim();
      return raw.split(/[\n,\s]+/).map((s) => s.trim()).filter(Boolean).map((url) => ({ url, start, duration }));
    });
  }
  if (!list || list.length === 0) {
    list = urlList.map((url) => ({ url, start: 0, duration: defaultDuration }));
  }

  const invalid = list.filter((c) => !isYouTubeUrl(c.url));
  if (invalid.length) {
    return res.status(400).json({
      error: "These links don’t look like YouTube URLs: " + invalid.slice(0, 3).map((c) => `"${c.url.slice(0, 50)}${c.url.length > 50 ? "…" : ""}"`).join(", "),
      invalid: invalid.slice(0, 5).map((c) => c.url),
    });
  }
  if (list.length === 0) {
    return res.status(400).json({ error: "Enter at least one YouTube URL." });
  }

  const clipPaths = [];
  const clipDurations = [];
  try {
    for (let i = 0; i < list.length; i++) {
      const { url, start: startSec, duration: durationSec } = list[i];
      const clipUrl = normalizeYouTubeUrl(url);
      const clipId = uuidv4().replace(/-/g, "");
      const rawPath = path.join(DOWNLOAD_DIR, `clip_${clipId}.mp3`);
      console.log(`[Mashup] Downloading clip ${i + 1}/${list.length} …`);
      downloadAudio(clipUrl, rawPath);
      console.log(`[Mashup] Clip ${i + 1}/${list.length} done, trimming ${startSec}s–${startSec + durationSec}s …`);
      const trimPath = path.join(DOWNLOAD_DIR, `trim_${clipId}.wav`);
      await trimToSegment(rawPath, trimPath, startSec, durationSec);
      fs.unlinkSync(rawPath);
      clipPaths.push(trimPath);
      clipDurations.push(durationSec);
    }

    const finalId = uuidv4().replace(/-/g, "");
    const filePrefix = preview ? "preview_mix_" : "final_mix_";
    const finalPath = path.join(DOWNLOAD_DIR, `${filePrefix}${finalId}.mp3`);
    console.log(preview ? "[Preview] Mixing with crossfade (gapless) …" : "[Mashup] Mixing with crossfade (gapless) …");
    concatWithCrossfade(clipPaths, clipDurations, finalPath, crossfadeMs);
    clipPaths.forEach((p) => { try { fs.unlinkSync(p); } catch (_) {} });

    const filename = `${filePrefix}${finalId}.mp3`;
    return res.json({ filename, streamUrl: `/api/stream/${filename}`, downloadUrl: `/api/download/${filename}`, preview: !!preview });
  } catch (err) {
    console.error("[Mashup]", err);
    clipPaths.forEach((p) => { try { fs.unlinkSync(p); } catch (_) {} });
    const msg = friendlyYouTubeError(err.message) || err.message || "Failed to generate mashup.";
    return res.status(500).json({ error: msg });
  }
});

app.get("/api/stream/:filename", (req, res) => {
  const filePath = safeFilename(req.params.filename);
  if (!filePath) return res.status(404).send("Not found");
  res.type("audio/mpeg");
  res.setHeader("Cache-Control", "no-store");
  res.sendFile(filePath);
});

app.get("/api/download/:filename", (req, res) => {
  const filePath = safeFilename(req.params.filename);
  if (!filePath) return res.status(404).json({ error: "Not found" });
  res.download(filePath, path.basename(filePath));
});

app.use((err, req, res, next) => {
  console.error("[Server error]", err);
  if (!res.headersSent) {
    res.status(500).json({ error: err.message || "Server error." });
  }
});

app.use("/api", (req, res) => {
  if (!res.headersSent) res.status(404).json({ error: "Not found" });
});

const clientDist = path.join(__dirname, "..", "client", "dist");
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get("*", (req, res) => {
    res.sendFile(path.join(clientDist, "index.html"));
  });
} else {
  app.get("/", (req, res) => {
    res.type("html").send(`
      <!DOCTYPE html><html><head><title>YouTube Mashup</title></head><body>
        <h1>Server is running</h1>
        <p>To use the app from this port (one server only), from the project root run:</p>
        <p><code>npm run run</code></p>
        <p>That builds the client and restarts the server so this page becomes the app. Then refresh.</p>
        <p>Or use two terminals: this server + <code>npm run dev:client</code>, then open <a href="http://localhost:5173">http://localhost:5173</a>.</p>
      </body></html>
    `);
  });
}

const PORT = process.env.PORT || 5175;
app.listen(PORT, () => {
  const cookiesFromEnv = !!(process.env.YTDLP_COOKIES && process.env.YTDLP_COOKIES.trim());
  const cookiesFromFile = !!(process.env.YTDLP_COOKIES_FILE && fs.existsSync(process.env.YTDLP_COOKIES_FILE));
  console.log(`Server running at http://localhost:${PORT} | cookies: ${cookiesFromEnv || cookiesFromFile ? "configured" : "not set"}`);
});
