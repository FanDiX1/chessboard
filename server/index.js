"use strict";

const http = require("http");
const express = require("express");
const cors = require("cors");
const { Server } = require("socket.io");

const PORT = Number(process.env.PORT) || 3001;
const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
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
 * @property {string} mode
 * @property {string} fen
 * @property {{from:string,to:string,san:string,color:string}|null} lastMove
 * @property {string[]} plySans
 * @property {object[]} diceTurnLog
 * @property {{w:Seat|null,b:Seat|null}} seats
 * @property {string} hostId
 * @property {'waiting'|'playing'|'finished'} status
 * @property {number} updatedAt
 * @property {object|null} dice  // diceCount, diceRoll, remainingDice, diceSide, lastSkipMsg
 * @property {number} diceCount  // 1|2|3 authoritative MP dice count (host-controlled)
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

function publicRoom(room, forClientId) {
  let yourSeat = null;
  if (forClientId) {
    if (room.seats.w && room.seats.w.clientId === forClientId) yourSeat = "w";
    if (room.seats.b && room.seats.b.clientId === forClientId) yourSeat = "b";
  }
  const turn = (room.fen.split(" ")[1] || "w");
  return {
    code: room.code,
    mode: room.mode,
    fen: room.fen,
    lastMove: room.lastMove,
    plySans: room.plySans.slice(),
    diceTurnLog: Array.isArray(room.diceTurnLog) ? room.diceTurnLog : [],
    seats: {
      w: room.seats.w
        ? { occupied: true, connected: !!room.seats.w.connected }
        : { occupied: false, connected: false },
      b: room.seats.b
        ? { occupied: true, connected: !!room.seats.b.connected }
        : { occupied: false, connected: false },
    },
    hostId: room.hostId,
    status: room.status,
    turn,
    yourSeat,
    dice: room.dice || null,
    diceCount: room.diceCount === 1 || room.diceCount === 3 ? room.diceCount : 2,
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
  // Also send personalized copies to each connected seat
  for (const color of ["w", "b"]) {
    const seat = room.seats[color];
    if (seat && seat.socketId) {
      io.to(seat.socketId).emit("roomState", { room: publicRoom(room, seat.clientId) });
    }
  }
}

function createRoom(clientId, mode) {
  const code = uniqueCode();
  /** @type {Room} */
  const room = {
    code,
    mode: mode === "dice" ? "dice" : "classic",
    fen: START_FEN,
    lastMove: null,
    plySans: [],
    diceTurnLog: [],
    seats: { w: null, b: null },
    hostId: clientId,
    status: "waiting",
    updatedAt: Date.now(),
    dice: null,
    diceCount: 2,
  };
  rooms.set(code, room);
  return room;
}

function seatPlayer(room, color, clientId, socketId) {
  room.seats[color] = { clientId, socketId, connected: true };
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
      seatPlayer(room, preferred, clientId, socket.id);
      socket.data.clientId = clientId;
      socket.data.roomCode = room.code;
      socket.join(room.code);

      const out = {
        ok: true,
        code: room.code,
        seat: preferred,
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
      if (wantMode && room.mode && wantMode !== room.mode) {
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
      seatPlayer(room, seat, clientId, socket.id);
      socket.data.clientId = clientId;
      socket.data.roomCode = code;
      socket.join(code);

      const out = {
        ok: true,
        code,
        seat,
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
      touch(room);
      socket.data.clientId = clientId;
      socket.data.roomCode = code;
      socket.join(code);

      const out = {
        ok: true,
        code,
        seat,
        room: publicRoom(room, clientId),
      };
      if (typeof ack === "function") ack(out);
      emitRoom(room);
      socket.to(code).emit("opponentReconnected", { seat });
    } catch (e) {
      if (typeof ack === "function") ack({ ok: false, error: e.message || "reconnect failed" });
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
      }
      room.status = "waiting";
      touch(room);

      const out = {
        ok: true,
        code,
        seat: want,
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
      const turn = (room.fen.split(" ")[1] || "w");
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
        stateSync: isStateSync,
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

      room.fen = START_FEN;
      room.lastMove = null;
      room.plySans = [];
      room.diceTurnLog = [];
      room.dice = null;
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
      }
    }
    socket.data.roomCode = null;
    if (typeof ack === "function") ack({ ok: true });
  });

  socket.on("disconnect", () => {
    const code = socket.data.roomCode;
    const clientId = socket.data.clientId;
    if (!code || !clientId) return;
    const room = rooms.get(code);
    if (!room) return;
    const seat = findSeatByClient(room, clientId);
    if (!seat) return;
    const s = room.seats[seat];
    if (s && s.socketId === socket.id) {
      s.socketId = null;
      s.connected = false;
      touch(room);
      socket.to(code).emit("opponentDisconnected", { seat });
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
