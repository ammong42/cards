import http from "node:http";
import { readFile, mkdir, rename, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { WebSocketServer } from "ws";
import { Room } from "./room.js";
import { makeCode, GameError } from "./game.js";

const root = fileURLToPath(new URL("../public", import.meta.url));
const dataDir =
  process.env.CARDS_DATA_DIR ||
  fileURLToPath(new URL("../.local/rooms", import.meta.url));
const port = Number(process.env.PORT || 3000);
await mkdir(dataDir, { recursive: true });
const rooms = new Map(),
  limits = new Map();
async function getRoom(code) {
  if (!rooms.has(code)) {
    // Cache the load itself so concurrent requests cannot create two coordinators.
    const pending = (async () => {
      let state = null;
      try {
        state = JSON.parse(
          await readFile(path.join(dataDir, `${code}.json`), "utf8"),
        );
      } catch (e) {
        if (e.code !== "ENOENT") throw e;
      }
      // Live connections do not survive a restart; reserve their seats for reconnect.
      if (state)
        for (const p of state.players)
          if (p.token && p.connected) {
            p.connected = false;
            p.disconnectAt = Date.now() + 120_000;
          }
      let timer;
      const room = new Room({
        state,
        save: async (state) => {
          const destination = path.join(dataDir, `${code}.json`);
          await writeFile(`${destination}.tmp`, JSON.stringify(state), {
            mode: 0o600,
          });
          await rename(`${destination}.tmp`, destination);
        },
        alarm: async (deadline) => {
          clearTimeout(timer);
          if (deadline)
            timer = setTimeout(
              () => room.tick().catch(console.error),
              Math.max(0, deadline - Date.now()),
            );
          timer?.unref();
        },
      });
      return room;
    })();
    rooms.set(code, pending);
    pending.catch(() => rooms.delete(code));
  }
  return rooms.get(code);
}
const json = (res, status, body) => {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(body));
};
const allow = (key) => {
  const now = Date.now();
  for (const [k, bucket] of limits)
    if (now - bucket.start > 60_000) limits.delete(k);
  const bucket = limits.get(key) || { start: now, count: 0 };
  limits.set(key, bucket);
  return ++bucket.count <= 30;
};
const headers = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Content-Security-Policy":
    "default-src 'self'; connect-src 'self' ws: wss:; style-src 'self'; script-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
};
const server = http.createServer(async (req, res) => {
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname.startsWith("/api/")) {
      if (req.method !== "POST") return json(res, 405, { error: "Use POST." });
      if (req.headers.origin !== url.origin)
        return json(res, 403, { error: "Invalid origin." });
      if (!allow(req.socket.remoteAddress))
        return json(res, 429, {
          error: "Too many attempts. Try again in one minute.",
        });
      let text = "";
      for await (const chunk of req) {
        text += chunk;
        if (text.length > 2048)
          return json(res, 413, { error: "Request too large." });
      }
      const body = JSON.parse(text || "{}");
      if (url.pathname === "/api/rooms") {
        for (let i = 0; i < 20; i++) {
          const code = makeCode(),
            room = await getRoom(code);
          if (!room.state)
            return json(res, 201, await room.initialize(code, body));
        }
        return json(res, 503, { error: "Try creating a table again." });
      }
      const match = url.pathname.match(/^\/api\/rooms\/([A-Z]{4})\/join$/);
      if (match) return json(res, 200, await (await getRoom(match[1])).join());
      return json(res, 404, { error: "Not found." });
    }
    if (!["GET", "HEAD"].includes(req.method)) {
      res.writeHead(405);
      return res.end();
    }
    const name =
      url.pathname === "/"
        ? "index.html"
        : decodeURIComponent(url.pathname).slice(1);
    const filename = path.resolve(root, name);
    if (!filename.startsWith(root + path.sep)) {
      res.writeHead(403);
      return res.end();
    }
    const content = await readFile(filename);
    const type =
      {
        ".html": "text/html; charset=utf-8",
        ".js": "text/javascript; charset=utf-8",
        ".css": "text/css; charset=utf-8",
        ".svg": "image/svg+xml",
      }[path.extname(filename)] || "application/octet-stream";
    res.writeHead(200, { "Content-Type": type });
    res.end(req.method === "HEAD" ? undefined : content);
  } catch (error) {
    if (error.code === "ENOENT") {
      res.writeHead(404);
      res.end("Not found");
    } else if (error instanceof GameError || error instanceof SyntaxError)
      json(res, 400, {
        error:
          error instanceof SyntaxError ? "Invalid request." : error.message,
      });
    else {
      console.error(error);
      json(res, 500, { error: "Something went wrong." });
    }
  }
});
const wss = new WebSocketServer({ noServer: true, maxPayload: 16_384 });
server.on("upgrade", async (req, socket, head) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const match = url.pathname.match(/^\/api\/rooms\/([A-Z]{4})\/socket$/);
  if (
    !match ||
    req.headers.origin !== url.origin ||
    !allow(req.socket.remoteAddress)
  ) {
    socket.end("HTTP/1.1 403 Forbidden\r\n\r\n");
    return;
  }
  const room = await getRoom(match[1]);
  wss.handleUpgrade(req, socket, head, (ws) => {
    let attachment = { createdAt: Date.now(), token: null };
    const wrapper = {
      info: () => attachment,
      attach: (value) => {
        attachment = value;
      },
      send: (data) => {
        if (ws.readyState === 1) ws.send(JSON.stringify(data));
      },
      close: () => ws.close(),
    };
    room.connect(wrapper).catch(console.error);
    ws.on("message", (data) => room.message(wrapper, data.toString()));
    ws.on("close", () => room.disconnect(wrapper).catch(console.error));
    ws.on("error", () => ws.close());
  });
});
server.listen(port, "0.0.0.0", () =>
  console.log(`Card Table is listening on port ${port}.`),
);
