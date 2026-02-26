# Run the app locally

## Option A: Dev mode (client + server, hot reload)

**Terminal 1 – backend**
```bash
cd youtube-mashup-app/server
node index.js
```
Wait until you see: `Server running at http://localhost:5175 | cookies: ...`

**Terminal 2 – frontend**
```bash
cd youtube-mashup-app/client
npm run dev
```
Then open: **http://localhost:5173**

The Vite dev server proxies `/api` to the backend on 5175, so the app and API both work.

---

## Option B: Single command (build + server, no hot reload)

From the project root:
```bash
cd youtube-mashup-app
npm run run
```
Then open: **http://localhost:5175**

This builds the client once and serves it from the same server. Change client code → run `npm run run` again to see updates.

---

## If port 5175 is already in use

Kill whatever is using it, then start the server again:

```bash
# Find process on 5175 (macOS/Linux)
lsof -i :5175

# Kill it (use the PID from above)
kill <PID>
```

Or use a different port:
```bash
PORT=3000 node index.js
```
Then in `client/vite.config.js` set the proxy to `"http://localhost:3000"` and run the client as in Option A.
