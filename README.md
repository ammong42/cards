# The Card Room

A live, private card table for up to four friends. Choose a standard deck (0–2 jokers) or a 57-card Rook deck, share a four-letter code, and play using your own rules. No accounts, enforced turns, or scoring system.

## Run locally

Requires **Node.js 22.14+** and npm. Use the existing checkout; each cloud task is already isolated and needs no Git worktree.

On Windows, install the **LTS version of Node.js** from [nodejs.org](https://nodejs.org/) with npm and the PATH option enabled. Reopen PowerShell after installation (restart VS Code too if using its terminal), then check `node --version` and `npm.cmd --version`.

Run commands from the repository directory. The examples below include **Windows PowerShell** equivalents; `npm.cmd` runs the same npm commands without relying on PowerShell's `npm.ps1` script.

Before installing dependencies, confirm that both `package.json` and `package-lock.json` are present in this directory. If they are missing, check that your checkout includes the app implementation and that you have switched to the branch containing it; npm cannot install the app from a README-only checkout.

macOS/Linux:

```sh
npm ci
npm run dev
```

Windows PowerShell (replace the example path with your checkout):

```powershell
Set-Location 'C:\path\to\cards'
npm.cmd ci
npm.cmd run dev
```

The development server listens on port **3000**. Open `http://localhost:3000` in your local browser. Press **Ctrl+C** in the terminal to stop the server. Use separate browser profiles or private windows for different players; tabs sharing local storage recover the same seat. `PORT` changes the port. `CARDS_DATA_DIR` changes the local data directory (default: `.local/rooms`).

For example, to use a different port and data directory on macOS/Linux:

```sh
PORT=3001 CARDS_DATA_DIR=./.local/custom-rooms npm run dev
```

Windows PowerShell:

```powershell
$env:PORT = '3001'
$env:CARDS_DATA_DIR = '.\.local\custom-rooms'
npm.cmd run dev
```

PowerShell environment variables remain set for the current terminal session. After stopping the server, remove these overrides to return to the defaults:

```powershell
Remove-Item Env:PORT, Env:CARDS_DATA_DIR -ErrorAction SilentlyContinue
```

The Node server persists room state in ignored JSON files and needs no external services or credentials. Local data contains private hands and seat tokens: keep `.local/` private. It is never served as web content. It is intended for development; use the Cloudflare backend for public hosting.

## Playing

- Click a card to select/deselect it. Choose a destination in the selection bar and move the selection together.
- Clicking a facedown stack selects its top card. **Select top N** selects several without revealing their values. Card counts are visible on both desktop and touch devices.
- You can give cards to any hand. You can take cards from your own hand, shared piles, or a vacant seat's hand. An occupied or reconnecting player's hand stays protected.
- Hosts can shuffle the Deck, return all cards with confirmation, add/configure piles, and delete empty piles. Returning cards leaves all collections in place and does **not** shuffle.
- **Deal cards** always deals from the Deck, one card at a time in player-number order, starting with the selected seat. Choose a base count per occupied player and check any players who should receive one extra. Insufficient deals fail without moving cards. Reconnecting seats count as occupied.
- Pile visibility applies to all cards in the pile. Faceup piles expose values to everyone; facedown piles hide them. Hands always remain private. Players manage game rules and scoring themselves.
- Hosts drag piles between grid cells or use each pile's **↔** button on touch/keyboard. Occupied cells swap, so collections cannot overlap. Card lists scroll internally. There is a practical limit of 60 shared collections, including the Deck; pile names allow 32 characters.
- On desktop, the next numbered seat is to your left, followed by the top and right. Seat numbers remain fixed when players leave. Compact screens place these same three seats in a row above the table; your hand stays below it.
- Refresh recovers your seat using a random browser-held token. A disconnected seat is held for two minutes, then becomes vacant. A replacement takes the lowest-numbered vacant seat and inherits its remaining cards.
- Explicitly leaving releases the seat immediately. A host must pass hosting to another occupied player or close the game. If a disconnected host times out, hosting passes to the next connected player (or the lowest occupied seat if all are reconnecting). When no occupied/reconnecting seats remain, the table closes. Closed codes cannot be reopened.

## Checks

macOS/Linux:

```sh
npm test              # 13 game/coordinator tests, including privacy and concurrent moves
npm run check         # JavaScript syntax checks
npm run build         # Cloudflare bundle validation; does not publish
npm run test:browser  # four-player Chromium test using an isolated Node server
```

Browser tests use `/usr/bin/chromium` by default. Set `CHROMIUM_PATH` to your Chromium executable. The test creates and cleans up its own server and data directory. Screenshots are saved to ignored `test-results/`.

Windows PowerShell:

```powershell
npm.cmd test
npm.cmd run check
npm.cmd run build

# Install Playwright's Chromium once, then use its Windows executable.
npm.cmd exec -- playwright install chromium
$env:CHROMIUM_PATH = node --input-type=module -e "import { chromium } from '@playwright/test'; console.log(chromium.executablePath());"
npm.cmd run test:browser
```

Set `CHROMIUM_PATH` again when opening a new PowerShell terminal, or point it to an existing Chrome/Chromium installation instead:

```powershell
$env:CHROMIUM_PATH = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
```

Use the actual installation path on your computer.

To exercise the actual Cloudflare runtime locally on macOS/Linux:

```sh
npm run dev:cloudflare -- --port 8787
# In another terminal:
CARDS_TEST_URL=http://localhost:8787 npm run test:browser
```

Windows PowerShell, in the first terminal:

```powershell
npm.cmd run dev:cloudflare -- --port 8787
```

In a second PowerShell terminal, opened in the repository directory:

```powershell
$env:CHROMIUM_PATH = node --input-type=module -e "import { chromium } from '@playwright/test'; console.log(chromium.executablePath());"
$env:CARDS_TEST_URL = 'http://localhost:8787'
npm.cmd run test:browser

# Remove this override before testing the isolated Node server again.
Remove-Item Env:CARDS_TEST_URL -ErrorAction SilentlyContinue
```

Install Playwright's Chromium first using the command above. Stop the Cloudflare runtime with **Ctrl+C** in its terminal when finished.

The browser suite covers both deck types, four seats, full-table rejection, extra-card dealing, visible/hidden hands, card transfers, pile configuration and shared positioning, refresh recovery, seat replacement, return/shuffle, host transfer, closure, and phone layouts. The game tests also check two-minute expiration and simultaneous attempts to move the same card.

## Free-tier deployment on Cloudflare

The frontend and API are served by **one Cloudflare Worker with Static Assets**. A SQLite-backed **Durable Object per room** coordinates WebSockets and persists state. A second namespace rate-limits join/create/socket attempts. No separate Pages project, database service, or paid add-on is required.

This architecture supports Cloudflare's Workers Free plan with SQLite Durable Objects, subject to the plan's current request, storage, and compute quotas. Free service is not unlimited; check the current [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/) and [Durable Objects pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/) before publishing. Billing is controlled in your Cloudflare account.

To publish using your own Cloudflare account on macOS/Linux:

```sh
npm run cloudflare -- login
npm run deploy
```

Windows PowerShell:

```powershell
npm.cmd run cloudflare -- login
npm.cmd run deploy
```

`wrangler.jsonc` declares both SQLite namespaces and their initial migration. Change its Worker name if needed. These scripts keep Wrangler configuration in `.local/cloudflare-config` unless `XDG_CONFIG_HOME` is explicitly set, and logs in `.local/wrangler-logs`, so they work in restricted cloud workspaces. Use the `cloudflare` script for login as well as deployment to keep the authentication location consistent. Never commit credentials or `.local/`.

Deployment is not performed by the build or tests. No Cloudflare account is required for local development.

## Structure and privacy

- `public/`: responsive, accessible HTML/CSS and browser ES module; no frontend build pipeline or external fonts/CDNs.
- `server/game.js`: shared game rules, authorization, deck definitions, and per-player state projection.
- `server/room.js`: serialized room operations, socket sessions, reconnect deadlines, and persistence coordination.
- `server/local.js`: Node HTTP/WebSocket development adapter with file persistence.
- `server/worker.js`: Worker routing, hibernating WebSockets, Durable Object persistence, and per-IP rate limiting.
- `test/`: state/coordinator tests and four-player browser workflow.

New decks start shuffled. Shuffling regenerates opaque card IDs so previously seen cards cannot be tracked through a shuffle. Hidden card values and seat tokens are never sent to other players. The server validates every move and host operation; selecting a card does not reserve it, and the first valid move wins. Browser selection is local. Room codes use four uppercase letters without I or O; endpoints limit repeated guesses. Seat tokens travel in the first WebSocket message, not a URL. Mutating endpoints and WebSocket upgrades require the same origin. There is no player identity verification: anyone knowing the code can take an available seat, as designed.
