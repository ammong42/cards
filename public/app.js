const app = document.querySelector("#app");
const dialog = document.querySelector("#dialog");
const toastEl = document.querySelector("#toast");
const esc = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
let state = null,
  session = null,
  socket = null,
  connected = false,
  reconnectTimer,
  reconnectAttempt = 0,
  toastTimer;
let destination = "";
let handDrag = null;
let selected = new Map(),
  chosenDeck = "standard",
  busy = false;
try {
  session = JSON.parse(localStorage.getItem("cardroom.session"));
} catch {}
function toast(message) {
  toastEl.textContent = message;
  toastEl.classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove("visible"), 4500);
}
function persist() {
  try {
    if (session)
      localStorage.setItem("cardroom.session", JSON.stringify(session));
    else localStorage.removeItem("cardroom.session");
  } catch {
    toast(
      "Browser storage is unavailable. Keep this tab open to retain your seat.",
    );
  }
}
function brand() {
  return '<a class="brand" href="/" data-action="home"><span class="brand-mark">♣</span><span>Card Table<span class="brand-dot">.</span></span></a>';
}
function renderHome() {
  cancelHandDrag();
  app.innerHTML = `
    <header class="site-header">${brand()}<span class="header-note"><span class="status-dot"></span> Good company. Great cards.</span></header>
    <main class="home">
      <section class="hero">
        <div class="hero-copy"><div class="eyebrow"><span class="mini-line"></span> YOUR PEOPLE. YOUR HOUSE RULES.</div>
          <h1>A good hand.<br>Even better <em>company.</em></h1>
          <p>Your favorite card games, around one shared table.<br class="desktop"> Pull up a chair. We’ll bring the deck.</p>
          <div class="hero-points"><span><i>✓</i> No sign-up</span><span><i>✓</i> Up to 4 friends</span><span><i>✓</i> Play your way</span></div>
        </div>
        <div class="hero-art" aria-hidden="true"><div class="art-ring ring-one"></div><div class="art-ring ring-two"></div>
          <span class="art-spark spark-one">✦</span><span class="art-spark spark-two">✦</span>
          <div class="display-card fan-left"><b>K<span>♠</span></b><span class="display-suit">♠</span><b class="corner-end">K<span>♠</span></b></div>
          <div class="display-card fan-middle"><b>A<span>♥</span></b><span class="display-suit">♥</span><b class="corner-end">A<span>♥</span></b></div>
          <div class="display-card fan-right"><b>Q<span>♣</span></b><span class="display-suit">♣</span><b class="corner-end">Q<span>♣</span></b></div>
          <span class="art-caption">A little less scrolling. A little more shuffling.</span>
        </div>
      </section>
      <section class="lobby" aria-label="Start playing">
        <form id="create-form" class="lobby-panel create-panel">
          <div class="panel-heading"><span class="panel-icon">♧</span><div><h2>Make room for a game</h2><p>Start a table and invite your people.</p></div><span class="step-number">01</span></div>
          <label class="field-label">CHOOSE YOUR DECK</label>
          <div class="deck-options">
            <button type="button" class="deck-option ${chosenDeck === "standard" ? "active" : ""}" data-action="choose-deck" data-kind="standard" aria-pressed="${chosenDeck === "standard"}"><span class="deck-mini face-mini">A<span>♠</span></span><span><strong>Face cards</strong><small>The familiar favorite · 52 cards</small></span><span class="radio-dot"></span></button>
            <button type="button" class="deck-option ${chosenDeck === "rook" ? "active" : ""}" data-action="choose-deck" data-kind="rook" aria-pressed="${chosenDeck === "rook"}"><span class="deck-mini rook-mini">R<span>♜</span></span><span><strong>Rook cards</strong><small>A colorful classic · 57 cards</small></span><span class="radio-dot"></span></button>
            <button type="button" class="deck-option ${chosenDeck === "500" ? "active" : ""}" data-action="choose-deck" data-kind="500" aria-pressed="${chosenDeck === "500"}"><span class="deck-mini five-hundred-mini">5<span>●</span></span><span><strong>500 Deck</strong><small>Rook without 1s, 2s, or 3s · 45 cards</small></span><span class="radio-dot"></span></button>
          </div>
          <div class="joker-row" ${chosenDeck !== "standard" ? "hidden" : ""}><label for="jokers">A little wild?</label><select id="jokers" name="jokers"><option value="0">No jokers</option><option value="1">1 joker</option><option value="2">2 jokers</option></select></div>
          <button class="button primary full" type="submit" ${busy ? "disabled" : ""}>${busy ? "Opening your table…" : "Create a game"}<span>→</span></button>
        </form>
        <form id="join-form" class="lobby-panel join-panel"><div class="panel-heading"><span class="panel-icon">→</span><div><h2>There’s a seat for you</h2><p>Got an invite? Come on in.</p></div><span class="step-number">02</span></div>
          <label class="field-label" for="room-code">YOUR FOUR-LETTER GAME CODE</label>
          <input id="room-code" class="code-input" name="code" placeholder="ABCD" aria-describedby="code-help" maxlength="4" minlength="4" pattern="[A-Za-z]{4}" autocomplete="off" autocapitalize="characters" spellcheck="false" required>
          <p id="code-help" class="code-help">Ask your host for the code. We’ll save you a chair.</p>
          <button class="button secondary full" type="submit" ${busy ? "disabled" : ""}>Join a game<span>→</span></button>
          <div class="private-note"><span>♧</span> A private table, just for your circle.</div>
        </form>
      </section>
      <section class="how-it-works"><span class="field-label">ALL YOU NEED IS A DECK AND EACH OTHER.</span><p>No downloads. No complicated rules. Just a table that feels like yours.</p><div><span>01 <b>Pick a deck</b></span><span class="how-line"></span><span>02 <b>Share your code</b></span><span class="how-line"></span><span>03 <b>Settle in & play</b></span></div></section>
    </main><footer class="site-footer"><span>Made for the way you play.</span><span>♠ <i>♥</i> ♣ <i>♦</i></span><span>A table for everyone.</span></footer>`;
}
function cardLabel(card) {
  if (card.suit === "rook") return "Rook bird";
  if (card.suit === "joker")
    return `${card.color === "red" ? "Red" : "Black"} joker`;
  return `${card.rank} ${card.suit}`;
}
function cardFace(card, collection, small = false) {
  const symbol =
    card.suit === "rook"
      ? "♜"
      : card.suit === "joker"
        ? "★"
        : ["red", "green", "yellow", "black"].includes(card.suit)
          ? "●"
          : card.suit;
  const face = `<button class="playing-card ${small ? "compact" : ""} ${selected.has(card.id) ? "selected" : ""}" data-color="${esc(card.color)}" data-action="card" data-card="${esc(card.id)}" data-source="${collection.id}" aria-label="${esc(cardLabel(card))}" aria-pressed="${selected.has(card.id)}"><b>${esc(card.rank)}</b><span>${symbol}</span><small>${esc(card.rank)}</small></button>`;
  if (collection.type !== "hand" || collection.seat !== state.seat) return face;
  const showHandle = selected.size === 1 && selected.has(card.id);
  return `<div class="hand-card" data-hand-card="${card.id}">${face}${showHandle ? `<button class="card-drag-handle" type="button" data-action="reorder-card" data-reorder-card="${card.id}" aria-label="Rearrange ${esc(cardLabel(card))}" aria-keyshortcuts="ArrowLeft ArrowRight Home End" title="Drag to rearrange your hand, or use Left/Right, Home/End" ${connected ? "" : "disabled"}>⠿</button>` : ""}</div>`;
}
function hand(seat, position) {
  const p = state.players[seat - 1],
    own = seat === state.seat;
  const c = state.collections.find((c) => c.id === `hand-${seat}`);
  return `<section class="hand hand-${position} ${own ? "own-hand" : ""} ${p.occupied ? "" : "vacant"}" aria-label="Player ${seat} hand">
    <div class="hand-heading"><span class="avatar">${seat}</span><span><strong>Player ${seat}${own ? ' <span class="you-label">YOU</span>' : ""}${seat === state.host ? ' <span title="Host" aria-label="Host">♔</span>' : ""}</strong><small>${p.occupied ? (p.connected ? (own ? "Only you can see these cards" : "At the table") : "Reconnecting · seat reserved") : "Open seat"}</small></span><span class="count-tag" title="${c.cards.length} cards">${c.cards.length}</span></div>
    ${own ? `<div class="hand-actions" role="group" aria-label="Your hand controls"><button class="button secondary small" data-action="draw" ${!connected || !state.collections.find((c) => c.id === "deck").cards.length ? "disabled" : ""} title="Draw the top card of the Deck into your hand">Draw one card</button><button class="button secondary small" data-action="sort-number" ${!connected || c.cards.length < 2 ? "disabled" : ""} title="Sort low to high, with Ace high and Rook birds or jokers last">Sort by number</button><button class="button secondary small" data-action="sort-suit" ${!connected || c.cards.length < 2 ? "disabled" : ""} title="Group suits or colors and sort low to high within each group">Sort by suit/color</button></div>` : ""}
    <div class="hand-cards" data-scroll="${c.id}">${own ? (c.cards.length ? c.cards.map((card) => cardFace(card, c)).join("") : '<div class="empty-hand">Your next good hand starts here.<span>Draw from the Deck or wait for a deal.</span></div>') : c.cards.length ? hiddenStack(c, !p.occupied) : '<span class="empty-seat">Pull up a chair</span>'}</div>
    ${!own && !p.occupied && c.cards.length ? `<button class="text-button" data-action="select-n" data-id="${c.id}">Select top cards</button>` : ""}
  </section>`;
}
function hiddenStack(c, selectable = true) {
  const top = c.cards.at(-1);
  return `<button class="card-back ${top && selected.has(top.id) ? "selected" : ""}" data-action="${selectable ? "top" : "private"}" data-id="${c.id}" title="${c.cards.length} cards${selectable ? " · Select top card" : " · Private hand"}" aria-label="${esc(c.name)}, ${c.cards.length} cards${selectable ? ", select top card" : ", private hand"}" ${!top ? "disabled" : ""}><span class="back-pattern"><span>♣</span></span><span class="stack-count">${c.cards.length}</span></button>`;
}
function pile(c) {
  const host = state.host === state.seat;
  const selectionHere = [...selected.values()].some((s) => s.source === c.id);
  return `<section class="pile ${selectionHere ? "has-selection" : ""}" data-pile="${c.id}" ${host ? 'draggable="true"' : ""} aria-label="${esc(c.name)} collection">
    <div class="pile-heading"><h3>${host ? '<span class="drag-grip" title="Drag to move pile">⠿</span>' : ""}${esc(c.name)}</h3><span class="pile-heading-end">${c.type === "deck" ? '<span class="tiny-label">SOURCE</span>' : `<button class="icon-button" data-action="edit-pile" data-id="${c.id}" aria-label="Configure ${esc(c.name)}">⚙</button>`}</span></div>
    <div class="pile-content" data-scroll="${c.id}">${c.cards.length ? (c.faceUp ? `<div class="faceup-cards">${c.cards.map((card) => cardFace(card, c, true)).join("")}</div>` : hiddenStack(c)) : '<div class="empty-pile"><span>♧</span>No cards yet</div>'}</div>
    <div class="pile-footer"><span>${c.faceUp ? "◉ Face up" : "◌ Face down"} <span class="pile-count">· ${c.cards.length}</span></span><span>${c.cards.length && !c.faceUp ? `<button class="text-button" data-action="select-n" data-id="${c.id}">Select top N</button>` : ""}${host ? `<button class="icon-button arrange" data-action="arrange" data-id="${c.id}" aria-label="Move ${esc(c.name)} on the table">↔</button>` : ""}</span></div>
    ${host && c.type === "deck" && selectionHere ? '<div class="deck-selection-tools"><button data-action="shuffle">⇄ Shuffle Deck</button><button data-action="return">↶ Return all cards</button></div>' : ""}
  </section>`;
}
function renderTable() {
  const focusedCard = app.querySelector(".card-drag-handle:focus")?.dataset
    .reorderCard;
  cancelHandDrag();
  const scroll = new Map(
    [...app.querySelectorAll("[data-scroll]")].map((el) => [
      el.dataset.scroll,
      [el.scrollTop, el.scrollLeft],
    ]),
  );
  const host = state.host === state.seat;
  const shared = state.collections.filter((c) => c.type !== "hand");
  const max = Math.max(...shared.map((c) => c.position));
  const slots = Math.min(60, Math.ceil((max + 1 + (host ? 1 : 0)) / 3) * 3);
  const others = [1, 2, 3].map((n) => ((state.seat - 1 + n) % 4) + 1);
  app.innerHTML = `<div class="game-shell">
    <header class="site-header game-header">${brand()}<div class="room-badge"><span>TABLE CODE</span><button data-action="copy" title="Copy game code">${state.code}<span>▣</span></button></div><div class="header-actions"><span class="connection ${connected ? "" : "offline"}"><span class="status-dot"></span>${connected ? "Live table" : "Reconnecting…"}</span><button class="button ghost small" data-action="exit">Leave table <span>→</span></button></div></header>
    <div class="table-toolbar"><div><span class="eyebrow">MAKE YOURSELF AT HOME</span><h1>Your table, your rules<span>.</span></h1><p>${state.kind === "500" ? "500 Deck" : state.kind === "rook" ? "Rook" : "Face cards"} <span>·</span> ${state.total} cards <span>·</span> ${state.players.filter((p) => p.occupied).length} of 4 seats ${host ? '<span class="host-pill">YOU’RE THE HOST</span>' : `<span>·</span> Hosted by Player ${state.host}`}</p></div><div class="table-controls">${host ? '<button class="button secondary small" data-action="shuffle">⇄ Shuffle</button><button class="button secondary small" data-action="deal">▤ Deal cards</button><button class="button primary small" data-action="create-pile">+ Add pile</button><button class="icon-button reset-button" data-action="return" title="Return all cards to Deck" aria-label="Return all cards to Deck">↶</button>' : '<span class="table-tip">Pick your cards. Make your move.</span>'}${host && state.kind === "500" ? '<button class="button secondary small" data-action="deal-500">Deal for 500</button>' : ""}<button class="icon-button" data-action="help" aria-label="How to play">?</button></div></div>
    <main class="table-layout">
      ${hand(others[1], "top")}${hand(others[0], "left")}
      <section class="shared-table" aria-label="Shared card table"><div class="felt-label"><span>♣</span> CARD TABLE <span>♣</span></div><div class="pile-grid">${Array.from(
        { length: slots },
        (_, position) => {
          const c = shared.find((c) => c.position === position);
          return `<div class="table-slot" data-position="${position}">${c ? pile(c) : `<div class="free-slot">${host ? "Drop a pile here" : "Your shared table"}</div>`}</div>`;
        },
      ).join(
        "",
      )}</div><div class="table-hint">${host ? "⠿ Drag piles to arrange your table · Changes are shared with everyone" : "A shared table · Hands stay private"}</div></section>
      ${hand(others[2], "right")}${hand(state.seat, "bottom")}
    </main>
    <footer class="game-footer"><span><span class="status-dot"></span> ${esc(state.events.at(-1))}</span>${host ? '<button class="text-button" data-action="activity">Table Activity →</button>' : ""}</footer>
    <div id="selection-bar"></div>
  </div>`;
  for (const el of app.querySelectorAll("[data-scroll]")) {
    const value = scroll.get(el.dataset.scroll);
    if (value) {
      el.scrollTop = value[0];
      el.scrollLeft = value[1];
    }
  }
  updateSelection();
  if (focusedCard) {
    const handle = app.querySelector(`[data-reorder-card="${focusedCard}"]`);
    handle?.focus({ preventScroll: true });
    handle
      ?.closest(".hand-card")
      .scrollIntoView({ block: "nearest", inline: "nearest" });
  }
}
function render() {
  if (state) renderTable();
  else renderHome();
}
function updateSelection() {
  for (const el of app.querySelectorAll("[data-card]")) {
    const active = selected.has(el.dataset.card);
    el.classList.toggle("selected", active);
    el.setAttribute("aria-pressed", active);
  }
  for (const el of app.querySelectorAll(".card-back[data-id]")) {
    const c = state?.collections.find((c) => c.id === el.dataset.id);
    el.classList.toggle(
      "selected",
      !!c?.cards.at(-1) && selected.has(c.cards.at(-1).id),
    );
  }
  const bar = document.querySelector("#selection-bar");
  if (!bar) return;
  const oldTarget = bar.querySelector("select")?.value || destination;
  const sources = new Set([...selected.values()].map((ref) => ref.source));
  bar.innerHTML = selected.size
    ? `<div class="selection-inner"><span class="selection-count">${selected.size}</span><strong>card${selected.size === 1 ? "" : "s"} selected</strong><label class="sr-only" for="destination">Move cards to</label><select id="destination" ${!connected ? "disabled" : ""}><option value="">Move to…</option>${state.collections
        .filter((c) => !sources.has(c.id))
        .map(
          (c) =>
            `<option value="${c.id}">${esc(c.name)}${c.type === "hand" && c.seat === state.seat ? " (you)" : c.type === "hand" && !state.players[c.seat - 1].occupied ? " (open seat)" : ""}</option>`,
        )
        .join(
          "",
        )}</select><button class="button primary small" data-action="move" ${!connected ? "disabled" : ""}>Move cards →</button><button class="icon-button" data-action="clear" aria-label="Clear selection">×</button></div>`
    : "";
  if (oldTarget && bar.querySelector("select"))
    bar.querySelector("select").value = oldTarget;
}
function selectCard(id, source) {
  if (selected.has(id)) selected.delete(id);
  else selected.set(id, { id, source });
  // Rendering updates contextual Deck controls as well as selection indicators.
  renderTable();
}
function pruneSelection() {
  for (const [id, ref] of selected) {
    const c = state.collections.find((c) => c.id === ref.source);
    if (!c?.canTake || !c.cards.some((card) => card.id === id))
      selected.delete(id);
  }
}
function send(data) {
  if (!connected || socket?.readyState !== WebSocket.OPEN) {
    toast("Reconnecting to your table. Try again in a moment.");
    return false;
  }
  socket.send(JSON.stringify(data));
  return true;
}
function connect() {
  if (!session) return;
  clearTimeout(reconnectTimer);
  const current = new WebSocket(
    `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/api/rooms/${session.code}/socket`,
  );
  socket = current;
  current.addEventListener("open", () =>
    current.send(JSON.stringify({ type: "auth", token: session.token })),
  );
  current.addEventListener("message", (event) => {
    if (socket !== current) return;
    const data = JSON.parse(event.data);
    if (data.type === "state") {
      const wasHost = state?.host;
      connected = true;
      reconnectAttempt = 0;
      state = data.state;
      pruneSelection();
      render();
      if (wasHost && wasHost !== state.host)
        toast(`Player ${state.host} is now the host.`);
    } else if (["closed", "left"].includes(data.type)) {
      endSession();
      toast(
        data.type === "closed"
          ? "This table has closed. There’s always room for another game."
          : "You’ve left the table.",
      );
    } else if (data.type === "error") toast(data.message);
  });
  current.addEventListener("close", () => {
    if (socket !== current || !session) return;
    connected = false;
    if (state) render();
    reconnectTimer = setTimeout(
      connect,
      Math.min(10_000, 1000 * 2 ** reconnectAttempt++),
    );
  });
  current.addEventListener("error", () => current.close());
}
function endSession() {
  clearTimeout(reconnectTimer);
  session = null;
  state = null;
  connected = false;
  selected.clear();
  const old = socket;
  socket = null;
  old?.close();
  persist();
  dialog.close();
  render();
}
async function request(path, body) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok)
    throw new Error(
      data.error || "Could not open the table. Please try again.",
    );
  return data;
}
async function enter(path, body) {
  if (busy) return;
  busy = true;
  app
    .querySelectorAll('button[type="submit"]')
    .forEach((b) => (b.disabled = true));
  try {
    const data = await request(path, body);
    session = { code: data.state.code, token: data.token };
    state = data.state;
    selected.clear();
    persist();
    render();
    connect();
  } catch (error) {
    toast(error.message);
  } finally {
    busy = false;
    if (!state)
      app
        .querySelectorAll('button[type="submit"]')
        .forEach((b) => (b.disabled = false));
  }
}
function modal(
  title,
  contents,
  { form, submit = "Save changes", danger = false, intro = "" } = {},
) {
  dialog.innerHTML = `<div class="dialog-header"><span class="eyebrow">CARD TABLE</span><button class="icon-button" data-action="cancel" aria-label="Close dialog">×</button></div><h2 id="dialog-title">${esc(title)}</h2>${intro ? `<p class="dialog-intro">${esc(intro)}</p>` : ""}${form ? `<form id="${form}">` : '<div class="dialog-content">'}${contents}<div class="dialog-actions">${form ? `<button type="button" class="button ghost" data-action="cancel">Cancel</button><button class="button ${danger ? "danger" : "primary"}" type="submit">${esc(submit)}</button>` : '<button class="button primary" data-action="cancel">Got it</button>'}</div>${form ? "</form>" : "</div>"}`;
  if (!dialog.open) dialog.showModal();
}
const seatOptions = (players, selectedSeat) =>
  players
    .map(
      (p) =>
        `<option value="${p.seat}" ${p.seat === selectedSeat ? "selected" : ""}>Player ${p.seat}${p.connected ? "" : " (reconnecting)"}</option>`,
    )
    .join("");
