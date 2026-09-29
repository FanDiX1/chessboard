# BoardHack multiplayer server

Room-by-code WebSocket server for BoardHack (chess classic/dice/customizable, checkers classic/customizable). Modes are isolated so rooms do not collide. No accounts — invite a friend with a short room code.

## Run

```bash
cd server
npm install
npm start
```

Default port: **3001** (override with `PORT=3002 npm start`).

Health check: `GET http://localhost:3001/health`

## Client connection

Open a game mode in a browser:

- Static site: open `/gamemodes/chess/classic/` or `/gamemodes/checkers/*/` (or serve the repo root; directory indexes resolve to `index.html`).
- Default production server: `https://chessboard-ulhg.onrender.com`
- Local: `http://localhost:3001` — override via `?server=http://HOST:3001`
- Join/invite link (open seat): `...?join=ABC123` or `...?room=ABC123` (optional `&server=...`)
- Spectate link (both seats filled): `...?spectate=ABC123`
- `createRoom` / `joinRoom` `mode`: `classic` | `dice` | `custom` (alias `chess-custom`) | `checkers` (alias `checkers-classic`) | `checkers-custom`

Flow:

1. Start this server (`npm start`).
2. Player A opens classic → **Создать комнату** → shares the code/link.
3. Player B opens classic → **Войти** and enters the code (or opens the share link).
4. Both play; bot is disabled in multiplayer. Reconnect uses `localStorage` `clientId` + room code.
5. Optional: set a nickname (persisted locally) shown on seats; **Наблюдать / Spectate** joins by code as read-only (multiple spectators; not counted for “both ready”).

## Protocol (socket.io)

| Event | Direction | Purpose |
|-------|-----------|---------|
| `listRooms` | C→S | `{ mode? }` → `{ mode, rooms[] }` (public lobby: code, seats nicks, spectators, joinable); also pushed as `roomList` |
| `createRoom` | C→S | `{ clientId, mode?, preferredSeat?, nick? }` → `{ ok, code, seat, role, room }` |
| `joinRoom` | C→S | `{ clientId, code, mode?, nick? }` → `{ ok, code, seat, role, room }` |
| `spectateRoom` | C→S | `{ clientId, code, mode?, nick? }` → join as spectator (no seat) |
| `reconnectRoom` | C→S | `{ clientId, code, nick? }` reclaim seat after refresh |
| `makeMove` | C→S | `{ clientId, code, from, to, fen, san, plySans?, gameOver?, stateSync? }` |
| `resetGame` | C→S | host only — back to start FEN |
| `updateCustomSettings` | C→S | checkers-custom shared rules: `{ clientId, code, customSettings }` (host only; rejected with `settings_locked` after first ply) |
| `updateSetup` | C→S | chess custom shared setup: `{ clientId, code, fen, ready? }` — rejected once `phase === "play"` |
| `startCustomGame` | C→S | chess custom: host force-start or confirm; requires one king each; locks setup |
| `leaveRoom` | C→S | leave seat |
| `roomState` / `moveApplied` / `gameReset` | S→C | sync (includes `customSettings` + `settingsLocked` where applicable) |
| `customSettingsUpdated` | S→C | checkers-custom: `{ customSettings, settingsLocked, room }` broadcast when rules change |
| `setupUpdated` / `customGameStarted` | S→C | chess custom setup sync / match start (setup locked) |
| `opponentJoined` / `opponentLeft` / `opponentDisconnected` / `opponentReconnected` | S→C | presence |
| `roomEnded` | S→C | room deleted (no seated players left) |

### Room lifecycle

- Seated player socket disconnect starts a **30s reconnect grace**. If still offline after grace, the seat is vacated (`opponentLeft` / kick).
- Vacating the **host** transfers `hostId` to the other seated player (if any).
- When **zero seats** remain occupied, the room is **deleted**: spectators are cleared, `roomEnded` is emitted, and the room is removed from the public `roomList`.
- Explicit `leaveRoom` vacates immediately (no grace). Joining another room also vacates seats held elsewhere.

Room codes are 6 characters (`A–Z` / `2–9`, no ambiguous `0/O/1/I`).

**Shared vs local settings**

- **Checkers custom (shared, room-scoped):** `customSettings` — `backwardCapture`, `mandatoryCapture`, `moveTimer`. Host / White may edit until the first ply; then `settingsLocked: true` and further client updates are ignored. Spectators receive the same values via `roomState` / `customSettingsUpdated`.
- **Chess custom (shared):** free-setup FEN + side-to-move + `setupReady` while `phase === "setup"`. Locked after `startCustomGame` / both ready (`phase === "play"`, `settingsLocked: true`). `updateSetup` rejected with `already_playing`.
- **Chess custom (local UX, not synced):** move-quality analysis and position-eval toggles stay per-client.

Do not confuse chess `custom` / `chess-custom` with `checkers-custom`.

Checkers rooms use a draughts-style board FEN (`w/W` white man/king, `b/B` black) with starting position for Russian draughts; chess rooms keep standard FIDE FEN.

## Deploy note

After pulling server changes (chess-custom shared `moveAnalysis`/`posEval`, `settingsLocked`, `customSettingsUpdated`), **redeploy the Render service** (`https://chessboard-ulhg.onrender.com`) so production picks up the update.
