import { chromium, expect } from "@playwright/test";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
const external = process.env.CARDS_TEST_URL;
const base = external || "http://127.0.0.1:4173";
const dataDir = await mkdtemp(path.join(tmpdir(), "cards-browser-"));
let server,
  browser,
  output = "";
const errors = [],
  contexts = [];
async function page(width = 1360, height = 1000) {
  const context = await browser.newContext({ viewport: { width, height } });
  contexts.push(context);
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  return page;
}
async function ready(page) {
  await expect(page.locator(".connection")).toHaveText("Live table");
}
const handCount = (page, n) =>
  expect(page.locator(".own-hand .count-tag")).toHaveText(String(n));
async function move(page, target) {
  await page.locator("#destination").selectOption(target);
  await page.getByRole("button", { name: "Move cards →", exact: true }).click();
}
async function join(page, code) {
  await page.goto(base);
  await page.locator("#room-code").fill(code);
  await page.getByRole("button", { name: "Join a game", exact: false }).click();
  await ready(page);
}
async function checkHandSort(page, by) {
  const cards = await page
    .locator(".own-hand .playing-card")
    .evaluateAll((elements) =>
      elements.map((el) => ({
        id: el.dataset.card,
        rank: el.querySelector("b").textContent,
        suit: el.querySelector("span").textContent,
        color: el.dataset.color,
      })),
    );
  const rank = (card) =>
    ({ J: 11, Q: 12, K: 13, A: 14, R: 15, "★": 15 })[card.rank] ??
    Number(card.rank);
  const suit = (card) =>
    ["♣", "♦", "♥", "♠", "black", "green", "red", "yellow", "♜", "★"].indexOf(
      card.suit === "●" ? card.color : card.suit,
    );
  const expected = [...cards]
    .sort((a, b) => {
      const primary = by === "number" ? rank(a) - rank(b) : suit(a) - suit(b);
      const secondary = by === "number" ? suit(a) - suit(b) : rank(a) - rank(b);
      return primary || secondary || a.color.localeCompare(b.color);
    })
    .map((card) => card.id);
  await page
    .getByRole("button", {
      name: by === "number" ? "Sort by number" : "Sort by suit/color",
      exact: true,
    })
    .click();
  await expect
    .poll(() =>
      page
        .locator(".own-hand .playing-card")
        .evaluateAll((elements) => elements.map((el) => el.dataset.card)),
    )
    .toEqual(expected);
  return expected;
}
const handIds = (page) =>
  page
    .locator(".own-hand .playing-card")
    .evaluateAll((elements) => elements.map((el) => el.dataset.card));
