// Parameter schema: defaults, ranges and docs in one table that drives validation,
// data-attribute parsing and the README parameter table.

const num = (def, min, max, doc) => ({ type: 'number', default: def, min, max, doc });
const int = (def, min, max, doc) => ({ type: 'int', default: def, min, max, doc });
const oneOf = (def, values, doc) => ({ type: 'enum', default: def, values, doc });

export const SCHEMA = {
  count: int(1, 1, 50, 'number of flies'),
  size: num(48, 8, 200, 'rendered body length (px)'),
  speed: num(2.5, 0.1, 20, 'mean run speed (BL/s)'),
  speedJitter: num(0.15, 0, 0.5, 'SD of the per-run speed multiplier'),
  runMean: num(2.5, 0.1, 60, 'mean run duration with no cursor influence (s)'),
  stopProbability: num(0.7, 0, 1, 'chance that a run ends in a stop rather than an immediate reorientation'),
  stopMean: num(1.2, 0.05, 30, 'mean stop duration (s)'),
  stopDistribution: oneOf('lognormal', ['exp', 'lognormal'], 'stop duration distribution'),
  rotDiffusion: num(0.4, 0, 10, 'heading diffusion during runs (rad²/s)'),
  turnRate: num(5, 0.5, 30, 'max angular speed while reorienting (rad/s)'),
  attraction: num(0.3, -1, 1, 'cursor attraction; negative means repulsion'),
  attractionRange: num(400, 10, 5000, 'cursor falloff length scale (px)'),
  steeringGain: num(3, 0, 20, 'strength of continuous steering during runs (rad/s)'),
  kappaMax: num(6, 0, 50, 'von Mises concentration of reorientation at full attraction'),
  klinokinesis: num(0.5, 0, 0.9, 'modulation of the run-ending hazard by heading'),
  arrivalRadius: num(1.5, 0, 10, 'attracted flies stop within this distance of the cursor (BL; 0 disables)'),
  lingerMax: num(6, 0, 60, 'max time to linger at the cursor (s)'),
  wallMargin: num(1.5, 0, 5, 'soft wall-avoidance zone (BL)'),
  wallGain: num(6, 0, 30, 'wall steering strength (rad/s)'),
  container: { type: 'container', default: null, doc: 'Element or CSS selector; null means full-viewport overlay' },
  zIndex: int(2147483000, -2147483648, 2147483647, 'overlay z-index'),
  seed: { type: 'seed', default: null, min: 0, max: 4294967295, doc: 'uint32 seed; null means random' },
  reducedMotion: oneOf('static', ['static', 'hide', 'ignore'], 'behaviour when prefers-reduced-motion: reduce'),
  sprite: { type: 'sprite', default: 'auto', doc: "'auto', 'procedural' or a sprite sheet URL" },
  touchTargetTimeout: num(4, 0, 30, 'how long a tap acts as the cursor on touch devices (s)'),
  debug: { type: 'bool', default: false, doc: 'draw the debug overlay' },
};

export const DEFAULTS = Object.freeze(
  Object.fromEntries(Object.entries(SCHEMA).map(([k, s]) => [k, s.default])));

const warned = new Set();

function warnOnce(key, message) {
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(`[fly] ${message}`);
}

/** Test hook: forget which keys have already warned. */
export function resetWarnings() {
  warned.clear();
}

const INVALID = Symbol('invalid');

function clampNumber(key, spec, v) {
  if (typeof v === 'string' && v.trim() !== '') v = Number(v);
  if (typeof v !== 'number' || Number.isNaN(v)) return INVALID;
  if (spec.type === 'int' || spec.type === 'seed') v = Math.round(v);
  const c = Math.min(spec.max, Math.max(spec.min, v));
  if (c !== v) warnOnce(key, `${key}=${v} is out of range [${spec.min}, ${spec.max}]; using ${c}`);
  return c;
}

function coerce(key, spec, v) {
  switch (spec.type) {
    case 'number':
    case 'int':
      return clampNumber(key, spec, v);
    case 'seed':
      return v === null ? null : clampNumber(key, spec, v);
    case 'enum':
      return spec.values.includes(v) ? v : INVALID;
    case 'bool':
      return typeof v === 'boolean' ? v : INVALID;
    case 'container':
      if (v === null || (typeof v === 'string' && v.trim() !== '')) return v;
      return v && typeof v === 'object' && v.nodeType === 1 ? v : INVALID;
    case 'sprite':
      return typeof v === 'string' && v.trim() !== '' ? v : INVALID;
  }
  return INVALID;
}

/**
 * Validates a partial options object. Unknown keys and invalid values are dropped with a
 * warning; out-of-range numbers are clamped with a warning (once per key).
 */
export function validateParams(partial = {}) {
  const out = {};
  for (const [key, value] of Object.entries(partial)) {
    const spec = SCHEMA[key];
    if (!spec) {
      warnOnce(key, `unknown option "${key}" ignored`);
      continue;
    }
    const v = coerce(key, spec, value);
    if (v === INVALID) {
      warnOnce(key, `invalid value for ${key}: ${String(value)}; keeping ${String(spec.default)}`);
      continue;
    }
    out[key] = v;
  }
  return out;
}

/** Full params: `base` (defaults) overlaid with the validated partial. */
export function resolveParams(partial = {}, base = DEFAULTS) {
  return { ...base, ...validateParams(partial) };
}

const camel = (s) => s.replace(/-([a-z])/g, (_, c) => c.toUpperCase());

/**
 * Parses data attributes (an element's `dataset`, or a plain object of strings with
 * camelCase or kebab-case keys) into a validated partial options object.
 * `data-fly` is the auto-init flag and is skipped.
 */
export function parseDataset(dataset) {
  const raw = {};
  for (const [k, value] of Object.entries(dataset)) {
    const key = camel(k);
    if (key === 'fly') continue;
    const spec = SCHEMA[key];
    if (!spec) {
      raw[key] = value;
      continue;
    }
    const s = String(value).trim();
    switch (spec.type) {
      case 'number':
      case 'int':
        raw[key] = s === '' ? NaN : Number(s);
        break;
      case 'seed':
        raw[key] = s === '' || s === 'null' ? null : Number(s);
        break;
      case 'bool':
        raw[key] = s === '' || s === 'true' ? true : s === 'false' ? false : s;
        break;
      default:
        raw[key] = s;
    }
  }
  return validateParams(raw);
}
