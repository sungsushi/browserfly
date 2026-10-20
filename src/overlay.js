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
 * With `page` set (viewport mode only, §4.10) the canvas stays viewport-sized but bounds and
 * coordinates are page coordinates; the caller draws shifted by scrollY.
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
    page: false,
    view: { w: 0, h: 0 }, // the canvas's CSS size
    bounds: { w: 0, h: 0 }, // the walking area: the view, or the page in page mode

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
      overlay.view = { w, h };
      overlay.bounds = overlay.page ? { w, h: Math.max(h, document.documentElement.scrollHeight) } : { w, h };
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    },

    /**
     * Converts a pointer (client coordinates) to container or page coordinates. In page mode a
     * mouse follows the current scroll; a tap stays where it landed on the page.
     */
    toLocal(p) {
      if (!p) return null;
      if (overlay.page) return { x: p.x, y: p.y + (p.mouse ? window.scrollY : p.sy) };
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
    // The page's height, for page mode (html may be fixed-height while body grows).
    if (!host) [document.documentElement, document.body].forEach((el) => ro.observe(el));
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
