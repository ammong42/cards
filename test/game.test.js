import test from "node:test";
import assert from "node:assert/strict";
import {
  createGame,
  makeDeck,
  makeCode,
  joinGame,
  act,
  viewFor,
  expireSeats,
  GRACE_MS,
} from "../server/game.js";
import { Room } from "../server/room.js";
const setup = (n = 4, kind = "standard", jokers = 0) => {
  const { state, token } = createGame("ABCD", kind, jokers);
  const tokens = [token];
  for (let i = 1; i < n; i++) tokens.push(joinGame(state));
  return { state, tokens, host: token };
};
const cardsIn = (state) => state.collections.flatMap((c) => c.cards);
const ref = (state, id, n = 1) =>
  state.collections
    .find((c) => c.id === id)
    .cards.slice(-n)
    .map((c) => ({ id: c.id, source: id }));

test("deck composition and unambiguous four-letter codes", () => {
  for (let jokers = 0; jokers <= 2; jokers++) {
    const cards = makeDeck("standard", jokers);
    assert.equal(cards.length, 52 + jokers);
    assert.equal(new Set(cards.map((c) => c.id)).size, cards.length);
    assert.equal(cards.filter((c) => c.suit === "joker").length, jokers);
  }
  const rook = makeDeck("rook", 0);
  assert.equal(rook.length, 57);
  assert.equal(rook.filter((c) => c.suit === "rook").length, 1);
  assert.equal(rook.filter((c) => c.color === "yellow").length, 14);
  for (let i = 0; i < 100; i++) assert.match(makeCode(), /^[A-HJ-NP-Z]{4}$/);
  assert.throws(() => makeDeck("standard", 3));
});
test("initial hands, seat order, full rooms, and private serialization", () => {
  const { state, tokens } = setup();
  assert.deepEqual(
    tokens.map((t) => viewFor(state, t).seat),
    [1, 2, 3, 4],
  );
  assert.throws(() => joinGame(state), /full/);
  const view = viewFor(state, tokens[0]);
  assert.equal(view.collections[0].cards.length, 52);
  assert.deepEqual(Object.keys(view.collections[0].cards[0]), ["id"]);
  assert.ok(!JSON.stringify(view).includes("token"));
  assert.equal(viewFor(state, "forged"), null);
});
test("round-robin dealing always uses the Deck and assigns host-selected extras", () => {
  const { state, host, tokens } = setup();
  const before = [...state.collections[0].cards];
  act(state, host, { type: "deal", count: 12, start: 3, extras: [2, 4] });
  const hands = state.collections.filter((c) => c.type === "hand");
  assert.deepEqual(
    hands.map((c) => c.cards.length),
    [12, 13, 12, 13],
  );
  assert.equal(hands[2].cards[0].id, before.at(-1).id);
  assert.equal(hands[3].cards[0].id, before.at(-2).id);
  assert.equal(state.collections[0].cards.length, 2);
  const own = viewFor(state, tokens[1]).collections.find(
    (c) => c.id === "hand-2",
  );
  assert.ok(own.cards.every((c) => c.rank));
  const other = viewFor(state, host).collections.find((c) => c.id === "hand-2");
  assert.ok(other.cards.every((c) => !c.rank && !c.suit && !c.color));
  assert.equal(new Set(cardsIn(state).map((c) => c.id)).size, 52);
});
test("invalid and insufficient deals leave every card in place", () => {
  const { state, host } = setup();
  for (const action of [
    { count: 14, start: 1, extras: [] },
    { count: 2, start: 5, extras: [] },
    { count: 1, start: 1, extras: [1, 1] },
    { count: -1, start: 1, extras: [] },
    { count: 1, start: 1, extras: [5] },
    { count: 0, start: 1, extras: [] },
  ]) {
    const before = JSON.stringify(state);
    assert.throws(() => act(state, host, { type: "deal", ...action }));
    assert.equal(JSON.stringify(state), before);
  }
});
test("players give directly to hands, but cannot take from occupied or reconnecting hands", () => {
  const { state, tokens, host } = setup();
  act(state, host, {
    type: "move",
    cards: ref(state, "deck", 3),
    target: "hand-2",
  });
  assert.throws(
    () =>
      act(state, host, {
        type: "move",
        cards: ref(state, "hand-2"),
        target: "hand-1",
      }),
    /private/,
  );
  state.players[1].connected = false;
  assert.throws(
    () =>
      act(state, host, {
        type: "move",
        cards: ref(state, "hand-2"),
        target: "deck",
      }),
    /private/,
  );
  act(state, tokens[1], {
    type: "move",
    cards: ref(state, "hand-2"),
    target: "hand-3",
  });
  assert.equal(
    state.collections.find((c) => c.id === "hand-3").cards.length,
    1,
  );
});
test("exiting releases a fixed seat; its cards remain hidden and available; replacement inherits remainder", () => {
  const { state, tokens, host } = setup();
  act(state, host, {
    type: "move",
    cards: ref(state, "deck", 3),
    target: "hand-2",
  });
  act(state, tokens[1], { type: "exit" });
  const vacant = viewFor(state, host).collections.find(
    (c) => c.id === "hand-2",
  );
  assert.equal(vacant.canTake, true);
  assert.ok(vacant.cards.every((c) => !c.rank));
  act(state, host, {
    type: "move",
    cards: ref(state, "hand-2"),
    target: "hand-1",
  });
  const replacement = joinGame(state);
  assert.equal(viewFor(state, replacement).seat, 2);
  assert.equal(
    viewFor(state, replacement).collections.find((c) => c.id === "hand-2").cards
      .length,
    2,
  );
  assert.equal(viewFor(state, tokens[1]), null);
});
test("pile visibility, naming, deletion rules and layout swaps are host controlled", () => {
  const { state, host, tokens } = setup();
  assert.throws(() => act(state, tokens[1], { type: "createPile" }), /host/);
  act(state, host, { type: "createPile" });
  act(state, host, { type: "createPile" });
  act(state, tokens[1], {
    type: "move",
    cards: ref(state, "deck", 3),
    target: "pile-1",
  });
  assert.throws(
    () => act(state, host, { type: "deletePile", id: "pile-1" }),
    /empty/,
  );
  act(state, host, {
    type: "editPile",
    id: "pile-1",
    name: "<Table>",
    faceUp: true,
  });
  assert.ok(
    viewFor(state, tokens[3])
      .collections.find((c) => c.id === "pile-1")
      .cards.every((c) => c.rank),
  );
  act(state, host, {
    type: "editPile",
    id: "pile-1",
    name: "Tricks",
    faceUp: false,
  });
  assert.ok(
    viewFor(state, tokens[3])
      .collections.find((c) => c.id === "pile-1")
      .cards.every((c) => !c.rank),
  );
  act(state, host, { type: "position", id: "deck", position: 1 });
  assert.equal(state.collections.find((c) => c.id === "pile-1").position, 0);
  assert.equal(
    new Set(
      state.collections.filter((c) => c.type !== "hand").map((c) => c.position),
    ).size,
    3,
  );
  act(state, host, { type: "deletePile", id: "pile-2" });
});
test("return gathers all cards without shuffling or removing collections", () => {
  const { state, host, tokens } = setup();
  act(state, host, { type: "createPile" });
  act(state, host, { type: "deal", count: 5, start: 1, extras: [2] });
  const deckBefore = [...state.collections[0].cards];
  assert.throws(() => act(state, tokens[1], { type: "return" }), /host/);
  assert.throws(() => act(state, tokens[1], { type: "shuffle" }), /host/);
  act(state, host, { type: "return" });
  assert.equal(state.collections.length, 6);
  assert.equal(state.collections[0].cards.length, 52);
  assert.deepEqual(
    state.collections[0].cards.slice(0, deckBefore.length),
    deckBefore,
  );
  assert.ok(state.collections.slice(1).every((c) => !c.cards.length));
  const faces = (cards) =>
    cards.map((c) => `${c.rank}:${c.suit}:${c.color}`).sort();
  const beforeFaces = faces(cardsIn(state)),
    oldIds = new Set(cardsIn(state).map((c) => c.id));
  act(state, host, { type: "shuffle" });
  assert.deepEqual(faces(cardsIn(state)), beforeFaces);
  assert.ok(
    cardsIn(state).every((c) => !oldIds.has(c.id)),
    "Shuffle must prevent tracking known values by card ID",
  );
});
test("stale and duplicate selections fail atomically; cards cannot disappear", () => {
  const { state, host, tokens } = setup();
  const top = ref(state, "deck");
  assert.throws(
    () =>
      act(state, host, {
        type: "move",
        cards: [...top, ...top],
        target: "hand-1",
      }),
    /once/,
  );
  act(state, tokens[1], { type: "move", cards: top, target: "hand-2" });
  const before = JSON.stringify(state);
  assert.throws(
    () =>
      act(state, host, {
        type: "move",
        cards: [...ref(state, "deck"), ...top],
        target: "hand-1",
      }),
    /moved/,
  );
  assert.equal(JSON.stringify(state), before);
  assert.equal(cardsIn(state).length, 52);
});
test("host can explicitly transfer or close the table; the final exit closes it", () => {
  const { state, host, tokens } = setup(2);
  assert.throws(() => act(state, host, { type: "exit" }), /Choose/);
  act(state, host, { type: "exit", host: 2 });
  assert.equal(state.host, 2);
  act(state, tokens[1], { type: "exit" });
  assert.equal(state.closed, true);
  assert.equal(state.collections.length, 0);
  assert.throws(() => joinGame(state), /closed/);
  const other = setup(3);
  act(other.state, other.host, { type: "exit", close: true });
  assert.equal(other.state.closed, true);
  assert.equal(viewFor(other.state, other.tokens[1]), null);
});
test("disconnect grace, automatic host transfer, and all-absent closure", () => {
  const { state } = setup(3);
  const deadline = Date.now() + GRACE_MS;
  state.players[0].disconnectAt = deadline;
  state.players[1].connected = true;
  state.players[1].disconnectAt = null;
  state.players[2].disconnectAt = deadline + 100;
  expireSeats(state, deadline - 1);
  assert.equal(state.host, 1);
  assert.ok(state.players[0].token);
  expireSeats(state, deadline);
  assert.equal(state.host, 2);
  assert.equal(state.players[0].token, null);
  state.players[1].connected = false;
  state.players[1].disconnectAt = deadline + 100;
  expireSeats(state, deadline + 100);
  assert.equal(state.closed, true);
});
const fakeSocket = () => {
  let info = { token: null, createdAt: Date.now() };
  const messages = [];
  return {
    messages,
    info: () => info,
    attach: (value) => {
      info = value;
    },
    send: (message) => messages.push(message),
    close() {},
  };
};
test("coordinator serializes concurrent moves and reauthenticates a refresh without losing its seat", async () => {
  let stored;
  const room = new Room({
    save: async (s) => {
      stored = structuredClone(s);
    },
    alarm: async () => {},
  });
  const host = await room.initialize("ABCD", { kind: "standard" });
  const guest = await room.join();
  const a = fakeSocket(),
    b = fakeSocket();
  await room.connect(a);
  await room.connect(b);
  await room.message(a, JSON.stringify({ type: "auth", token: host.token }));
  await room.message(b, JSON.stringify({ type: "auth", token: guest.token }));
  const cards = ref(room.state, "deck");
  await Promise.all([
    room.message(a, JSON.stringify({ type: "move", cards, target: "hand-1" })),
    room.message(b, JSON.stringify({ type: "move", cards, target: "hand-2" })),
  ]);
  assert.equal(room.state.collections[0].cards.length, 51);
  assert.ok(
    b.messages.some((m) => m.type === "error" && /moved/.test(m.message)),
  );
  assert.equal(stored.collections[0].cards.length, 51);
  await room.disconnect(a);
  assert.equal(room.state.players[0].connected, false);
  const refreshed = fakeSocket();
  await room.connect(refreshed);
  await room.message(
    refreshed,
    JSON.stringify({ type: "auth", token: host.token }),
  );
  assert.equal(room.state.players[0].connected, true);
  assert.equal(
    refreshed.messages.at(-1).state.collections.find((c) => c.id === "hand-1")
      .cards.length,
    1,
  );
  assert.equal(
    b.messages
      .filter((m) => m.type === "state")
      .at(-1)
      .state.collections.find((c) => c.id === "hand-1").cards[0].rank,
    undefined,
  );
});
test("coordinator rejects unauthorized socket commands and expired recovery tokens", async () => {
  const room = new Room({ save: async () => {}, alarm: async () => {} });
  const host = await room.initialize("ABCD", { kind: "rook" });
  const guest = await room.join();
  const a = fakeSocket();
  await room.connect(a);
  await room.message(a, JSON.stringify({ type: "shuffle" }));
  assert.equal(a.messages.at(-1).type, "error");
  room.state.players[0].disconnectAt = Date.now() - 1;
  await room.message(a, JSON.stringify({ type: "auth", token: host.token }));
  assert.ok(a.messages.some((m) => m.type === "left"));
  assert.equal(room.state.host, 2);
  assert.equal(viewFor(room.state, guest.token).seat, 2);
});
