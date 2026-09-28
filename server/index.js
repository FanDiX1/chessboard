"use strict";

const http = require("http");
const express = require("express");
const cors = require("cors");
const { Server } = require("socket.io");

const PORT = Number(process.env.PORT) || 3001;
const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
// Russian draughts: dark squares only; w/W white man/king, b/B black; white to move
const CHECKERS_START_FEN = "1b1b1b1b/b1b1b1b1/1b1b1b1b/8/8/w1w1w1w1/1w1w1w1w/w1w1w1w1 w";
const BG_START_FEN = "bg w"; // turn marker for backgammon modes (full state in room.bg)
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I
const CODE_LEN = 6;
const ROOM_TTL_MS = 6 * 60 * 60 * 1000; // 6h idle cleanup

const app = express();
app.use(cors({ origin: true }));
app.get("/health", (_req, res) => {
  res.json({ ok: true, rooms: rooms.size });
});

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: true, methods: ["GET", "POST"] },
});

/** @type {Map<string, Room>} */
const rooms = new Map();

/**
 * @typedef {Object} Seat
 * @property {string} clientId
 * @property {string|null} socketId
 * @property {boolean} connected
 */

/**
 * @typedef {Object} Room
 * @property {string} code
 * @property {string} mode  // classic | dice | checkers | backgammon | backgammon-long
 * @property {string} fen
 * @property {{from:string,to:string,san:string,color:string}|null} lastMove
 * @property {string[]} plySans
 * @property {object[]} diceTurnLog
 * @property {{w:Seat|null,b:Seat|null}} seats
 * @property {string} hostId
 * @property {'waiting'|'playing'|'finished'} status
 * @property {number} updatedAt
 * @property {object|null} dice  // diceCount, diceRoll, remainingDice, diceSide, lastSkipMsg
 * @property {{color:string,current:string}|null} checkersChain // active stepwise capture
 * @property {number} diceCount  // 1|2|3 authoritative MP dice count (host-controlled)
 * @property {object|null} bg  // backgammon full state (points, bar?, off, turn, dice, phase, history)
 */

function genCode() {
  let code = "";
  for (let i = 0; i < CODE_LEN; i++) {
    code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return code;
}

function uniqueCode() {
  for (let i = 0; i < 40; i++) {
    const c = genCode();
    if (!rooms.has(c)) return c;
  }
  throw new Error("Could not allocate room code");
}

function sanitizeNick(raw) {
  let n = String(raw == null ? "" : raw)
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 24);
  return n;
}

function seatPublic(seat) {
  if (!seat) return { occupied: false, connected: false, nick: "" };
  return {
    occupied: true,
    connected: !!seat.connected,
    nick: sanitizeNick(seat.nick || ""),
  };
}

function findSpectator(room, clientId) {
  if (!room.spectators || !clientId) return null;
  return room.spectators.get(clientId) || null;
}

function addSpectator(room, clientId, socketId, nick) {
  if (!room.spectators) room.spectators = new Map();
  room.spectators.set(clientId, {
    clientId,
    socketId,
    connected: true,
    nick: sanitizeNick(nick),
  });
  touch(room);
}

function removeSpectator(room, clientId) {
  if (!room.spectators || !clientId) return false;
  const had = room.spectators.delete(clientId);
  if (had) touch(room);
  return had;
}

function spectatorCount(room) {
  if (!room.spectators) return 0;
  let n = 0;
  for (const s of room.spectators.values()) {
    if (s && s.connected) n++;
  }
  return n;
}


