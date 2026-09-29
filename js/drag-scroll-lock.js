/**
 * Temporarily lock page scroll while a piece is dragged.
 * Refcounted so overlapping/nested drag starts do not leave body stuck locked.
 */
(function (global) {
  var lockCount = 0;
  var savedBodyOverflow = null;
  var savedHtmlOverflow = null;
  var safetyBound = false;

  function onSafetyEnd() {
    // Cover cancel paths (e.g. chessboard.js has no touchcancel handler).
    unlockDragScroll();
  }

  function bindSafety() {
    if (safetyBound) return;
    safetyBound = true;
    window.addEventListener("mouseup", onSafetyEnd, true);
    window.addEventListener("touchend", onSafetyEnd, true);
    window.addEventListener("touchcancel", onSafetyEnd, true);
    window.addEventListener("pointerup", onSafetyEnd, true);
    window.addEventListener("pointercancel", onSafetyEnd, true);
  }

  function unbindSafety() {
    if (!safetyBound) return;
    safetyBound = false;
    window.removeEventListener("mouseup", onSafetyEnd, true);
    window.removeEventListener("touchend", onSafetyEnd, true);
    window.removeEventListener("touchcancel", onSafetyEnd, true);
    window.removeEventListener("pointerup", onSafetyEnd, true);
    window.removeEventListener("pointercancel", onSafetyEnd, true);
  }

  function lockDragScroll() {
    if (lockCount === 0) {
      savedBodyOverflow = document.body.style.overflow;
      savedHtmlOverflow = document.documentElement.style.overflow;
      document.body.style.overflow = "hidden";
      // iOS Safari often scrolls via <html>; lock both.
      document.documentElement.style.overflow = "hidden";
      bindSafety();
    }
    lockCount += 1;
  }

  function unlockDragScroll() {
    if (lockCount === 0) return;
    lockCount -= 1;
    if (lockCount === 0) {
      document.body.style.overflow = savedBodyOverflow;
      document.documentElement.style.overflow = savedHtmlOverflow;
      savedBodyOverflow = null;
      savedHtmlOverflow = null;
      unbindSafety();
    }
  }

  global.lockDragScroll = lockDragScroll;
  global.unlockDragScroll = unlockDragScroll;
})(typeof window !== "undefined" ? window : this);
