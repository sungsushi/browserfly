// Canvas overlay (PLAN.md §4.7): creation, DPR sizing, resize handling, visibility, bounds.

function resolveContainer(container) {
  if (typeof container !== 'string') return container;
  const el = document.querySelector(container);
  if (!el) console.warn(`[fly] container "${container}" not found; using the viewport`);
  return el;
}

/**
 * Creates the overlay canvas. In viewport mode (no container) it is fixed over the whole
 * viewport; in container mode it fills the container. `onResize()` runs after the backing
 * store has been resized; `onVisible(bool)` runs when a container scrolls on/off screen.
 */
export function createOverlay({ container, zIndex, onResize, onVisible }) {
  const host = resolveContainer(container);
  const canvas = document.createElement('canvas');
  const s = canvas.style;
  s.position = host ? 'absolute' : 'fixed';
  s.inset = '0';
  s.top = s.left = '0';
  s.width = s.height = '100%';
  s.pointerEvents = 'none';
  s.zIndex = String(zIndex);
  s.display = 'block';
  // Decorative: hidden from assistive technology.
  canvas.setAttribute('aria-hidden', 'true');
  canvas.setAttribute('role', 'presentation');

  if (host && getComputedStyle(host).position === 'static') {
    console.warn('[fly] container is position: static; setting it to relative');
    host.style.position = 'relative';
  }
  (host || document.body).appendChild(canvas);
  const ctx = canvas.getContext('2d');

  const overlay = {
    canvas,
    ctx,
    host,
    dpr: 1,
    bounds: { w: 0, h: 0 },

    /** Re-reads the CSS size and DPR and resizes the backing store. */
    resize() {
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      const bw = Math.round(w * dpr);
      const bh = Math.round(h * dpr);
      if (canvas.width !== bw) canvas.width = bw;
      if (canvas.height !== bh) canvas.height = bh;
      overlay.dpr = dpr;
      overlay.bounds = { w, h };
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    },

    /** Converts client coordinates to container coordinates. */
    toLocal(p) {
      if (!p) return null;
      if (!host) return { x: p.x, y: p.y };
      const r = canvas.getBoundingClientRect();
      return { x: p.x - r.left, y: p.y - r.top };
    },

    clear() {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.setTransform(overlay.dpr, 0, 0, overlay.dpr, 0, 0);
    },

    setZIndex(z) {
      s.zIndex = String(z);
    },

    destroy() {
      if (ro) ro.disconnect();
      window.removeEventListener('resize', handleResize);
      if (io) io.disconnect();
      canvas.remove();
    },
  };

  const handleResize = () => {
    overlay.resize();
    onResize();
  };

  // window resize fires before rAF callbacks in a frame, ResizeObserver after them, so the
  // listener lets a viewport resize clamp the flies before the next update; the observer
  // catches container-only size changes.
  let ro = null;
  if (typeof ResizeObserver === 'function') {
    ro = new ResizeObserver(handleResize);
    ro.observe(canvas);
  }
  window.addEventListener('resize', handleResize);

  let io = null;
  if (host && typeof IntersectionObserver === 'function') {
    io = new IntersectionObserver((entries) => onVisible(entries[entries.length - 1].isIntersecting));
    io.observe(host);
  }

  overlay.resize();
  return overlay;
}