function publicRoom(room, forClientId) {
  let yourSeat = null;
  let yourRole = null;
  if (forClientId) {
    if (room.seats.w && room.seats.w.clientId === forClientId) {
      yourSeat = "w";
      yourRole = "player";
    } else if (room.seats.b && room.seats.b.clientId === forClientId) {
      yourSeat = "b";
      yourRole = "player";
    } else if (findSpectator(room, forClientId)) {
      yourRole = "spectator";
    }
  }
  const turn = isBgMode(room.mode) && room.bg && room.bg.turn
    ? room.bg.turn
    : (room.fen.split(" ")[1] || "w");
  return {
    code: room.code,
    mode: room.mode,
    fen: room.fen,
    lastMove: room.lastMove,
    plySans: room.plySans.slice(),
    diceTurnLog: Array.isArray(room.diceTurnLog) ? room.diceTurnLog : [],
    seats: {
      w: seatPublic(room.seats.w),
      b: seatPublic(room.seats.b),
    },
    hostId: room.hostId,
    status: room.status,
    turn,
    yourSeat,
    yourRole,
    spectatorCount: spectatorCount(room),
    dice: room.dice || null,
    diceCount: room.diceCount === 1 || room.diceCount === 3 ? room.diceCount : 2,
    chain: room.checkersChain || null,
    bg: room.bg || null,
  };
}

function touch(room) {
  room.updatedAt = Date.now();
}

function findSeatByClient(room, clientId) {
  if (room.seats.w && room.seats.w.clientId === clientId) return "w";
  if (room.seats.b && room.seats.b.clientId === clientId) return "b";
  return null;
}

function emitRoom(room) {
  io.to(room.code).emit("roomState", { room: publicRoom(room, null) });
  // Personalized copies for seated players
  for (const color of ["w", "b"]) {
    const seat = room.seats[color];
    if (seat && seat.socketId) {
      io.to(seat.socketId).emit("roomState", { room: publicRoom(room, seat.clientId) });
    }
  }
  // Personalized copies for spectators
  if (room.spectators) {
    for (const spec of room.spectators.values()) {
      if (spec && spec.socketId) {
        io.to(spec.socketId).emit("roomState", { room: publicRoom(room, spec.clientId) });
      }
    }
  }
}

function isBgMode(mode) {
  return mode === "backgammon" || mode === "backgammon-long";
}

function normalizeMode(mode) {
  if (mode === "dice") return "dice";
  if (mode === "checkers" || mode === "checkers-classic") return "checkers";
  if (mode === "backgammon" || mode === "bg-classic" || mode === "bg") return "backgammon";
  if (mode === "backgammon-long" || mode === "bg-long" || mode === "long-nardy") return "backgammon-long";
  return "classic";
}

function emptyBgPoint() {
  return { color: null, count: 0 };
}

function initialBgState(mode) {
  const pts = new Array(25);
  for (let i = 0; i <= 24; i++) pts[i] = emptyBgPoint();
  if (mode === "backgammon-long") {
    pts[24] = { color: "w", count: 15 };
    pts[12] = { color: "b", count: 15 };
    return {
      points: pts,
      off: { w: 0, b: 0 },
      turn: "w",
      winner: null,
      phase: "roll",
      rolledDice: [],
      remainingDice: [],
      headLeft: 1,
      history: [],
    };
  }
  // classic short / Western
  pts[24] = { color: "w", count: 2 };
  pts[13] = { color: "w", count: 5 };
  pts[8] = { color: "w", count: 3 };
  pts[6] = { color: "w", count: 5 };
  pts[1] = { color: "b", count: 2 };
  pts[12] = { color: "b", count: 5 };
  pts[17] = { color: "b", count: 3 };
  pts[19] = { color: "b", count: 5 };
  return {
    points: pts,
    bar: { w: 0, b: 0 },
    off: { w: 0, b: 0 },
    turn: "w",
    winner: null,
    phase: "roll",
    rolledDice: [],
    remainingDice: [],
    history: [],
  };
}

