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

  var audioCtx = null;

  function getAudioCtx() {
    if (!audioCtx) {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      audioCtx = new AC();
    }
    if (audioCtx.state === "suspended") {
      try { audioCtx.resume(); } catch (e) {}
    }
    return audioCtx;
  }

  function playMoveSound() {
    try {
      var ctx = getAudioCtx();
      if (!ctx) return;
      var t0 = ctx.currentTime;
      var dur = 0.12;
      var osc = ctx.createOscillator();
      var oscGain = ctx.createGain();
      var oscFilter = ctx.createBiquadFilter();
      osc.type = "sine";
      osc.frequency.setValueAtTime(95, t0);
      osc.frequency.exponentialRampToValueAtTime(38, t0 + dur);
      oscFilter.type = "lowpass";
      oscFilter.frequency.setValueAtTime(280, t0);
      oscGain.gain.setValueAtTime(0.0001, t0);
      oscGain.gain.exponentialRampToValueAtTime(0.38, t0 + 0.006);
      oscGain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(oscFilter);
      oscFilter.connect(oscGain);
      oscGain.connect(ctx.destination);
      osc.start(t0);
      osc.stop(t0 + dur + 0.02);
      var nLen = Math.floor(ctx.sampleRate * 0.06);
      var buffer = ctx.createBuffer(1, nLen, ctx.sampleRate);
      var data = buffer.getChannelData(0);
      for (var i = 0; i < nLen; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / nLen, 2.2);
      }
      var noise = ctx.createBufferSource();
      noise.buffer = buffer;
      var noiseFilter = ctx.createBiquadFilter();
      noiseFilter.type = "bandpass";
      noiseFilter.frequency.setValueAtTime(420, t0);
      noiseFilter.Q.setValueAtTime(0.9, t0);
      var noiseGain = ctx.createGain();
      noiseGain.gain.setValueAtTime(0.0001, t0);
      noiseGain.gain.exponentialRampToValueAtTime(0.22, t0 + 0.004);
      noiseGain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.07);
      noise.connect(noiseFilter);
      noiseFilter.connect(noiseGain);
      noiseGain.connect(ctx.destination);
      noise.start(t0);
      noise.stop(t0 + 0.08);
    } catch (e) {}
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
    playMoveSound();
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

  var drag = null;

  function canMoveNow() {
    return !!(state && !state.over && !locked && isHuman(state.turn));
  }

  function clientToSvg(clientX, clientY) {
    var svg = document.getElementById("boardSvg");
    var pt = svg.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    var ctm = svg.getScreenCTM();
    if (!ctm) return null;
    return pt.matrixTransform(ctm.inverse());
  }

  function pointInPoly(x, y, pts) {
    var inside = false;
    for (var i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      var xi = pts[i][0], yi = pts[i][1];
      var xj = pts[j][0], yj = pts[j][1];
      var denom = (yj - yi) || 1e-9;
      if (((yi > y) !== (yj > y)) && (x < ((xj - xi) * (y - yi)) / denom + xi)) inside = !inside;
    }
    return inside;
  }

  function squareAt(clientX, clientY) {
    var p = clientToSvg(clientX, clientY);
    if (!p) return null;
    var colors = ThreeChess.COLORS;
    for (var ci = 0; ci < colors.length; ci++) {
      var c = colors[ci];
      for (var row = 0; row < 4; row++) {
        for (var col = 0; col < 8; col++) {
          var pts = ThreeChess.cellPolygon(c, row, col).map(function (pt) {
            return ThreeChess.toSvg(pt, SIZE);
          });
          if (pointInPoly(p.x, p.y, pts)) return ThreeChess.key(c, row, col);
        }
      }
    }
    return null;
  }

  function pieceScreenSize() {
    var svg = document.getElementById("boardSvg");
    var rect = svg.getBoundingClientRect();
    return Math.max(24, (PIECE_SIZE * rect.width) / SIZE);
  }

  function showGhost(pc, x, y) {
    var ghost = document.getElementById("dragGhost");
    if (!ghost || !pc) return;
    var size = pieceScreenSize();
    var src = pieceSprite(pc);
    if (ghost.getAttribute("src") !== src) ghost.src = src;
    ghost.classList.toggle("red", pc.color === "r");
    ghost.style.width = size + "px";
    ghost.style.height = size + "px";
    ghost.style.left = x + "px";
    ghost.style.top = y + "px";
    ghost.style.display = "block";
  }

  function hideGhost() {
    var ghost = document.getElementById("dragGhost");
    if (ghost) ghost.style.display = "none";
  }

  function finishPointer(from, to, moved, already) {
    if (!canMoveNow()) {
      selected = null;
      render();
      return;
    }
    if (moved && from && to && from !== to) {
      var legal = ThreeChess.legalMovesFor(state.board, state.turn);
      for (var i = 0; i < legal.length; i++) {
        if (legal[i].from === from && legal[i].to === to) {
          play(from, to);
          return;
        }
      }
      selected = from;
      render();
      return;
    }
    if (moved) {
      selected = from;
      render();
      return;
    }
    if (!moved) {
      if (selected && to && to !== from) {
        var legalClick = ThreeChess.legalMovesFor(state.board, state.turn);
        for (var j = 0; j < legalClick.length; j++) {
          if (legalClick[j].from === from && legalClick[j].to === to) {
            play(from, to);
            return;
          }
        }
      }
      var piece = to ? state.board[to] : null;
      if (piece && piece.owner === state.turn) selected = already && to === from ? null : to;
      else selected = null;
      render();
    }
  }

  function onPointerDown(e) {
    if (e.button != null && e.button !== 0) return;
    if (!canMoveNow()) return;
    var key = squareAt(e.clientX, e.clientY);
    if (!key) return;
    var piece = state.board[key];
    var own = piece && piece.owner === state.turn;
    if (!own && !selected) return;
    e.preventDefault();
    if (!own) {
      drag = {
        pointerId: e.pointerId,
        from: selected,
        moved: false,
        already: true,
        clickOnly: true,
        piece: null
      };
      return;
    }
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch (err) {}
    drag = {
      pointerId: e.pointerId,
      from: key,
      startX: e.clientX,
      startY: e.clientY,
      moved: false,
      already: selected === key,
      clickOnly: false,
      piece: piece
    };
    if (typeof lockDragScroll === "function") lockDragScroll();
    selected = key;
  }

  function onPointerMove(e) {
    if (!drag || drag.clickOnly || e.pointerId !== drag.pointerId) return;
    var dx = e.clientX - drag.startX;
    var dy = e.clientY - drag.startY;
    if (!drag.moved && dx * dx + dy * dy > 36) {
      drag.moved = true;
      var mount = document.getElementById("boardMount");
      if (mount) mount.classList.add("is-dragging");
      render();
    }
    if (drag.moved) showGhost(drag.piece, e.clientX, e.clientY);
  }

  function onPointerUp(e) {
    if (!drag || (e.pointerId != null && e.pointerId !== drag.pointerId)) return;
    var d = drag;
    drag = null;
    hideGhost();
    var mount = document.getElementById("boardMount");
    if (mount) mount.classList.remove("is-dragging");
    if (!d.clickOnly && typeof unlockDragScroll === "function") unlockDragScroll();
    var to = squareAt(e.clientX, e.clientY);
    finishPointer(d.from, to, d.clickOnly ? false : d.moved, d.already);
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
      var dragCls = drag && drag.moved && sq === drag.from ? " dragging" : "";
      chunks.push(
        '<image class="pc' + dragCls + '" href="' + pieceSprite(pc) + '" xlink:href="' + pieceSprite(pc) + '" x="' + (ctr[0] - half).toFixed(1) +
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
        list.innerHTML = '<div class="empty-moves"></div>';
        list.querySelector(".empty-moves").textContent = t("emptyMoves");
      } else {
        var cols = ThreeChess.COLORS;
        var buckets = { w: [], r: [], b: [] };
        for (var mi = 0; mi < state.log.length; mi++) {
          var mv = state.log[mi];
          if (buckets[mv.mover]) buckets[mv.mover].push(mv);
        }
        var rows = Math.max(buckets.w.length, buckets.r.length, buckets.b.length);
        var html = '<div class="move-head"><span></span>';
        for (var hc = 0; hc < cols.length; hc++) html += "<span>" + colorName(cols[hc]) + "</span>";
        html += "</div>";
        for (var ri = 0; ri < rows; ri++) {
          html += '<div class="move-row"><span class="move-num">' + (ri + 1) + ".</span>";
          for (var cc = 0; cc < cols.length; cc++) {
            var cell = buckets[cols[cc]][ri];
            var cls = "move-san" + (cell && !isHuman(cell.mover) ? " bot" : "");
            var label = cell ? (ThreeChess.label(cell.from) + "–" + ThreeChess.label(cell.to)) : "";
            html += '<span class="' + cls + '">' + label + "</span>";
          }
          html += "</div>";
        }
        list.innerHTML = html;
        list.scrollTop = list.scrollHeight;
      }
    }
  }

  var boardSvg = document.getElementById("boardSvg");
  boardSvg.addEventListener("pointerdown", onPointerDown);
  boardSvg.addEventListener("pointermove", onPointerMove);
  boardSvg.addEventListener("pointerup", onPointerUp);
  boardSvg.addEventListener("pointercancel", onPointerUp);
  boardSvg.addEventListener("contextmenu", function (e) { e.preventDefault(); });
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
