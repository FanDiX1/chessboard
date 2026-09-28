# Stockfish WASM (BoardHack)

Vendored from npm `stockfish@18.0.0` (nmrugg/stockfish.js):

- `stockfish-18-lite-single.js` — Web Worker entry (single-threaded, no special CORS)
- `stockfish-18-lite-single.wasm` — lite NNUE binary (~7 MB)
- `Copying.txt` / `AUTHORS` — GPLv3 / credits

## Loading

Pages start a Worker at a relative URL, e.g. `../../vendor/stockfish/stockfish-18-lite-single.js`.
The worker resolves the `.wasm` next to the `.js` file automatically.

## file:// caveat

Chrome/Edge block `new Worker()` (and often WASM fetch) for pages opened as `file://`.
Serve the site over HTTP instead, e.g.:

```bash
cd chessboard
npx --yes serve -p 8080
# or: python -m http.server 8080
```

Then open `http://localhost:8080/gamemodes/classic/` (or dice).