function sanitizeBgState(raw, mode) {
  if (!raw || typeof raw !== "object") return null;
  const turn = raw.turn === "b" ? "b" : "w";
  const phase = raw.phase === "move" || raw.phase === "over" ? raw.phase : "roll";
  const winner = raw.winner === "w" || raw.winner === "b" ? raw.winner : null;
  const pts = new Array(25);
  for (let i = 0; i <= 24; i++) pts[i] = emptyBgPoint();
  if (Array.isArray(raw.points)) {
    for (let i = 1; i <= 24; i++) {
      const p = raw.points[i];
      if (!p) continue;
      const color = p.color === "w" || p.color === "b" ? p.color : null;
      const count = Math.max(0, Math.min(15, Number(p.count) || 0));
      pts[i] = { color: count > 0 ? color : null, count };
    }
  }
  const offW = Math.max(0, Math.min(15, Number(raw.off && raw.off.w) || 0));
  const offB = Math.max(0, Math.min(15, Number(raw.off && raw.off.b) || 0));
  const rolled = Array.isArray(raw.rolledDice)
    ? raw.rolledDice.map((d) => Math.max(1, Math.min(6, Number(d) || 1))).slice(0, 4)
    : [];
  const remaining = Array.isArray(raw.remainingDice)
    ? raw.remainingDice.map((d) => Math.max(1, Math.min(6, Number(d) || 1))).slice(0, 4)
    : [];
  const history = Array.isArray(raw.history)
    ? raw.history.map(String).slice(-80)
    : (Array.isArray(raw.plySans) ? raw.plySans.map(String).slice(-80) : []);
  /** @type {object} */
  const out = {
    points: pts,
    off: { w: offW, b: offB },
    turn,
    winner,
    phase,
    rolledDice: rolled,
    remainingDice: remaining,
    history,
  };
  if (mode === "backgammon-long") {
    out.headLeft = raw.headLeft === 0 ? 0 : 1;
  } else {
    out.bar = {
      w: Math.max(0, Math.min(15, Number(raw.bar && raw.bar.w) || 0)),
      b: Math.max(0, Math.min(15, Number(raw.bar && raw.bar.b) || 0)),
    };
  }
  return out;
}

function startFenForMode(mode) {
  if (mode === "checkers") return CHECKERS_START_FEN;
  if (isBgMode(mode)) return BG_START_FEN;
  return START_FEN;
}

function createRoom(clientId, mode) {
  const code = uniqueCode();
  const norm = normalizeMode(mode);
  /** @type {Room} */
  const room = {
    code,
    mode: norm,
    fen: startFenForMode(norm),
    lastMove: null,
    plySans: [],
    diceTurnLog: [],
    seats: { w: null, b: null },
    spectators: new Map(),
    hostId: clientId,
    status: "waiting",
    updatedAt: Date.now(),
    dice: null,
    diceCount: 2,
    checkersChain: null,
    bg: isBgMode(norm) ? initialBgState(norm) : null,
  };
  rooms.set(code, room);
  return room;
}

function seatPlayer(room, color, clientId, socketId, nick) {
  const prevNick = room.seats[color] && room.seats[color].clientId === clientId
    ? room.seats[color].nick
    : "";
  room.seats[color] = {
    clientId,
    socketId,
    connected: true,
    nick: sanitizeNick(nick) || sanitizeNick(prevNick),
  };
  // Seated players leave spectator list
  removeSpectator(room, clientId);
  touch(room);
  if (room.seats.w && room.seats.b) {
    room.status = room.status === "finished" ? room.status : "playing";
  }
}

function freeSocketFromOtherRooms(socketId, keepCode) {
  for (const room of rooms.values()) {
    if (room.code === keepCode) continue;
    for (const color of ["w", "b"]) {
      const s = room.seats[color];
      if (s && s.socketId === socketId) {
        s.socketId = null;
        s.connected = false;
      }
    }
    if (room.spectators) {
      for (const [cid, spec] of [...room.spectators.entries()]) {
        if (spec && spec.socketId === socketId) {
          room.spectators.delete(cid);
        }
      }
    }
  }
}

