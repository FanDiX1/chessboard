/**
 * BoardHack Atomic Chess engine (browser).
 * Capture explosion: capturing piece + captured piece + all king-adjacent (Chebyshev ≤1)
 * pieces around the capture square are removed, EXCEPT pawns (pawns do not explode).
 * Capturing/captured pawns are still removed as participants of the capture.
 * Both kings exploded → mover loses. Enemy king exploded, own survives → win.
 */
(function (global) {
  "use strict";

  var FILES = "abcdefgh";
  var START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

  var PIECE_VAL = { p: 100, n: 300, b: 300, r: 500, q: 900, k: 0 };

  function cloneBoard(board) {
    var out = {};
    for (var sq in board) {
      if (Object.prototype.hasOwnProperty.call(board, sq) && board[sq]) {
        out[sq] = { type: board[sq].type, color: board[sq].color };
      }
    }
    return out;
  }

  function sqOk(f, r) {
    return f >= 0 && f < 8 && r >= 1 && r <= 8;
  }

  function alg(f, r) {
    return FILES.charAt(f) + String(r);
  }

  function parseSq(sq) {
    return { f: FILES.indexOf(sq.charAt(0)), r: parseInt(sq.charAt(1), 10) };
  }

  function neighborsOf(sq) {
    var p = parseSq(sq);
    var out = [];
    for (var df = -1; df <= 1; df++) {
      for (var dr = -1; dr <= 1; dr++) {
        if (df === 0 && dr === 0) continue;
        var f = p.f + df;
        var r = p.r + dr;
        if (sqOk(f, r)) out.push(alg(f, r));
      }
    }
    return out;
  }

  function fenToBoard(fen) {
    var parts = fen.split(" ");
    var rows = parts[0].split("/");
    var board = {};
    for (var ri = 0; ri < 8; ri++) {
      var rank = 8 - ri;
      var file = 0;
      var row = rows[ri];
      for (var i = 0; i < row.length; i++) {
        var ch = row.charAt(i);
        if (ch >= "1" && ch <= "8") {
          file += parseInt(ch, 10);
        } else {
          var color = ch === ch.toUpperCase() ? "w" : "b";
          var type = ch.toLowerCase();
          board[alg(file, rank)] = { type: type, color: color };
          file++;
        }
      }
    }
    return {
      board: board,
      turn: parts[1] || "w",
      castling: parts[2] || "-",
      ep: parts[3] || "-",
      halfmove: parseInt(parts[4], 10) || 0,
      fullmove: parseInt(parts[5], 10) || 1
    };
  }

  function boardToFen(state) {
    var rows = [];
    for (var rank = 8; rank >= 1; rank--) {
      var empty = 0;
      var row = "";
      for (var f = 0; f < 8; f++) {
        var p = state.board[alg(f, rank)];
        if (!p) {
          empty++;
        } else {
          if (empty) {
            row += String(empty);
            empty = 0;
          }
          var ch = p.type;
          row += p.color === "w" ? ch.toUpperCase() : ch;
        }
      }
      if (empty) row += String(empty);
      rows.push(row);
    }
    return (
      rows.join("/") +
      " " +
      state.turn +
      " " +
      (state.castling || "-") +
      " " +
      (state.ep || "-") +
      " " +
      (state.halfmove || 0) +
      " " +
      (state.fullmove || 1)
    );
  }

  function findKing(board, color) {
    for (var sq in board) {
      if (board[sq] && board[sq].type === "k" && board[sq].color === color) return sq;
    }
    return null;
  }

  function boardToPositionObject(board) {
    var pos = {};
    for (var sq in board) {
      if (!board[sq]) continue;
      pos[sq] = board[sq].color + board[sq].type.toUpperCase();
    }
    return pos;
  }

  /** Apply capture explosion centered on `to`. Mutates board. */
  function explode(board, from, to) {
    // Capturer leaves `from` (already conceptually moved onto `to`)
    delete board[from];
    // Remove capturer + captured at `to`, and adjacent non-pawns
    var epicenter = [to].concat(neighborsOf(to));
    for (var i = 0; i < epicenter.length; i++) {
      var sq = epicenter[i];
      var p = board[sq];
      if (!p) continue;
      if (sq === to) {
        // Capture square: everything goes (capturer & captured)
        delete board[sq];
        continue;
      }
      // Adjacent: pawns immune
      if (p.type === "p") continue;
      delete board[sq];
    }
  }

  function rayMoves(board, from, color, deltas, sliding) {
    var p = parseSq(from);
    var out = [];
    for (var d = 0; d < deltas.length; d++) {
      var df = deltas[d][0];
      var dr = deltas[d][1];
      var f = p.f + df;
      var r = p.r + dr;
      while (sqOk(f, r)) {
        var sq = alg(f, r);
        var occ = board[sq];
        if (!occ) {
          out.push({ from: from, to: sq, capture: false });
        } else {
          if (occ.color !== color) out.push({ from: from, to: sq, capture: true });
          break;
        }
        if (!sliding) break;
        f += df;
        r += dr;
      }
    }
    return out;
  }

  function knightMoves(board, from, color) {
    return rayMoves(
      board,
      from,
      color,
      [
        [1, 2],
        [2, 1],
        [2, -1],
        [1, -2],
        [-1, -2],
        [-2, -1],
        [-2, 1],
        [-1, 2]
      ],
      false
    );
  }

  function kingMoves(board, from, color) {
    return rayMoves(
      board,
      from,
      color,
      [
        [1, 0],
        [1, 1],
        [0, 1],
        [-1, 1],
        [-1, 0],
        [-1, -1],
        [0, -1],
        [1, -1]
      ],
      false
    );
  }

  function pawnMoves(board, from, color, ep) {
    var p = parseSq(from);
    var dir = color === "w" ? 1 : -1;
    var startRank = color === "w" ? 2 : 7;
    var promoRank = color === "w" ? 8 : 1;
    var out = [];
    var one = alg(p.f, p.r + dir);
    if (sqOk(p.f, p.r + dir) && !board[one]) {
      if (p.r + dir === promoRank) {
        out.push({ from: from, to: one, capture: false, promotion: "q" });
        out.push({ from: from, to: one, capture: false, promotion: "n" });
        out.push({ from: from, to: one, capture: false, promotion: "r" });
        out.push({ from: from, to: one, capture: false, promotion: "b" });
      } else {
        out.push({ from: from, to: one, capture: false });
        if (p.r === startRank) {
          var two = alg(p.f, p.r + 2 * dir);
          if (!board[two]) out.push({ from: from, to: two, capture: false, doublePawn: true });
        }
      }
    }
    for (var df = -1; df <= 1; df += 2) {
      var cf = p.f + df;
      var cr = p.r + dir;
      if (!sqOk(cf, cr)) continue;
      var csq = alg(cf, cr);
      var occ = board[csq];
      if (occ && occ.color !== color) {
        if (cr === promoRank) {
          out.push({ from: from, to: csq, capture: true, promotion: "q" });
          out.push({ from: from, to: csq, capture: true, promotion: "n" });
          out.push({ from: from, to: csq, capture: true, promotion: "r" });
          out.push({ from: from, to: csq, capture: true, promotion: "b" });
        } else {
          out.push({ from: from, to: csq, capture: true });
        }
      } else if (ep && ep === csq && !occ) {
        // en passant: captured pawn sits behind ep square
        out.push({ from: from, to: csq, capture: true, ep: true });
      }
    }
    return out;
  }

  function castlingMoves(state, color) {
    var board = state.board;
    var out = [];
    var rights = state.castling || "-";
    if (rights === "-") return out;
    // In atomic, castling through/into check uses atomic check; also king/rook must be clear.
    // Skip castling if kings would explode (adjacent enemy) — handled by legality filter.
    var rank = color === "w" ? 1 : 8;
    var kingSq = "e" + rank;
    if (!board[kingSq] || board[kingSq].type !== "k" || board[kingSq].color !== color) return out;
    function clear(files) {
      for (var i = 0; i < files.length; i++) {
        if (board[files[i] + rank]) return false;
      }
      return true;
    }
    if (color === "w") {
      if (rights.indexOf("K") >= 0 && board["h1"] && board["h1"].type === "r" && board["h1"].color === "w" && clear(["f", "g"])) {
        out.push({ from: "e1", to: "g1", capture: false, castle: "K" });
      }
      if (rights.indexOf("Q") >= 0 && board["a1"] && board["a1"].type === "r" && board["a1"].color === "w" && clear(["b", "c", "d"])) {
        out.push({ from: "e1", to: "c1", capture: false, castle: "Q" });
      }
    } else {
      if (rights.indexOf("k") >= 0 && board["h8"] && board["h8"].type === "r" && board["h8"].color === "b" && clear(["f", "g"])) {
        out.push({ from: "e8", to: "g8", capture: false, castle: "k" });
      }
      if (rights.indexOf("q") >= 0 && board["a8"] && board["a8"].type === "r" && board["a8"].color === "b" && clear(["b", "c", "d"])) {
        out.push({ from: "e8", to: "c8", capture: false, castle: "q" });
      }
    }
    return out;
  }

  function generatePseudo(state) {
    var board = state.board;
    var color = state.turn;
    var moves = [];
    for (var sq in board) {
      var p = board[sq];
      if (!p || p.color !== color) continue;
      var list;
      if (p.type === "n") list = knightMoves(board, sq, color);
      else if (p.type === "b")
        list = rayMoves(board, sq, color, [[1, 1], [1, -1], [-1, 1], [-1, -1]], true);
      else if (p.type === "r")
        list = rayMoves(board, sq, color, [[1, 0], [-1, 0], [0, 1], [0, -1]], true);
      else if (p.type === "q")
        list = rayMoves(
          board,
          sq,
          color,
          [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]],
          true
        );
      else if (p.type === "k") list = kingMoves(board, sq, color);
      else if (p.type === "p") list = pawnMoves(board, sq, color, state.ep);
      else list = [];
      for (var i = 0; i < list.length; i++) {
        list[i].piece = p.type;
        list[i].color = color;
        moves.push(list[i]);
      }
    }
    var castles = castlingMoves(state, color);
    for (var c = 0; c < castles.length; c++) {
      castles[c].piece = "k";
      castles[c].color = color;
      moves.push(castles[c]);
    }
    return moves;
  }

  function updateCastling(state, move, piece) {
    var rights = state.castling || "-";
    if (rights === "-") return "-";
    var r = rights;
    if (piece === "k") {
      if (move.color === "w") r = r.replace("K", "").replace("Q", "");
      else r = r.replace("k", "").replace("q", "");
    }
    if (piece === "r" || move.castle) {
      if (move.from === "a1" || move.to === "a1") r = r.replace("Q", "");
      if (move.from === "h1" || move.to === "h1") r = r.replace("K", "");
      if (move.from === "a8" || move.to === "a8") r = r.replace("q", "");
      if (move.from === "h8" || move.to === "h8") r = r.replace("k", "");
    }
    // rook may explode
    if (!state.board["a1"] || state.board["a1"].type !== "r") r = r.replace("Q", "");
    if (!state.board["h1"] || state.board["h1"].type !== "r") r = r.replace("K", "");
    if (!state.board["a8"] || state.board["a8"].type !== "r") r = r.replace("q", "");
    if (!state.board["h8"] || state.board["h8"].type !== "r") r = r.replace("k", "");
    return r || "-";
  }

  /**
   * Apply a pseudo-legal move. Returns new state or null if suicide (own king gone, enemy alive)
   * or both kings gone.
   */
  function applyMove(state, move) {
    var board = cloneBoard(state.board);
    var piece = board[move.from];
    if (!piece) return null;
    var isCapture = !!move.capture || !!board[move.to] || !!move.ep;
    var nextEp = "-";

    if (move.castle) {
      delete board[move.from];
      board[move.to] = { type: "k", color: piece.color };
      if (move.castle === "K" || move.castle === "k") {
        var rf = move.color === "w" ? "h1" : "h8";
        var rt = move.color === "w" ? "f1" : "f8";
        delete board[rf];
        board[rt] = { type: "r", color: piece.color };
      } else {
        var rf2 = move.color === "w" ? "a1" : "a8";
        var rt2 = move.color === "w" ? "d1" : "d8";
        delete board[rf2];
        board[rt2] = { type: "r", color: piece.color };
      }
    } else if (isCapture) {
      if (move.ep) {
        // remove captured pawn behind ep square
        var epCapRank = piece.color === "w" ? parseSq(move.to).r - 1 : parseSq(move.to).r + 1;
        var epCap = alg(parseSq(move.to).f, epCapRank);
        delete board[epCap];
        // Place capturer on ep square then explode (captured already removed; epicenter is ep sq)
        delete board[move.from];
        board[move.to] = { type: piece.type, color: piece.color };
        explode(board, move.to, move.to); // from already empty; explode around to
        // explode() deletes `from` again (noop) and clears epicenter — but capturer is ON `to`.
        // Re-do properly:
      }
      // Standard capture path (also re-do ep cleanly below)
    }

    // Clean unified apply
    board = cloneBoard(state.board);
    piece = board[move.from];
    if (move.castle) {
      delete board[move.from];
      board[move.to] = { type: "k", color: piece.color };
      if (move.castle === "K" || move.castle === "k") {
        delete board[move.color === "w" ? "h1" : "h8"];
        board[move.color === "w" ? "f1" : "f8"] = { type: "r", color: piece.color };
      } else {
        delete board[move.color === "w" ? "a1" : "a8"];
        board[move.color === "w" ? "d1" : "d8"] = { type: "r", color: piece.color };
      }
    } else if (move.ep) {
      var capR = piece.color === "w" ? parseSq(move.to).r - 1 : parseSq(move.to).r + 1;
      delete board[alg(parseSq(move.to).f, capR)];
      delete board[move.from];
      board[move.to] = piece;
      // Explosion: remove capturer at to + neighbors (non-pawns). Captured pawn already gone.
      var epi = [move.to].concat(neighborsOf(move.to));
      for (var ei = 0; ei < epi.length; ei++) {
        var es = epi[ei];
        var ep = board[es];
        if (!ep) continue;
        if (es === move.to) {
          delete board[es];
          continue;
        }
        if (ep.type === "p") continue;
        delete board[es];
      }
    } else if (board[move.to] || move.capture) {
      delete board[move.from];
      board[move.to] = move.promotion
        ? { type: move.promotion, color: piece.color }
        : { type: piece.type, color: piece.color };
      var epi2 = [move.to].concat(neighborsOf(move.to));
      for (var ej = 0; ej < epi2.length; ej++) {
        var es2 = epi2[ej];
        var ep2 = board[es2];
        if (!ep2) continue;
        if (es2 === move.to) {
          delete board[es2];
          continue;
        }
        if (ep2.type === "p") continue;
        delete board[es2];
      }
    } else {
      delete board[move.from];
      board[move.to] = move.promotion
        ? { type: move.promotion, color: piece.color }
        : { type: piece.type, color: piece.color };
      if (move.doublePawn) {
        var mid = alg(parseSq(move.from).f, (parseSq(move.from).r + parseSq(move.to).r) / 2);
        nextEp = mid;
      }
    }

    var ownKing = findKing(board, move.color);
    var oppColor = move.color === "w" ? "b" : "w";
    var oppKing = findKing(board, oppColor);

    // Both kings gone → illegal for mover
    if (!ownKing && !oppKing) return null;
    // Own king gone, opponent alive → illegal
    if (!ownKing && oppKing) return null;

    var half = state.halfmove || 0;
    if (isCapture || piece.type === "p") half = 0;
    else half += 1;

    var next = {
      board: board,
      turn: oppColor,
      castling: "-",
      ep: nextEp,
      halfmove: half,
      fullmove: move.color === "b" ? (state.fullmove || 1) + 1 : state.fullmove || 1,
      winner: !oppKing ? move.color : null
    };
    next.castling = updateCastling(
      { board: board, castling: state.castling },
      move,
      piece.type
    );
    return next;
  }

  /** Does `color` have a pseudo move that removes opponent king? */
  function canExplodeKing(state, attackerColor) {
    var victim = attackerColor === "w" ? "b" : "w";
    var kingSq = findKing(state.board, victim);
    if (!kingSq) return true;
    var danger = {};
    danger[kingSq] = true;
    var neigh = neighborsOf(kingSq);
    for (var ni = 0; ni < neigh.length; ni++) danger[neigh[ni]] = true;

    var probe = {
      board: state.board,
      turn: attackerColor,
      castling: "-",
      ep: state.ep,
      halfmove: state.halfmove,
      fullmove: state.fullmove
    };
    var moves = generatePseudo(probe);
    for (var i = 0; i < moves.length; i++) {
      var m = moves[i];
      // Only captures (or king walks onto danger) can explode a king
      if (!(m.capture || m.ep || danger[m.to])) continue;
      if (!(m.capture || m.ep) && m.to !== kingSq) continue;
      var next = applyMove(probe, m);
      if (!next) continue;
      if (!findKing(next.board, victim)) return true;
    }
    return false;
  }

  function inCheck(state, color) {
    // Side `color` is in check if opponent can explode their king
    return canExplodeKing(state, color === "w" ? "b" : "w");
  }

  function legalMoves(state) {
    var pseudo = generatePseudo(state);
    var out = [];
    for (var i = 0; i < pseudo.length; i++) {
      var m = pseudo[i];
      var next = applyMove(state, m);
      if (!next) continue;
      // Winning move (opp king gone) is always legal
      if (next.winner) {
        out.push(m);
        continue;
      }
      // Castling: cannot castle out of / through / into atomic check
      if (m.castle) {
        if (inCheck(state, state.turn)) continue;
        // Through square
        var mid = m.to === "g1" ? "f1" : m.to === "c1" ? "d1" : m.to === "g8" ? "f8" : "d8";
        var midState = applyMove(state, { from: m.from, to: mid, capture: false, piece: "k", color: m.color });
        if (!midState || inCheck(midState, m.color)) continue;
        if (inCheck(next, m.color)) continue;
      } else if (inCheck(next, m.color)) {
        continue;
      }
      out.push(m);
    }
    return out;
  }

  function moveToSan(state, move, next) {
    var piece = state.board[move.from];
    var sym = piece.type === "p" ? "" : piece.type.toUpperCase();
    if (move.castle === "K" || move.castle === "k") return "O-O";
    if (move.castle === "Q" || move.castle === "q") return "O-O-O";
    var cap = move.capture || move.ep || state.board[move.to] ? "x" : "";
    var fromHint = "";
    if (piece.type === "p" && cap) fromHint = move.from.charAt(0);
    var promo = move.promotion ? "=" + move.promotion.toUpperCase() : "";
    var san = sym + fromHint + cap + move.to + promo;
    if (next && next.winner) san += "#";
    else if (next && inCheck(next, next.turn)) san += "+";
    return san;
  }

  function evaluate(state, forColor) {
    if (state.winner) {
      return state.winner === forColor ? 100000 : -100000;
    }
    var ownKing = findKing(state.board, forColor);
    var opp = forColor === "w" ? "b" : "w";
    var oppKing = findKing(state.board, opp);
    if (!oppKing) return 100000;
    if (!ownKing) return -100000;
    var score = 0;
    for (var sq in state.board) {
      var p = state.board[sq];
      if (!p) continue;
      var v = PIECE_VAL[p.type] || 0;
      score += p.color === forColor ? v : -v;
    }
    // Prefer not being adjacent to enemy king with hanging pieces — light mobility bonus
    var moves = legalMoves(state);
    if (state.turn === forColor) score += moves.length * 2;
    else score -= moves.length * 2;
    // King safety: penalize being in check
    if (inCheck(state, forColor)) score -= 80;
    if (inCheck(state, opp)) score += 80;
    return score;
  }

  function searchBest(state, depth, forColor) {
    var rootMoves = legalMoves(state);
    if (!rootMoves.length) return { move: null, score: evaluate(state, forColor) };

    rootMoves.sort(function (a, b) {
      return (b.capture || b.ep ? 1 : 0) - (a.capture || a.ep ? 1 : 0);
    });

    // Instant win
    for (var i = 0; i < rootMoves.length; i++) {
      var wtry = applyMove(state, rootMoves[i]);
      if (wtry && wtry.winner === forColor) return { move: rootMoves[i], score: 100000 };
    }

    var d = typeof depth === "number" ? depth : 1;
    if (d < 1) d = 1;
    if (d > 3) d = 3;

    function staticEval(st) {
      return evaluate(st, forColor);
    }

    function minimax(st, ply, maximizing) {
      if (st.winner) {
        return st.winner === forColor ? 100000 - ply : -100000 + ply;
      }
      if (ply >= d) return staticEval(st);
      var ms = legalMoves(st);
      if (!ms.length) {
        if (inCheck(st, st.turn)) {
          return st.turn === forColor ? -100000 + ply : 100000 - ply;
        }
        return 0;
      }
      ms.sort(function (a, b) {
        return (b.capture || b.ep ? 1 : 0) - (a.capture || a.ep ? 1 : 0);
      });
      // Cap fan-out hard for speed
      if (ms.length > 18) {
        var caps = [];
        var quiet = [];
        for (var j = 0; j < ms.length; j++) {
          if (ms[j].capture || ms[j].ep) caps.push(ms[j]);
          else quiet.push(ms[j]);
        }
        ms = caps.concat(quiet.slice(0, Math.max(6, 18 - caps.length)));
      }
      var bestSc = maximizing ? -Infinity : Infinity;
      for (var k = 0; k < ms.length; k++) {
        var nxt = applyMove(st, ms[k]);
        if (!nxt) continue;
        var sc = minimax(nxt, ply + 1, !maximizing);
        if (maximizing) {
          if (sc > bestSc) bestSc = sc;
        } else {
          if (sc < bestSc) bestSc = sc;
        }
      }
      if (bestSc === Infinity || bestSc === -Infinity) return staticEval(st);
      return bestSc;
    }

    var best = null;
    var bestScore = -Infinity;
    // Limit root quiet moves too
    var root = rootMoves;
    if (root.length > 22) {
      var rc = [];
      var rq = [];
      for (var r = 0; r < root.length; r++) {
        if (root[r].capture || root[r].ep) rc.push(root[r]);
        else rq.push(root[r]);
      }
      root = rc.concat(rq.slice(0, Math.max(8, 22 - rc.length)));
    }
    for (var n = 0; n < root.length; n++) {
      var nxt2 = applyMove(state, root[n]);
      if (!nxt2) continue;
      var sc2 = minimax(nxt2, 1, false);
      if (sc2 > bestScore) {
        bestScore = sc2;
        best = root[n];
      }
    }
    return { move: best || rootMoves[0], score: bestScore };
  }

  function createGame(fen) {
    var state = fenToBoard(fen || START_FEN);
    var history = [];
    var sans = [];

    return {
      fen: function () {
        return boardToFen(state);
      },
      turn: function () {
        return state.turn;
      },
      board: function () {
        return cloneBoard(state.board);
      },
      position: function () {
        return boardToPositionObject(state.board);
      },
      get: function (sq) {
        return state.board[sq] || null;
      },
      moves: function (opts) {
        var list = legalMoves(state);
        if (opts && opts.square) {
          list = list.filter(function (m) {
            return m.from === opts.square;
          });
        }
        if (opts && opts.verbose) return list;
        return list.map(function (m) {
          return m.from + m.to + (m.promotion || "");
        });
      },
      move: function (m) {
        var legal = legalMoves(state);
        var match = null;
        // Match chess.js: promotion is only required for promoting moves.
        // Callers often pass promotion:"q" for every drop; ignore it unless needed.
        for (var i = 0; i < legal.length; i++) {
          var L = legal[i];
          if (L.from !== m.from || L.to !== m.to) continue;
          if (L.promotion) {
            var want = m.promotion || "q";
            if (L.promotion === want) {
              match = L;
              break;
            }
          } else {
            match = L;
            break;
          }
        }
        if (!match) return null;
        var prev = {
          state: {
            board: cloneBoard(state.board),
            turn: state.turn,
            castling: state.castling,
            ep: state.ep,
            halfmove: state.halfmove,
            fullmove: state.fullmove,
            winner: state.winner || null
          },
          sans: sans.slice()
        };
        var next = applyMove(state, match);
        if (!next) return null;
        var san = moveToSan(state, match, next);
        history.push(prev);
        state = next;
        sans.push(san);
        return {
          from: match.from,
          to: match.to,
          promotion: match.promotion,
          san: san,
          color: match.color,
          piece: match.piece,
          captured: match.capture,
          winner: next.winner
        };
      },
      undo: function () {
        if (!history.length) return null;
        var prev = history.pop();
        state = prev.state;
        sans = prev.sans;
        return true;
      },
      in_check: function () {
        return inCheck(state, state.turn);
      },
      king_exploded_winner: function () {
        return state.winner || null;
      },
      game_over: function () {
        if (state.winner) return true;
        var ms = legalMoves(state);
        return ms.length === 0;
      },
      in_checkmate: function () {
        if (state.winner) return false;
        return legalMoves(state).length === 0 && inCheck(state, state.turn);
      },
      in_stalemate: function () {
        if (state.winner) return false;
        return legalMoves(state).length === 0 && !inCheck(state, state.turn);
      },
      history_san: function () {
        return sans.slice();
      },
      load: function (fen) {
        state = fenToBoard(fen);
        history = [];
        sans = [];
      },
      reset: function () {
        this.load(START_FEN);
      },
      snapshot: function () {
        return {
          fen: boardToFen(state),
          sans: sans.slice(),
          winner: state.winner || null
        };
      },
      restore: function (snap) {
        state = fenToBoard(snap.fen);
        if (snap.winner) state.winner = snap.winner;
        sans = snap.sans ? snap.sans.slice() : [];
        history = [];
      },
      searchBest: function (depth, forColor) {
        return searchBest(state, depth, forColor || state.turn);
      },
      START_FEN: START_FEN
    };
  }

  global.BoardHackAtomic = {
    START_FEN: START_FEN,
    createGame: createGame,
    DEPTHS: { easy: 1, medium: 1, hard: 2, expert: 2, master: 2 }
  };
})(typeof window !== "undefined" ? window : self);
