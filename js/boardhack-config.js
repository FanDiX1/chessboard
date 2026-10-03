/**
 * Shared BoardHack settings. Chess and checkers modes read these values
 * instead of copying the same literals. Per-mode room keys stay distinct.
 */
(function (root, factory) {
  var config = factory();
  root.BoardHackConfig = config;
  if (typeof module !== "undefined" && module.exports) module.exports = config;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  return {
    defaultServer: "https://chessboard-main.onrender.com",
    pieceTheme:
      "https://cdn.jsdelivr.net/gh/oakmac/chessboardjs@master/website/img/chesspieces/wikipedia/{piece}.png",
    standardStartFen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
    standardStartPosition: {
      a8: "bR", b8: "bN", c8: "bB", d8: "bQ", e8: "bK", f8: "bB", g8: "bN", h8: "bR",
      a7: "bP", b7: "bP", c7: "bP", d7: "bP", e7: "bP", f7: "bP", g7: "bP", h7: "bP",
      a2: "wP", b2: "wP", c2: "wP", d2: "wP", e2: "wP", f2: "wP", g2: "wP", h2: "wP",
      a1: "wR", b1: "wN", c1: "wB", d1: "wQ", e1: "wK", f1: "wB", g1: "wN", h1: "wR"
    },
    checkersStartFen: "1b1b1b1b/b1b1b1b1/1b1b1b1b/8/8/w1w1w1w1/1w1w1w1w/w1w1w1w1 w",
    nickMaxLength: 24,
    socket: {
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionAttempts: 12,
      timeout: 8000
    },
    storage: {
      clientId: "boardhack-client-id",
      nick: "boardhack-nick",
      lang: "boardhack-lang",
      color: "boardhack-color",
      mode: "boardhack-mode",
      diceCount: "boardhack-dice-count",
      hubGame: "boardhack-hub-game",
      rooms: {
        classic: "boardhack-mp-room",
        custom: "boardhack-mp-room",
        dice: "boardhack-mp-room-dice",
        knights: "boardhack-mp-room-knights",
        atomic: "boardhack-mp-room-atomic",
        three: "boardhack-mp-room-three",
        checkers: "boardhack-checkers-mp-room",
        checkersCustom: "boardhack-checkers-custom-mp-room"
      },
      colorKnights: "boardhack-knights-color",
      modeKnights: "boardhack-knights-mode",
      colorAtomic: "boardhack-atomic-color",
      colorCheckers: "boardhack-checkers-color",
      diffCheckers: "boardhack-checkers-diff",
      colorCheckersCustom: "boardhack-checkers-custom-color",
      diffCheckersCustom: "boardhack-checkers-custom-diff",
      checkersCustomSettings: "boardhack-checkers-custom-settings",
      customMoveAnalysis: "boardhack-custom-move-analysis",
      customPosEval: "boardhack-custom-pos-eval"
    }
  };
});
