import { useState, useEffect, useRef, useCallback } from "react";

// Use relative /api so Vite proxies to 5175 when on 5173 (avoids cross-origin "Failed to fetch")
const API = "/api";

function formatTime(sec) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function TrimRange({ videoDuration, start, duration, onStartChange, onDurationChange }) {
  const trackRef = useRef(null);
  const [dragging, setDragging] = useState(null); // "start" | "end"

  const ratioToTime = useCallback(
    (ratio) => Math.max(0, Math.min(videoDuration, Math.round(ratio * videoDuration))),
    [videoDuration]
  );
  const timeToRatio = useCallback((t) => t / videoDuration, [videoDuration]);

  const getRatio = useCallback(
    (e) => {
      const el = trackRef.current;
      if (!el) return 0;
      const rect = el.getBoundingClientRect();
      const x = "touches" in e ? e.touches[0].clientX : e.clientX;
      return Math.max(0, Math.min(1, (x - rect.left) / rect.width));
    },
    []
  );

  const handlePointerDown = useCallback(
    (which) => (e) => {
      e.preventDefault();
      setDragging(which);
    },
    []
  );
  const handlePointerMove = useCallback(
    (e) => {
      if (dragging === null) return;
      const ratio = getRatio(e);
      const t = ratioToTime(ratio);
      if (dragging === "start") {
        const maxStart = start + duration - 1;
        const newStart = Math.max(0, Math.min(maxStart, t));
        onStartChange(newStart);
        onDurationChange(start + duration - newStart);
      } else {
        const minEnd = start + 1;
        const newEnd = Math.max(minEnd, Math.min(videoDuration, t));
        onDurationChange(newEnd - start);
      }
    },
    [dragging, start, duration, videoDuration, getRatio, ratioToTime, onStartChange, onDurationChange]
  );
  const handlePointerUp = useCallback(() => setDragging(null), []);

  useEffect(() => {
    if (dragging === null) return;
    const onMove = (e) => handlePointerMove(e);
    const onUp = () => handlePointerUp();
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [dragging, handlePointerMove, handlePointerUp]);

  const useStart = Math.min(Math.max(0, start), videoDuration - 1);
  const useEnd = Math.min(Math.max(useStart + 1, start + duration), videoDuration);
  const useDuration = useEnd - useStart;
  const startRatio = Math.max(0, Math.min(1, timeToRatio(useStart)));
  const endRatio = Math.max(0, Math.min(1, timeToRatio(useEnd)));
  const segmentWidth = Math.max(0.02, endRatio - startRatio);

  return (
    <div className="trim-range">
      <div className="trim-range-labels">
        <span>{formatTime(0)}</span>
        <span className="trim-range-segment">
          {formatTime(useStart)} – {formatTime(useEnd)}
        </span>
        <span>{formatTime(videoDuration)}</span>
      </div>
      <div
        ref={trackRef}
        className="trim-track"
        role="slider"
        aria-label="Trim range"
        tabIndex={0}
      >
        <div className="trim-track-bg" />
        <div
          className="trim-track-segment"
          style={{ left: `${startRatio * 100}%`, width: `${segmentWidth * 100}%` }}
        />
        <div
          className="trim-handle trim-handle-start"
          style={{ left: `${startRatio * 100}%` }}
          onPointerDown={handlePointerDown("start")}
        />
        <div
          className="trim-handle trim-handle-end"
          style={{ left: `${endRatio * 100}%` }}
          onPointerDown={handlePointerDown("end")}
        />
      </div>
    </div>
  );
}

function getYouTubeVideoId(url) {
  if (!url || typeof url !== "string") return null;
  const u = url.trim();
  if (!u) return null;
  try {
    const parsed = new URL(u.startsWith("http") ? u : "https://" + u);
    const host = parsed.hostname.toLowerCase();
    if (host === "youtu.be") return parsed.pathname.slice(1).split("/")[0].split("?")[0] || null;
    if (host.includes("youtube")) {
      const v = parsed.searchParams.get("v");
      if (v) return v;
      const match = parsed.pathname.match(/^\/(?:shorts|live)\/([a-zA-Z0-9_-]{10,})/);
      if (match) return match[1];
    }
  } catch (_) {}
  return null;
}

function useElapsed(loading) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!loading) return setElapsed(0);
    const start = Date.now();
    const t = setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 1000);
    return () => clearInterval(t);
  }, [loading]);
  return elapsed;
}

