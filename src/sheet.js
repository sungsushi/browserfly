// Sprite sheet loading (PLAN.md §4.7, M5): metadata validation, URL resolution, image decoding.

/**
 * Checks sheet metadata (PLAN.md §3). With `image` ({ width, height }) it also checks that every
 * clip fits the image. Returns a list of problems; empty means valid.
 */
export function validateSheetMeta(meta, image = null) {
  const errors = [];
  const posInt = (v) => Number.isInteger(v) && v > 0;
  if (!meta || typeof meta !== 'object') return ['metadata is not an object'];
  if (meta.version !== 1) errors.push(`unsupported version ${meta.version}`);
  for (const k of ['frameWidth', 'frameHeight', 'bodyLengthPx']) {
    if (!posInt(meta[k])) errors.push(`${k} must be a positive integer`);
  }
  const a = meta.anchor;
  if (!Array.isArray(a) || a.length !== 2 || !a.every(Number.isFinite)) errors.push('anchor must be [x, y]');
  const clips = meta.clips;
  if (!clips || typeof clips !== 'object') return errors.concat('clips missing');
  for (const name of ['walk', 'idle']) {
    if (!clips[name]) errors.push(`clip "${name}" missing`);
  }
  for (const [name, c] of Object.entries(clips)) {
    if (!Number.isInteger(c.row) || c.row < 0) errors.push(`clip "${name}": row must be an integer ≥ 0`);
    if (!posInt(c.frames)) errors.push(`clip "${name}": frames must be a positive integer`);
    if (image && posInt(c.frames) && posInt(meta.frameWidth) && c.frames * meta.frameWidth > image.width) {
      errors.push(`clip "${name}": ${c.frames} frames of ${meta.frameWidth} px exceed the image width ${image.width}`);
    }
    if (image && Number.isInteger(c.row) && posInt(meta.frameHeight) && (c.row + 1) * meta.frameHeight > image.height) {
      errors.push(`clip "${name}": row ${c.row} is outside the image height ${image.height}`);
    }
  }
  if (clips.walk && !(Number.isFinite(clips.walk.strideBL) && clips.walk.strideBL > 0)) {
    errors.push('clip "walk": strideBL must be a positive number');
  }
  return errors;
}

/**
 * Where to load the sheet from, in order of preference: [{ image, meta }] with `meta` either an
 * object or a URL of a metadata JSON. `embeddedMeta` is the bundle's copy of fly-sheet.json.
 *   'procedural'            → none
 *   'auto' + inline sheet   → the inlined data URI
 *   'auto'                  → fly-sheet.webp, then fly-sheet.png, next to the script
 *   '….json'                → that metadata, with its image (and a .png alternative)
 *   any other URL           → that image with the embedded metadata
 */
export function sheetCandidates(sprite, { scriptSrc, inlineSheet, embeddedMeta }) {
  if (sprite === 'procedural') return [];
  const base = scriptSrc || (typeof document !== 'undefined' ? document.baseURI : undefined);
  const url = (u) => new URL(u, base).href;
  if (sprite === 'auto') {
    if (!embeddedMeta) return [];
    if (inlineSheet) return [{ image: inlineSheet, meta: embeddedMeta }];
    return ['fly-sheet.webp', 'fly-sheet.png'].map((f) => ({ image: url(f), meta: embeddedMeta }));
  }
  if (/\.json(?:[?#]|$)/i.test(sprite)) return [{ image: null, meta: url(sprite) }];
  return embeddedMeta ? [{ image: url(sprite), meta: embeddedMeta }] : [];
}

// Decodes to something drawImage can use at once. An ImageBitmap avoids WebKit drawing nothing
// for the first frames after an <img> decodes, so the switch from procedural is seamless.
async function decode(src) {
  const img = new Image();
  img.decoding = 'async';
  img.src = src;
  await img.decode();
  return typeof createImageBitmap === 'function' ? createImageBitmap(img) : img;
}

async function loadOne({ image, meta }) {
  let metaUrl = null;
  if (typeof meta === 'string') {
    metaUrl = meta;
    const res = await fetch(metaUrl);
    if (!res.ok) throw new Error(`metadata ${res.status}`);
    meta = await res.json();
  }
  const images = image ? [image] : [new URL(meta.image, metaUrl).href];
  if (!image && /\.webp(?:[?#]|$)/i.test(images[0])) images.push(images[0].replace(/\.webp(?=[?#]|$)/i, '.png'));
  let lastError = null;
  for (const src of images) {
    try {
      const img = await decode(src);
      const errors = validateSheetMeta(meta, { width: img.width, height: img.height });
      if (errors.length) throw new Error(errors.join('; '));
      return { img, meta, url: src };
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError;
}

/**
 * Loads the first candidate that decodes and validates. Resolves to { img, meta, url } or null;
 * never rejects (the caller falls back to the procedural renderer).
 */
export async function loadSheet(candidates) {
  for (const c of candidates) {
    try {
      return await loadOne(c);
    } catch {
      // try the next candidate
    }
  }
  return null;
}
