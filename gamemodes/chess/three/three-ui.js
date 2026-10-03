(function () {
  "use strict";

  var SIZE = 640;
  var state = null;
  var past = [];
  var human = "w";
  var first = "w";
  var firstPref = "lot";
  var firstWinner = false;
  var selected = null;
  var locked = false;
  var botTimer = null;
  var note = "";
  var lang = "ru";

  var PIECE_THEME = window.BoardHackConfig.pieceTheme;
  var PIECE_SIZE = 58;

  var i18nReady = BoardHackI18n.init({ page: "chess/three", base: "../../../locales", version: "20261003e" });

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
  function isHuman(c) {
    if (isMultiplayer()) return !mpSpectating && mpSeat === c;
    return human === c;
  }

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
      var labels = [t("sideWhite"), t("sideRed"), t("sideBlack")];
      for (var i = 0; i < opts.length && i < labels.length; i++) opts[i].textContent = labels[i];
    }
    setText("mpTitle", t("mpTitle"));
    setText("mpNickLabel", t("mpNickLabel"));
    setText("mpCreateBtn", t("mpCreate"));
    setText("mpJoinToggleBtn", t("mpJoin"));
    setText("mpSpectateToggleBtn", t("mpSpectate"));
    setText("mpJoinBtn", t("mpJoinOk"));
    setText("mpSpectateBtn", t("mpSpectateOk"));
    setText("mpHint", t("mpHint"));
    setText("mpRoomsTitle", t("mpRooms"));
    setText("mpRoomsRefreshBtn", t("mpRoomsRefresh"));
    setText("mpCodeLabel", t("mpCodeLabel"));
    setText("mpLeaveBtn", t("mpLeave"));
    setText("mpResetBtn", t("newGame"));
    setText("settingsCardTitle", t("settingsTitle"));
    setText("firstMoveLabel", t("firstMoveLabel"));
    setText("firstWinnerLabel", t("firstWinnerLabel"));
    setText("firstWinnerHint", t("firstWinnerHint"));
    var fwBtn = document.getElementById("firstWinnerToggle");
    if (fwBtn) fwBtn.setAttribute("aria-label", t("firstWinnerLabel"));
    var firstSel = document.getElementById("firstMoveSelect");
    if (firstSel && firstSel.options.length >= 4) {
      firstSel.options[0].textContent = t("firstMoveLottery");
      firstSel.options[1].textContent = t("sideWhite");
      firstSel.options[2].textContent = t("sideRed");
      firstSel.options[3].textContent = t("sideBlack");
    }
    var nick = document.getElementById("mpNick");
    if (nick) nick.setAttribute("placeholder", t("mpNickPlaceholder"));
    if (mpConnState) setMpConn(mpConnState);
    if (typeof updateMpUI === "function") updateMpUI();
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

  function readFirstPref() {
    var sel = document.getElementById("firstMoveSelect");
    var v = sel ? sel.value : firstPref;
    firstPref = v === "w" || v === "r" || v === "b" ? v : "lot";
    return firstPref;
  }

  function readFirstWinner() {
    var btn = document.getElementById("firstWinnerToggle");
    if (btn) firstWinner = btn.getAttribute("aria-checked") === "true";
    return firstWinner;
  }

  function setFirstWinnerToggle(on) {
    firstWinner = !!on;
    var btn = document.getElementById("firstWinnerToggle");
    if (btn) btn.setAttribute("aria-checked", firstWinner ? "true" : "false");
  }

  function rollFirst(pref) {
    if (pref === "w" || pref === "r" || pref === "b") return pref;
    var order = ThreeChess.COLORS.slice();
    return order[Math.floor(Math.random() * order.length)];
  }

  function newGame() {
    if (isMultiplayer()) return;
    clearBot();
    first = rollFirst(readFirstPref());
    state = ThreeChess.newGame(first, { firstWinner: readFirstWinner() });
    past = [];
    selected = null;
    note = "";
    render();
    scheduleBot();
  }

  function undo() {
    if (isMultiplayer()) return;
    if (locked || !past.length) return;
    clearBot();
    selected = null;
    note = "";
    // Like classic: undo the human ply and every bot reply after it,
    // so bots do not immediately replay the same sequence.
    while (past.length && !isHuman(past[past.length - 1].turn)) {
      state = past.pop();
    }
    if (past.length && isHuman(past[past.length - 1].turn)) {
      state = past.pop();
    }
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
      if (n.kind === "firstWin") {
        lines.push(fill(t("statusFirstWin"), { victim: colorName(n.victim), taker: colorName(n.taker) }));
      } else if (n.kind === "mate") {
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
    if (isMultiplayer()) publishMpMove(from, to);
    else scheduleBot();
  }

  function scheduleBot() {
    if (isMultiplayer()) return;
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
    if (isMultiplayer() && (!mpSeat || mpSpectating)) return false;
    if (isMultiplayer() && mpRoom && mpRoom.status !== "playing") return false;
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

  function onPointerDown(e) {
    if (e.button != null && e.button !== 0) return;
    if (!canMoveNow()) return;
    var key = squareAt(e.clientX, e.clientY);
    if (!key) return;
    var piece = state.board[key];
    if (!piece || piece.owner !== state.turn) return;
    e.preventDefault();
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch (err) {}
    drag = {
      pointerId: e.pointerId,
      from: key,
      startX: e.clientX,
      startY: e.clientY,
      moved: false,
      piece: piece
    };
    if (typeof lockDragScroll === "function") lockDragScroll();
  }

  function onPointerMove(e) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    if (e.cancelable) e.preventDefault();
    var dx = e.clientX - drag.startX;
    var dy = e.clientY - drag.startY;
    if (!drag.moved && dx * dx + dy * dy > 36) {
      drag.moved = true;
      selected = drag.from;
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
    if (typeof unlockDragScroll === "function") unlockDragScroll();
    selected = null;
    if (!d.moved || !canMoveNow()) {
      render();
      return;
    }
    var to = squareAt(e.clientX, e.clientY);
    if (d.from && to && d.from !== to) {
      var legal = ThreeChess.legalMovesFor(state.board, state.turn);
      for (var i = 0; i < legal.length; i++) {
        if (legal[i].from === d.from && legal[i].to === to) {
          play(d.from, to);
          return;
        }
      }
    }
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
    var caps = [];
    for (var di in dest) {
      if (!Object.prototype.hasOwnProperty.call(dest, di)) continue;
      var parsed = ThreeChess.parse(di);
      if (state.board[di]) {
        var cpts = ThreeChess.cellPolygon(parsed.c, parsed.r, parsed.f).map(function (p) { return ThreeChess.toSvg(p, SIZE); });
        var cpoints = cpts.map(function (p) { return p[0].toFixed(1) + "," + p[1].toFixed(1); }).join(" ");
        caps.push('<polygon class="cap" points="' + cpoints + '" />');
      } else {
        var center = ThreeChess.toSvg(ThreeChess.cellCenter(parsed.c, parsed.r, parsed.f), SIZE);
        chunks.push('<circle class="dot" data-key="' + di + '" cx="' + center[0].toFixed(1) + '" cy="' + center[1].toFixed(1) + '" r="7" fill="#9fef00" fill-opacity="0.9" />');
      }
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
    for (var ci2 = 0; ci2 < caps.length; ci2++) chunks.push(caps[ci2]);
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
    var shownFirst = first;
    if (isMultiplayer() && mpRoom && mpRoom.firstRolled) shownFirst = mpRoom.firstRolled;
    setText("firstLabel", shownFirst ? colorName(shownFirst) : t("firstMoveLottery"));
    setText("turnLabel", state.over ? t("turnOver") : turnName);
    var movesK = document.getElementById("metaMovesK");
    if (movesK) movesK.textContent = t("metaMoves") || "Moves";
    setText("moveCount", String(state.log.length));

    var list = document.getElementById("moveList");
    var head = document.getElementById("moveHead");
    if (list) {
      if (!state.log.length) {
        if (head) {
          head.hidden = true;
          head.innerHTML = "";
        }
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
        if (head) {
          var headHtml = "<span></span>";
          for (var hc = 0; hc < cols.length; hc++) headHtml += "<span>" + colorName(cols[hc]) + "</span>";
          head.innerHTML = headHtml;
          head.hidden = false;
        }
        var html = "";
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
    if (isMultiplayer()) return;
    human = e.target.value === "r" || e.target.value === "b" ? e.target.value : "w";
    selected = null;
    clearBot();
    render();
    scheduleBot();
  });
  var firstMoveSelect = document.getElementById("firstMoveSelect");
  if (firstMoveSelect) {
    firstMoveSelect.addEventListener("change", function () {
      readFirstPref();
      if (isMultiplayer()) pushThreeSettings();
      else newGame();
    });
  }
  var firstWinnerToggle = document.getElementById("firstWinnerToggle");
  if (firstWinnerToggle) {
    firstWinnerToggle.addEventListener("click", function () {
      if (firstWinnerToggle.disabled) return;
      setFirstWinnerToggle(firstWinnerToggle.getAttribute("aria-checked") !== "true");
      if (isMultiplayer()) pushThreeSettings();
      else if (state && !state.log.length) newGame();
      else if (state) {
        state.firstWinner = readFirstWinner();
        render();
      }
    });
  }

  try {
    var u = new URL(window.location.href);
    if (/\/index\.html$/i.test(u.pathname)) {
      u.pathname = u.pathname.replace(/\/index\.html$/i, "/");
      history.replaceState(null, "", u.pathname + u.search + u.hash);
    }
  } catch (err) {}


  var CLIENT_ID_KEY = window.BoardHackConfig.storage.clientId;
  var MP_ROOM_KEY = window.BoardHackConfig.storage.rooms.three;
  var NICK_KEY = window.BoardHackConfig.storage.nick;
  var mpActive = false;
  var mpSocket = null;
  var mpRoomCode = null;
  var mpSeat = null;
  var mpRoom = null;
  var mpSpectating = false;
  var mpConnState = "offline";
  var mpServerUrl = window.BoardHackConfig.defaultServer;
  var mpRoomListTimer = null;
  var mpApplyingRemote = false;

  function isMultiplayer() { return mpActive && (!!mpSeat || mpSpectating); }
  function canMpAct() { return mpActive && !!mpSeat && !mpSpectating; }

  function sanitizeNickClient(raw) {
    return String(raw == null ? "" : raw).replace(/[\u0000-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim().slice(0, window.BoardHackConfig.nickMaxLength);
  }
  function getOrCreateClientId() {
    var id = null;
    try { id = localStorage.getItem(CLIENT_ID_KEY); } catch (e) {}
    if (!id || id.length < 8) {
      id = "c_" + Math.random().toString(36).slice(2) + Date.now().toString(36);
      try { localStorage.setItem(CLIENT_ID_KEY, id); } catch (e2) {}
    }
    return id;
  }
  function getNick() {
    var el = document.getElementById("mpNick");
    var n = sanitizeNickClient(el ? el.value : "");
    if (!n) { try { n = sanitizeNickClient(localStorage.getItem(NICK_KEY) || ""); } catch (e) {} }
    if (el && el.value !== n) el.value = n;
    try { if (n) localStorage.setItem(NICK_KEY, n); } catch (e2) {}
    return n;
  }
  function loadNickIntoInput() {
    var el = document.getElementById("mpNick");
    if (!el) return;
    try {
      var saved = sanitizeNickClient(localStorage.getItem(NICK_KEY) || "");
      if (saved && !el.value) el.value = saved;
    } catch (e) {}
    el.setAttribute("placeholder", t("mpNickPlaceholder"));
  }
  function persistNickFromInput() {
    var el = document.getElementById("mpNick");
    if (!el) return;
    var n = sanitizeNickClient(el.value);
    el.value = n;
    try { localStorage.setItem(NICK_KEY, n); } catch (e) {}
  }
  function resolveServerUrl() {
    var params = new URLSearchParams(window.location.search);
    var srv = params.get("server");
    if (srv) {
      srv = srv.trim();
      if (srv.indexOf("://") === -1) srv = "http://" + srv;
      return srv.replace(/\/$/, "");
    }
    return window.BoardHackConfig.defaultServer;
  }
  function mpAllSeated() {
    if (!mpRoom || !mpRoom.seats) return false;
    return ["w", "r", "b"].every(function (c) {
      return mpRoom.seats[c] && mpRoom.seats[c].occupied;
    });
  }
  function setMpConn(state, detail) {
    mpConnState = state;
    var dot = document.getElementById("mpConnDot");
    if (dot) dot.className = "mp-conn-dot " + (state === "playing" || state === "connected" ? "online" : state === "error" ? "error" : state === "offline" ? "offline" : "waiting");
    var label = t("mpOffline");
    if (state === "connecting") label = t("mpConnecting");
    else if (state === "connected") label = t("mpConnected");
    else if (state === "waiting") label = t("mpWaiting");
    else if (state === "playing") label = t("mpPlaying");
    else if (state === "error") label = detail || t("mpError");
    setText("mpConnText", label);
  }
  function displayNickOrStub(raw) {
    return sanitizeNickClient(raw || "") || t("mpPlayerStub");
  }
  function roomListSeatText(raw) {
    if (raw == null) return t("mpSeatEmpty");
    return displayNickOrStub(raw);
  }
  function seatLabel(color) {
    if (!mpRoom || !mpRoom.seats) return t("mpSeatEmpty");
    var seat = mpRoom.seats[color];
    if (!seat || !seat.occupied) return t("mpSeatEmpty");
    var nick = displayNickOrStub(seat.nick || "");
    if (mpSeat === color) return nick + " (" + t("mpSeatYou") + ")";
    if (!seat.connected) return nick + " (" + t("mpSeatOffline") + ")";
    return nick;
  }
  function buildShareLink(code) {
    var u = new URL(window.location.href);
    if (/\/index\.html$/i.test(u.pathname)) u.pathname = u.pathname.replace(/\/index\.html$/i, "/");
    u.searchParams.delete("room");
    u.searchParams.delete("join");
    u.searchParams.delete("spectate");
    if (mpAllSeated()) u.searchParams.set("spectate", code);
    else u.searchParams.set("join", code);
    if (mpServerUrl && mpServerUrl !== window.BoardHackConfig.defaultServer) u.searchParams.set("server", mpServerUrl);
    else u.searchParams.delete("server");
    return u.toString();
  }
  function copyBtnLabel() {
    return mpAllSeated() ? t("mpCopySpectate") : t("mpCopyInvite");
  }
  function syncFirstControl() {
    var sel = document.getElementById("firstMoveSelect");
    var fw = document.getElementById("firstWinnerToggle");
    if (isMultiplayer() && mpRoom && mpRoom.firstMove && sel) {
      sel.value = mpRoom.firstMove === "w" || mpRoom.firstMove === "r" || mpRoom.firstMove === "b" ? mpRoom.firstMove : "lot";
    }
    if (isMultiplayer() && mpRoom && fw) {
      setFirstWinnerToggle(!!mpRoom.firstWinner);
    }
    var host = !isMultiplayer() || (mpRoom && mpRoom.hostId === getOrCreateClientId());
    var locked = isMultiplayer() && mpRoom && (mpRoom.threeStarted || mpRoom.settingsLocked);
    var disabled = isMultiplayer() && (!host || locked || mpSpectating);
    if (sel) sel.disabled = disabled;
    if (fw) fw.disabled = disabled;
  }
  function adoptServerState(raw) {
    if (!raw) return;
    state = ThreeChess.cloneState(raw);
    if (raw.log && raw.log.length) {
      var last = raw.log[raw.log.length - 1];
      if (last && last.notes) note = notesToText(last.notes);
    }
    if (mpRoom && mpRoom.firstRolled) first = mpRoom.firstRolled;
    else if (raw.turn) first = first || raw.turn;
  }
  function updateMpUI() {
    var lobby = document.getElementById("mpLobby");
    var active = document.getElementById("mpActive");
    var sideWrap = document.getElementById("sideSelectWrap");
    var newBtn = document.getElementById("newGameBtn");
    var undoBtn = document.getElementById("undoBtn");
    if (!mpActive) {
      if (lobby) lobby.classList.remove("mp-hidden");
      if (active) active.classList.add("mp-hidden");
      if (sideWrap) sideWrap.classList.remove("mp-hidden");
      if (newBtn) newBtn.disabled = false;
      if (undoBtn) undoBtn.disabled = false;
      syncFirstControl();
      return;
    }
    if (lobby) lobby.classList.add("mp-hidden");
    if (active) active.classList.remove("mp-hidden");
    if (sideWrap) sideWrap.classList.add("mp-hidden");
    if (newBtn) newBtn.disabled = true;
    if (undoBtn) undoBtn.disabled = true;
    setText("mpCodeValue", mpRoomCode || "------");
    var share = document.getElementById("mpShareLink");
    if (share) share.textContent = mpRoomCode ? buildShareLink(mpRoomCode) : "";
    setText("mpCopyBtn", mpRoomCode ? copyBtnLabel() : t("mpCopyInvite"));
    var started = mpRoom && (mpRoom.threeStarted || mpRoom.settingsLocked);
    ["w", "r", "b"].forEach(function (color) {
      var el = document.getElementById(color === "w" ? "mpSeatW" : color === "r" ? "mpSeatR" : "mpSeatB");
      if (!el) return;
      var occ = mpRoom && mpRoom.seats && mpRoom.seats[color] && mpRoom.seats[color].occupied;
      var pickable = canMpAct() && !started && mpSeat !== color && !occ;
      el.textContent = colorName(color) + " — " + seatLabel(color);
      el.classList.toggle("you", mpSeat === color);
      el.classList.toggle("filled", !!occ);
      el.classList.toggle("pickable", pickable);
    });
    var hint = document.getElementById("mpSeatPickHint");
    if (hint) {
      var anyPick = canMpAct() && !started;
      hint.classList.toggle("mp-hidden", !anyPick);
      hint.textContent = anyPick ? t("mpSeatPickHint") : "";
    }
    var both = mpAllSeated();
    var activeHint = document.getElementById("mpActiveHint");
    if (activeHint) {
      activeHint.classList.toggle("mp-hidden", both);
      activeHint.textContent = both ? "" : t("mpWaitingHint");
    }
    var resetBtn = document.getElementById("mpResetBtn");
    if (resetBtn) resetBtn.classList.toggle("mp-hidden", !(canMpAct() && mpRoom && mpRoom.hostId === getOrCreateClientId()));
    var specN = mpRoom && typeof mpRoom.spectatorCount === "number" ? mpRoom.spectatorCount : 0;
    var specEl = document.getElementById("mpSpectatorCount");
    if (specEl) {
      specEl.classList.toggle("mp-hidden", specN <= 0);
      specEl.textContent = specN > 0 ? t("mpSpectatorCount").replace("{n}", String(specN)) : "";
    }
    var banner = document.getElementById("mpSpectateBanner");
    if (banner) {
      banner.classList.toggle("mp-hidden", !mpSpectating);
      banner.textContent = mpSpectating ? t("mpYouSpectate") : "";
    }
    syncFirstControl();
  }
  function applyMpRoom(res) {
    if (!res) return;
    if (res.room) mpRoom = res.room;
    if (res.code) mpRoomCode = res.code;
    var role = res.role || (res.room && res.room.yourRole) || null;
    if (role === "spectator") {
      mpSpectating = true;
      mpSeat = null;
    } else if (res.seat) {
      mpSpectating = false;
      mpSeat = res.seat;
      human = res.seat;
    } else if (res.room && res.room.yourSeat) {
      mpSpectating = false;
      mpSeat = res.room.yourSeat;
      human = mpSeat;
    }
    mpActive = true;
    try { localStorage.setItem(MP_ROOM_KEY, mpRoomCode); } catch (e) {}
    setMpConn(mpAllSeated() && mpRoom && mpRoom.status === "playing" ? "playing" : "waiting");
    clearBot();
    if (mpRoom && mpRoom.threeState) {
      var remoteLen = mpRoom.threeState.log ? mpRoom.threeState.log.length : 0;
      var localLen = state && state.log ? state.log.length : 0;
      if (!state || remoteLen !== localLen || (mpRoom.threeState.turn && state.turn !== mpRoom.threeState.turn)) {
        adoptServerState(mpRoom.threeState);
      }
      if (mpRoom.firstRolled) first = mpRoom.firstRolled;
    }
    updateMpUI();
    render();
  }
  function ensureMpSocket(cb) {
    mpServerUrl = resolveServerUrl();
    if (mpSocket && mpSocket.connected) { if (cb) cb(null); return; }
    if (typeof io === "undefined") {
      setMpConn("error", t("mpError"));
      if (cb) cb(new Error("socket.io missing"));
      return;
    }
    setMpConn("connecting");
    if (mpSocket) {
      try { mpSocket.removeAllListeners(); mpSocket.disconnect(); } catch (e) {}
      mpSocket = null;
    }
    mpSocket = io(mpServerUrl, window.BoardHackConfig.socket);
    mpSocket.on("connect", function () {
      setMpConn(mpActive ? (mpAllSeated() ? "playing" : "waiting") : "connected");
      if (mpActive && mpRoomCode) {
        mpSocket.emit("reconnectRoom", { clientId: getOrCreateClientId(), code: mpRoomCode, nick: getNick() }, function (res) {
          if (res && res.ok) applyMpRoom(res);
        });
      } else if (!mpActive) requestRoomList();
      if (cb) { var f = cb; cb = null; f(null); }
    });
    mpSocket.on("connect_error", function () {
      setMpConn("error", t("mpError"));
      if (cb) { var f = cb; cb = null; f(new Error("connect_error")); }
    });
    mpSocket.on("disconnect", function () {
      setMpConn(mpActive ? "error" : "offline", t("mpError"));
    });
    mpSocket.on("roomState", function (msg) {
      if (msg && msg.room && mpActive) applyMpRoom({ room: msg.room, seat: msg.room.yourSeat || mpSeat, code: msg.room.code, role: msg.room.yourRole });
    });
    mpSocket.on("moveApplied", function (msg) {
      if (!mpActive || !msg) return;
      if (msg.by === mpSeat) return;
      mpApplyingRemote = true;
      try {
        if (msg.threeState) adoptServerState(msg.threeState);
        if (msg.notes) note = notesToText(msg.notes);
        playMoveSound();
        selected = null;
        render();
      } finally { mpApplyingRemote = false; }
    });
    mpSocket.on("gameReset", function (msg) {
      if (!mpActive) return;
      past = [];
      note = "";
      if (msg && msg.room) applyMpRoom({ room: msg.room, seat: mpSeat, code: mpRoomCode, role: mpSpectating ? "spectator" : "player" });
    });
    mpSocket.on("customSettingsUpdated", function (msg) {
      if (!mpActive || !msg) return;
      if (msg.room) mpRoom = msg.room;
      else if (mpRoom) {
        if (msg.firstMove) mpRoom.firstMove = msg.firstMove;
        if (typeof msg.firstWinner === "boolean") mpRoom.firstWinner = msg.firstWinner;
      }
      syncFirstControl();
      render();
    });
    mpSocket.on("opponentJoined", function () { updateMpUI(); render(); });
    mpSocket.on("roomEnded", function () { clearMpSession(false); newGame(); });
    mpSocket.on("opponentLeft", function () { setMpConn("waiting"); updateMpUI(); render(); });
    mpSocket.on("opponentDisconnected", function () { setMpConn("waiting"); updateMpUI(); render(); });
    mpSocket.on("opponentReconnected", function () { setMpConn(mpAllSeated() ? "playing" : "waiting"); updateMpUI(); render(); });
    mpSocket.on("roomList", function (msg) {
      if (msg && Array.isArray(msg.rooms) && (!msg.mode || msg.mode === "three")) renderRoomList(msg.rooms);
    });
  }
  function publishMpMove(from, to) {
    if (!canMpAct() || !mpSocket || mpApplyingRemote) return;
    var snapshot = past.length ? past[past.length - 1] : null;
    mpSocket.emit("makeMove", {
      clientId: getOrCreateClientId(),
      code: mpRoomCode,
      from: from,
      to: to,
      san: ThreeChess.label(from) + "-" + ThreeChess.label(to)
    }, function (res) {
      if (res && res.ok) {
        if (res.room) mpRoom = res.room;
        return;
      }
      if (snapshot) {
        state = snapshot;
        past.pop();
        note = "";
        render();
      }
      setMpConn("error", (res && res.error) || t("mpError"));
    });
  }
  function pushThreeSettings() {
    if (!canMpAct() || !mpSocket || !mpRoom || mpRoom.hostId !== getOrCreateClientId()) {
      syncFirstControl();
      return;
    }
    if (mpRoom.threeStarted || mpRoom.settingsLocked) { syncFirstControl(); return; }
    mpSocket.emit("updateCustomSettings", {
      clientId: getOrCreateClientId(),
      code: mpRoomCode,
      firstMove: readFirstPref(),
      firstWinner: readFirstWinner()
    }, function (res) {
      if (res && res.room) applyMpRoom({ room: res.room, seat: mpSeat, code: mpRoomCode });
      else syncFirstControl();
    });
  }
  function requestRoomList() {
    if (mpActive || !mpSocket || !mpSocket.connected) return;
    mpSocket.emit("listRooms", { mode: "three" }, function (res) {
      if (res && Array.isArray(res.rooms)) renderRoomList(res.rooms);
    });
  }
  function startRoomListPolling() {
    stopRoomListPolling();
    ensureMpSocket(function (err) {
      if (err) return;
      requestRoomList();
      mpRoomListTimer = setInterval(function () { if (!mpActive) requestRoomList(); }, 6000);
    });
  }
  function stopRoomListPolling() {
    if (mpRoomListTimer) { clearInterval(mpRoomListTimer); mpRoomListTimer = null; }
  }
  function renderRoomList(rooms) {
    var list = document.getElementById("mpRoomsList");
    var empty = document.getElementById("mpRoomsEmpty");
    if (!list) return;
    list.innerHTML = "";
    rooms = Array.isArray(rooms) ? rooms : [];
    if (!rooms.length) {
      if (empty) { empty.classList.remove("mp-hidden"); empty.textContent = t("mpRoomsEmpty"); }
      return;
    }
    if (empty) empty.classList.add("mp-hidden");
    rooms.forEach(function (r) {
      if (!r || !r.code) return;
      var seats = r.seats || {};
      var txt = roomListSeatText(seats.w) + " · " + roomListSeatText(seats.r) + " · " + roomListSeatText(seats.b);
      var row = document.createElement("div");
      row.className = "mp-room-row";
      var info = document.createElement("div");
      info.className = "mp-room-info";
      var code = document.createElement("span");
      code.className = "mp-room-code";
      code.textContent = r.code;
      var seatEl = document.createElement("span");
      seatEl.className = "mp-room-seats";
      seatEl.textContent = txt;
      info.appendChild(code);
      info.appendChild(seatEl);
      if (r.spectatorCount) {
        var spec = document.createElement("span");
        spec.className = "mp-room-specs";
        spec.textContent = t("mpSpectators") + ": " + r.spectatorCount;
        info.appendChild(spec);
      }
      var actions = document.createElement("div");
      actions.className = "mp-room-actions btn-row";
      if (r.joinable) {
        var join = document.createElement("button");
        join.type = "button";
        join.className = "btn btn-primary";
        join.textContent = t("mpJoin");
        join.addEventListener("click", function () { enterMpFromJoin(r.code); });
        actions.appendChild(join);
      }
      var watch = document.createElement("button");
      watch.type = "button";
      watch.className = "btn btn-ghost";
      watch.textContent = t("mpSpectate");
      watch.addEventListener("click", function () { enterMpFromSpectate(r.code); });
      actions.appendChild(watch);
      row.appendChild(info);
      row.appendChild(actions);
      list.appendChild(row);
    });
  }
  function enterMpFromCreate() {
    persistNickFromInput();
    ensureMpSocket(function (err) {
      if (err) return;
      mpSocket.emit("createRoom", {
        clientId: getOrCreateClientId(),
        mode: "three",
        preferredSeat: human === "r" || human === "b" ? human : "w",
        nick: getNick(),
        firstMove: readFirstPref(),
        firstWinner: readFirstWinner()
      }, function (res) {
        if (!res || !res.ok) { setMpConn("error", (res && res.error) || t("mpError")); return; }
        stopRoomListPolling();
        applyMpRoom(res);
      });
    });
  }
  function normalizeCode(code) {
    return String(code || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
  }
  function enterMpFromJoin(code) {
    code = normalizeCode(code);
    if (!code) return;
    persistNickFromInput();
    ensureMpSocket(function (err) {
      if (err) return;
      mpSocket.emit("joinRoom", { clientId: getOrCreateClientId(), code: code, mode: "three", nick: getNick() }, function (res) {
        if (!res || !res.ok) {
          var msg = t("mpError");
          if (res && res.error === "room_not_found") msg = t("mpNotFound");
          if (res && res.error === "room_full") msg = t("mpRoomFull");
          if (res && res.error === "wrong_mode") msg = t("mpWrongMode");
          setMpConn("error", msg);
          return;
        }
        stopRoomListPolling();
        applyMpRoom(res);
      });
    });
  }
  function enterMpFromSpectate(code) {
    code = normalizeCode(code);
    if (!code) return;
    persistNickFromInput();
    ensureMpSocket(function (err) {
      if (err) return;
      mpSocket.emit("spectateRoom", { clientId: getOrCreateClientId(), code: code, mode: "three", nick: getNick() }, function (res) {
        if (!res || !res.ok) {
          var msg = t("mpError");
          if (res && res.error === "room_not_found") msg = t("mpNotFound");
          if (res && res.error === "wrong_mode") msg = t("mpWrongMode");
          setMpConn("error", msg);
          return;
        }
        stopRoomListPolling();
        applyMpRoom(res);
      });
    });
  }
  function claimMpSeat(color) {
    if (!canMpAct() || !mpSocket || !mpRoomCode) return;
    if (mpRoom && (mpRoom.threeStarted || mpRoom.settingsLocked)) return;
    mpSocket.emit("claimSeat", { clientId: getOrCreateClientId(), code: mpRoomCode, seat: color, nick: getNick() }, function (res) {
      if (!res || !res.ok) return;
      applyMpRoom(res);
    });
  }
  function clearMpSession(disconnectSocket) {
    mpActive = false;
    mpSpectating = false;
    mpRoomCode = null;
    mpSeat = null;
    mpRoom = null;
    try { localStorage.removeItem(MP_ROOM_KEY); } catch (e) {}
    if (disconnectSocket && mpSocket) {
      try { mpSocket.removeAllListeners(); mpSocket.disconnect(); } catch (e2) {}
      mpSocket = null;
    }
    setMpConn("offline");
    updateMpUI();
    startRoomListPolling();
  }
  function leaveMultiplayer() {
    if (mpSocket && mpRoomCode) {
      try { mpSocket.emit("leaveRoom", { clientId: getOrCreateClientId(), code: mpRoomCode }); } catch (e) {}
    }
    clearMpSession(true);
    newGame();
  }
  function resetMpGame() {
    if (!canMpAct() || !mpSocket || !mpRoom || mpRoom.hostId !== getOrCreateClientId()) return;
    mpSocket.emit("resetGame", { clientId: getOrCreateClientId(), code: mpRoomCode }, function (res) {
      if (res && res.ok && res.room) {
        past = [];
        note = "";
        applyMpRoom({ room: res.room, seat: mpSeat, code: mpRoomCode });
      }
    });
  }
  function tryAutoRejoin() {
    var params = new URLSearchParams(window.location.search);
    var spectateParam = params.get("spectate");
    if (spectateParam) { enterMpFromSpectate(spectateParam); return; }
    var roomParam = params.get("join") || params.get("room");
    var saved = null;
    try { saved = localStorage.getItem(MP_ROOM_KEY); } catch (e) {}
    var code = normalizeCode(roomParam || saved || "");
    if (!code) return;
    ensureMpSocket(function (err) {
      if (err) return;
      mpSocket.emit("reconnectRoom", { clientId: getOrCreateClientId(), code: code, nick: getNick() }, function (res) {
        if (res && res.ok) { stopRoomListPolling(); applyMpRoom(res); return; }
        if (!roomParam) return;
        mpSocket.emit("joinRoom", { clientId: getOrCreateClientId(), code: code, mode: "three", nick: getNick() }, function (res2) {
          if (res2 && res2.ok) { stopRoomListPolling(); applyMpRoom(res2); }
          else setMpConn("error", t("mpNotFound"));
        });
      });
    });
  }
  function wireMultiplayer() {
    var createBtn = document.getElementById("mpCreateBtn");
    if (createBtn) createBtn.addEventListener("click", enterMpFromCreate);
    var joinToggle = document.getElementById("mpJoinToggleBtn");
    var specToggle = document.getElementById("mpSpectateToggleBtn");
    if (joinToggle) joinToggle.addEventListener("click", function () {
      document.getElementById("mpJoinPanel").classList.toggle("mp-hidden");
    });
    if (specToggle) specToggle.addEventListener("click", function () {
      document.getElementById("mpSpectatePanel").classList.toggle("mp-hidden");
    });
    var joinBtn = document.getElementById("mpJoinBtn");
    if (joinBtn) joinBtn.addEventListener("click", function () { enterMpFromJoin(document.getElementById("mpJoinCode").value); });
    var specBtn = document.getElementById("mpSpectateBtn");
    if (specBtn) specBtn.addEventListener("click", function () { enterMpFromSpectate(document.getElementById("mpSpectateCode").value); });
    ["w", "r", "b"].forEach(function (color) {
      var el = document.getElementById(color === "w" ? "mpSeatW" : color === "r" ? "mpSeatR" : "mpSeatB");
      if (!el) return;
      el.addEventListener("click", function () { claimMpSeat(color); });
    });
    var copyBtn = document.getElementById("mpCopyBtn");
    if (copyBtn) copyBtn.addEventListener("click", function () {
      var link = mpRoomCode ? buildShareLink(mpRoomCode) : "";
      if (!link || !navigator.clipboard) return;
      navigator.clipboard.writeText(link).then(function () {
        setText("mpCopyToast", t("mpCopied"));
        setTimeout(function () { setText("mpCopyToast", ""); }, 1600);
      }).catch(function () {});
    });
    var leaveBtn = document.getElementById("mpLeaveBtn");
    if (leaveBtn) leaveBtn.addEventListener("click", leaveMultiplayer);
    var resetBtn = document.getElementById("mpResetBtn");
    if (resetBtn) resetBtn.addEventListener("click", resetMpGame);
    var refresh = document.getElementById("mpRoomsRefreshBtn");
    if (refresh) refresh.addEventListener("click", function () { startRoomListPolling(); });
    var nick = document.getElementById("mpNick");
    if (nick) nick.addEventListener("change", persistNickFromInput);
  }

  wireSettings();
  i18nReady.then(function () {
    applyLang();
    loadNickIntoInput();
    newGame();
    wireMultiplayer();
    tryAutoRejoin();
    if (!isMultiplayer()) startRoomListPolling();
  });
})();
