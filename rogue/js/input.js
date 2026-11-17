// Pointer (mouse + touch) and Space input. See CONTRACTS.md "RD.Input".
(function (RD) {
  'use strict';

  const state = { x: null, y: null, down: false };
  let pointerHeld = false;
  let spaceHeld = false;
  let activeId = null;
  let canvasEl = null;

  function sync() { state.down = pointerHeld || spaceHeld; }

  function updatePos(e) {
    const rect = canvasEl.getBoundingClientRect();
    state.x = e.clientX - rect.left;
    state.y = e.clientY - rect.top;
  }

  function releaseAll() {
    pointerHeld = false;
    spaceHeld = false;
    activeId = null;
    sync();
  }

  function isTextTarget(t) {
    const tag = t && t.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (t && t.isContentEditable);
  }

  function init(canvas) {
    canvasEl = canvas;
    canvas.style.touchAction = 'none';
    canvas.style.userSelect = 'none';
    canvas.style.webkitUserSelect = 'none';
    canvas.style.webkitTapHighlightColor = 'transparent';

    canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });

    canvas.addEventListener('pointerdown', function (e) {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      e.preventDefault();
      activeId = e.pointerId;
      pointerHeld = true;
      updatePos(e);
      try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      sync();
    });

    // Mouse hover also moves the cloud; touch only moves while a finger is down.
    canvas.addEventListener('pointermove', function (e) {
      if (e.pointerType === 'mouse' || e.pointerId === activeId) updatePos(e);
    });

    function end(e) {
      if (e.pointerId !== activeId) return;
      activeId = null;
      pointerHeld = false;
      sync();
    }
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
    canvas.addEventListener('lostpointercapture', end);

    window.addEventListener('keydown', function (e) {
      if (e.code !== 'Space' || isTextTarget(e.target)) return;
      e.preventDefault();
      spaceHeld = true;
      sync();
    });
    window.addEventListener('keyup', function (e) {
      if (e.code !== 'Space') return;
      if (!isTextTarget(e.target)) e.preventDefault();
      spaceHeld = false;
      sync();
    });

    window.addEventListener('blur', releaseAll);
    document.addEventListener('visibilitychange', function () { if (document.hidden) releaseAll(); });
  }

  RD.Input = { init: init, state: state };
})(window.RD = window.RD || {});
