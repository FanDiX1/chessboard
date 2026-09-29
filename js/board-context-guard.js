/**
 * Suppress browser image context menu / long-press callout on the game board.
 * Scoped to .board-wrap / #board only — does not affect the rest of the page.
 */
(function () {
  function suppressContextMenu(e) {
    e.preventDefault();
  }

  function bindRoot(root) {
    if (!root || root.getAttribute("data-bh-ctx-guard") === "1") return;
    root.setAttribute("data-bh-ctx-guard", "1");
    // Capture so piece <img>s (and chessboard.js rebuilds) are covered via the board root.
    root.addEventListener("contextmenu", suppressContextMenu, true);
  }

  function init() {
    var nodes = document.querySelectorAll(".board-wrap, #board");
    for (var i = 0; i < nodes.length; i++) {
      bindRoot(nodes[i]);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
