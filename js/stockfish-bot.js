/**
 * BoardHack Stockfish bot — Web Worker wrapper (UCI).
 * Expects vendor files under ../vendor/stockfish/ relative to this script's
 * usual page location: ../../vendor/stockfish/stockfish-18-lite-single.js
 */
(function (global) {
  "use strict";

  var DEFAULT_WORKER =
    "../../vendor/stockfish/stockfish-18-lite-single.js";

  /** @type {Record<string, {skill:number, limitStrength:boolean, elo:number, movetime:number, labelKey:string}>} */
  var SKILLS = {
    // UCI_Elo for this build is clamped ~1320–3190
    easy: { skill: 0, limitStrength: true, elo: 1320, movetime: 300, labelKey: "easy" },
    medium: { skill: 5, limitStrength: true, elo: 1600, movetime: 500, labelKey: "medium" },
    hard: { skill: 10, limitStrength: true, elo: 1900, movetime: 800, labelKey: "hard" },
    expert: { skill: 15, limitStrength: true, elo: 2300, movetime: 1200, labelKey: "expert" },
    master: { skill: 20, limitStrength: false, elo: 2850, movetime: 1800, labelKey: "master" }
  };

  var workerUrl = DEFAULT_WORKER;
  var worker = null;
  var readyPromise = null;
  var uciReady = false;
  var engineFullyReady = false;
  var searchGen = 0;
  var pending = null; // { gen, resolve, reject }
  var appliedSkillKey = null;

  function getSkill(key) {
    return SKILLS[key] || SKILLS.medium;
  }

  function skillKeys() {
    return ["easy", "medium", "hard", "expert", "master"];
  }

  function post(cmd) {
    if (worker) worker.postMessage(cmd);
  }

  function failPending(err) {
    if (!pending) return;
    var p = pending;
    pending = null;
    try {
      p.reject(err);
    } catch (e) {}
  }

  function resolvePending(uciMove) {
    if (!pending) return;
    var p = pending;
    pending = null;
    try {
      p.resolve(uciMove);
    } catch (e) {}
  }

  function onWorkerMessage(e) {
    var line = typeof e.data === "string" ? e.data : String(e.data || "");
    if (!line) return;

    if (line.indexOf("\n") !== -1) {
      var parts = line.split("\n");
      for (var i = 0; i < parts.length; i++) {
        if (parts[i]) onWorkerMessage({ data: parts[i] });
      }
      return;
    }

    if (line === "uciok") {
      uciReady = true;
      return;
    }
    if (line === "readyok") {
      engineFullyReady = true;
      return;
    }

    if (line.indexOf("bestmove ") === 0) {
      var rest = line.slice(9).trim();
      var move = rest.split(/\s+/)[0] || "(none)";
      if (pending && pending.gen === searchGen) {
        resolvePending(move === "(none)" ? null : move);
      }
    }
  }

  function createWorker() {
    try {
      return new Worker(workerUrl);
    } catch (err) {
      // Blob fallback (helps some hosts; still needs HTTP for WASM fetch)
      throw err;
    }
  }

  function ensureReady() {
    if (readyPromise) return readyPromise;
    readyPromise = new Promise(function (resolve, reject) {
      try {
        worker = createWorker();
      } catch (err) {
        readyPromise = null;
        reject(err);
        return;
      }
      worker.onmessage = onWorkerMessage;
      worker.onerror = function (ev) {
        failPending(new Error("Stockfish worker error"));
        readyPromise = null;
        uciReady = false;
        try {
          worker.terminate();
        } catch (e) {}
        worker = null;
        reject(ev && ev.message ? new Error(ev.message) : new Error("Stockfish worker failed"));
      };

      post("uci");

      var tries = 0;
      var phase = "uci";
      var wait = function () {
        if (phase === "uci" && uciReady) {
          post("setoption name Threads value 1");
          post("setoption name Hash value 16");
          post("isready");
          phase = "ready";
          tries = 0;
        }
        if (phase === "ready" && engineFullyReady) {
          resolve();
          return;
        }
        if (++tries > 400) {
          readyPromise = null;
          reject(new Error("Stockfish UCI timeout — serve over HTTP (not file://)"));
          return;
        }
        setTimeout(wait, 25);
      };
      wait();
    });
    return readyPromise;
  }

  function applySkill(key) {
    var cfg = getSkill(key);
    if (appliedSkillKey === key) return cfg;
    post("setoption name Skill Level value " + cfg.skill);
    post("setoption name UCI_LimitStrength value " + (cfg.limitStrength ? "true" : "false"));
    if (cfg.limitStrength) {
      post("setoption name UCI_Elo value " + cfg.elo);
    }
    appliedSkillKey = key;
    return cfg;
  }

  /**
   * @param {string} fen
   * @param {string[]} [searchMovesUci] optional UCI moves to restrict search (dice)
   * @param {string} skillKey
   * @returns {Promise<string|null>} UCI bestmove or null
   */
  function getBestMove(fen, searchMovesUci, skillKey) {
    return ensureReady().then(function () {
      // Cancel any in-flight search
      searchGen += 1;
      var gen = searchGen;
      if (pending) {
        post("stop");
        failPending(new Error("cancelled"));
      }

      var cfg = applySkill(skillKey || "medium");

      return new Promise(function (resolve, reject) {
        pending = { gen: gen, resolve: resolve, reject: reject };

        post("ucinewgame");
        post("position fen " + fen);
        var go = "go movetime " + cfg.movetime;
        if (searchMovesUci && searchMovesUci.length) {
          go += " searchmoves " + searchMovesUci.join(" ");
        }
        post(go);

        // Safety timeout
        setTimeout(function () {
          if (pending && pending.gen === gen) {
            post("stop");
            failPending(new Error("Stockfish search timeout"));
          }
        }, cfg.movetime + 8000);
      }).then(function (move) {
        if (gen !== searchGen) return null;
        return move;
      });
    });
  }

  /** Abort current search (e.g. newGame). Does not kill the worker. */
  function cancelSearch() {
    searchGen += 1;
    if (pending) {
      post("stop");
      failPending(new Error("cancelled"));
    }
  }

  function terminate() {
    cancelSearch();
    appliedSkillKey = null;
    uciReady = false;
    engineFullyReady = false;
    readyPromise = null;
    if (worker) {
      try {
        post("quit");
      } catch (e) {}
      try {
        worker.terminate();
      } catch (e2) {}
      worker = null;
    }
  }

  function setWorkerUrl(url) {
    if (url && url !== workerUrl) {
      terminate();
      workerUrl = url;
    }
  }

  /** Parse UCI like e7e8q → { from, to, promotion? } */
  function parseUci(uci) {
    if (!uci || uci.length < 4 || uci === "(none)") return null;
    var from = uci.slice(0, 2);
    var to = uci.slice(2, 4);
    var promotion = uci.length > 4 ? uci.charAt(4).toLowerCase() : undefined;
    return { from: from, to: to, promotion: promotion };
  }

  /** chess.js verbose move → UCI */
  function moveToUci(m) {
    if (!m || !m.from || !m.to) return "";
    return m.from + m.to + (m.promotion ? String(m.promotion).toLowerCase() : "");
  }

  global.BoardHackStockfish = {
    SKILLS: SKILLS,
    skillKeys: skillKeys,
    getSkill: getSkill,
    setWorkerUrl: setWorkerUrl,
    ensureReady: ensureReady,
    getBestMove: getBestMove,
    cancelSearch: cancelSearch,
    terminate: terminate,
    parseUci: parseUci,
    moveToUci: moveToUci
  };
})(typeof window !== "undefined" ? window : self);