function openDeal() {
  const players = state.players.filter((p) => p.occupied),
    count = state.collections.find((c) => c.id === "deck").cards.length;
  modal(
    "A hand for everyone",
    `<p class="form-note">Deal from the <strong>Deck</strong> · ${count} cards available</p><label class="input-label" for="deal-count">Cards per player</label><input id="deal-count" name="count" type="number" min="0" max="${Math.floor(count / players.length)}" value="${Math.min(5, Math.floor(count / players.length))}" required><label class="input-label" for="deal-start">Start dealing with</label><select id="deal-start" name="start">${seatOptions(players, players[0].seat)}</select><fieldset><legend>One extra card for… <span>(optional)</span></legend>${players.map((p) => `<label class="check-label"><input type="checkbox" name="extra" value="${p.seat}"> Player ${p.seat}${p.seat === state.seat ? " (you)" : ""}</label>`).join("")}</fieldset><p class="form-note" id="deal-total"></p>`,
    {
      form: "deal-form",
      submit: "Deal cards",
      intro:
        "Cards go around the table in player-number order. Choose who gets an extra card when the deal isn’t even.",
    },
  );
  updateDealTotal();
}
function updateDealTotal() {
  const form = dialog.querySelector("#deal-form");
  if (!form) return;
  const count = Number(form.elements.count.value),
    n = state.players.filter((p) => p.occupied).length;
  const total =
    count * n + form.querySelectorAll('[name="extra"]:checked').length;
  const available = state.collections.find((c) => c.id === "deck").cards.length;
  form.querySelector("#deal-total").textContent =
    `${total} cards to deal · ${available - total} left in the Deck`;
  form.querySelector('[type="submit"]').disabled =
    !Number.isInteger(count) || count < 0 || total <= 0 || total > available;
}
function openExit() {
  const host = state.host === state.seat,
    others = state.players.filter((p) => p.occupied && p.seat !== state.seat);
  modal(
    host ? "Ready to call it a night?" : "Leave your seat?",
    `${host && others.length ? `<label class="input-label" for="exit-choice">Before you go</label><select id="exit-choice" name="choice"><option value="transfer">Pass hosting to another player</option><option value="close">Close the game for everyone</option></select><div id="transfer-field"><label class="input-label" for="next-host">New host</label><select id="next-host" name="host">${seatOptions(others, others.find((p) => p.connected)?.seat || others[0].seat)}</select></div>` : `<p class="form-note">${host ? "You’re the last player. Leaving will close this game." : "Your cards will stay on the table. The next player to join will take your seat."}</p>`}`,
    {
      form: "exit-form",
      submit: "Leave table",
      danger: true,
      intro: "There’s always a seat for another game.",
    },
  );
}
function openEdit(id) {
  const c = state.collections.find((c) => c.id === id);
  if (!c || c.type !== "pile") return;
  if (state.host !== state.seat) {
    toast("Only the host can configure piles.");
    return;
  }
  modal(
    "Make this pile yours",
    `<input type="hidden" name="id" value="${id}"><label class="input-label" for="pile-name">Pile name</label><input id="pile-name" name="name" value="${esc(c.name)}" maxlength="32" required><label class="check-label visibility-check"><input type="checkbox" name="faceUp" ${c.faceUp ? "checked" : ""}> Show cards face up to everyone</label><p class="form-note">Changing visibility applies to every card in this pile.</p><button type="button" class="text-button danger-text" data-action="delete-pile" data-id="${id}" ${c.cards.length ? "disabled" : ""}>Delete empty pile</button>${c.cards.length ? '<small class="form-note">Move the cards out before deleting this pile.</small>' : ""}`,
    { form: "edit-form" },
  );
}
function openSelect(id) {
  const c = state.collections.find((c) => c.id === id);
  if (!c?.canTake) return;
  modal(
    `Select from ${c.name}`,
    `<input name="source" type="hidden" value="${id}"><label class="input-label" for="select-count">Number of cards from the top</label><input id="select-count" name="count" type="number" value="1" min="1" max="${c.cards.length}" required><p class="form-note">${c.cards.length} cards available. Their values stay hidden until moved somewhere you can see them.</p>`,
    { form: "select-form", submit: "Select cards" },
  );
}
async function handleAction(event) {
  const button = event.target.closest("[data-action]");
  if (!button || button.disabled) return;
  const action = button.dataset.action,
    id = button.dataset.id;
  if (action === "home") {
    event.preventDefault();
    if (state) openExit();
    else if (session) {
      endSession();
      toast(
        "Seat recovery canceled. Your old seat is held for up to two minutes.",
      );
    }
    return;
  }
  if (action === "cancel") {
    dialog.close();
    return;
  }
  if (action === "choose-deck") {
    chosenDeck = button.dataset.kind;
    renderHome();
    return;
  }
  if (!state) return;
  const c = state.collections.find((c) => c.id === id);
  switch (action) {
    case "reorder-card":
      // The handle must not toggle the card's selection when clicked after dragging.
      break;
    case "draw":
      send({ type: "draw" });
      break;
    case "sort-number":
      send({ type: "sortHand", by: "number" });
      break;
    case "sort-suit":
      send({ type: "sortHand", by: "suit" });
      break;
    case "card":
      selectCard(button.dataset.card, button.dataset.source);
      break;
    case "top":
      if (c?.canTake && c.cards.length) selectCard(c.cards.at(-1).id, c.id);
      break;
    case "private":
      toast(
        "That hand is private. You can give cards to it, but only its player can take them.",
      );
      break;
    case "clear":
      selected.clear();
      renderTable();
      break;
    case "move": {
      const target = document.querySelector("#destination").value;
      if (!target) {
        toast("Choose a destination for your cards.");
        return;
      }
      if (send({ type: "move", cards: [...selected.values()], target })) {
        selected.clear();
        renderTable();
      }
      break;
    }
    case "select-n":
      openSelect(id);
      break;
    case "copy":
      try {
        await navigator.clipboard.writeText(state.code);
        toast("Game code copied. Invite your people!");
      } catch {
        toast(`Your game code is ${state.code}.`);
      }
      break;
    case "create-pile":
      send({ type: "createPile" });
      break;
    case "edit-pile":
      openEdit(id);
      break;
    case "delete-pile":
      if (send({ type: "deletePile", id })) dialog.close();
      break;
    case "shuffle":
      if (send({ type: "shuffle" })) {
        for (const [key, ref] of selected)
          if (ref.source === "deck") selected.delete(key);
      }
      break;
    case "return":
      modal(
        "Bring the cards home?",
        '<p class="form-note">All cards, including everyone’s hands, will return to the Deck. Your piles will remain empty. The Deck will not be shuffled.</p>',
        { form: "return-form", submit: "Return all cards", danger: true },
      );
      break;
    case "deal":
      openDeal();
      break;
    case "deal-500":
      if (state.host === state.seat) send({ type: "deal500" });
      break;
    case "exit":
      openExit();
      break;
    case "arrange":
      modal(
        `Move ${c.name}`,
        `<input type="hidden" name="id" value="${id}"><label class="input-label" for="pile-position">Table position</label><select id="pile-position" name="position">${Array.from({ length: Math.min(60, Math.max(6, ...state.collections.filter((c) => c.type !== "hand").map((c) => c.position + 2))) }, (_, i) => `<option value="${i}" ${i === c.position ? "selected" : ""}>Row ${Math.floor(i / 3) + 1}, position ${(i % 3) + 1}${state.collections.some((c) => c.type !== "hand" && c.position === i) ? " (occupied — swap)" : ""}</option>`).join("")}</select><p class="form-note">Piles snap into place so they never overlap. Occupied positions swap.</p>`,
        { form: "position-form", submit: "Move pile" },
      );
      break;
    case "help":
      modal(
        "Your table, your rules",
        '<div class="help-list"><p><strong>Pick & move.</strong> Click a visible card to select it. Click again to deselect. Choose a destination in the selection bar.</p><p><strong>Keep a little mystery.</strong> Click a facedown stack to select its top card, or use “Select top N” for several.</p><p><strong>Share the table.</strong> Give cards to any hand. Only its player can take them, unless the seat is vacant.</p><p><strong>Host the evening.</strong> The host deals, shuffles, gathers cards, and arranges piles. Everyone handles turns and scoring together.</p><p><strong>Stay awhile.</strong> Refreshing restores your seat. Disconnections reserve it for two minutes. Leaving releases it immediately.</p></div>',
      );
      break;
    case "activity":
      if (state.host !== state.seat) return;
      modal(
        "Around the table",
        `<ol class="activity-list">${state.events.map((e) => `<li>${esc(e)}</li>`).join("")}</ol>`,
      );
      break;
  }
}
app.addEventListener("click", handleAction);
dialog.addEventListener("click", handleAction);
app.addEventListener("submit", (event) => {
  event.preventDefault();
  const data = new FormData(event.target);
  if (event.target.id === "create-form")
    enter("/api/rooms", {
      kind: chosenDeck,
      jokers: Number(data.get("jokers")),
    });
  if (event.target.id === "join-form")
    enter(
      `/api/rooms/${String(data.get("code")).trim().toUpperCase()}/join`,
      {},
    );
});
dialog.addEventListener("submit", (event) => {
  event.preventDefault();
  const form = event.target,
    data = new FormData(form),
    formId = form.getAttribute("id");
  let action;
  if (formId === "deal-form")
    action = {
      type: "deal",
      count: Number(data.get("count")),
      start: Number(data.get("start")),
      extras: data.getAll("extra").map(Number),
    };
  if (formId === "edit-form")
    action = {
      type: "editPile",
      id: data.get("id"),
      name: data.get("name"),
      faceUp: data.has("faceUp"),
    };
  if (formId === "position-form")
    action = {
      type: "position",
      id: data.get("id"),
      position: Number(data.get("position")),
    };
  if (formId === "return-form") action = { type: "return" };
  if (formId === "exit-form")
    action = {
      type: "exit",
      host: Number(data.get("host")),
      close: data.get("choice") === "close",
    };
  if (formId === "select-form") {
    const c = state.collections.find((c) => c.id === data.get("source"));
    const count = Number(data.get("count"));
    if (!c || count > c.cards.length) {
      toast("That pile has changed. Please choose again.");
      return;
    }
    for (const card of c.cards.slice(-count))
      selected.set(card.id, { id: card.id, source: c.id });
    renderTable();
    dialog.close();
    return;
  }
  if (action && send(action)) dialog.close();
});
dialog.addEventListener("input", updateDealTotal);
dialog.addEventListener("change", (event) => {
  if (event.target.id === "exit-choice")
    document.querySelector("#transfer-field").hidden =
      event.target.value === "close";
});
app.addEventListener("change", (event) => {
  if (event.target.id === "destination") destination = event.target.value;
});
app.addEventListener("input", (event) => {
  if (event.target.id === "room-code")
    event.target.value = event.target.value
      .toUpperCase()
      .replace(/[^A-Z]/g, "");
});