async function expectHandIds(page, ids) {
  await expect.poll(() => handIds(page)).toEqual(ids);
}
async function dragHandCard(
  page,
  before,
  { cancel = false, outside = false } = {},
) {
  const handle = page.locator(".card-drag-handle");
  await handle.scrollIntoViewIfNeeded();
  const start = await handle.boundingBox();
  const last = page.locator(".own-hand .hand-card").last();
  const target = await (
    before ? page.locator(`[data-hand-card="${before}"]`) : last
  ).boundingBox();
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    before ? target.x + 2 : target.x + target.width - 2,
    outside ? target.y - 100 : target.y + target.height / 2,
    { steps: 8 },
  );
  if (cancel) await page.keyboard.press("Escape");
  await page.mouse.up();
}
async function checkHandRearrange(page) {
  const original = await handIds(page);
  const selected = original[1];
  await expect(page.locator(".card-drag-handle")).toHaveCount(0);
  await page.locator(`[data-card="${selected}"]`).click();
  await expect(page.locator(".card-drag-handle")).toHaveCount(1);
  await expect(page.locator(".card-drag-handle")).toHaveText("⠿");
  await page.locator(`[data-card="${original[2]}"]`).click();
  await expect(page.locator(".card-drag-handle")).toHaveCount(0);
  await page.locator(`[data-card="${original[2]}"]`).click();
  const deckTop = page.locator('[data-pile="deck"] [data-action="top"]');
  await deckTop.click();
  await expect(page.locator(".card-drag-handle")).toHaveCount(0);
  await deckTop.click();
  await expect(page.locator(".card-drag-handle")).toHaveCount(1);
  await dragHandCard(page, original[0]);
  await expectHandIds(page, [
    selected,
    ...original.filter((id) => id !== selected),
  ]);
  const rest = original.filter((id) => id !== selected);
  await dragHandCard(page, rest.at(-1));
  await expectHandIds(page, [...rest.slice(0, -1), selected, rest.at(-1)]);
  await dragHandCard(page, null);
  const atEnd = [...rest, selected];
  await expectHandIds(page, atEnd);
  await expect(page.locator(`[data-card="${selected}"]`)).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await dragHandCard(page, rest[0], { outside: true });
  await expectHandIds(page, atEnd);
  await dragHandCard(page, rest[0], { cancel: true });
  await expectHandIds(page, atEnd);
  await expect(page.locator(".hand-drop-marker")).toHaveCount(0);
  // Keyboard rearrangement keeps the handle focused across state broadcasts.
  await page.locator(".card-drag-handle").focus();
  await page.keyboard.press("Home");
  await expectHandIds(page, [selected, ...rest]);
  await expect(page.locator(".card-drag-handle")).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expectHandIds(page, original);
  await page.keyboard.press("End");
  await expectHandIds(page, atEnd);
  await page.keyboard.press("ArrowLeft");
  const final = [...rest.slice(0, -1), selected, rest.at(-1)];
  await expectHandIds(page, final);
  await page.reload();
  await ready(page);
  await expectHandIds(page, final);
  await expect(
    page.locator(".hand:not(.own-hand) .card-drag-handle"),
  ).toHaveCount(0);
}
async function checkTouchRearrange(page) {
  const original = await handIds(page);
  const selected = original[2];
  await page.locator(`[data-card="${selected}"]`).click();
  const client = await page.context().newCDPSession(page);
  await client.send("Emulation.setTouchEmulationEnabled", {
    enabled: true,
    maxTouchPoints: 1,
  });
  async function touchDrag(before) {
    const handle = page.locator(".card-drag-handle");
    await handle.scrollIntoViewIfNeeded();
    const start = await handle.boundingBox();
    const hand = await page.locator(".own-hand .hand-cards").boundingBox();
    const target = before
      ? await page.locator(`[data-hand-card="${before}"]`).boundingBox()
      : null;
    const sendTouch = (type, x, y) =>
      client.send("Input.dispatchTouchEvent", {
        type,
        touchPoints:
          type === "touchEnd"
            ? []
            : [{ x, y, id: 1, radiusX: 1, radiusY: 1, force: 1 }],
      });
    await sendTouch(
      "touchStart",
      start.x + start.width / 2,
      start.y + start.height / 2,
    );
    await sendTouch(
      "touchMove",
      target ? target.x + 2 : hand.x + hand.width - 4,
      hand.y + hand.height / 2,
    );
    if (!before)
      await expect
        .poll(() =>
          page
            .locator(".own-hand .hand-cards")
            .evaluate(
              (el) => el.scrollLeft >= el.scrollWidth - el.clientWidth - 1,
            ),
        )
        .toBe(true);
    await sendTouch("touchEnd");
  }
  try {
    await touchDrag(original[0]);
    const rest = original.filter((id) => id !== selected);
    await expectHandIds(page, [selected, ...rest]);
    await touchDrag(original[3]);
    await expectHandIds(page, [
      ...rest.slice(0, 2),
      selected,
      ...rest.slice(2),
    ]);
    await touchDrag(null);
    await expectHandIds(page, [...rest, selected]);
    await expect(page.locator(".hand-drop-marker")).toHaveCount(0);
    await page.getByRole("button", { name: "Clear selection" }).click();
  } finally {
    await client.send("Emulation.setTouchEmulationEnabled", { enabled: false });
    await client.detach();
  }
}
try {
  if (!external) {
    server = spawn(process.execPath, ["server/local.js"], {
      env: { ...process.env, PORT: "4173", CARDS_DATA_DIR: dataDir },
      stdio: ["ignore", "pipe", "pipe"],
    });
    server.stdout.on("data", (d) => {
      output += d;
    });
    server.stderr.on("data", (d) => {
      output += d;
    });
  }
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(base)).ok) break;
    } catch {}
    if (i === 99) throw new Error(`Server failed to start: ${output}`);
    await new Promise((r) => setTimeout(r, 100));
  }
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
    headless: true,
    args: ["--no-sandbox"],
  });
  await mkdir("test-results", { recursive: true });
  const host = await page();
  await host.goto(base);
  await expect(host).toHaveTitle("Card Table · A table for everyone");
  await expect(host.locator(".brand")).toContainText("Card Table");
  await expect(
    host.getByRole("heading", { name: "A good hand. Even better company." }),
  ).toBeVisible();
  await host.screenshot({
    path: "test-results/home-desktop.png",
    fullPage: true,
  });
  await host.locator("#jokers").selectOption("2");
  await host.getByRole("button", { name: "Create a game" }).click();
  await ready(host);
  const code = await host
    .locator(".room-badge button")
    .textContent()
    .then((v) => v.slice(0, 4));
  await expect(host.locator(".table-toolbar p")).toContainText("54 cards");
  await expect(host.locator('[data-action="deal-500"]')).toHaveCount(0);
  const guest = await page(),
    third = await page(),
    fourth = await page();
  await join(guest, code);
  await join(third, code);
  await join(fourth, code);
  await expect(host.locator(".table-toolbar p")).toContainText("4 of 4 seats");
  for (const player of [host, guest, third, fourth]) {
    await expect(player.locator(".own-hand .hand-actions button")).toHaveCount(
      3,
    );
    await expect(
      player.locator(".hand:not(.own-hand) .hand-actions"),
    ).toHaveCount(0);
    await expect(
      player.getByRole("button", { name: "Sort by number", exact: true }),
    ).toBeDisabled();
    await expect(
      player.getByRole("button", { name: "Sort by suit/color", exact: true }),
    ).toBeDisabled();
  }
  // Host and guest can draw directly; each draw affects only its player's hand.
  await host
    .getByRole("button", { name: "Draw one card", exact: true })
    .click();
  await handCount(host, 1);
  await handCount(guest, 0);
  await expect(
    host.getByRole("button", { name: "Sort by number", exact: true }),
  ).toBeDisabled();
  await guest
    .getByRole("button", { name: "Draw one card", exact: true })
    .click();
  await handCount(guest, 1);
  await handCount(host, 1);
  await expect(guest.locator(".hand:not(.own-hand) .playing-card")).toHaveCount(
    0,
  );
  await host
    .getByRole("button", { name: "Return all cards to Deck", exact: true })
    .click();
  await host.locator('#return-form button[type="submit"]').click();
  await handCount(host, 0);
  await handCount(guest, 0);
  await expect(
    host.getByRole("button", { name: "Table Activity" }),
  ).toBeVisible();
  await expect(guest.locator('[data-action="activity"]')).toHaveCount(0);
  await expect(third.locator('[data-action="activity"]')).toHaveCount(0);
  await expect(fourth.locator('[data-action="activity"]')).toHaveCount(0);
  await host.getByRole("button", { name: "Table Activity" }).click();
  await expect(host.locator("#dialog .eyebrow")).toHaveText("CARD TABLE");
  await expect(host.locator(".activity-list li")).not.toHaveCount(0);
  await host.getByRole("button", { name: "Got it" }).click();
  const full = await host.request.post(`${base}/api/rooms/${code}/join`, {
    headers: { Origin: base },
    data: {},
  });
  assert.equal(full.status(), 400);
  assert.match((await full.json()).error, /full/);
  await host.getByRole("button", { name: "Deal cards", exact: false }).click();
  await host.locator("#deal-count").fill("5");
  await host.locator('[name="extra"][value="2"]').check();
  await host.locator('[name="extra"][value="4"]').check();
  await expect(host.locator("#deal-total")).toContainText("22 cards to deal");
  await host.locator('#deal-form button[type="submit"]').click();
  await handCount(host, 5);
  await handCount(guest, 6);
  await handCount(third, 5);
  await handCount(fourth, 6);
  await checkHandRearrange(host);
  await checkHandRearrange(guest);
  const selectedId = await host
    .locator(".own-hand .playing-card")
    .first()
    .getAttribute("data-card");
  await host.locator(".own-hand .playing-card").first().click();
  await checkHandSort(host, "number");
  await expect(host.locator(`[data-card="${selectedId}"]`)).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  const sortedHostIds = await checkHandSort(host, "suit");
  await expect(host.locator(".selection-count")).toHaveText("1");
  await host.getByRole("button", { name: "Clear selection" }).click();
  await checkHandSort(guest, "number");
  await checkHandSort(guest, "suit");
  await handCount(guest, 6);
  assert.equal(
    await guest.locator(".hand:not(.own-hand) .playing-card").count(),
    0,
  );
  await host.reload();
  await ready(host);
  await handCount(host, 5);
  assert.deepEqual(
    await host
      .locator(".own-hand .playing-card")
      .evaluateAll((elements) => elements.map((el) => el.dataset.card)),
    sortedHostIds,
  );
  await host.getByRole("button", { name: "Add pile", exact: false }).click();
  await host.getByRole("button", { name: "Configure Pile 1" }).click();
  await host.locator("#pile-name").fill("The middle");
  await host.locator('[name="faceUp"]').check();
  await host.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(guest.locator('[data-pile="pile-1"] h3')).toHaveText(
    "⠿The middle".replace("⠿", ""),
  );
  await host.locator(".own-hand .playing-card").first().click();
  await move(host, "pile-1");
  await expect(guest.locator('[data-pile="pile-1"] .playing-card')).toHaveCount(
    1,
  );
  await handCount(host, 4);
  // Direct giving preserves recipient privacy.
  await host.locator(".own-hand .playing-card").first().click();
  await move(host, "hand-2");
  await handCount(guest, 7);
  await handCount(host, 3);
  // Select multiple hidden cards without exposing their values.
  await host.locator('[data-pile="deck"] [data-action="select-n"]').click();
  await host.locator("#select-count").fill("3");
  await host.getByRole("button", { name: "Select cards", exact: true }).click();
  await expect(host.locator(".selection-count")).toHaveText("3");
  await move(host, "hand-1");
  await handCount(host, 6);
  // Accessible layout control swaps cells for all clients.
  await host
    .getByRole("button", { name: "Move The middle on the table" })
    .click();
  await host.locator("#pile-position").selectOption("0");
  await host.getByRole("button", { name: "Move pile", exact: true }).click();
  await expect(
    guest.locator('[data-position="0"] [data-pile="pile-1"]'),
  ).toBeVisible();
  await host.screenshot({
    path: "test-results/table-desktop.png",
    fullPage: true,
  });
  // Mobile table and lobby do not overflow horizontally.
  await fourth.setViewportSize({ width: 390, height: 844 });
  await checkHandSort(fourth, "suit");
  await fourth.screenshot({
    path: "test-results/table-mobile.png",
    fullPage: true,
  });
  assert.ok(
    await fourth.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    "Mobile table overflow",
  );
  const mobile = await page(390, 844);
  await mobile.goto(base);
  await mobile.screenshot({
    path: "test-results/home-mobile.png",
    fullPage: true,
  });
  assert.ok(
    await mobile.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    "Mobile home overflow",
  );
  // A departing player leaves a hand, and the next arrival takes the same seat.
  await guest
    .getByRole("button", { name: "Leave table", exact: false })
    .click();
  await guest.locator('#exit-form button[type="submit"]').click();
  await expect(guest.locator("#join-form")).toBeVisible();
  const replacement = await page();
  await join(replacement, code);
  await handCount(replacement, 7);
  await expect(replacement.locator(".own-hand strong")).toContainText(
    "Player 2",
  );
  // Return is confirmed and leaves the pile intact; shuffle is separate.
  await host
    .getByRole("button", { name: "Return all cards to Deck", exact: true })
    .click();
  await expect(host.locator("#return-form")).toBeVisible();
  await host.locator('#return-form button[type="submit"]').click();
  await handCount(host, 0);
  await handCount(replacement, 0);
  await expect(host.locator('[data-pile="deck"] .stack-count')).toHaveText(
    "54",
  );
  await expect(host.locator('[data-pile="pile-1"]')).toBeVisible();
  await host.locator('.table-controls [data-action="shuffle"]').click();
  // Host transfer and game-wide closure.
  await host.getByRole("button", { name: "Leave table", exact: false }).click();
  await host.locator("#next-host").selectOption("3");
  await host.locator('#exit-form button[type="submit"]').click();
  await expect(third.locator(".host-pill")).toBeVisible();
  await expect(
    third.getByRole("button", { name: "Table Activity" }),
  ).toBeVisible();
  await expect(replacement.locator('[data-action="activity"]')).toHaveCount(0);
  await third
    .getByRole("button", { name: "Leave table", exact: false })
    .click();
  await third.locator("#exit-choice").selectOption("close");
  await third.locator('#exit-form button[type="submit"]').click();
  await expect(fourth.locator("#join-form")).toBeVisible();
  await expect(replacement.locator("#join-form")).toBeVisible();
  // Rook is independently playable.
  await mobile.getByRole("button", { name: /Rook cards/ }).click();
  await mobile.getByRole("button", { name: "Create a game" }).click();
  await ready(mobile);
  await expect(mobile.locator(".table-toolbar p")).toContainText("57 cards");
  await expect(mobile.locator('[data-action="deal-500"]')).toHaveCount(0);
  for (let count = 1; count <= 3; count++) {
    await mobile
      .getByRole("button", { name: "Draw one card", exact: true })
      .click();
    await handCount(mobile, count);
  }
  await checkHandSort(mobile, "number");
  await checkHandSort(mobile, "suit");
  // The 500 shortcut requires four seats, preserves private hands, and reuses Middle.
  await host.getByRole("button", { name: /500 Deck/ }).click();
  await expect(host.locator(".joker-row")).toBeHidden();
  await host.getByRole("button", { name: "Create a game" }).click();
  await ready(host);
  await expect(host.locator(".table-toolbar p")).toContainText(
    "500 Deck · 45 cards",
  );
  const fiveHundredCode = (
    await host.locator(".room-badge button").textContent()
  ).slice(0, 4);
  await host.getByRole("button", { name: "Deal for 500", exact: true }).click();
  await expect(host.locator("#toast")).toContainText("four occupied seats");
  await expect(host.locator('[data-pile="deck"] .stack-count')).toHaveText(
    "45",
  );
  await expect(host.locator('[data-pile="pile-1"]')).toHaveCount(0);
  await join(guest, fiveHundredCode);
  await join(third, fiveHundredCode);
  await join(fourth, fiveHundredCode);
  await expect(guest.locator('[data-action="deal-500"]')).toHaveCount(0);
  await host.getByRole("button", { name: "Deal for 500", exact: true }).click();
  for (const player of [host, guest, third, fourth]) {
    await handCount(player, 10);
    await expect(player.locator('[data-pile="pile-1"] h3')).toContainText(
      "Middle",
    );
    await expect(
      player.locator('[data-pile="pile-1"] .stack-count'),
    ).toHaveText("5");
    await expect(
      player.locator('[data-pile="pile-1"] .playing-card'),
    ).toHaveCount(0);
    await expect(
      player.locator(".hand:not(.own-hand) .playing-card"),
    ).toHaveCount(0);
    await expect(
      player.locator('[data-pile="deck"] .empty-pile'),
    ).toBeVisible();
    await expect(
      player.getByRole("button", { name: "Draw one card", exact: true }),
    ).toBeDisabled();
  }
  await checkHandSort(host, "number");
  await checkHandSort(guest, "suit");
  await host
    .getByRole("button", { name: "Return all cards to Deck", exact: true })
    .click();
  await host.locator('#return-form button[type="submit"]').click();
  await handCount(host, 0);
  await host.getByRole("button", { name: "Configure Middle" }).click();
  await host.locator('[name="faceUp"]').check();
  await host.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(host.locator('[data-pile="pile-1"] .pile-footer')).toContainText(
    "Face up",
  );
  await host.getByRole("button", { name: "Deal for 500", exact: true }).click();
  await handCount(host, 10);
  await expect(host.locator('[data-pile="pile-1"] .pile-footer')).toContainText(
    "Face down",
  );
  await expect(host.locator('[data-pile="pile-1"] .stack-count')).toHaveText(
    "5",
  );
  await expect(host.locator("[data-pile]")).toHaveCount(2);
  await host.screenshot({
    path: "test-results/500-desktop.png",
    fullPage: true,
  });
  await host.setViewportSize({ width: 390, height: 844 });
  await checkTouchRearrange(host);
  await host.screenshot({
    path: "test-results/500-mobile.png",
    fullPage: true,
  });
  assert.ok(
    await host.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    "500 host mobile overflow",
  );
  assert.deepEqual(errors, [], `Browser exceptions: ${errors.join(", ")}`);
  console.log(
    "PASS: Card Table branding, three deck types, four-player join, draw controls, hand sorting and manual rearrangement, single-selection handles, mouse/touch/keyboard drops, long-hand scrolling, cancellation and refresh persistence, selection preservation, capacity, extra-card deal, private hands, 500 deals and Middle reuse, host-only activity, piles, card moves, layout sync, mobile layouts, replacement seats, return, shuffle, host transfer, and closure.",
  );
} finally {
  await browser?.close();
  server?.kill();
  await rm(dataDir, { recursive: true, force: true });
}
