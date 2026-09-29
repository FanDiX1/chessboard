"use strict";

const http = require("http");
const express = require("express");
const cors = require("cors");
const { Server } = require("socket.io");

const PORT = Number(process.env.PORT) || 3001;
const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
// Russian draughts: dark squares only; w/W white man/king, b/B black; white to move
const CHECKERS_START_FEN = "1b1b1b1b/b1b1b1b1/1b1b1b1b/8/8/w1w1w1w1/1w1w1w1w/w1w1w1w1 w";
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
 * @property {string} mode  // classic | dice | custom | checkers | checkers-custom
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
 * @property {object|null} customSettings  // checkers-custom: backwardCapture, mandatoryCapture, moveTimer
 * @property {'setup'|'play'|null} phase  // chess custom free-setup
 * @property {{w:boolean,b:boolean}|null} setupReady
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
  const turn = room.fen.split(" ")[1] || "w";
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
    customSettings: room.mode === "checkers-custom"
      ? sanitizeCustomSettings(room.customSettings)
      : null,
    chain: room.checkersChain || null,
    phase: isChessCustomMode(room.mode) ? (room.phase === "play" ? "play" : "setup") : null,
    setupReady: isChessCustomMode(room.mode)
      ? {
          w: !!(room.setupReady && room.setupReady.w),
          b: !!(room.setupReady && room.setupReady.b),
        }
      : null,
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

function normalizeMode(mode) {
  if (mode === "dice") return "dice";
  if (mode === "checkers-custom") return "checkers-custom";
  if (mode === "custom" || mode === "chess-custom") return "custom";
  if (mode === "checkers" || mode === "checkers-classic") return "checkers";
  return "classic";
}

function isChessCustomMode(mode) {
  return mode === "custom";
}

const CUSTOM_EMPTY_FEN = "8/8/8/8/8/8/8/8 w - - 0 1";

function sanitizeSetupFen(raw) {
  const s = String(raw == null ? "" : raw).trim();
  if (!s || s.length > 120) return CUSTOM_EMPTY_FEN;
  const parts = s.split(/\s+/);
  if (parts.length < 1) return CUSTOM_EMPTY_FEN;
  // basic placement sanity: only piece letters, digits, slashes
  if (!/^[pnbrqkPNBRQK1-8\/]+$/.test(parts[0])) return CUSTOM_EMPTY_FEN;
  const turn = parts[1] === "b" ? "b" : "w";
  return parts[0] + " " + turn + " - - 0 1";
}

function countKingsInFen(fen) {
  const placement = String(fen || "").split(" ")[0] || "";
  let wk = 0, bk = 0;
  for (const ch of placement) {
    if (ch === "K") wk++;
    if (ch === "k") bk++;
  }
  return { wk, bk };
}

function isCheckersMode(mode) {
  return mode === "checkers" || mode === "checkers-custom";
}

function defaultCustomSettings() {
  return { backwardCapture: true, mandatoryCapture: true, moveTimer: 0 };
}

function sanitizeCustomSettings(raw) {
  const base = defaultCustomSettings();
  if (!raw || typeof raw !== "object") return base;
  const timer = Number(raw.moveTimer);
  return {
    backwardCapture: Object.prototype.hasOwnProperty.call(raw, "backwardCapture")
      ? !!raw.backwardCapture
      : base.backwardCapture,
    mandatoryCapture: Object.prototype.hasOwnProperty.call(raw, "mandatoryCapture")
      ? !!raw.mandatoryCapture
      : base.mandatoryCapture,
    moveTimer: timer === 10 || timer === 30 || timer === 60 || timer === 120 ? timer : 0,
  };
}


