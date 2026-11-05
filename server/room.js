import {
  act,
  createGame,
  joinGame,
  viewFor,
  playerFor,
  expireSeats,
  GRACE_MS,
  GameError,
} from "./game.js";

// The same serialized coordinator runs in Node and in a Durable Object.
export class Room {
  constructor({ state = null, save, alarm, sockets = [] }) {
    this.state = state;
    this.save = save;
    this.alarm = alarm;
    this.sockets = new Set(sockets);
    this.queue = Promise.resolve();
  }
  run(fn) {
    const result = this.queue.then(async () => {
      if (this.state) expireSeats(this.state);
      try {
        return await fn();
      } finally {
        await this.commit();
      }
    });
    this.queue = result.catch(() => {});
    return result;
  }
  async commit() {
    if (!this.state) return;
    this.state.revision++;
    await this.save(this.state);
    const deadlines = this.state.players
      .filter((p) => p.token && !p.connected)
      .map((p) => p.disconnectAt);
    for (const socket of this.sockets) {
      const info = socket.info();
      if (!info.token) {
        deadlines.push(info.createdAt + 10_000);
        continue;
      }
      const view = viewFor(this.state, info.token);
      if (view) socket.send({ type: "state", state: view });
      else {
        socket.send({ type: this.state.closed ? "closed" : "left" });
        this.sockets.delete(socket);
        socket.close();
      }
    }
    await this.alarm(deadlines.length ? Math.min(...deadlines) : null);
  }
  initialize(code, options) {
    return this.run(() => {
      if (this.state) throw new GameError("Code already used.");
      if (!options || typeof options !== "object" || Array.isArray(options))
        throw new GameError("Choose a valid deck.");
      const game = createGame(code, options.kind, options.jokers ?? 0);
      this.state = game.state;
      return { token: game.token, state: viewFor(this.state, game.token) };
    });
  }
  join() {
    return this.run(() => {
      if (!this.state) throw new GameError("No table found with that code.");
      const token = joinGame(this.state);
      return { token, state: viewFor(this.state, token) };
    });
  }
  connect(socket) {
    this.sockets.add(socket);
    return this.run(() => {});
  }
  message(socket, raw) {
    return this.run(() => {
      if (!this.sockets.has(socket)) return;
      if (raw.length > 16_384) {
        socket.close();
        return;
      }
      let data;
      try {
        data = JSON.parse(raw);
      } catch {
        throw new GameError("Invalid message.");
      }
      if (!data || typeof data !== "object" || Array.isArray(data))
        throw new GameError("Invalid message.");
      const info = socket.info();
      const now = Date.now();
      if (!info.window || now - info.window > 10_000) {
        info.window = now;
        info.messages = 0;
      }
      info.messages++;
      if (info.messages > 80) throw new GameError("Please slow down.");
      socket.attach(info);
      if (!this.state || this.state.closed) {
        socket.send({ type: "closed" });
        socket.close();
        return;
      }
      if (data.type === "auth") {
        const player = playerFor(this.state, data.token);
        if (!player || (info.token && info.token !== data.token)) {
          socket.send({ type: "left" });
          this.sockets.delete(socket);
          socket.close();
          return;
        }
        socket.attach({ ...info, token: data.token });
        player.connected = true;
        player.disconnectAt = null;
        return;
      }
      if (!info.token) throw new GameError("Please reconnect to the table.");
      if (data.type === "ping") {
        socket.send({ type: "pong" });
        return;
      }
      act(this.state, info.token, data);
    }).catch((error) => {
      socket.send({
        type: "error",
        message:
          error instanceof GameError
            ? error.message
            : "The action could not be saved. Please reconnect.",
      });
      if (!(error instanceof GameError)) console.error(error);
    });
  }
  disconnect(socket) {
    return this.run(() => {
      this.sockets.delete(socket);
      const token = socket.info().token;
      if (
        !this.state ||
        !token ||
        [...this.sockets].some((s) => s.info().token === token)
      )
        return;
      const player = playerFor(this.state, token);
      if (player) {
        player.connected = false;
        player.disconnectAt = Date.now() + GRACE_MS;
      }
    });
  }
  tick() {
    return this.run(() => {
      for (const socket of this.sockets) {
        const info = socket.info();
        if (!info.token && Date.now() >= info.createdAt + 10_000) {
          this.sockets.delete(socket);
          socket.close();
        }
      }
    });
  }
}
