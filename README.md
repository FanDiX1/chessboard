# BoardHack

Dark-themed chess lab: classic FIDE chess and dice chess, local Stockfish bot, and multiplayer rooms (RU/EN).

## Features

- **Classic** — standard chess vs Stockfish or a friend
- **Dice** — move only piece types rolled (1–3 dice)
- **Stockfish bot** — browser WASM engine (`vendor/stockfish`)
- **Multiplayer** — room codes via Socket.IO server (`server/`)
- **i18n** — Russian / English UI

## Quick start (static site)

Serve the repo root with any static file server, or open `index.html` / `gamemodes/*/index.html` in a browser.

Stockfish needs HTTP(S) (not `file://`) for WASM workers.

```bash
# example
npx --yes serve -l 8080 .
```

## Multiplayer server

```bash
cd server
npm install
npm start
```

Default: `http://localhost:3001` — see `server/README.md`.

## Layout

```
index.html          # hub
css/                # BoardHack styles
gamemodes/classic/  # classic mode
gamemodes/dice/     # dice mode
js/                 # Stockfish bot helper
vendor/stockfish/   # Stockfish 18 lite WASM
server/             # Express + Socket.IO rooms (no node_modules in git)
```

## License notes

Stockfish files under `vendor/stockfish/` keep their upstream licenses (`Copying.txt`, `AUTHORS`).
