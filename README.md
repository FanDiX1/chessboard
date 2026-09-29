# BoardHack

Dark-themed multi-game hub: chess (classic / dice / customizable / knights battle / atomic), checkers (classic / customizable), and Mahjong (stub). Local bots and multiplayer rooms (RU/EN).

## Features

- **Hub** — game tabs (Chess / Checkers / Mahjong) with mode cards
- **Chess → Classic** — standard FIDE chess vs Stockfish or a friend
- **Chess → Dice** — move only piece types rolled (1–3 dice)
- **Chess → Customizable** — free piece setup (palette) before play; then classic rules vs Stockfish or MP
- **Chess → Knights Battle** — all non-pawn/non-king pieces are knights; vs Stockfish (SP)
- **Chess → Atomic** — captures explode adjacent non-pawn pieces; local search bot (SP)
- **Checkers → Classic** — Russian draughts vs local bot or online multiplayer
- **Checkers → Customizable** — house rules (backward capture for men, mandatory capture, move timer)
- **Mahjong** — stub panel (modes coming soon)
- **Stockfish bot** — browser WASM engine (`vendor/stockfish`)
- **Multiplayer** — room codes via Socket.IO server (`server/`); nicknames + spectate by code; live public room list in each MP lobby
- **i18n** — Russian / English UI

## Quick start (static site)

Serve the repo root with any static file server (preferred), or open directory URLs such as `/`, `/gamemodes/chess/classic/`, `/gamemodes/checkers/classic/` (GitHub Pages serves `index.html` for directories). Opening `file://…/index.html` still works locally.

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
gamemodes/chess/custom/    # free-setup customizable chess
gamemodes/chess/knights/   # knights battle (SP)
gamemodes/chess/atomic/    # atomic chess (SP)
gamemodes/checkers/classic/# Russian draughts
gamemodes/checkers/custom/ # customizable draughts house rules
js/                        # Stockfish bot helper + atomic engine
vendor/stockfish/          # Stockfish 18 lite WASM
server/                    # Express + Socket.IO rooms (no node_modules in git)
```

## License notes

Stockfish files under `vendor/stockfish/` keep their upstream licenses (`Copying.txt`, `AUTHORS`).