// Pointer capture supports mouse, pen, and touch without changing pile dragging.
function cancelHandDrag() {
  const drag = handDrag;
  if (!drag) return;
  handDrag = null;
  cancelAnimationFrame(drag.frame);
  drag.marker.remove();
  drag.wrapper.classList.remove("is-reordering");
  try {
    drag.handle.releasePointerCapture(drag.pointerId);
  } catch {}
}
function updateHandDrag() {
  const drag = handDrag;
  if (!drag) return;
  if (drag.moved) {
    const bounds = drag.hand.getBoundingClientRect();
    drag.valid =
      drag.x >= bounds.left &&
      drag.x <= bounds.right &&
      drag.y >= bounds.top - 12 &&
      drag.y <= bounds.bottom + 12;
    drag.marker.hidden = !drag.valid;
    if (drag.valid) {
      // Keep scrolling while the pointer is held near the edge of a long hand.
      if (drag.x < bounds.left + 24) drag.hand.scrollLeft -= 8;
      if (drag.x > bounds.right - 24) drag.hand.scrollLeft += 8;
      const others = [...drag.hand.querySelectorAll("[data-hand-card]")].filter(
        (el) => el.dataset.handCard !== drag.id,
      );
      const next = others.find((el) => {
        const r = el.getBoundingClientRect();
        return drag.x < r.left + r.width / 2;
      });
      drag.before = next?.dataset.handCard ?? null;
      const edge = next
        ? next.getBoundingClientRect().left - 4
        : others.length
          ? others.at(-1).getBoundingClientRect().right + 4
          : bounds.left;
      drag.marker.style.left = `${Math.max(0, (edge ?? bounds.left) - bounds.left + drag.hand.scrollLeft)}px`;
    }
  }
  drag.frame = requestAnimationFrame(updateHandDrag);
}
app.addEventListener("pointerdown", (event) => {
  const handle = event.target.closest(".card-drag-handle");
  if (
    !handle ||
    handle.disabled ||
    event.button !== 0 ||
    selected.size !== 1 ||
    !selected.has(handle.dataset.reorderCard)
  )
    return;
  event.preventDefault();
  cancelHandDrag();
  const hand = handle.closest(".hand-cards");
  const marker = document.createElement("div");
  marker.className = "hand-drop-marker";
  marker.setAttribute("aria-hidden", "true");
  marker.hidden = true;
  hand.append(marker);
  const wrapper = handle.closest(".hand-card");
  handDrag = {
    id: handle.dataset.reorderCard,
    pointerId: event.pointerId,
    handle,
    wrapper,
    hand,
    marker,
    x: event.clientX,
    y: event.clientY,
    startX: event.clientX,
    startY: event.clientY,
    moved: false,
    valid: false,
    before: null,
  };
  wrapper.classList.add("is-reordering");
  handle.setPointerCapture(event.pointerId);
  handDrag.frame = requestAnimationFrame(updateHandDrag);
});
app.addEventListener("pointermove", (event) => {
  if (!handDrag || handDrag.pointerId !== event.pointerId) return;
  handDrag.x = event.clientX;
  handDrag.y = event.clientY;
  if (
    Math.hypot(
      event.clientX - handDrag.startX,
      event.clientY - handDrag.startY,
    ) >= 4
  )
    handDrag.moved = true;
});
app.addEventListener("pointerup", (event) => {
  const drag = handDrag;
  if (!drag || drag.pointerId !== event.pointerId) return;
  // Use the final pointer position even if it changed since the last animation frame.
  drag.x = event.clientX;
  drag.y = event.clientY;
  cancelAnimationFrame(drag.frame);
  updateHandDrag();
  const { id, before, moved, valid } = drag;
  cancelHandDrag();
  if (moved && valid) send({ type: "reorderHand", id, before });
});
for (const eventName of ["pointercancel", "lostpointercapture"])
  app.addEventListener(eventName, (event) => {
    if (handDrag?.pointerId === event.pointerId) cancelHandDrag();
  });
