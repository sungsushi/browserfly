import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SCHEMA, DEFAULTS, validateParams, resolveParams, parseDataset, resetWarnings } from '../../src/params.js';

describe('9. params', () => {
  let warn;
  beforeEach(() => {
    resetWarnings();
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => warn.mockRestore());

  it('defaults match the schema table', () => {
    expect(DEFAULTS.attraction).toBe(0.3);
    expect(DEFAULTS.stopDistribution).toBe('lognormal');
    expect(DEFAULTS.container).toBe(null);
    expect(Object.keys(DEFAULTS)).toEqual(Object.keys(SCHEMA));
  });

  it('clamps out-of-range values and warns once per key', () => {
    expect(validateParams({ attraction: 2 })).toEqual({ attraction: 1 });
    expect(validateParams({ count: 0 })).toEqual({ count: 1 });
    expect(validateParams({ attraction: -5 })).toEqual({ attraction: -1 });
    expect(validateParams({ runMean: Infinity })).toEqual({ runMean: 60 });
    expect(warn).toHaveBeenCalledTimes(3); // attraction warned once, count, runMean
  });

  it('rounds integers', () => {
    expect(validateParams({ count: 3.6 })).toEqual({ count: 4 });
    expect(validateParams({ seed: 12.2 })).toEqual({ seed: 12 });
  });

  it('warns on unknown keys and drops them', () => {
    expect(validateParams({ bogus: 1, speed: 3 })).toEqual({ speed: 3 });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toMatch(/bogus/);
  });

  it('drops invalid values with a warning', () => {
    expect(validateParams({
      speed: 'fast', stopDistribution: 'gamma', debug: 'yes', sprite: '', container: 42,
    })).toEqual({});
    expect(warn).toHaveBeenCalledTimes(5);
  });

  it('accepts valid non-numeric values', () => {
    const el = { nodeType: 1 };
    expect(validateParams({
      seed: null, container: '#hero', sprite: 'https://x/y.webp', reducedMotion: 'hide', debug: true,
    })).toEqual({ seed: null, container: '#hero', sprite: 'https://x/y.webp', reducedMotion: 'hide', debug: true });
    expect(validateParams({ container: el }).container).toBe(el);
    expect(warn).not.toHaveBeenCalled();
  });

  it('resolveParams overlays validated values on defaults', () => {
    const p = resolveParams({ attraction: 0.8 });
    expect(p.attraction).toBe(0.8);
    expect(p.speed).toBe(DEFAULTS.speed);
    expect(resolveParams({ speed: 4 }, p).attraction).toBe(0.8);
  });

  it('parses data attributes', () => {
    expect(parseDataset({ fly: '', attraction: '0.4', debug: 'true' })).toEqual({ attraction: 0.4, debug: true });
    expect(parseDataset({ 'run-mean': '3' }).runMean).toBe(3);
    expect(parseDataset({ debug: '' })).toEqual({ debug: true });
    expect(parseDataset({ debug: 'false' })).toEqual({ debug: false });
    expect(parseDataset({ count: '7', seed: '42' })).toEqual({ count: 7, seed: 42 });
    expect(parseDataset({ seed: 'null' })).toEqual({ seed: null });
    expect(parseDataset({ stopDistribution: 'exp', container: '#hero', sprite: 'procedural' }))
      .toEqual({ stopDistribution: 'exp', container: '#hero', sprite: 'procedural' });
    expect(parseDataset({ speed: '', size: 'abc' })).toEqual({});
    expect(parseDataset({ debug: 'maybe' })).toEqual({});
  });
});
