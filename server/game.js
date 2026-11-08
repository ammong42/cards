export const GRACE_MS = 120_000;
export const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ";
export class GameError extends Error {}
const fail = (message) => {
  throw new GameError(message);
};
const integer = (n, min, max) => Number.isInteger(n) && n >= min && n <= max;
const unique = (xs) => new Set(xs).size === xs.length;
const handSuits = [
  "♣",
  "♦",
  "♥",
  "♠",
  "black",
  "green",
  "red",
  "yellow",
  "rook",
  "joker",
];
const handValue = (card) =>
  card.suit === "rook" || card.suit === "joker"
    ? 15
    : ({ J: 11, Q: 12, K: 13, A: 14 }[card.rank] ?? Number(card.rank));
function compareHandCards(a, b, by) {
  const number = handValue(a) - handValue(b);
  const suit = handSuits.indexOf(a.suit) - handSuits.indexOf(b.suit);
  return (
    (by === "suit" ? suit || number : number || suit) ||
    a.color.localeCompare(b.color)
  );
}
export const randomInt = (max) => {
  const limit = 0x100000000 - (0x100000000 % max);
  const value = new Uint32Array(1);
  do {
    crypto.getRandomValues(value);
  } while (value[0] >= limit);
  return value[0] % max;
};
export const makeCode = () =>
  Array.from(
    { length: 4 },
    () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)],
  ).join("");
