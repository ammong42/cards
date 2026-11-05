import { Room } from "./room.js";
import { makeCode, GameError, GRACE_MS } from "./game.js";
const json = (body, status = 200) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
const security = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Content-Security-Policy":
    "default-src 'self'; connect-src 'self' ws: wss:; style-src 'self'; script-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
};
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) {
      const asset = await env.ASSETS.fetch(request);
      const response = new Response(asset.body, asset);
      for (const [k, v] of Object.entries(security)) response.headers.set(k, v);
      return response;
    }
    if (request.headers.get("Origin") !== url.origin)
      return json({ error: "Invalid origin." }, 403);
    const ip = request.headers.get("CF-Connecting-IP") || "unknown";
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(ip),
    );
    const key = Array.from(new Uint8Array(digest), (n) =>
      n.toString(16).padStart(2, "0"),
    ).join("");
    const limiter = env.LIMITS.get(env.LIMITS.idFromName(key));
    const limit = await limiter.fetch("https://limit/check");
    if (limit.status === 429)
      return json(
        { error: "Too many attempts. Try again in one minute." },
        429,
      );
    try {
      if (request.method === "POST" && url.pathname === "/api/rooms") {
        const raw = await request.text();
        if (raw.length > 2048)
          return json({ error: "Request too large." }, 413);
        const options = JSON.parse(raw);
        for (let i = 0; i < 20; i++) {
          const code = makeCode();
          const room = env.ROOMS.get(env.ROOMS.idFromName(code));
          const result = await room.fetch(`https://room/${code}/initialize`, {
            method: "POST",
            body: JSON.stringify(options),
          });
          if (result.status !== 409) return result;
        }
        return json({ error: "Try creating a table again." }, 503);
      }
      const match = url.pathname.match(
        /^\/api\/rooms\/([A-Z]{4})\/(join|socket)$/,
      );
      if (!match || (match[2] === "join" && request.method !== "POST"))
        return json({ error: "Not found." }, 404);
      const room = env.ROOMS.get(env.ROOMS.idFromName(match[1]));
      return room.fetch(
        new Request(`https://room/${match[1]}/${match[2]}`, request),
      );
    } catch {
      return json(
        { error: "Could not reach the table. Please try again." },
        500,
      );
    }
  },
};
export class RateLimiter {
  constructor(ctx) {
    this.ctx = ctx;
  }
  async fetch() {
    return this.ctx.blockConcurrencyWhile(async () => {
      const now = Date.now();
      let bucket = await this.ctx.storage.get("bucket");
      if (!bucket || now - bucket.start >= 60_000)
        bucket = { start: now, count: 0 };
      bucket.count++;
      await this.ctx.storage.put("bucket", bucket);
      await this.ctx.storage.setAlarm(bucket.start + 60_000);
      return new Response(null, { status: bucket.count > 30 ? 429 : 204 });
    });
  }
  async alarm() {
    await this.ctx.storage.deleteAll();
  }
}
export class CardRoom {
  constructor(ctx) {
    this.ctx = ctx;
    this.wrappers = new Map();
    ctx.blockConcurrencyWhile(async () => {
      const state = (await ctx.storage.get("state")) || null;
      const sockets = ctx.getWebSockets().map((ws) => this.wrap(ws));
      // Hibernated sockets survive; after a runtime restart, missing sockets do not.
      if (state)
        for (const p of state.players) {
          if (
            p.token &&
            p.connected &&
            !sockets.some((s) => s.info().token === p.token)
          ) {
            p.connected = false;
            p.disconnectAt = Date.now() + GRACE_MS;
          }
        }
      this.room = new Room({
        state,
        sockets,
        save: (state) => ctx.storage.put("state", state),
        alarm: (deadline) =>
          deadline ? ctx.storage.setAlarm(deadline) : ctx.storage.deleteAlarm(),
      });
    });
  }
  wrap(ws) {
    if (!this.wrappers.has(ws))
      this.wrappers.set(ws, {
        info: () => ws.deserializeAttachment(),
        attach: (info) => ws.serializeAttachment(info),
        send: (data) => {
          try {
            ws.send(JSON.stringify(data));
          } catch {}
        },
        close: () => {
          try {
            ws.close(1000, "Session ended");
          } catch {}
        },
      });
    return this.wrappers.get(ws);
  }
  async fetch(request) {
    const [, code, operation] = new URL(request.url).pathname.split("/");
    try {
      if (operation === "initialize") {
        if (this.room.state) return json({ error: "Code already used." }, 409);
        return json(
          await this.room.initialize(code, await request.json()),
          201,
        );
      }
      if (operation === "join") return json(await this.room.join());
      if (operation === "socket") {
        if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket")
          return json({ error: "WebSocket required." }, 426);
        const pair = new WebSocketPair();
        const [client, server] = Object.values(pair);
        this.ctx.acceptWebSocket(server);
        server.serializeAttachment({ token: null, createdAt: Date.now() });
        await this.room.connect(this.wrap(server));
        return new Response(null, { status: 101, webSocket: client });
      }
      return json({ error: "Not found." }, 404);
    } catch (e) {
      if (!(e instanceof GameError)) console.error(e);
      return json(
        {
          error:
            e instanceof GameError ? e.message : "Could not update this table.",
        },
        e instanceof GameError ? 400 : 500,
      );
    }
  }
  webSocketMessage(ws, message) {
    return this.room.message(
      this.wrap(ws),
      typeof message === "string" ? message : "",
    );
  }
  async webSocketClose(ws) {
    await this.room.disconnect(this.wrap(ws));
    this.wrappers.delete(ws);
  }
  webSocketError(ws) {
    return this.webSocketClose(ws);
  }
  alarm() {
    return this.room.tick();
  }
}
