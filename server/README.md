# BoardHack multiplayer server

Room-by-code WebSocket server for BoardHack classic chess. No accounts — invite a friend with a short room code.

## Run

```bash
cd server
npm install
npm start
```

Default port: **3001** (override with `PORT=3002 npm start`).

Health check: `GET http://localhost:3001/health`

## Client connection

Open classic mode in a browser:

- Static site: open `gamemodes/classic/index.html` (or serve the repo root with any static server).
- Default server URL: `http://localhost:3001`
- Override via query: `?server=http://HOST:3001`
- Join link: `gamemodes/classic/index.html?room=ABC123` (optional `&server=...`)

Flow:

1. Start this server (`npm start`).
2. Player A opens classic → **Создать комнату** → shares the code/link.
3. Player B opens classic → **Войти** and enters the code (or opens the share link).
4. Both play; bot is disabled in multiplayer. Reconnect uses `localStorage` `clientId` + room code.

## Protocol (socket.io)

| Event | Direction | Purpose |
|-------|-----------|---------|
| `createRoom` | C→S | `{ clientId, mode?, preferredSeat? }` → `{ ok, code, seat, room }` |
| `joinRoom` | C→S | `{ clientId, code }` → `{ ok, code, seat, room }` |
| `reconnectRoom` | C→S | `{ clientId, code }` reclaim seat after refresh |
| `makeMove` | C→S | `{ clientId, code, from, to, fen, san, plySans?, gameOver? }` |
| `resetGame` | C→S | host only — back to start FEN |
| `leaveRoom` | C→S | leave seat |
| `roomState` / `moveApplied` / `gameReset` | S→C | sync |
| `opponentJoined` / `opponentLeft` / `opponentDisconnected` / `opponentReconnected` | S→C | presence |

Room codes are 6 characters (`A–Z` / `2–9`, no ambiguous `0/O/1/I`).
