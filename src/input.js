// Pointer tracking (PLAN.md §4.6). Stores the last pointer position in client coordinates;
// the caller converts to container coordinates at frame time, so scrolling under a still
// mouse is handled. Listeners are passive; never preventDefault, never capture.

/**
 * Creates a pointer tracker. `cursor(now, touchTimeoutS)` returns { x, y, mouse, sy } in client
 * coordinates (sy: the page's scrollY when the event happened) or null. A mouse cursor lasts
 * until the pointer leaves the page; a touch or pen tap lasts `touchTimeoutS` seconds.
 */
export function createInput() {
  let state = null; // { x, y, mouse, time, sy }
  const opts = { passive: true };

  const onPointer = (e) => {
    state = { x: e.clientX, y: e.clientY, mouse: e.pointerType === 'mouse', time: performance.now(), sy: window.scrollY };
  };
  // Only a mouse cursor leaves with the pointer; a tap keeps its timeout even if the
  // browser fires compatibility mouse events.
  const clearMouse = () => {
    if (state && state.mouse) state = null;
  };
  const onMouseOut = (e) => {
    if (e.relatedTarget === null) clearMouse();
  };
  const onBlur = () => {
    state = null;
  };

  const root = document.documentElement;
  window.addEventListener('pointermove', onPointer, opts);
  window.addEventListener('pointerdown', onPointer, opts);
  document.addEventListener('mouseout', onMouseOut, opts);
  root.addEventListener('pointerleave', clearMouse, opts);
  window.addEventListener('blur', onBlur, opts);

  return {
    cursor(now, touchTimeoutS) {
      if (!state) return null;
      if (!state.mouse && now - state.time > touchTimeoutS * 1000) {
        state = null;
        return null;
      }
      return { x: state.x, y: state.y, mouse: state.mouse, sy: state.sy };
    },
    destroy() {
      window.removeEventListener('pointermove', onPointer, opts);
      window.removeEventListener('pointerdown', onPointer, opts);
      document.removeEventListener('mouseout', onMouseOut, opts);
      root.removeEventListener('pointerleave', clearMouse, opts);
      window.removeEventListener('blur', onBlur, opts);
      state = null;
    },
  };
}