io.on("connection", (socket) => {
  socket.data.clientId = null;
  socket.data.roomCode = null;

  socket.on("createRoom", (payload, ack) => {
    try {
      const clientId = String((payload && payload.clientId) || "");
      if (!clientId) return ack && ack({ ok: false, error: "clientId required" });
      const mode = (payload && payload.mode) || "classic";
      const preferred = payload && (payload.preferredSeat === "b" ? "b" : "w");

      freeSocketFromOtherRooms(socket.id, null);
      const room = createRoom(clientId, mode);
      const dc = payload && payload.diceCount;
      if (dc === 1 || dc === 2 || dc === 3) room.diceCount = dc;
      const nick = sanitizeNick(payload && payload.nick);
      seatPlayer(room, preferred, clientId, socket.id, nick);
      socket.data.clientId = clientId;
      socket.data.roomCode = room.code;
      socket.data.role = "player";
      socket.join(room.code);

      const out = {
        ok: true,
        code: room.code,
        seat: preferred,
        role: "player",
        room: publicRoom(room, clientId),
      };
      if (typeof ack === "function") ack(out);
      else socket.emit("roomCreated", out);
      emitRoom(room);
    } catch (e) {
      if (typeof ack === "function") ack({ ok: false, error: e.message || "create failed" });
    }
  });

  socket.on("joinRoom", (payload, ack) => {
    try {
      const clientId = String((payload && payload.clientId) || "");
      const code = String((payload && payload.code) || "").toUpperCase().trim();
      if (!clientId) return ack && ack({ ok: false, error: "clientId required" });
      if (!code) return ack && ack({ ok: false, error: "code required" });

      const room = rooms.get(code);
      if (!room) return ack && ack({ ok: false, error: "room_not_found" });

      const wantMode = payload && payload.mode;
      if (wantMode && room.mode && normalizeMode(wantMode) !== room.mode) {
        return ack && ack({ ok: false, error: "wrong_mode" });
      }

      // Reclaim own seat if reconnecting via join
      let seat = findSeatByClient(room, clientId);
      if (!seat) {
        if (!room.seats.w) seat = "w";
        else if (!room.seats.b) seat = "b";
        else return ack && ack({ ok: false, error: "room_full" });
      }

      freeSocketFromOtherRooms(socket.id, code);
      const nick = sanitizeNick(payload && payload.nick);
      seatPlayer(room, seat, clientId, socket.id, nick);
      socket.data.clientId = clientId;
      socket.data.roomCode = code;
      socket.data.role = "player";
      socket.join(code);

      const out = {
        ok: true,
        code,
        seat,
        role: "player",
        room: publicRoom(room, clientId),
      };
      if (typeof ack === "function") ack(out);
      else socket.emit("roomJoined", out);
      emitRoom(room);
      socket.to(code).emit("opponentJoined", { seat, room: publicRoom(room, null) });
    } catch (e) {
      if (typeof ack === "function") ack({ ok: false, error: e.message || "join failed" });
    }
  });

  socket.on("reconnectRoom", (payload, ack) => {
    try {
      const clientId = String((payload && payload.clientId) || "");
      const code = String((payload && payload.code) || "").toUpperCase().trim();
      if (!clientId || !code) return ack && ack({ ok: false, error: "clientId and code required" });

      const room = rooms.get(code);
      if (!room) return ack && ack({ ok: false, error: "room_not_found" });

      const seat = findSeatByClient(room, clientId);
      if (!seat) return ack && ack({ ok: false, error: "not_a_member" });

      freeSocketFromOtherRooms(socket.id, code);
      room.seats[seat].socketId = socket.id;
      room.seats[seat].connected = true;
      const nick = sanitizeNick(payload && payload.nick);
      if (nick) room.seats[seat].nick = nick;
      removeSpectator(room, clientId);
      touch(room);
      socket.data.clientId = clientId;
      socket.data.roomCode = code;
      socket.data.role = "player";
      socket.join(code);

      const out = {
        ok: true,
        code,
        seat,
        role: "player",
        room: publicRoom(room, clientId),
      };
      if (typeof ack === "function") ack(out);
      emitRoom(room);
      socket.to(code).emit("opponentReconnected", { seat });
    } catch (e) {
      if (typeof ack === "function") ack({ ok: false, error: e.message || "reconnect failed" });
    }
  });


  socket.on("spectateRoom", (payload, ack) => {
    try {
      const clientId = String((payload && payload.clientId) || "");
      const code = String((payload && payload.code) || "").toUpperCase().trim();
      if (!clientId) return ack && ack({ ok: false, error: "clientId required" });
      if (!code) return ack && ack({ ok: false, error: "code required" });

      const room = rooms.get(code);
      if (!room) return ack && ack({ ok: false, error: "room_not_found" });

      const wantMode = payload && payload.mode;
      if (wantMode && room.mode && normalizeMode(wantMode) !== room.mode) {
        return ack && ack({ ok: false, error: "wrong_mode" });
      }

      // If already seated in this room, reconnect as player instead
      const existingSeat = findSeatByClient(room, clientId);
      if (existingSeat) {
        freeSocketFromOtherRooms(socket.id, code);
        const nick = sanitizeNick(payload && payload.nick);
        seatPlayer(room, existingSeat, clientId, socket.id, nick);
        socket.data.clientId = clientId;
        socket.data.roomCode = code;
        socket.data.role = "player";
        socket.join(code);
        const asPlayer = {
          ok: true,
          code,
          seat: existingSeat,
          role: "player",
          room: publicRoom(room, clientId),
        };
        if (typeof ack === "function") ack(asPlayer);
        emitRoom(room);
        return;
      }

      freeSocketFromOtherRooms(socket.id, code);
      // Clear any seat this client held elsewhere already handled; ensure not seated here
      const nick = sanitizeNick(payload && payload.nick);
      addSpectator(room, clientId, socket.id, nick);
      socket.data.clientId = clientId;
      socket.data.roomCode = code;
      socket.data.role = "spectator";
      socket.join(code);

      const out = {
        ok: true,
        code,
        seat: null,
        role: "spectator",
        room: publicRoom(room, clientId),
      };
      if (typeof ack === "function") ack(out);
      else socket.emit("roomSpectating", out);
      emitRoom(room);
    } catch (e) {
      if (typeof ack === "function") ack({ ok: false, error: e.message || "spectate failed" });
    }
  });


  socket.on("claimSeat", (payload, ack) => {
    try {
      const clientId = String((payload && payload.clientId) || socket.data.clientId || "");
      const code = String((payload && payload.code) || socket.data.roomCode || "")
        .toUpperCase()
        .trim();
      const want = payload && payload.seat === "b" ? "b" : "w";
      if (!clientId || !code) return ack && ack({ ok: false, error: "clientId and code required" });

      const room = rooms.get(code);
      if (!room) return ack && ack({ ok: false, error: "room_not_found" });

      const current = findSeatByClient(room, clientId);
      if (!current) return ack && ack({ ok: false, error: "not_a_member" });

      const occupied = (room.seats.w ? 1 : 0) + (room.seats.b ? 1 : 0);
      // Alone in room → can switch; once opponent occupies the other seat, locked.
      if (occupied !== 1) {
        return ack && ack({ ok: false, error: "seats_locked" });
      }

      if (want === current) {
        const same = { ok: true, code, seat: current, room: publicRoom(room, clientId) };
        if (typeof ack === "function") ack(same);
        return;
      }

      const seatObj = room.seats[current];
      room.seats[want] = seatObj;
      room.seats[current] = null;
      if (seatObj) {
        seatObj.socketId = socket.id;
        seatObj.connected = true;
        const nick = sanitizeNick(payload && payload.nick);
        if (nick) seatObj.nick = nick;
      }
      room.status = "waiting";
      touch(room);

      const out = {
        ok: true,
        code,
        seat: want,
        role: "player",
        room: publicRoom(room, clientId),
      };
      if (typeof ack === "function") ack(out);
      emitRoom(room);
    } catch (e) {
      if (typeof ack === "function") ack({ ok: false, error: e.message || "claim failed" });
    }
  });

  socket.on("makeMove", (payload, ack) => {
    try {
      const clientId = String((payload && payload.clientId) || socket.data.clientId || "");
      const code = String((payload && payload.code) || socket.data.roomCode || "")
        .toUpperCase()
        .trim();
      const room = rooms.get(code);
      if (!room) return ack && ack({ ok: false, error: "room_not_found" });

      const seat = findSeatByClient(room, clientId);
      if (!seat) return ack && ack({ ok: false, error: "not_a_member" });
      if (room.status === "waiting") return ack && ack({ ok: false, error: "waiting_for_opponent" });

      const isStateSync = !!(payload && (payload.stateSync || payload.pass));
      const isBg = isBgMode(room.mode);
      const turn = isBg && room.bg && room.bg.turn
        ? room.bg.turn
        : (room.fen.split(" ")[1] || "w");
      // Dice mid-turn / pass / roll sync: FEN turn may already have flipped on a pass.
      // For normal moves require seat === turn; for stateSync allow either seated player
      // (authoritative client sends post-pass fen + dice).
      if (!isStateSync && seat !== turn) {
        return ack && ack({ ok: false, error: "not_your_turn" });
      }

      const from = payload && payload.from;
      const to = payload && payload.to;
      const fen = payload && payload.fen;
      const san = payload && payload.san;
      const bgPayload = payload && payload.bg;

      if (isBg) {
        if (!bgPayload) {
          return ack && ack({ ok: false, error: "invalid_move_payload" });
        }
        const sanitized = sanitizeBgState(bgPayload, room.mode);
        if (!sanitized) {
          return ack && ack({ ok: false, error: "invalid_move_payload" });
        }
        room.bg = sanitized;
        room.fen = "bg " + sanitized.turn;
        room.plySans = Array.isArray(sanitized.history) ? sanitized.history.slice() : [];
        if (!isStateSync && from != null && to != null) {
          room.lastMove = {
            from: String(from),
            to: String(to),
            san: String(san || ""),
            color: seat,
            promotion: null,
          };
        }
      } else {
        if (!fen) {
          return ack && ack({ ok: false, error: "invalid_move_payload" });
        }
        if (!isStateSync && (!from || !to || !san)) {
          return ack && ack({ ok: false, error: "invalid_move_payload" });
        }

        room.fen = String(fen);
        if (!isStateSync) {
          room.lastMove = {
            from: String(from),
            to: String(to),
            san: String(san),
            color: seat,
            promotion: payload.promotion || null,
          };
          if (Array.isArray(payload.plySans)) {
            room.plySans = payload.plySans.map(String);
          } else {
            room.plySans.push(String(san));
          }
        } else if (Array.isArray(payload.plySans)) {
          room.plySans = payload.plySans.map(String);
        }
      }

      if (payload && Array.isArray(payload.diceTurnLog)) {
        room.diceTurnLog = payload.diceTurnLog;
      }

      if (payload && Object.prototype.hasOwnProperty.call(payload, "dice")) {
        room.dice = payload.dice == null ? null : payload.dice;
        const dc = payload.dice && payload.dice.diceCount;
        if (dc === 1 || dc === 2 || dc === 3) room.diceCount = dc;
      }

      if (room.mode === "checkers") {
        const chain = payload && payload.chain;
        room.checkersChain = chain && (chain.color === "w" || chain.color === "b")
          && typeof chain.current === "string" && /^[a-h][1-8]$/.test(chain.current)
          ? { color: chain.color, current: chain.current }
          : null;
      }

      touch(room);

      // Detect finished by FEN side-effects is client-driven; optional flag:
      if (payload.gameOver || (isBg && room.bg && room.bg.winner)) room.status = "finished";
      else if (room.status !== "finished") room.status = "playing";

      const movePayload = {
        move: room.lastMove,
        fen: room.fen,
        plySans: room.plySans.slice(),
        diceTurnLog: Array.isArray(room.diceTurnLog) ? room.diceTurnLog : [],
        status: room.status,
        by: seat,
        dice: room.dice || null,
        stateSync: isStateSync,
        chain: room.checkersChain || null,
        bg: room.bg || null,
      };
      io.to(code).emit("moveApplied", movePayload);
      emitRoom(room);
      if (typeof ack === "function") ack({ ok: true, room: publicRoom(room, clientId) });
    } catch (e) {
      if (typeof ack === "function") ack({ ok: false, error: e.message || "move failed" });
    }
  });

  socket.on("resetGame", (payload, ack) => {
    try {
      const clientId = String((payload && payload.clientId) || socket.data.clientId || "");
      const code = String((payload && payload.code) || socket.data.roomCode || "")
        .toUpperCase()
        .trim();
      const room = rooms.get(code);
      if (!room) return ack && ack({ ok: false, error: "room_not_found" });
      if (room.hostId !== clientId) return ack && ack({ ok: false, error: "host_only" });

      const dc = payload && payload.diceCount;
      if (dc === 1 || dc === 2 || dc === 3) room.diceCount = dc;

      room.fen = startFenForMode(room.mode);
      room.lastMove = null;
      room.plySans = [];
      room.diceTurnLog = [];
      room.dice = null;
      room.checkersChain = null;
      room.bg = isBgMode(room.mode) ? initialBgState(room.mode) : null;
      room.status = room.seats.w && room.seats.b ? "playing" : "waiting";
      touch(room);
      io.to(code).emit("gameReset", { room: publicRoom(room, null) });
      emitRoom(room);
      if (typeof ack === "function") ack({ ok: true, room: publicRoom(room, clientId) });
    } catch (e) {
      if (typeof ack === "function") ack({ ok: false, error: e.message || "reset failed" });
    }
  });

  socket.on("leaveRoom", (payload, ack) => {
    const clientId = String((payload && payload.clientId) || socket.data.clientId || "");
    const code = String((payload && payload.code) || socket.data.roomCode || "")
      .toUpperCase()
      .trim();
    const room = rooms.get(code);
    if (room && clientId) {
      const seat = findSeatByClient(room, clientId);
      if (seat) {
        room.seats[seat] = null;
        touch(room);
        if (room.status === "playing") room.status = "waiting";
        socket.leave(code);
        socket.to(code).emit("opponentLeft", { seat });
        emitRoom(room);
      } else if (removeSpectator(room, clientId)) {
        socket.leave(code);
        emitRoom(room);
      }
    }
    socket.data.roomCode = null;
    socket.data.role = null;
    if (typeof ack === "function") ack({ ok: true });
  });

  socket.on("disconnect", () => {
    const code = socket.data.roomCode;
    const clientId = socket.data.clientId;
    if (!code || !clientId) return;
    const room = rooms.get(code);
    if (!room) return;
    const seat = findSeatByClient(room, clientId);
    if (seat) {
      const s = room.seats[seat];
      if (s && s.socketId === socket.id) {
        s.socketId = null;
        s.connected = false;
        touch(room);
        socket.to(code).emit("opponentDisconnected", { seat });
        emitRoom(room);
      }
      return;
    }
    const spec = findSpectator(room, clientId);
    if (spec && spec.socketId === socket.id) {
      removeSpectator(room, clientId);
      emitRoom(room);
    }
  });
});

// Idle room cleanup
setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) {
    const bothGone =
      (!room.seats.w || !room.seats.w.connected) &&
      (!room.seats.b || !room.seats.b.connected);
    if (bothGone && now - room.updatedAt > ROOM_TTL_MS) {
      rooms.delete(code);
    }
  }
}, 60 * 1000);

server.listen(PORT, () => {
  console.log(`BoardHack multiplayer server on http://localhost:${PORT}`);
  console.log(`Health: http://localhost:${PORT}/health`);
});
