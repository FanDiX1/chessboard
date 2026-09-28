# BoardHack

Dark-themed multi-game hub: chess, checkers, and backgammon. Local bots and multiplayer rooms (RU/EN).

## Features

- **Hub** — game tabs (Chess / Checkers / Backgammon / Mahjong) with mode cards
- **Chess → Classic** — standard FIDE chess vs Stockfish or a friend
- **Chess → Dice** — move only piece types rolled (1–3 dice)
- **Checkers → Classic** — Russian draughts vs local bot or online multiplayer
- **Backgammon → Classic** — Russian long nardy vs local bot or online multiplayer (same direction, no hitting, head rule)
- **Backgammon → Short** — short/Western backgammon vs local bot or online multiplayer (hitting, bar, bearing off)
- **Stockfish bot** — browser WASM engine (`vendor/stockfish`)
- **Multiplayer** — room codes via Socket.IO server (`server/`)
- **i18n** — Russian / English UI

## Quick start (static site)

Serve the repo root with any static file server, or open `index.html` / `gamemodes/chess/*/index.html` / `gamemodes/checkers/classic/index.html` / `gamemodes/backgammon/*/index.html` in a browser.

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
index.html                 # multi-game hub
css/                       # BoardHack styles
gamemodes/chess/classic/   # classic chess
gamemodes/chess/dice/      # dice chess
gamemodes/checkers/classic/# Russian draughts
gamemodes/backgammon/long/   # classic long nardy (классика)
gamemodes/backgammon/classic/# short backgammon (короткие)
js/                        # Stockfish bot helper
vendor/stockfish/          # Stockfish 18 lite WASM
server/                    # Express + Socket.IO rooms (no node_modules in git)
```

## License notes

Stockfish files under `vendor/stockfish/` keep their upstream licenses (`Copying.txt`, `AUTHORS`).