function startFenForMode(mode) {
  if (isCheckersMode(mode)) return CHECKERS_START_FEN;
  if (isChessCustomMode(mode)) return CUSTOM_EMPTY_FEN;
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
    createdAt: Date.now(),
    updatedAt: Date.now(),
    dice: null,
    diceCount: 2,
    customSettings: norm === "checkers-custom" ? defaultCustomSettings() : null,
    checkersChain: null,
    phase: isChessCustomMode(norm) ? "setup" : null,
    setupReady: isChessCustomMode(norm) ? { w: false, b: false } : null,
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


function roomIsNonEmpty(room) {
  if (room.seats && (room.seats.w || room.seats.b)) return true;
  if (spectatorCount(room) > 0) return true;
  // Keep rooms that still have disconnected seated players (reconnect window)
  return false;
}

function roomListEntry(room) {
  const w = room.seats && room.seats.w;
  const b = room.seats && room.seats.b;
  const openSeats = (w ? 0 : 1) + (b ? 0 : 1);
  return {
    code: room.code,
    mode: room.mode,
    seats: {
      // null = empty seat; "" = occupied but no nick (client shows stub)
      w: w ? sanitizeNick(w.nick || "") : null,
      b: b ? sanitizeNick(b.nick || "") : null,
    },
    spectatorCount: spectatorCount(room),
    createdAt: room.createdAt || room.updatedAt || 0,
    joinable: openSeats > 0,
    openSeats,
  };
}

function buildRoomList(modeFilter) {
  const want = modeFilter ? normalizeMode(modeFilter) : null;
  const list = [];
  for (const room of rooms.values()) {
    if (!roomIsNonEmpty(room)) continue;
    if (want && room.mode !== want) continue;
    list.push(roomListEntry(room));
  }
  list.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  return list;
}

function lobbyChannel(mode) {
  return "lobby:" + normalizeMode(mode);
}

const LOBBY_MODES = ["classic", "dice", "custom", "checkers", "checkers-custom"];

function broadcastRoomList(modeOrRoom) {
  let modes;
  if (!modeOrRoom) {
    modes = LOBBY_MODES;
  } else if (typeof modeOrRoom === "string") {
    modes = [normalizeMode(modeOrRoom)];
  } else if (modeOrRoom.mode) {
    modes = [normalizeMode(modeOrRoom.mode)];
  } else {
    modes = LOBBY_MODES;
  }
  for (const m of modes) {
    io.to(lobbyChannel(m)).emit("roomList", { mode: m, rooms: buildRoomList(m) });
  }
}

io.on("connection", (socket) => {
  socket.data.clientId = null;
  socket.data.roomCode = null;
  socket.data.lobbyMode = null;

  socket.on("listRooms", (payload, ack) => {
    try {
      const rawMode = payload && payload.mode;
      const mode = rawMode ? normalizeMode(rawMode) : null;
      if (socket.data.lobbyMode) {
        socket.leave(lobbyChannel(socket.data.lobbyMode));
        socket.data.lobbyMode = null;
      }
      if (mode) {
        socket.data.lobbyMode = mode;
        socket.join(lobbyChannel(mode));
      }
      const out = { mode: mode || null, rooms: buildRoomList(mode) };
      if (typeof ack === "function") ack(out);
      else socket.emit("roomList", out);
    } catch (e) {
      if (typeof ack === "function") ack({ mode: null, rooms: [], error: e.message || "list failed" });
    }
  });

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
      if (room.mode === "checkers-custom" && payload && payload.customSettings) {
        room.customSettings = sanitizeCustomSettings(payload.customSettings);
      }
      if (isChessCustomMode(room.mode) && payload && payload.fen) {
        room.fen = sanitizeSetupFen(payload.fen);
        room.phase = "setup";
        room.setupReady = { w: false, b: false };
      }
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
      broadcastRoomList(room);
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
      broadcastRoomList(room);
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
        broadcastRoomList(room);
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
      broadcastRoomList(room);
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
      if (isChessCustomMode(room.mode) && room.phase !== "play") {
        return ack && ack({ ok: false, error: "setup_phase" });
      }
      if (room.status === "waiting") return ack && ack({ ok: false, error: "waiting_for_opponent" });

      const isStateSync = !!(payload && (payload.stateSync || payload.pass));
      const turn = room.fen.split(" ")[1] || "w";
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

      if (payload && Array.isArray(payload.diceTurnLog)) {
        room.diceTurnLog = payload.diceTurnLog;
      }

      if (payload && Object.prototype.hasOwnProperty.call(payload, "dice")) {
        room.dice = payload.dice == null ? null : payload.dice;
        const dc = payload.dice && payload.dice.diceCount;
        if (dc === 1 || dc === 2 || dc === 3) room.diceCount = dc;
      }

      if (payload && payload.customSettings && room.mode === "checkers-custom") {
        // Host / white seat may update settings before first ply; after that keep locked.
        const canEditSettings =
          room.hostId === clientId ||
          (room.seats.w && room.seats.w.clientId === clientId);
        const unlocked = !Array.isArray(room.plySans) || room.plySans.length === 0;
        if (canEditSettings && unlocked) {
          room.customSettings = sanitizeCustomSettings(payload.customSettings);
        }
      }

      if (isCheckersMode(room.mode)) {
        const chain = payload && payload.chain;
        room.checkersChain = chain && (chain.color === "w" || chain.color === "b")
          && typeof chain.current === "string" && /^[a-h][1-8]$/.test(chain.current)
          ? { color: chain.color, current: chain.current }
          : null;
      }

      touch(room);

      // Detect finished by FEN side-effects is client-driven; optional flag:
      if (payload.gameOver) room.status = "finished";
      else if (room.status !== "finished") room.status = "playing";

      const movePayload = {
        move: room.lastMove,
        fen: room.fen,
        plySans: room.plySans.slice(),
        diceTurnLog: Array.isArray(room.diceTurnLog) ? room.diceTurnLog : [],
        status: room.status,
        by: seat,
        dice: room.dice || null,
        customSettings: room.mode === "checkers-custom" ? sanitizeCustomSettings(room.customSettings) : null,
        stateSync: isStateSync,
        chain: room.checkersChain || null,
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
      if (room.mode === "checkers-custom" && payload && payload.customSettings) {
        room.customSettings = sanitizeCustomSettings(payload.customSettings);
      }

      room.fen = startFenForMode(room.mode);
      room.lastMove = null;
      room.plySans = [];
      room.diceTurnLog = [];
      room.dice = null;
      room.checkersChain = null;
      if (isChessCustomMode(room.mode)) {
        room.phase = "setup";
        room.setupReady = { w: false, b: false };
      }
      room.status = room.seats.w && room.seats.b ? "playing" : "waiting";
      touch(room);
      io.to(code).emit("gameReset", { room: publicRoom(room, null) });
      emitRoom(room);
      if (typeof ack === "function") ack({ ok: true, room: publicRoom(room, clientId) });
    } catch (e) {
      if (typeof ack === "function") ack({ ok: false, error: e.message || "reset failed" });
    }
  });

  socket.on("updateSetup", (payload, ack) => {
    try {
      const clientId = String((payload && payload.clientId) || socket.data.clientId || "");
      const code = String((payload && payload.code) || socket.data.roomCode || "")
        .toUpperCase()
        .trim();
      const room = rooms.get(code);
      if (!room) return ack && ack({ ok: false, error: "room_not_found" });
      if (!isChessCustomMode(room.mode)) return ack && ack({ ok: false, error: "wrong_mode" });
      const seat = findSeatByClient(room, clientId);
      if (!seat) return ack && ack({ ok: false, error: "not_a_member" });
      if (room.phase === "play") return ack && ack({ ok: false, error: "already_playing" });

      room.phase = "setup";
      if (payload && payload.fen) {
        room.fen = sanitizeSetupFen(payload.fen);
      }
      if (!room.setupReady) room.setupReady = { w: false, b: false };
      if (payload && typeof payload.ready === "boolean") {
        room.setupReady[seat] = payload.ready;
      }
      // editing board clears both ready flags unless this was a ready-only toggle with same fen
      if (payload && payload.fen && payload.ready == null) {
        room.setupReady = { w: false, b: false };
      }
      touch(room);

      const bothReady = !!(room.setupReady.w && room.setupReady.b && room.seats.w && room.seats.b);
      const kings = countKingsInFen(room.fen);
      if (bothReady && kings.wk === 1 && kings.bk === 1) {
        room.phase = "play";
        room.setupReady = { w: false, b: false };
        room.status = "playing";
        room.plySans = [];
        room.lastMove = null;
        touch(room);
        io.to(code).emit("customGameStarted", { fen: room.fen, room: publicRoom(room, null) });
        emitRoom(room);
        if (typeof ack === "function") ack({ ok: true, started: true, room: publicRoom(room, clientId) });
        return;
      }

      io.to(code).emit("setupUpdated", {
        fen: room.fen,
        phase: room.phase,
        setupReady: room.setupReady,
        by: seat,
        room: publicRoom(room, null),
      });
      emitRoom(room);
      if (typeof ack === "function") ack({ ok: true, room: publicRoom(room, clientId) });
    } catch (e) {
      if (typeof ack === "function") ack({ ok: false, error: e.message || "setup failed" });
    }
  });

  socket.on("startCustomGame", (payload, ack) => {
    try {
      const clientId = String((payload && payload.clientId) || socket.data.clientId || "");
      const code = String((payload && payload.code) || socket.data.roomCode || "")
        .toUpperCase()
        .trim();
      const room = rooms.get(code);
      if (!room) return ack && ack({ ok: false, error: "room_not_found" });
      if (!isChessCustomMode(room.mode)) return ack && ack({ ok: false, error: "wrong_mode" });
      const seat = findSeatByClient(room, clientId);
      if (!seat) return ack && ack({ ok: false, error: "not_a_member" });
      const force = !!(payload && payload.force);
      if (force && room.hostId !== clientId) {
        return ack && ack({ ok: false, error: "host_only" });
      }
      if (payload && payload.fen) {
        room.fen = sanitizeSetupFen(payload.fen);
      }
      const kings = countKingsInFen(room.fen);
      if (kings.wk !== 1 || kings.bk !== 1) {
        return ack && ack({ ok: false, error: "need_kings" });
      }
      if (!force) {
        if (!room.setupReady) room.setupReady = { w: false, b: false };
        room.setupReady[seat] = true;
        const bothReady = !!(room.setupReady.w && room.setupReady.b && room.seats.w && room.seats.b);
        if (!bothReady) {
          touch(room);
          io.to(code).emit("setupUpdated", {
            fen: room.fen,
            phase: "setup",
            setupReady: room.setupReady,
            by: seat,
            room: publicRoom(room, null),
          });
          emitRoom(room);
          return ack && ack({ ok: true, started: false, room: publicRoom(room, clientId) });
        }
      }
      room.phase = "play";
      room.setupReady = { w: false, b: false };
      room.status = room.seats.w && room.seats.b ? "playing" : "waiting";
      room.plySans = [];
      room.lastMove = null;
      touch(room);
      io.to(code).emit("customGameStarted", { fen: room.fen, room: publicRoom(room, null) });
      emitRoom(room);
      if (typeof ack === "function") ack({ ok: true, started: true, room: publicRoom(room, clientId) });
    } catch (e) {
      if (typeof ack === "function") ack({ ok: false, error: e.message || "start failed" });
    }
  });

  socket.on("updateCustomSettings", (payload, ack) => {
    try {
      const clientId = String((payload && payload.clientId) || socket.data.clientId || "");
      const code = String((payload && payload.code) || socket.data.roomCode || "")
        .toUpperCase()
        .trim();
      const room = rooms.get(code);
      if (!room) return ack && ack({ ok: false, error: "room_not_found" });
      if (room.mode !== "checkers-custom") return ack && ack({ ok: false, error: "wrong_mode" });
      const seat = findSeatByClient(room, clientId);
      if (!seat) return ack && ack({ ok: false, error: "not_a_member" });
      const canEdit =
        room.hostId === clientId ||
        (room.seats.w && room.seats.w.clientId === clientId);
      if (!canEdit) return ack && ack({ ok: false, error: "host_only" });
      const unlocked = !Array.isArray(room.plySans) || room.plySans.length === 0;
      if (!unlocked) return ack && ack({ ok: false, error: "settings_locked" });
      room.customSettings = sanitizeCustomSettings(payload && payload.customSettings);
      touch(room);
      emitRoom(room);
      if (typeof ack === "function") ack({ ok: true, room: publicRoom(room, clientId) });
    } catch (e) {
      if (typeof ack === "function") ack({ ok: false, error: e.message || "settings failed" });
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
        broadcastRoomList(room);
      } else if (removeSpectator(room, clientId)) {
        socket.leave(code);
        emitRoom(room);
        broadcastRoomList(room);
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
        // seat still occupied (reconnect window) — list nicks unchanged
      }
      return;
    }
    const spec = findSpectator(room, clientId);
    if (spec && spec.socketId === socket.id) {
      removeSpectator(room, clientId);
      emitRoom(room);
      broadcastRoomList(room);
    }
  });
});

// Idle room cleanup
setInterval(() => {
  const now = Date.now();
  const removedModes = new Set();
  for (const [code, room] of rooms) {
    const bothGone =
      (!room.seats.w || !room.seats.w.connected) &&
      (!room.seats.b || !room.seats.b.connected);
    if (bothGone && now - room.updatedAt > ROOM_TTL_MS) {
      removedModes.add(room.mode);
      rooms.delete(code);
    }
  }
  for (const m of removedModes) broadcastRoomList(m);
}, 60 * 1000);

// Periodic lobby refresh for subscribed clients
setInterval(() => {
  broadcastRoomList(null);
}, 7 * 1000);

server.listen(PORT, () => {
  console.log(`BoardHack multiplayer server on http://localhost:${PORT}`);
  console.log(`Health: http://localhost:${PORT}/health`);
});