export default function App() {
  const DEFAULT_CLIP_DURATION = 10;
  const [urls, setUrls] = useState([""]);
  const [crossfade, setCrossfade] = useState(2500);
  const [loading, setLoading] = useState(false);
  const [loadingMode, setLoadingMode] = useState(null);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);
  const elapsed = useElapsed(loading);

  const [clipStarts, setClipStarts] = useState([0]);
  const [clipDurations, setClipDurations] = useState([null]);
  const [videoDurations, setVideoDurations] = useState([null]);
  const [songTitles, setSongTitles] = useState([null]);
  const [durationLoading, setDurationLoading] = useState({});
  const [showPreviewPanel, setShowPreviewPanel] = useState(false);
  const [previewStreamUrl, setPreviewStreamUrl] = useState(null);
  const [prevPreviewStreamUrl, setPrevPreviewStreamUrl] = useState(null);
  const [previewABChoice, setPreviewABChoice] = useState("current");
  const [loopPreview, setLoopPreview] = useState(false);
  const [previewFileName, setPreviewFileName] = useState(() => localStorage.getItem("mashupPreviewFileName") || "my-preview");
  const previewAudioRef = useRef(null);
  const previewPanelRef = useRef(null);
  const errorRef = useRef(null);
  const dragIndexRef = useRef(null);
  const [skippedForPreview, setSkippedForPreview] = useState([]);
  const [serverOk, setServerOk] = useState(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`${API}/health`)
      .then((r) => r.ok)
      .then((ok) => { if (!cancelled) setServerOk(ok); })
      .catch(() => { if (!cancelled) setServerOk(false); });
    return () => { cancelled = true; };
  }, []);

  const addUrl = () => {
    setUrls((prev) => [...prev, ""]);
    setClipStarts((prev) => [...prev, 0]);
    setClipDurations((prev) => [...prev, null]);
    setVideoDurations((prev) => [...prev, null]);
    setSongTitles((prev) => [...prev, null]);
  };
  const setUrl = (i, v) => {
    const prevUrl = urls[i];
    setUrls((prev) => prev.map((u, j) => (j === i ? v : u)));
    if (getYouTubeVideoId(v) !== getYouTubeVideoId(prevUrl)) {
      setVideoDurations((prev) => prev.map((d, j) => (j === i ? null : d)));
      setSongTitles((prev) => prev.map((t, j) => (j === i ? null : t)));
    }
  };
  const setClipStart = (i, v) => setClipStarts((prev) => prev.map((s, j) => (j === i ? v : s)));
  const setClipDuration = (i, v) => setClipDurations((prev) => prev.map((d, j) => (j === i ? v : d)));
  const setVideoDuration = (i, v) => setVideoDurations((prev) => prev.map((d, j) => (j === i ? v : d)));
  const removeUrl = (i) => {
    setUrls((prev) => prev.filter((_, j) => j !== i));
    setClipStarts((prev) => prev.filter((_, j) => j !== i));
    setClipDurations((prev) => prev.filter((_, j) => j !== i));
    setVideoDurations((prev) => prev.filter((_, j) => j !== i));
    setSongTitles((prev) => prev.filter((_, j) => j !== i));
  };

  const handleFormKeyDown = (e) => {
    if (e.key === "Enter" && e.shiftKey) {
      e.preventDefault();
      if (!loading) startPreview();
    }
  };

  const handleUrlKeyDown = (index) => (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const inputs = document.querySelectorAll('input[data-url-input]');
      const nextIndex = e.key === "ArrowDown" ? index + 1 : index - 1;
      if (nextIndex >= 0 && nextIndex < inputs.length) {
        inputs[nextIndex].focus();
      }
    }
    if (e.key === "Enter" && e.shiftKey) {
      e.preventDefault();
      if (!loading) startPreview();
    }
  };

  const shuffleOrder = () => {
    const n = urls.length;
    if (n < 2) return;
    const indices = [...Array(n).keys()];
    for (let i = n - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [indices[i], indices[j]] = [indices[j], indices[i]];
    }
    setUrls((prev) => indices.map((i) => prev[i]));
    setClipStarts((prev) => indices.map((i) => prev[i]));
    setClipDurations((prev) => indices.map((i) => prev[i]));
    setVideoDurations((prev) => indices.map((i) => prev[i]));
    setSongTitles((prev) => indices.map((i) => prev[i]));
  };

  const stopPreview = useCallback(() => {
    if (previewAudioRef.current) previewAudioRef.current.pause();
    setPreviewStreamUrl(null);
    setShowPreviewPanel(false);
  }, []);

  const buildClipsList = useCallback(() => {
    const defaultDur = DEFAULT_CLIP_DURATION;
    const list = [];
    urls.forEach((raw, i) => {
      const s = (raw || "").trim();
      if (!s) return;
      const maxLen = videoDurations[i] ?? Infinity;
      const start = Math.max(0, Math.min((clipStarts[i] ?? 0), maxLen - 1));
      const dur = Math.max(1, Math.min((clipDurations[i] ?? defaultDur), maxLen - start));
      s.split(/[\n,\s]+/).forEach((part) => {
        const u = part.trim();
        if (u) list.push({ url: u.startsWith("http") ? u : "https://" + u, start, duration: dur, index: i });
      });
    });
    return list;
  }, [urls, clipStarts, clipDurations, videoDurations]);

  const applyRecipe = useCallback((recipe) => {
    if (!recipe || !Array.isArray(recipe.urls) || !recipe.urls.length) return;
    const nextUrls = recipe.urls.map((u) => String(u || ""));
    const n = nextUrls.length;
    setUrls(nextUrls);
    setClipStarts((recipe.clipStarts || []).slice(0, n).concat(Array(Math.max(0, n - (recipe.clipStarts || []).length)).fill(0)));
    setClipDurations((recipe.clipDurations || []).slice(0, n).concat(Array(Math.max(0, n - (recipe.clipDurations || []).length)).fill(null)));
    setVideoDurations(Array(n).fill(null));
    if (typeof recipe.crossfade === "number" && !Number.isNaN(recipe.crossfade)) {
      setCrossfade(Math.max(2500, Math.min(6000, recipe.crossfade)));
    }
  }, []);

  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const m = params.get("m");
      if (!m) return;
      const padded = m.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((m.length + 3) % 4);
      const json = atob(decodeURIComponent(padded));
      const recipe = JSON.parse(json);
      applyRecipe(recipe);
    } catch (_) {
      // ignore invalid recipe
    }
  }, [applyRecipe]);

  const startPreview = useCallback(async () => {
    const list = buildClipsList();
    if (list.length === 0) {
      setError("Add at least one YouTube link to preview.");
      return;
    }
    const included = new Set(list.map((c) => c.index));
    setSkippedForPreview(urls.map((_, i) => !included.has(i)));
    setError("");
    setPreviewStreamUrl(null);
    setShowPreviewPanel(true);
    setLoading(true);
    setLoadingMode("preview");
    const PREVIEW_TIMEOUT_MS = 8 * 60 * 1000; // 8 minutes (download + mix can be slow)
    const ac = new AbortController();
    const timeoutId = setTimeout(() => ac.abort(), PREVIEW_TIMEOUT_MS);
    try {
      const res = await fetch(`${API}/mashup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clips: list.map(({ url, start, duration }) => ({ url, start, duration })),
          urls: list.map((c) => c.url),
          duration: DEFAULT_CLIP_DURATION,
          crossfade: Number(crossfade) || 2500,
          preview: true,
        }),
        signal: ac.signal,
      });
      clearTimeout(timeoutId);
      const text = await res.text();
      let data;
      try {
        data = text ? JSON.parse(text) : {};
      } catch (_) {
        setError(res.ok ? "Invalid response from server." : `Preview failed (${res.status}). Server may be down or returned an error.`);
        setShowPreviewPanel(false);
        setTimeout(() => errorRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }), 0);
        return;
      }
      if (!res.ok) {
        const msg = data.error || (text && text.slice(0, 200)) || `Preview failed (${res.status}).`;
        setError(msg);
        setShowPreviewPanel(false);
        setTimeout(() => errorRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }), 0);
        return;
      }
      if (!data.streamUrl) {
        setError("Preview returned no audio URL.");
        setShowPreviewPanel(false);
        setTimeout(() => errorRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }), 0);
        return;
      }
      setPrevPreviewStreamUrl((prev) => previewStreamUrl || prev);
      setPreviewStreamUrl(data.streamUrl.startsWith("/") ? data.streamUrl : "/" + data.streamUrl);
      setPreviewABChoice("current");
      setShowPreviewPanel(true);
    } catch (err) {
      clearTimeout(timeoutId);
      setShowPreviewPanel(false);
      setTimeout(() => errorRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }), 0);
      const msg = err.message || "Preview failed.";
      const isAbort = err.name === "AbortError";
      const isNetwork = msg.includes("fetch") || msg.includes("Network") || msg.includes("too long");
      if (isAbort) {
        setError("Preview timed out (8 min). The server may still be working—check its terminal. Try again or use shorter clips.");
      } else if (isNetwork) {
        setError(`${msg} Is the server running on port 5175?`);
      } else {
        setError(msg);
      }
    } finally {
      setLoading(false);
      setLoadingMode(null);
    }
  }, [buildClipsList, crossfade, previewStreamUrl]);

  useEffect(() => {
    if (!previewAudioRef.current) return;
    previewAudioRef.current.loop = !!loopPreview;
  }, [loopPreview, previewStreamUrl, prevPreviewStreamUrl]);

  useEffect(() => {
    if (showPreviewPanel && loading && loadingMode === "preview") {
      previewPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [showPreviewPanel, loading, loadingMode]);

  useEffect(() => {
    urls.forEach((u, i) => {
      const id = getYouTubeVideoId(u);
      if (!id || durationLoading[i]) return;
      if (videoDurations[i] != null && songTitles[i]) return;
      setDurationLoading((prev) => ({ ...prev, [i]: true }));
      const url = u.trim().startsWith("http") ? u.trim() : "https://" + u.trim();
      fetch(`${API}/video-info?url=${encodeURIComponent(url)}`)
        .then((r) => r.text().then((t) => ({ ok: r.ok, status: r.status, text: t })))
        .then(({ ok, status, text }) => {
          let data = {};
          try {
            data = text ? JSON.parse(text) : {};
          } catch (_) {}
          if (ok && data.duration != null) {
            setVideoDurations((prev) => prev.map((d, j) => (j === i ? data.duration : d)));
            setClipDurations((prev) =>
              prev.map((d, j) => (j === i && (d == null || d === "")) ? Math.min(30, data.duration) : d)
            );
          }
          if (ok && data.title) {
            setSongTitles((prev) => prev.map((t, j) => (j === i ? data.title : t)));
          }
          if (!ok && data.error) {
            setError(`Could not load video info: ${(data.error || "Video may be private or unavailable.").slice(0, 180)}`);
          }
        })
        .catch(() => {})
        .finally(() => setDurationLoading((prev) => ({ ...prev, [i]: false })));
    });
  }, [urls, videoDurations, songTitles, durationLoading]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    const defaultDur = DEFAULT_CLIP_DURATION;
    let list = [];
    const urlInputs = form.querySelectorAll('input[data-url-input]');
    urlInputs.forEach((input, i) => {
      const raw = (input.value || "").trim();
      if (!raw) return;
      const maxLen = videoDurations[i] ?? Infinity;
      let start = Math.max(0, Math.min((clipStarts[i] ?? 0), maxLen - 1));
      let dur = Math.max(1, Math.min((clipDurations[i] ?? defaultDur), maxLen - start));
      raw.split(/[\n,\s]+/).forEach((s) => {
        const url = s.trim();
        if (url) list.push({ url, start, duration: dur });
      });
    });
    if (list.length === 0) {
      urls.forEach((raw, i) => {
        const s = (raw || "").trim();
        if (!s) return;
        const maxLen = videoDurations[i] ?? Infinity;
        let start = Math.max(0, Math.min((clipStarts[i] ?? 0), maxLen - 1));
        let dur = Math.max(1, Math.min((clipDurations[i] ?? defaultDur), maxLen - start));
        s.split(/[\n,\s]+/).forEach((part) => {
          const url = part.trim();
          if (url) list.push({ url, start, duration: dur });
        });
      });
    }
    if (list.length === 0) {
      setError("Enter at least one YouTube URL in the link fields above.");
      return;
    }
    setError("");
    setResult(null);
    setLoading(true);
    setLoadingMode("generate");
    try {
      const payload = {
        clips: list.map(({ url, start, duration }) => ({ url, start, duration })),
        urls: list.map((c) => c.url),
        duration: defaultDur,
        crossfade: Number(crossfade) || 2500,
      };
      const res = await fetch(`${API}/mashup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const text = await res.text();
      let data;
      try {
        data = text ? JSON.parse(text) : {};
      } catch (_) {
        setError(res.ok ? "Invalid response from server." : `Request failed (${res.status}). Server may be down or returned an error.`);
        return;
      }
      if (!res.ok) {
        const msg = data.error || "Something went wrong.";
        setError(data.invalid?.length ? `${msg} Check that each link is from youtube.com or youtu.be.` : msg);
        return;
      }
      setResult(data);
    } catch (err) {
      setError(err.message || "Request failed.");
    } finally {
      setLoading(false);
      setLoadingMode(null);
    }
  };

  const reset = () => {
    setResult(null);
    setError("");
  };

  if (result) {
    return (
      <div className="success">
        <h2>Your mashup is ready</h2>
        <p className="success-play-label">Play it below before downloading — use the player to listen, then download if you like it.</p>
        <div className="audio-wrap" aria-label="Play mashup">
          <audio controls preload="metadata" src={result.streamUrl} className="success-audio">
            Your browser does not support the audio player.
          </audio>
        </div>
        <a className="download-link" href={result.downloadUrl} download>
          Download MP3
        </a>
        <br />
        <a className="back-link" href="#" onClick={(e) => { e.preventDefault(); reset(); }}>
          ← Make another mashup
        </a>
      </div>
    );
  }

  return (
    <>
      <h1>YouTube Mashup Generator</h1>
      <form onSubmit={handleSubmit} onKeyDown={handleFormKeyDown}>
        <label>YouTube links</label>
        <div className="url-list">
          {urls.map((u, i) => {
            const videoId = getYouTubeVideoId(u);
            return (
              <div
                key={i}
                className="url-row"
                draggable
                onDragStart={() => { dragIndexRef.current = i; }}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const from = dragIndexRef.current;
                  const to = i;
                  if (from == null || from === to) return;
                  const reorder = (arr) => {
                    const next = [...arr];
                    const [moved] = next.splice(from, 1);
                    next.splice(to, 0, moved);
                    return next;
                  };
                  setUrls((prev) => reorder(prev));
                  setClipStarts((prev) => reorder(prev));
                  setClipDurations((prev) => reorder(prev));
                  setVideoDurations((prev) => reorder(prev));
                  setSongTitles((prev) => reorder(prev));
                  dragIndexRef.current = null;
                }}
                onDragEnd={() => { dragIndexRef.current = null; }}
              >
                <div className="url-input-row">
                  <input
                    type="text"
                    data-url-input
                    placeholder="https://youtube.com/watch?v=..."
                    value={u}
                    onChange={(e) => setUrl(i, e.target.value)}
                    onKeyDown={handleUrlKeyDown(i)}
                  />
                  <button
                    type="button"
                    className="btn-play"
                    title="Play this song in a new tab"
                    disabled={!videoId}
                    onClick={() => videoId && window.open(`https://www.youtube.com/watch?v=${videoId}`, "_blank")}
                  >
                    ▶ Play
                  </button>
                  {urls.length > 1 && (
                    <button type="button" className="btn-secondary" onClick={() => removeUrl(i)}>
                      Remove
                    </button>
                  )}
                </div>
                {songTitles[i] && (
                  <div className="song-title">
                    {songTitles[i]}
                  </div>
                )}
                <div className="trim-wrap">
                  {durationLoading[i] && <p className="trim-loading">Loading song length…</p>}
                  {(videoDurations[i] != null || videoId) && (
                    <TrimRange
                      videoDuration={videoDurations[i] ?? 300}
                      start={clipStarts[i] ?? 0}
                      duration={clipDurations[i] ?? Math.min(30, videoDurations[i] ?? 300)}
                      onStartChange={(v) => setClipStart(i, v)}
                      onDurationChange={(v) => setClipDuration(i, v)}
                    />
                  )}
                  {videoDurations[i] == null && videoId && !durationLoading[i] && (
                    <p className="trim-hint">Song length loading — you can drag to select; we'll use the real length when generating.</p>
                  )}
                  {skippedForPreview[i] && videoId && (
                    <p className="trim-hint trim-warning">
                      This song couldn’t be included in the mix preview. Try a direct YouTube video link.
                    </p>
                  )}
                  {videoId && (
                    <div className="trim-inline-player">
                      <iframe
                        title={`Trim preview ${i + 1}`}
                        src={`https://www.youtube.com/embed/${videoId}?start=${Math.max(0, Math.floor(clipStarts[i] ?? 0))}`}
                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                        allowFullScreen
                      />
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        <button type="button" className="btn-secondary" onClick={addUrl}>
          Add another link
        </button>
        {urls.length >= 2 && (
          <button
            type="button"
            className="btn-secondary"
            onClick={shuffleOrder}
            title="Randomize the order of clips in your mashup (like Smart Shuffle)"
          >
            Smart shuffle
          </button>
        )}
        <label>Transition length between songs</label>
        <input
          type="number"
          min={2500}
          max={6000}
          value={crossfade}
          onChange={(e) => setCrossfade(Math.max(2500, Math.min(6000, Number(e.target.value) || 2500)))}
        />
        <p className="field-hint">Most mixes sound good between 2500 and 4000 (≈2.5–4 seconds).</p>

        <div className="share-row">
          <button
            type="button"
            className="share-link-btn"
            title="Copy link to this setup"
            aria-label="Copy link to this setup"
            onClick={() => {
              try {
                const recipe = {
                  urls,
                  clipStarts,
                  clipDurations,
                  crossfade,
                };
                const json = JSON.stringify(recipe);
                const b64 = btoa(json).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
                const url = `${window.location.origin}${window.location.pathname}?m=${encodeURIComponent(b64)}`;
                if (navigator.clipboard && navigator.clipboard.writeText) {
                  navigator.clipboard.writeText(url);
                  setError("");
                  alert("Link to this setup copied to your clipboard.");
                } else {
                  prompt("Copy this link to share your current setup:", url);
                }
              } catch (e) {
                setError("Could not generate share link.");
              }
            }}
          >
            <span className="share-icon" aria-hidden="true" />
          </button>
        </div>

        {serverOk === false && (
          <p className="error" style={{ marginBottom: "0.5rem" }}>
            Server not connected. Start it: <code>cd youtube-mashup-app && npm start</code> then run the client on port 5173.
          </p>
        )}
        {serverOk === true && (
          <p style={{ fontSize: "0.85rem", color: "var(--text-muted, #666)", marginBottom: "0.5rem" }}>Server connected</p>
        )}
        <button type="button" className="btn-preview" onClick={startPreview} disabled={loading}>
          Preview
        </button>
        <button type="submit" className="btn-primary" disabled={loading}>
          {loading ? "Generating…" : "Generate MP3"}
        </button>
      </form>

      {showPreviewPanel && (
        <div className="preview-panel" ref={previewPanelRef}>
          <div className="preview-panel-inner">
            <h3>Preview — clips converted to MP3, then mixed with crossfade</h3>
            {loading && loadingMode === "preview" ? (
              <p className="preview-clip-label">Building preview… Downloading from YouTube and mixing (can take 2–5 min). Please wait.</p>
            ) : previewStreamUrl ? (
              <>
            <p className="preview-clip-label">
              Same gapless mix as the final file.
              {prevPreviewStreamUrl && " Use A/B compare to hear changes between previews."}
            </p>
            <audio
              key={previewABChoice === "previous" && prevPreviewStreamUrl ? prevPreviewStreamUrl : previewStreamUrl}
              ref={previewAudioRef}
              src={previewABChoice === "previous" && prevPreviewStreamUrl ? prevPreviewStreamUrl : previewStreamUrl}
              controls
              autoPlay
              playsInline
            />
            <div className="preview-controls-row">
              <label className="preview-loop-toggle">
                <input
                  type="checkbox"
                  checked={loopPreview}
                  onChange={(e) => setLoopPreview(e.target.checked)}
                />
                Loop preview
              </label>
              {prevPreviewStreamUrl && (
                <div className="preview-ab-toggle">
                  <span>Compare:</span>
                  <label>
                    <input
                      type="radio"
                      name="preview-ab"
                      value="current"
                      checked={previewABChoice === "current"}
                      onChange={() => setPreviewABChoice("current")}
                    />
                    Current
                  </label>
                  <label>
                    <input
                      type="radio"
                      name="preview-ab"
                      value="previous"
                      checked={previewABChoice === "previous"}
                      onChange={() => setPreviewABChoice("previous")}
                    />
                    Previous
                  </label>
                </div>
              )}
            </div>
            <label className="preview-save-label">Save preview as (name is stored locally):</label>
            <input
              type="text"
              className="preview-name-input"
              value={previewFileName}
              onChange={(e) => {
                const v = e.target.value;
                setPreviewFileName(v);
                try { localStorage.setItem("mashupPreviewFileName", v); } catch (_) {}
              }}
              placeholder="my-preview"
            />
            <a
              href={previewStreamUrl}
              download={(((previewFileName.trim() || "preview").replace(/[^\w\s-]/g, "").replace(/\s+/g, "-") || "preview") + ".mp3")}
              className="btn-primary preview-save-btn"
            >
              Save to computer
            </a>
            <button type="button" className="btn-secondary" onClick={stopPreview}>Stop preview</button>
              </>
            ) : (
              <p className="preview-clip-label">Preview failed. See error above.</p>
            )}
          </div>
        </div>
      )}

      {loading && (
        <div className="loading">
          <p><strong>{loadingMode === "preview" ? "Building preview…" : "Generating…"} {elapsed >= 60 ? `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, "0")}` : `${elapsed}s`}</strong></p>
          <p>Downloading clips from YouTube, then mixing with crossfade. Please wait — don’t close the page.</p>
        </div>
      )}
      {error && <div className="error" ref={errorRef} role="alert">{error}</div>}
    </>
  );
}
