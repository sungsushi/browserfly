// Demo-only prototype: the quotation's text wraps around the flies.
//
// A small custom line breaker: words are measured once with canvas measureText, each line's free
// horizontal gaps are found (the column minus the drop cap minus a circle around each fly), the
// gaps are filled greedily with words, and each piece is justified with word-spacing. Lines are
// drawn as absolutely positioned spans inside their paragraph, in reading order, so the text stays
// selectable and searchable. The fly library is not modified; fly positions come from
// swarm.debug().
//
// Modes:
//   'live'  every visible fly pushes the text aside; a paragraph is re-laid out only when a fly
//           near it has moved at least SETTLE_PX ("live reflow, settled")
//   'off'   the browser lays out the text (CSS justification and hyphenation)
(function () {
  const SETTLE_PX = 4; // re-lay out a paragraph only after this much fly movement
  const MIN_GAP_EM = 2.2; // gaps narrower than this hold no text
  const CLEARANCE = 0.8; // clear-zone radius in body lengths, plus PAD_PX
  const PAD_PX = 4;
  const MAX_STRETCH_EM = 0.33; // most extra word spacing a justified piece may get, per gap
  const SHRINK_DELAY_MS = 1500; // a grown paragraph shrinks back only after this long without growing

  function createTextWrap({ root, getSwarm, mode = 'live' }) {
    const ctx = document.createElement('canvas').getContext('2d');
    const paras = [...root.querySelectorAll('p:not(.elision)')].map((el) => ({
      el,
      html: el.innerHTML,
      // The text as written, captured before any wrapping: once lines are spans, textContent
      // runs words at line ends together, and a late font load re-measures (see measure()).
      text: el.textContent.replace(/\s+/g, ' ').trim(),
      attrs: { class: el.getAttribute('class'), style: el.getAttribute('style') },
      indent: parseFloat(getComputedStyle(el).textIndent) || 0,
      dropcap: el.classList.contains('dropcap'),
      sig: null,
    }));
    let metrics = null;
    let rafId = 0;
    const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

    // --- measuring ------------------------------------------------------------------------------

    function measure() {
      const cs = getComputedStyle(paras[0].el);
      const size = parseFloat(cs.fontSize);
      const font = `${cs.fontStyle} ${cs.fontWeight} ${size}px ${cs.fontFamily}`;
      ctx.font = font;
      const m = ctx.measureText('Hxg');
      const asc = m.fontBoundingBoxAscent;
      const desc = m.fontBoundingBoxDescent;
      const lh = parseFloat(cs.lineHeight);
      const capH = ctx.measureText('H').actualBoundingBoxAscent;
      metrics = {
        font, size, lh, space: ctx.measureText(' ').width, asc, desc, capH,
        baseline: (lh - (asc + desc)) / 2 + asc, // baseline offset inside a line box
        minGap: MIN_GAP_EM * size,
      };
      for (const p of paras) {
        const text = p.text;
        p.cap = p.dropcap ? text[0] : '';
        p.words = (p.dropcap ? text.slice(1) : text).split(' ');
        p.widths = p.words.map((w) => ctx.measureText(w).width);
        if (p.dropcap) {
          // Cap top level with the first line's cap height, baseline on the third line's.
          const target = 2 * lh + capH;
          const capSize = target / (capH / size);
          ctx.font = `${cs.fontStyle} 600 ${capSize}px ${cs.fontFamily}`;
          p.capSize = capSize;
          p.capWidth = ctx.measureText(p.cap).width + 0.45 * size;
          ctx.font = font;
        }
        p.sig = null;
      }
    }

    // --- layout ---------------------------------------------------------------------------------

    // Subtracts [a, b] from a sorted list of free intervals.
    function subtract(free, a, b) {
      const out = [];
      for (const [x0, x1] of free) {
        if (b <= x0 || a >= x1) out.push([x0, x1]);
        else {
          if (a > x0) out.push([x0, a]);
          if (b < x1) out.push([b, x1]);
        }
      }
      return out;
    }

    // Lays out one paragraph of width W around circular obstacles (paragraph coordinates).
    function layout(p, W, obstacles) {
      const { lh, space, minGap } = metrics;
      const pieces = [];
      let wi = 0;
      for (let line = 0; wi < p.words.length && line < 500; line++) {
        const top = line * lh;
        // The line's own left edge: the indent, or the drop cap's right side.
        const edge = p.dropcap && line < 3 ? p.capWidth : line === 0 ? p.indent : 0;
        let free = [[edge, W]];
        for (const o of obstacles) {
          const dy = Math.max(0, top - o.y, o.y - (top + lh)); // distance from the line band
          if (dy < o.r) {
            const hw = Math.sqrt(o.r * o.r - dy * dy);
            free = subtract(free, o.x - hw, o.x + hw);
          }
        }
        free = free.filter(([a, b]) => b - a >= minGap);
        for (const [a, b] of free) {
          const start = wi;
          let natural = 0;
          while (wi < p.words.length) {
            const add = (wi > start ? space : 0) + p.widths[wi];
            if (natural + add > b - a - 0.5) break;
            natural += add;
            wi++;
          }
          // A word wider than a full-width line is placed anyway (never happens in this text).
          if (wi === start && b - a >= W - p.indent) natural = p.widths[wi++];
          if (wi > start) {
            pieces.push({ x: a, top, from: start, to: wi, natural, width: b - a,
              endsAtFly: b < W - 0.5, byFly: a > edge + 0.5 || b < W - 0.5 });
          }
        }
      }
      p.lines = pieces.length ? pieces[pieces.length - 1].top / lh + 1 : 0;
      return { pieces, lines: p.lines };
    }

    const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

    function render(p, W, obstacles, now) {
      const { lh, size, baseline } = metrics;
      const { pieces, lines } = layout(p, W, obstacles);
      let html = '';
      if (p.dropcap) {
        // Baseline of the cap on the third line's baseline.
        const capBaseline = 2 * lh + baseline;
        const top = capBaseline - (p.capSize * (metrics.asc / size));
        // line-height = the font's ascent + descent, so the span's top is exactly one ascent above its baseline.
        const capLh = p.capSize * ((metrics.asc + metrics.desc) / size);
        html += `<span class="tw-cap" style="top:${top.toFixed(2)}px;font-size:${p.capSize.toFixed(2)}px;line-height:${capLh.toFixed(2)}px">${esc(p.cap)}</span>`;
      }
      pieces.forEach((piece, i) => {
        const words = p.words.slice(piece.from, piece.to);
        const gaps = words.length - 1;
        const slack = piece.width - piece.natural;
        // Justify every piece except the paragraph's last. A piece beside a fly is justified only if
        // that stretches its gaps by at most MAX_STRETCH_EM; otherwise a piece ending at a fly is set
        // flush against it (right-aligned) and one starting at a fly is left-aligned.
        let extra = 0;
        let x = piece.x;
        if (i < pieces.length - 1 && gaps > 0) {
          if (!piece.byFly || slack / gaps <= MAX_STRETCH_EM * size) extra = slack / gaps;
          else if (piece.endsAtFly) x += slack;
        } else if (i < pieces.length - 1 && piece.endsAtFly) {
          x += slack; // a lone word before a fly
        }
        html += `<span class="tw-line" style="left:${x.toFixed(2)}px;top:${piece.top}px;word-spacing:${extra.toFixed(3)}px">${esc(words.join(' '))}</span>`;
      });
      p.el.classList.add('tw');
      // Grow at once, shrink only after SHRINK_DELAY_MS without growing, so the text below doesn't
      // jump back and forth by a line as a fly moves.
      const h = lines * lh;
      if (!(p.h >= h) || now - p.grewAt > SHRINK_DELAY_MS) {
        if (!(p.h >= h)) p.grewAt = now;
        p.h = h;
      }
      p.el.style.height = `${p.h}px`;
      p.el.innerHTML = html;
    }

    function restore() {
      for (const p of paras) {
        p.el.innerHTML = p.html;
        // Put back the original attributes exactly (classList.remove would leave class=""). Clear the
        // inline style through the CSSOM first: Chrome and WebKit sync the style attribute lazily,
        // and removing it with a sync pending writes back an empty style="" later.
        p.el.style.cssText = '';
        for (const [name, value] of Object.entries(p.attrs)) {
          if (value === null) p.el.removeAttribute(name);
          else p.el.setAttribute(name, value);
        }
        p.h = undefined;
        p.sig = null;
      }
    }

    // --- frame loop -----------------------------------------------------------------------------

    function frame(now) {
      if (mode === 'off') return; // a frame queued before switching off must not lay anything out
      rafId = requestAnimationFrame(frame);
      const swarm = getSwarm();
      if (!swarm || !metrics) return;
      // Don't move text under an active selection.
      const sel = getSelection();
      if (sel && !sel.isCollapsed && root.contains(sel.anchorNode)) return;

      const d = swarm.debug();
      const toPage = d.anchor === 'page' ? 0 : window.scrollY;
      const r = CLEARANCE * d.params.size + PAD_PX;
      const flies = d.flies.map((f) => ({ x: f.x, y: f.y + toPage, r }));

      // Read every paragraph's position first, then write, so layout is computed once per frame.
      const rects = paras.map((p) => {
        const b = p.el.getBoundingClientRect();
        return { x: b.left, y: b.top + window.scrollY, w: p.el.clientWidth, h: b.height };
      });
      paras.forEach((p, i) => {
        const b = rects[i];
        const q = SETTLE_PX;
        const near = flies
          .filter((f) => f.y + f.r > b.y && f.y - f.r < b.y + b.h + metrics.lh && f.x + f.r > b.x && f.x - f.r < b.x + b.w)
          .map((f) => ({ x: f.x - b.x, y: f.y - b.y, r: f.r }));
        const sig = `${b.w}|` + near.map((o) => `${Math.round(o.x / q)},${Math.round(o.y / q)},${Math.round(o.r)}`).join(';');
        if (sig !== p.sig || (p.h > (p.lines || 0) * metrics.lh && now - p.grewAt > SHRINK_DELAY_MS)) {
          p.sig = sig;
          render(p, b.w, near, now);
        }
      });
    }

    function start() {
      if (mode === 'off' || reducedMotion.matches) {
        cancelAnimationFrame(rafId);
        rafId = 0;
        restore();
        return;
      }
      if (!rafId) {
        rafId = requestAnimationFrame(frame);
      }
    }

    const ro = new ResizeObserver(() => paras.forEach((p) => { p.sig = null; }));
    ro.observe(root);
    reducedMotion.addEventListener('change', start);

    // Measure only once Lora has loaded (the fallback font has different widths).
    const ready = document.fonts.ready.then(() => {
      measure();
      start();
    });
    // A later font load (e.g. Lora 600 for the drop cap) changes widths: measure again.
    document.fonts.addEventListener('loadingdone', () => { if (metrics) measure(); });

    return {
      ready,
      get mode() { return mode; },
      setMode(m) {
        mode = m;
        paras.forEach((p) => { p.sig = null; });
        if (mode === 'off') restore();
        start();
      },
      /**
       * For tests: the clear-zone radius for flies of `size` px, and how far (px) a zone may lag
       * its fly, since positions are bucketed to a SETTLE_PX grid.
       */
      clearance(size) {
        return { r: CLEARANCE * size + PAD_PX, lag: mode === 'live' ? SETTLE_PX : 0 };
      },
    };
  }

  window.createTextWrap = createTextWrap;
})();
