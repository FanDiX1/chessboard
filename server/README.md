# BoardHack multiplayer server

Room-by-code WebSocket server for BoardHack (chess classic/dice, checkers classic/customizable, and backgammon classic/long). Modes are isolated so rooms do not collide. No accounts — invite a friend with a short room code.

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

- Static site: open `gamemodes/chess/classic/index.html`, `gamemodes/checkers/*/index.html`, or `gamemodes/backgammon/*/index.html` (or serve the repo root).
- Default production server: `https://chessboard-ulhg.onrender.com`
- Local: `http://localhost:3001` — override via `?server=http://HOST:3001`
- Join link: `...?room=ABC123` (optional `&server=...`)
- `createRoom` / `joinRoom` `mode`: `classic` | `dice` | `checkers` (alias `checkers-classic`) | `checkers-custom` | `backgammon` | `backgammon-long` (aliases `bg-classic` / `bg-long`)

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
| `makeMove` | C→S | `{ clientId, code, from, to, fen, san, plySans?, gameOver?, bg?, stateSync? }` |
| `resetGame` | C→S | host only — back to start FEN |
| `updateCustomSettings` | C→S | checkers-custom: `{ clientId, code, customSettings }` (host/white, before first ply) |
| `leaveRoom` | C→S | leave seat |
| `roomState` / `moveApplied` / `gameReset` | S→C | sync |
| `opponentJoined` / `opponentLeft` / `opponentDisconnected` / `opponentReconnected` | S→C | presence |

Room codes are 6 characters (`A–Z` / `2–9`, no ambiguous `0/O/1/I`).

Customizable checkers rooms sync `customSettings` (`backwardCapture`, `mandatoryCapture`, `moveTimer`) with FEN/chain.

Checkers rooms use a draughts-style board FEN (`w/W` white man/king, `b/B` black) with starting position for Russian draughts; chess rooms keep standard FIDE FEN; backgammon rooms sync a `bg` state object (points, bar for classic, off, turn, dice, phase, history) with `fen` marker `bg w|b`.

## Deploy note

After pulling server changes (new `checkers-custom` mode / `updateCustomSettings`), **redeploy the Render service** so production picks up `checkers-custom` rooms.