app.addEventListener("keydown", (event) => {
  if (event.key === "Escape") cancelHandDrag();
  const handle = event.target.closest(".card-drag-handle");
  if (
    !handle ||
    handle.disabled ||
    !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)
  )
    return;
  event.preventDefault();
  const hand = state.collections.find((c) => c.id === `hand-${state.seat}`);
  const index = hand.cards.findIndex(
    (c) => c.id === handle.dataset.reorderCard,
  );
  if (index === -1) return;
  if ((event.key === "ArrowLeft" || event.key === "Home") && index === 0)
    return;
  if (
    (event.key === "ArrowRight" || event.key === "End") &&
    index === hand.cards.length - 1
  )
    return;
  const before =
    event.key === "Home"
      ? hand.cards[0].id
      : event.key === "ArrowLeft"
        ? hand.cards[index - 1].id
        : event.key === "ArrowRight"
          ? (hand.cards[index + 2]?.id ?? null)
          : null;
  send({ type: "reorderHand", id: handle.dataset.reorderCard, before });
});
let dragged = null;
app.addEventListener("dragstart", (event) => {
  const pile = event.target.closest("[data-pile]");
  if (!pile || state.host !== state.seat || event.target.closest("button")) {
    event.preventDefault();
    return;
  }
  dragged = pile.dataset.pile;
  event.dataTransfer.setData("text/plain", dragged);
  event.dataTransfer.effectAllowed = "move";
});
app.addEventListener("dragover", (event) => {
  if (dragged && event.target.closest("[data-position]")) {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  }
});
app.addEventListener("drop", (event) => {
  const slot = event.target.closest("[data-position]");
  if (dragged && slot) {
    event.preventDefault();
    send({
      type: "position",
      id: dragged,
      position: Number(slot.dataset.position),
    });
  }
  dragged = null;
});
app.addEventListener("dragend", () => {
  dragged = null;
});
window.addEventListener("online", () => {
  if (session && !connected) connect();
});
if (session?.token && /^[A-Z]{4}$/.test(session.code)) {
  app.innerHTML = `<main class="recover"><span class="brand-mark">♣</span><h1>Saving your seat…</h1><p>Reconnecting to table ${esc(session.code)}.</p><button class="button secondary" data-action="home">Return home</button></main>`;
  connect();
} else {
  session = null;
  render();
}