export function shuffle(cards) {
  for (let i = cards.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  // A shuffle must also break the link between public card IDs and hidden cards.
  for (const card of cards) card.id = crypto.randomUUID();
}
export function makeDeck(kind, jokers) {
  const cards = [];
  const add = (rank, suit, color) =>
    cards.push({ id: crypto.randomUUID(), rank, suit, color });
  if (kind === "rook" || kind === "500") {
    for (const color of ["red", "green", "yellow", "black"]) {
      for (let rank = kind === "500" ? 4 : 1; rank <= 14; rank++)
        add(String(rank), color, color);
    }
    add("R", "rook", "black");
  } else if (kind === "standard" && integer(jokers, 0, 2)) {
    for (const [suit, color] of [
      ["♠", "black"],
      ["♥", "red"],
      ["♣", "black"],
      ["♦", "red"],
    ]) {
      for (const rank of [
        "A",
        "2",
        "3",
        "4",
        "5",
        "6",
        "7",
        "8",
        "9",
        "10",
        "J",
        "Q",
        "K",
      ])
        add(rank, suit, color);
    }
    for (let i = 0; i < jokers; i++) add("★", "joker", i ? "red" : "black");
  } else fail("Choose a valid deck and 0, 1, or 2 jokers.");
  return cards;
}
export function createGame(code, kind, jokers = 0, now = Date.now()) {
  const deck = makeDeck(kind, jokers);
  shuffle(deck);
  const players = Array.from({ length: 4 }, (_, i) => ({
    seat: i + 1,
    token: null,
    connected: false,
    disconnectAt: null,
  }));
  const token = crypto.randomUUID();
  Object.assign(players[0], { token, disconnectAt: now + GRACE_MS });
  return {
    token,
    state: {
      code,
      kind,
      jokers: kind === "standard" ? jokers : 0,
      host: 1,
      closed: false,
      revision: 0,
      players,
      nextPile: 1,
      total: deck.length,
      collections: [
        {
          id: "deck",
          name: "Deck",
          type: "deck",
          faceUp: false,
          position: 0,
          cards: deck,
        },
        ...players.map((p) => ({
          id: `hand-${p.seat}`,
          name: `Player ${p.seat}`,
          type: "hand",
          seat: p.seat,
          cards: [],
        })),
      ],
      events: ["Player 1 opened the table."],
    },
  };
}
export const occupied = (state) => state.players.filter((p) => p.token);
export const playerFor = (state, token) =>
  state.players.find((p) => p.token && p.token === token);
export const collectionFor = (state, id) =>
  state.collections.find((c) => c.id === id);
export const canTake = (state, seat, c) =>
  c.type !== "hand" || c.seat === seat || !state.players[c.seat - 1].token;
function record(state, text) {
  state.events = [...state.events.slice(-14), text];
}
function createPile(state, name) {
  if (state.collections.filter((c) => c.type !== "hand").length >= 60)
    fail("This table has reached its 60-pile limit.");
  let position = 0;
  while (state.collections.some((c) => c.position === position)) position++;
  const n = state.nextPile++;
  const pile = {
    id: `pile-${n}`,
    name: name ?? `Pile ${n}`,
    type: "pile",
    faceUp: false,
    position,
    cards: [],
  };
  state.collections.push(pile);
  return pile;
}
export function closeGame(state) {
  state.closed = true;
  state.collections = [];
  state.players.forEach((p) =>
    Object.assign(p, { token: null, connected: false, disconnectAt: null }),
  );
}
export function expireSeats(state, now = Date.now()) {
  if (state.closed) return false;
  let changed = false;
  for (const p of state.players) {
    if (p.token && !p.connected && p.disconnectAt <= now) {
      Object.assign(p, { token: null, disconnectAt: null });
      record(state, `Player ${p.seat}'s seat is now available.`);
      changed = true;
    }
  }
  if (!occupied(state).length) {
    closeGame(state);
    return changed;
  }
  if (!state.players[state.host - 1].token) {
    state.host = (
      occupied(state).find((p) => p.connected) || occupied(state)[0]
    ).seat;
    record(state, `Player ${state.host} is now the host.`);
  }
  return changed;
}
export function joinGame(state, now = Date.now()) {
  if (state.closed) fail("This table has closed. Create a new game.");
  const p = state.players.find((p) => !p.token);
  if (!p)
    fail("This table is full. Reconnecting seats are held for two minutes.");
  Object.assign(p, {
    token: crypto.randomUUID(),
    connected: false,
    disconnectAt: now + GRACE_MS,
  });
  record(state, `Player ${p.seat} joined the table.`);
  return p.token;
}
export function viewFor(state, token) {
  const player = playerFor(state, token);
  if (!player || state.closed) return null;
  return {
    code: state.code,
    kind: state.kind,
    jokers: state.jokers,
    host: state.host,
    seat: player.seat,
    revision: state.revision,
    total: state.total,
    events: state.events,
    players: state.players.map((p) => ({
      seat: p.seat,
      occupied: !!p.token,
      connected: p.connected,
      disconnectAt: p.disconnectAt,
    })),
    collections: state.collections.map((c) => ({
      ...c,
      cards: c.cards.map((card) =>
        c.faceUp || (c.type === "hand" && c.seat === player.seat)
          ? { ...card }
          : { id: card.id },
      ),
      canTake: canTake(state, player.seat, c),
    })),
  };
}
export function act(state, token, action) {
  if (state.closed) fail("This table has closed.");
  const p = playerFor(state, token);
  if (!p) fail("Your seat is no longer available. Join the table again.");
  if (!action || typeof action !== "object") fail("Invalid action.");
  const isHost = p.seat === state.host;
  const hostOnly = () => {
    if (!isHost) fail("Only the host can do that.");
  };
  const deck = collectionFor(state, "deck");
  switch (action.type) {
    case "draw": {
      if (!deck.cards.length) fail("The Deck is empty.");
      collectionFor(state, `hand-${p.seat}`).cards.push(deck.cards.pop());
      record(state, `Player ${p.seat} drew one card from the Deck.`);
      break;
    }
    case "sortHand": {
      if (!["number", "suit"].includes(action.by))
        fail("Choose a valid hand sort order.");
      collectionFor(state, `hand-${p.seat}`).cards.sort((a, b) =>
        compareHandCards(a, b, action.by),
      );
      break;
    }
    case "reorderHand": {
      const hand = collectionFor(state, `hand-${p.seat}`);
      const from = hand.cards.findIndex((c) => c.id === action.id);
      if (from === -1)
        fail("That card is no longer in your hand. Please select again.");
      if (
        action.before !== null &&
        !hand.cards.some((c) => c.id === action.before)
      )
        fail("The destination card has moved. Please try again.");
      if (action.before === action.id) break;
      const [card] = hand.cards.splice(from, 1);
      const to =
        action.before === null
          ? hand.cards.length
          : hand.cards.findIndex((c) => c.id === action.before);
      hand.cards.splice(to, 0, card);
      break;
    }
    case "move": {
      const target = collectionFor(state, action.target);
      if (
        !target ||
        !Array.isArray(action.cards) ||
        !action.cards.length ||
        action.cards.length > state.total
      )
        fail("Choose cards and a destination.");
      if (!unique(action.cards.map((c) => c.id)))
        fail("Each card can only be moved once.");
      const moves = action.cards.map((ref) => {
        const source = collectionFor(state, ref.source);
        if (!source || !canTake(state, p.seat, source))
          fail("That hand is private.");
        const card = source.cards.find((c) => c.id === ref.id);
        if (!card) fail("A selected card has moved. Please select again.");
        if (source === target) fail("Choose a different destination.");
        return { source, card };
      });
      for (const { source, card } of moves) {
        source.cards.splice(source.cards.indexOf(card), 1);
        target.cards.push(card);
      }
      record(
        state,
        `Player ${p.seat} moved ${moves.length} card${moves.length === 1 ? "" : "s"} to ${target.name}.`,
      );
      break;
    }
    case "shuffle":
      hostOnly();
      shuffle(deck.cards);
      record(state, "The host shuffled the Deck.");
      break;
    case "return":
      hostOnly();
      for (const c of state.collections)
        if (c !== deck) {
          deck.cards.push(...c.cards);
          c.cards = [];
        }
      record(state, "The host returned all cards to the Deck.");
      break;
    case "deal": {
      hostOnly();
      const players = occupied(state).map((p) => p.seat);
      const extras = action.extras;
      if (
        !integer(action.count, 0, state.total) ||
        !Array.isArray(extras) ||
        !unique(extras) ||
        !extras.every((s) => players.includes(s))
      )
        fail("Choose a valid deal.");
      const total = action.count * players.length + extras.length;
      if (!total || total > deck.cards.length)
        fail("There are not enough cards in the Deck for that deal.");
      if (!players.includes(action.start))
        fail("Choose an occupied starting seat.");
      const start = players.indexOf(action.start);
      const order = [...players.slice(start), ...players.slice(0, start)];
      for (let round = 0; round < action.count; round++) {
        for (const seat of order)
          collectionFor(state, `hand-${seat}`).cards.push(deck.cards.pop());
      }
      for (const seat of order.filter((s) => extras.includes(s)))
        collectionFor(state, `hand-${seat}`).cards.push(deck.cards.pop());
      record(state, `The host dealt ${total} cards from the Deck.`);
      break;
    }
    case "deal500": {
      hostOnly();
      if (state.kind !== "500") fail("Deal for 500 requires a 500 Deck.");
      if (occupied(state).length !== 4)
        fail(
          "Deal for 500 needs four occupied seats. Invite the other players first.",
        );
      if (deck.cards.length !== 45)
        fail("Return all 45 cards to the Deck before using Deal for 500.");
      const middle =
        state.collections.find(
          (c) => c.type === "pile" && c.name.trim().toLowerCase() === "middle",
        ) ?? createPile(state, "Middle");
      middle.faceUp = false;
      for (let round = 0; round < 10; round++)
        for (let seat = 1; seat <= 4; seat++)
          collectionFor(state, `hand-${seat}`).cards.push(deck.cards.pop());
      for (let i = 0; i < 5; i++) middle.cards.push(deck.cards.pop());
      record(
        state,
        "The host dealt for 500: 10 cards per player and 5 face down to Middle.",
      );
      break;
    }
    case "createPile": {
      hostOnly();
      const pile = createPile(state);
      record(state, `The host created ${pile.name}.`);
      break;
    }
    case "editPile": {
      hostOnly();
      const c = collectionFor(state, action.id);
      if (!c || c.type !== "pile") fail("Choose a shared pile.");
      if (
        typeof action.name !== "string" ||
        !action.name.trim() ||
        action.name.trim().length > 32 ||
        typeof action.faceUp !== "boolean"
      )
        fail("Use a name between 1 and 32 characters.");
      c.name = action.name.trim();
      c.faceUp = action.faceUp;
      record(state, `The host updated ${c.name}.`);
      break;
    }
    case "deletePile": {
      hostOnly();
      const c = collectionFor(state, action.id);
      if (!c || c.type !== "pile" || c.cards.length)
        fail("Only empty shared piles can be deleted.");
      state.collections.splice(state.collections.indexOf(c), 1);
      record(state, `The host removed ${c.name}.`);
      break;
    }
    case "position": {
      hostOnly();
      const c = collectionFor(state, action.id);
      if (!c || c.type === "hand" || !integer(action.position, 0, 59))
        fail("Choose a valid table position.");
      const other = state.collections.find(
        (x) => x.type !== "hand" && x.position === action.position,
      );
      if (other) other.position = c.position;
      c.position = action.position;
      break;
    }
    case "exit": {
      if (isHost) {
        if (action.close || occupied(state).length === 1) {
          closeGame(state);
          return;
        }
        const next = state.players.find(
          (x) => x.seat === action.host && x.seat !== p.seat && x.token,
        );
        if (!next)
          fail("Choose a player to become the host, or close the game.");
        state.host = next.seat;
      }
      Object.assign(p, { token: null, connected: false, disconnectAt: null });
      record(state, `Player ${p.seat} left the table.`);
      if (!occupied(state).length) closeGame(state);
      break;
    }
    default:
      fail("Unknown action.");
  }
}
