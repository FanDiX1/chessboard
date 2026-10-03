(function () {
  "use strict";

  var SIZE = 640;
  var state = null;
  var past = [];
  var human = "w";
  var first = "w";
  var selected = null;
  var locked = false;
  var botTimer = null;
  var note = "";
  var lang = "ru";

  var PIECE_THEME =
    "https://cdn.jsdelivr.net/gh/oakmac/chessboardjs@master/website/img/chesspieces/wikipedia/{piece}.png";
  var PIECE_SIZE = 58;

  var i18nReady = BoardHackI18n.init({ page: "chess/three", base: "../../../locales", version: "20261003b" });

  function t(key) { return BoardHackI18n.t(key); }
  function fill(template, map) {
    return String(template).replace(/\{(\w+)\}/g, function (_, k) {
      return map[k] != null ? map[k] : "";
    });
  }
  function colorName(c) {
    if (c === "w") return t("sideWhite");
    if (c === "r") return t("sideRed");
    if (c === "b") return t("sideBlack");
    return "";
  }
  function isHuman(c) { return human === "hot" || human === c; }

  function setText(id, value) {
    var el = document.getElementById(id);
    if (el) el.textContent = value;
  }

  function applyLang() {
    lang = BoardHackI18n.getLang();
    document.documentElement.lang = lang;
    document.title = t("docTitle");
    setText("modeBadge", t("modeBadge"));
    setText("playAreaTitle", t("playArea"));
    setText("missionTitle", t("mission"));
    setText("sideSelectLabel", t("sideSelectLabel"));
    setText("newGameBtn", t("newGame"));
    setText("undoBtn", t("undo"));
    setText("rulesBtn", t("rulesButton"));
    setText("rulesTitle", t("rulesTitle"));
    setText("sessionTitle", t("session"));
    setText("metaFirstK", t("metaFirst"));
    setText("metaTurnK", t("metaTurn"));
    setText("historyTitle", t("history"));
    setText("settingsTitle", t("settingsTitle"));
    setText("settingsLangLabel", t("settingsLangLabel"));
    var rules = document.getElementById("rulesBox");
    if (rules) rules.innerHTML = t("rulesHtml");
    var sel = document.getElementById("sideSelect");
    if (sel) {
      var opts = sel.options;
      var labels = [t("sideWhite"), t("sideRed"), t("sideBlack"), t("sideHotseat")];
      for (var i = 0; i < opts.length && i < labels.length; i++) opts[i].textContent = labels[i];
    }
    var gear = document.getElementById("settingsMenuBtn");
    if (gear) {
      gear.setAttribute("aria-label", t("settingsTitle"));
      gear.setAttribute("title", t("settingsTitle"));
    }
    var closeBtn = document.getElementById("settingsCloseBtn");
    if (closeBtn) closeBtn.setAttribute("aria-label", t("settingsTitle"));
    var rulesClose = document.getElementById("rulesCloseBtn");
    if (rulesClose) rulesClose.setAttribute("aria-label", t("rulesClose"));
    document.getElementById("langRu").classList.toggle("active", lang === "ru");
    document.getElementById("langEn").classList.toggle("active", lang === "en");
    render();
  }

  function wireSettings() {
    var dialog = document.getElementById("settingsDialog");
    var btn = document.getElementById("settingsMenuBtn");
    var closeBtn = document.getElementById("settingsCloseBtn");
    if (!dialog || !btn) return;
    btn.addEventListener("click", function () {
      if (!dialog.open) dialog.showModal();
      btn.setAttribute("aria-expanded", "true");
    });
    if (closeBtn) closeBtn.addEventListener("click", function () { dialog.close(); });
    dialog.addEventListener("click", function (e) { if (e.target === dialog) dialog.close(); });
    dialog.addEventListener("close", function () { btn.setAttribute("aria-expanded", "false"); });
    var rulesDialog = document.getElementById("rulesDialog");
    var rulesBtn = document.getElementById("rulesBtn");
    var rulesCloseBtn = document.getElementById("rulesCloseBtn");
    if (rulesDialog && rulesBtn) {
      rulesBtn.addEventListener("click", function () {
        if (!rulesDialog.open) rulesDialog.showModal();
      });
      if (rulesCloseBtn) rulesCloseBtn.addEventListener("click", function () { rulesDialog.close(); });
      rulesDialog.addEventListener("click", function (e) {
        if (e.target === rulesDialog) rulesDialog.close();
      });
    }
    document.getElementById("langRu").addEventListener("click", function () {
      BoardHackI18n.setLang("ru").then(applyLang);
    });
    document.getElementById("langEn").addEventListener("click", function () {
      BoardHackI18n.setLang("en").then(applyLang);
    });
  }

  function clearBot() {
    if (botTimer) {
      clearTimeout(botTimer);
      botTimer = null;
    }
    locked = false;
  }

  function newGame() {
    clearBot();
    var order = ThreeChess.COLORS.slice();
    first = order[Math.floor(Math.random() * order.length)];
    state = ThreeChess.newGame(first);
    past = [];
    selected = null;
    note = "";
    render();
    scheduleBot();
  }

  function undo() {
    if (locked || !past.length) return;
    clearBot();
    state = past.pop();
    selected = null;
    note = "";
    render();
    scheduleBot();
  }

  function chooseBotMove() {
    var moves = ThreeChess.legalMovesFor(state.board, state.turn);
    if (!moves.length) return null;
    var best = -1e9;
    var bag = [];
    for (var i = 0; i < moves.length; i++) {
      var m = moves[i];
      var cap = state.board[m.to];
      var score = Math.random() * 0.2;
      if (cap) score += 8 * ThreeChess.VAL[cap.type];
      var copy = ThreeChess.cloneState(state);
      var res = ThreeChess.move(copy, m.from, m.to);
      if (res.ok && res.notes) {
        for (var n = 0; n < res.notes.length; n++) {
          if (res.notes[n].kind === "mate") score += 50;
        }
      }
      if (copy.winner === state.turn) score += 100;
      if (score > best + 1e-9) {
        best = score;
        bag = [m];
      } else if (Math.abs(score - best) < 1e-9) bag.push(m);
    }
    return bag[Math.floor(Math.random() * bag.length)];
  }

  function notesToText(notes) {
    if (!notes || !notes.length) return "";
    var lines = [];
    for (var i = 0; i < notes.length; i++) {
      var n = notes[i];
      if (n.kind === "mate") {
        lines.push(fill(t("statusMate"), { victim: colorName(n.victim), taker: colorName(n.taker) }));
      } else if (n.kind === "stale") {
        lines.push(fill(t("statusStale"), { name: colorName(n.victim) }));
      }
    }
    return lines.join(" ");
  }

  function play(from, to) {
    past.push(ThreeChess.cloneState(state));
    if (past.length > 80) past.shift();
    var res = ThreeChess.move(state, from, to);
    if (!res.ok) {
      past.pop();
      return;
    }
    selected = null;
    note = notesToText(res.notes);
    render();
    scheduleBot();
  }

  function scheduleBot() {
    if (!state || state.over || isHuman(state.turn)) return;
    locked = true;
    render();
    botTimer = setTimeout(function () {
      botTimer = null;
      if (!state || state.over || isHuman(state.turn)) {
        locked = false;
        render();
        return;
      }
      var m = chooseBotMove();
      locked = false;
      if (!m) {
        render();
        return;
      }
      play(m.from, m.to);
    }, 420);
  }

  function onBoardClick(e) {
    var node = e.target;
    while (node && node !== e.currentTarget && !node.getAttribute("data-key")) node = node.parentNode;
    if (!node || !node.getAttribute) return;
    var key = node.getAttribute("data-key");
    if (!key || !state || state.over || locked || !isHuman(state.turn)) return;
    var piece = state.board[key];
    if (selected) {
      var legal = ThreeChess.legalMovesFor(state.board, state.turn);
      for (var i = 0; i < legal.length; i++) {
        if (legal[i].from === selected && legal[i].to === key) {
          play(selected, key);
          return;
        }
      }
    }
    if (piece && piece.owner === state.turn) selected = key;
    else selected = null;
    render();
  }

  function pieceSprite(pc) {
    var tone = pc.color === "b" ? "b" : "w";
    var code = tone + pc.type.toUpperCase();
    return PIECE_THEME.replace("{piece}", code);
  }

  function render() {
    if (!state) return;
    var svg = document.getElementById("boardSvg");
    var legal = [];
    if (!state.over && !locked && isHuman(state.turn)) {
      legal = ThreeChess.legalMovesFor(state.board, state.turn);
    }
    var dest = {};
    if (selected) {
      for (var i = 0; i < legal.length; i++) {
        if (legal[i].from === selected) dest[legal[i].to] = true;
      }
    }
    var last = state.log.length ? state.log[state.log.length - 1] : null;
    var chunks = [];
    var colors = ThreeChess.COLORS;
    for (var ci = 0; ci < colors.length; ci++) {
      var c = colors[ci];
      for (var row = 0; row < 4; row++) {
        for (var col = 0; col < 8; col++) {
          var k = ThreeChess.key(c, row, col);
          var pts = ThreeChess.cellPolygon(c, row, col).map(function (p) { return ThreeChess.toSvg(p, SIZE); });
          var points = pts.map(function (p) { return p[0].toFixed(1) + "," + p[1].toFixed(1); }).join(" ");
          var cls = "sq " + ((row + col) % 2 === 0 ? "dark" : "light");
          if (k === selected) cls += " sel";
          if (last && (k === last.from || k === last.to)) cls += " last";
          chunks.push('<polygon class="' + cls + '" data-key="' + k + '" points="' + points + '" />');
        }
      }
    }
    for (var di in dest) {
      if (!Object.prototype.hasOwnProperty.call(dest, di)) continue;
      var parsed = ThreeChess.parse(di);
      var center = ThreeChess.toSvg(ThreeChess.cellCenter(parsed.c, parsed.r, parsed.f), SIZE);
      chunks.push('<circle class="dot" data-key="' + di + '" cx="' + center[0].toFixed(1) + '" cy="' + center[1].toFixed(1) + '" r="7" fill="#9fef00" fill-opacity="0.9" />');
    }
    chunks.unshift(
      '<defs><filter id="redPiece" color-interpolation-filters="sRGB">' +
      '<feColorMatrix type="matrix" values="' +
      '1.15 0 0 0 0.05  0 0.22 0 0 0  0 0 0.22 0 0  0 0 0 1 0"/>' +
      "</filter></defs>"
    );
    for (var sq in state.board) {
      if (!Object.prototype.hasOwnProperty.call(state.board, sq)) continue;
      var pc = state.board[sq];
      var pp = ThreeChess.parse(sq);
      var ctr = ThreeChess.toSvg(ThreeChess.cellCenter(pp.c, pp.r, pp.f), SIZE);
      var half = PIECE_SIZE / 2;
      var filter = pc.color === "r" ? ' filter="url(#redPiece)"' : "";
      chunks.push(
        '<image class="pc" href="' + pieceSprite(pc) + '" xlink:href="' + pieceSprite(pc) + '" x="' + (ctr[0] - half).toFixed(1) +
        '" y="' + (ctr[1] - half).toFixed(1) + '" width="' + PIECE_SIZE + '" height="' + PIECE_SIZE +
        '"' + filter + " />"
      );
    }
    svg.innerHTML = chunks.join("");

    var turnName = colorName(state.turn);
    var status;
    var dot = document.getElementById("statusDot");
    if (state.over) {
      status = fill(t("statusWin"), { name: colorName(state.winner) });
      if (dot) dot.style.background = "#9fef00";
    } else if (locked && !isHuman(state.turn)) {
      status = fill(t("statusBot"), { name: turnName });
      if (dot) dot.style.background = "#ffbf00";
    } else if (isHuman(state.turn)) {
      status = t("statusYour");
      if (ThreeChess.ownerInCheck(state.board, state.turn)) {
        status = fill(t("statusCheck"), { name: turnName });
      }
      if (dot) dot.style.background = "#9fef00";
    } else {
      status = fill(t("statusWait"), { name: turnName });
      if (dot) dot.style.background = "#ffbf00";
    }
    setText("statusText", status);
    setText("noteText", note);
    setText("firstLabel", colorName(first));
    setText("turnLabel", state.over ? t("turnOver") : turnName);
    var movesK = document.getElementById("metaMovesK");
    if (movesK) movesK.textContent = t("metaMoves") || "Moves";
    setText("moveCount", String(state.log.length));

    var list = document.getElementById("moveList");
    if (list) {
      if (!state.log.length) {
        list.textContent = t("emptyMoves");
      } else {
        var html = "";
        for (var mi = 0; mi < state.log.length; mi++) {
          var mv = state.log[mi];
          html += '<div class="move-row"><span class="move-san">' + (mi + 1) + ". " +
            colorName(mv.mover) + " " + ThreeChess.label(mv.from) + "–" + ThreeChess.label(mv.to) +
            "</span></div>";
        }
        list.innerHTML = html;
        list.scrollTop = list.scrollHeight;
      }
    }
  }

  document.getElementById("boardSvg").addEventListener("click", onBoardClick);
  document.getElementById("newGameBtn").addEventListener("click", newGame);
  document.getElementById("undoBtn").addEventListener("click", undo);
  document.getElementById("sideSelect").addEventListener("change", function (e) {
    human = e.target.value;
    selected = null;
    clearBot();
    render();
    scheduleBot();
  });

  try {
    var u = new URL(window.location.href);
    if (/\/index\.html$/i.test(u.pathname)) {
      u.pathname = u.pathname.replace(/\/index\.html$/i, "/");
      history.replaceState(null, "", u.pathname + u.search + u.hash);
    }
  } catch (err) {}

  wireSettings();
  i18nReady.then(function () {
    applyLang();
    newGame();
  });
})();
