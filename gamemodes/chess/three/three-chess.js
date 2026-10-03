/**
 * Three-player chess on a 96-cell hexagonal board (three 4×8 camps).
 * Geometry and piece steps follow the quadrilateral-cell variant described
 * for Robert Zubrin's board: pawns of the left half advance toward the next
 * player clockwise, the right half toward the other player.
 * Mate transfers the mated army (except the king) to the player who delivered mate.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.ThreeChess = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var COLORS = ["w", "r", "b"];
  var FILES = "abcdefgh";
  var VAL = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 40 };
  var GLYPH = {
    w: { k: "\u2654", q: "\u2655", r: "\u2656", b: "\u2657", n: "\u2658", p: "\u2659" },
    r: { k: "\u2654", q: "\u2655", r: "\u2656", b: "\u2657", n: "\u2658", p: "\u2659" },
    b: { k: "\u265A", q: "\u265B", r: "\u265C", b: "\u265D", n: "\u265E", p: "\u265F" }
  };

  var PAWN_STEPS = [
    ["F"], ["F", "F"],
    ["F", "L"], ["L", "F"],
    ["F", "R"], ["R", "F"]
  ];
  var KNIGHT_STEPS = [
    ["F", "F", "L"], ["F", "F", "R"], ["F", "L", "L"], ["F", "R", "R"],
    ["B", "B", "L"], ["B", "B", "R"], ["B", "L", "L"], ["B", "R", "R"],
    ["L", "L", "F"], ["L", "L", "B"], ["L", "F", "F"], ["L", "B", "B"],
    ["R", "R", "F"], ["R", "R", "B"], ["R", "F", "F"], ["R", "B", "B"]
  ];
  var BISHOP_STEPS = [
    ["F", "L"], ["F", "R"], ["L", "F"], ["R", "F"],
    ["B", "L"], ["B", "R"], ["L", "B"], ["R", "B"]
  ];
  var ROOK_STEPS = [["F"], ["B"], ["L"], ["R"]];
  var KING_STEPS = BISHOP_STEPS.concat(ROOK_STEPS);

  function key(c, row, col) {
    return c + row + col;
  }
  function parse(k) {
    return { c: k.charAt(0), r: +k.charAt(1), f: +k.charAt(2) };
  }
  function idx(c) { return COLORS.indexOf(c); }
  function revDir(d) {
    return d === "F" ? "B" : d === "B" ? "F" : d === "L" ? "R" : "L";
  }

  function neighbour(k, dir) {
    var p = parse(k);
    if (dir === "F") {
      if (p.r < 3) return key(p.c, p.r + 1, p.f);
      if (p.f < 4) return key(COLORS[(idx(p.c) + 1) % 3], 3, 7 - p.f);
      return key(COLORS[(idx(p.c) + 2) % 3], 3, 7 - p.f);
    }
    if (dir === "B") {
      if (p.r === 0) return null;
      return key(p.c, p.r - 1, p.f);
    }
    if (dir === "L") {
      if (p.f === 0) return null;
      return key(p.c, p.r, p.f - 1);
    }
    if (dir === "R") {
      if (p.f === 7) return null;
      return key(p.c, p.r, p.f + 1);
    }
    return null;
  }

  function step(piece, dirs, current, reverse) {
    var rev = !!reverse;
    for (var i = 0; i < dirs.length; i++) {
      var d = dirs[i];
      if ((piece.color !== parse(current).c && piece.type === "p") || rev) d = revDir(d);
      var next = neighbour(current, d);
      if (!next) return null;
      if (parse(next).c !== parse(current).c) rev = true;
      current = next;
    }
    return current;
  }

  function stepsOf(type) {
    if (type === "p") return PAWN_STEPS;
    if (type === "n") return KNIGHT_STEPS;
    if (type === "b") return BISHOP_STEPS;
    if (type === "r") return ROOK_STEPS;
    return KING_STEPS;
  }

  function cloneBoard(board) {
    var out = {};
    for (var k in board) {
      if (Object.prototype.hasOwnProperty.call(board, k)) {
        var p = board[k];
        out[k] = { type: p.type, color: p.color, owner: p.owner };
      }
    }
    return out;
  }

  function piece(type, color) {
    return { type: type, color: color, owner: color };
  }

  function newGame(first, opts) {
    var board = {};
    var back = ["r", "n", "b", "q", "k", "b", "n", "r"];
    for (var ci = 0; ci < COLORS.length; ci++) {
      var c = COLORS[ci];
      for (var f = 0; f < 8; f++) {
        board[key(c, 0, f)] = piece(back[f], c);
        board[key(c, 1, f)] = piece("p", c);
      }
    }
    var start = COLORS.indexOf(first) >= 0 ? first : COLORS[Math.floor(Math.random() * 3)];
    return {
      board: board,
      turn: start,
      over: false,
      winner: null,
      reason: "",
      log: [],
      eliminated: {},
      firstWinner: !!(opts && opts.firstWinner)
    };
  }

  function livingKings(board, owner) {
    var list = [];
    for (var k in board) {
      if (!Object.prototype.hasOwnProperty.call(board, k)) continue;
      var p = board[k];
      if (p.type === "k" && p.owner === owner) list.push(k);
    }
    return list;
  }

  function ownersWithKings(board) {
    var set = {};
    for (var k in board) {
      if (!Object.prototype.hasOwnProperty.call(board, k)) continue;
      var p = board[k];
      if (p.type === "k") set[p.owner] = true;
    }
    return COLORS.filter(function (c) { return set[c]; });
  }

  function nextOwner(board, owner) {
    var alive = ownersWithKings(board);
    if (!alive.length) return null;
    var i = COLORS.indexOf(owner);
    for (var n = 1; n <= 3; n++) {
      var c = COLORS[(i + n) % 3];
      if (alive.indexOf(c) >= 0) return c;
    }
    return null;
  }

  function rayDestinations(board, pieceObj, start, dirs) {
    var out = [];
    var tmp = step(pieceObj, dirs, start, false);
    var guard = 0;
    while (tmp && guard++ < 24) {
      out.push(tmp);
      if (board[tmp]) break;
      var reverse = parse(tmp).c !== parse(start).c;
      var nxt = step(pieceObj, dirs, tmp, reverse);
      if (nxt === tmp) break;
      tmp = nxt;
    }
    return out;
  }

  function pseudoTargets(board, from) {
    var mover = board[from];
    if (!mover) return [];
    var steps = stepsOf(mover.type);
    var dests = [];
    if (mover.type === "r" || mover.type === "b" || mover.type === "q") {
      for (var i = 0; i < steps.length; i++) {
        var ray = rayDestinations(board, mover, from, steps[i]);
        for (var j = 0; j < ray.length; j++) {
          var occ = board[ray[j]];
          if (occ && occ.owner === mover.owner) break;
          dests.push(ray[j]);
          if (occ) break;
        }
      }
      return unique(dests);
    }
    if (mover.type === "p") {
      for (var pi = 0; pi < steps.length; pi++) {
        var end = step(mover, steps[pi], from, false);
        if (!end) continue;
        var target = board[end];
        if (pi === 0) {
          if (!target) dests.push(end);
        } else if (pi === 1) {
          var p = parse(from);
          if (!target && mover.color === p.c && p.r === 1) {
            var mid = step(mover, ["F"], from, false);
            if (mid && !board[mid]) dests.push(end);
          }
        } else if (target && target.owner !== mover.owner) {
          dests.push(end);
        }
      }
      return unique(dests);
    }
    for (var si = 0; si < steps.length; si++) {
      var e2 = step(mover, steps[si], from, false);
      if (!e2) continue;
      var occ = board[e2];
      if (occ && occ.owner === mover.owner) continue;
      dests.push(e2);
    }
    return unique(dests);
  }

  function unique(list) {
    var seen = {};
    var out = [];
    for (var i = 0; i < list.length; i++) {
      if (seen[list[i]]) continue;
      seen[list[i]] = true;
      out.push(list[i]);
    }
    return out;
  }

  function squareAttacked(board, square, byOwner) {
    for (var k in board) {
      if (!Object.prototype.hasOwnProperty.call(board, k)) continue;
      var p = board[k];
      if (p.owner !== byOwner) continue;
      var targets = pseudoTargets(board, k);
      for (var i = 0; i < targets.length; i++) {
        if (targets[i] === square) return true;
      }
    }
    return false;
  }

  function ownerInCheck(board, owner) {
    var kings = livingKings(board, owner);
    if (!kings.length) return false;
    var foes = COLORS.filter(function (c) { return c !== owner && livingKings(board, c).length; });
    for (var i = 0; i < kings.length; i++) {
      for (var f = 0; f < foes.length; f++) {
        if (squareAttacked(board, kings[i], foes[f])) return true;
      }
    }
    return false;
  }

  function applyMove(board, from, to) {
    var mover = board[from];
    var next = cloneBoard(board);
    delete next[from];
    var landed = { type: mover.type, color: mover.color, owner: mover.owner };
    var dest = parse(to);
    if (mover.type === "p" && dest.r === 0 && dest.c !== mover.color) landed.type = "q";
    next[to] = landed;
    return next;
  }

  function legalMovesFor(board, owner) {
    var moves = [];
    for (var k in board) {
      if (!Object.prototype.hasOwnProperty.call(board, k)) continue;
      var p = board[k];
      if (p.owner !== owner) continue;
      var dests = pseudoTargets(board, k);
      for (var i = 0; i < dests.length; i++) {
        var to = dests[i];
        var nb = applyMove(board, k, to);
        if (!ownerInCheck(nb, owner)) moves.push({ from: k, to: to });
      }
    }
    return moves;
  }

  function transferArmy(board, victim, taker) {
    var next = cloneBoard(board);
    for (var k in next) {
      if (!Object.prototype.hasOwnProperty.call(next, k)) continue;
      var p = next[k];
      if (p.owner !== victim) continue;
      if (p.type === "k") delete next[k];
      else p.owner = taker;
    }
    return next;
  }

  function removeArmy(board, victim) {
    var next = cloneBoard(board);
    for (var k in next) {
      if (!Object.prototype.hasOwnProperty.call(next, k)) continue;
      if (next[k].owner === victim) delete next[k];
    }
    return next;
  }

  function resolveTurn(state, mover) {
    var board = state.board;
    var next = nextOwner(board, mover);
    var guard = 0;
    var notes = [];
    while (next && guard++ < 4) {
      var moves = legalMovesFor(board, next);
      var inCheck = ownerInCheck(board, next);
      if (moves.length === 0 && inCheck) {
        if (state.firstWinner) {
          notes.push({ kind: "firstWin", victim: next, taker: mover });
          state.board = board;
          state.over = true;
          state.winner = mover;
          state.turn = mover;
          state.reason = "first";
          return notes;
        }
        notes.push({ kind: "mate", victim: next, taker: mover });
        board = transferArmy(board, next, mover);
        next = nextOwner(board, mover);
        continue;
      }
      if (moves.length === 0 && !inCheck) {
        notes.push({ kind: "stale", victim: next });
        board = removeArmy(board, next);
        next = nextOwner(board, mover);
        continue;
      }
      break;
    }
    state.board = board;
    var alive = ownersWithKings(board);
    if (alive.length <= 1) {
      state.over = true;
      state.winner = alive[0] || null;
      state.turn = state.winner;
      state.reason = "win";
    } else {
      state.turn = next;
    }
    return notes;
  }

  function move(state, from, to) {
    if (state.over) return { ok: false, error: "over" };
    var legal = legalMovesFor(state.board, state.turn);
    var ok = false;
    for (var i = 0; i < legal.length; i++) {
      if (legal[i].from === from && legal[i].to === to) { ok = true; break; }
    }
    if (!ok) return { ok: false, error: "illegal" };
    var mover = state.turn;
    var captured = state.board[to] ? state.board[to].type : null;
    state.board = applyMove(state.board, from, to);
    var notes = resolveTurn(state, mover);
    state.log.push({ from: from, to: to, mover: mover, captured: captured, notes: notes });
    return { ok: true, notes: notes };
  }

  function label(k) {
    var p = parse(k);
    return p.c.toUpperCase() + FILES.charAt(p.f) + (p.r + 1);
  }

  function glyph(pieceObj) {
    return GLYPH[pieceObj.color][pieceObj.type];
  }

  /** Board geometry: flat-bottom hex, white camp along the bottom edge. */
  var R = 280;
  function polar(deg) {
    var a = deg * Math.PI / 180;
    return [Math.cos(a) * R, Math.sin(a) * R];
  }
  function lerp(a, b, t) {
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  }
  function rot(p, deg) {
    var a = deg * Math.PI / 180;
    var c = Math.cos(a), s = Math.sin(a);
    return [p[0] * c - p[1] * s, p[0] * s + p[1] * c];
  }

  var V240 = polar(240), V300 = polar(300), V180 = polar(180), V0 = polar(0);
  var Mleft = lerp(V180, V240, 0.5);
  var Mright = lerp(V300, V0, 0.5);
  var Bmid = lerp(V240, V300, 0.5);
  var O = [0, 0];

  function whiteEdge(fileEdge, rankEdge) {
    var u = rankEdge / 4;
    var left = lerp(V240, Mleft, u);
    var apex = lerp(Bmid, O, u);
    var right = lerp(V300, Mright, u);
    if (fileEdge <= 4) return lerp(left, apex, fileEdge / 4);
    return lerp(apex, right, (fileEdge - 4) / 4);
  }

  function cellPolygon(color, row, col) {
    var deg = -idx(color) * 120;
    var corners = [
      whiteEdge(col, row),
      whiteEdge(col + 1, row),
      whiteEdge(col + 1, row + 1),
      whiteEdge(col, row + 1)
    ];
    return corners.map(function (p) { return rot(p, deg); });
  }

  function cellCenter(color, row, col) {
    var pts = cellPolygon(color, row, col);
    var x = 0, y = 0;
    for (var i = 0; i < pts.length; i++) { x += pts[i][0]; y += pts[i][1]; }
    return [x / pts.length, y / pts.length];
  }

  function toSvg(p, size) {
    var cx = size / 2, cy = size / 2;
    var scale = (size * 0.49) / R;
    return [cx + p[0] * scale, cy - p[1] * scale];
  }

  return {
    COLORS: COLORS,
    VAL: VAL,
    newGame: newGame,
    move: move,
    legalMovesFor: legalMovesFor,
    ownerInCheck: ownerInCheck,
    ownersWithKings: ownersWithKings,
    label: label,
    glyph: glyph,
    parse: parse,
    key: key,
    cellPolygon: cellPolygon,
    cellCenter: cellCenter,
    toSvg: toSvg,
    cloneState: function (state) {
      return {
        board: cloneBoard(state.board),
        turn: state.turn,
        over: state.over,
        winner: state.winner,
        reason: state.reason,
        log: state.log.map(function (e) {
          return { from: e.from, to: e.to, mover: e.mover, captured: e.captured, notes: e.notes.slice() };
        }),
        eliminated: Object.assign({}, state.eliminated),
        firstWinner: !!state.firstWinner
      };
    }
  };
});
