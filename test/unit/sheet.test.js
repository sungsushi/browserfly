// sheet.js: metadata validation and sprite source resolution (M5).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { validateSheetMeta, sheetCandidates } from '../../src/sheet.js';

const fixture = (name) => JSON.parse(readFileSync(new URL(`../fixtures/sheets/${name}.json`, import.meta.url), 'utf8'));
const valid = fixture('valid');
// The image size that goes with the fixtures: one row per clip, 16 frames across.
const IMAGE = { width: valid.frameWidth * 16, height: valid.frameHeight * 2 };

describe('sheet metadata validation', () => {
  it('accepts the real sheet metadata, with and without the image size', () => {
    expect(validateSheetMeta(valid)).toEqual([]);
    expect(validateSheetMeta(valid, IMAGE)).toEqual([]);
  });

  it('rejects a missing clip', () => {
    expect(validateSheetMeta(fixture('missing-clip'), IMAGE).join()).toMatch(/clip "idle" missing/);
  });

  it('rejects a frame count that does not fit the image', () => {
    const errors = validateSheetMeta(fixture('frame-count-mismatch'), IMAGE);
    expect(errors.join()).toMatch(/20 frames .* exceed the image width/);
  });

  it('rejects a negative stride', () => {
    expect(validateSheetMeta(fixture('negative-stride'), IMAGE).join()).toMatch(/strideBL must be a positive number/);
  });

  it('rejects other malformed metadata', () => {
    expect(validateSheetMeta(null)).toEqual(['metadata is not an object']);
    expect(validateSheetMeta({ ...valid, version: 2 }).join()).toMatch(/version/);
    expect(validateSheetMeta({ ...valid, frameWidth: 0 }).join()).toMatch(/frameWidth/);
    expect(validateSheetMeta({ ...valid, anchor: [1] }).join()).toMatch(/anchor/);
    expect(validateSheetMeta({ ...valid, clips: undefined }).join()).toMatch(/clips missing/);
    const badRow = { ...valid, clips: { ...valid.clips, idle: { row: 2, frames: 2 } } };
    expect(validateSheetMeta(badRow, IMAGE).join()).toMatch(/row 2 is outside/);
  });
});

describe('sprite source resolution', () => {
  const opts = { scriptSrc: 'https://example.org/my-repo/js/fly.min.js', inlineSheet: null, embeddedMeta: valid };

  it("'auto' tries the WebP then the PNG next to the script", () => {
    expect(sheetCandidates('auto', opts)).toEqual([
      { image: 'https://example.org/my-repo/js/fly-sheet.webp', meta: valid },
      { image: 'https://example.org/my-repo/js/fly-sheet.png', meta: valid },
    ]);
  });

  it("'auto' uses the inlined sheet when the bundle has one", () => {
    expect(sheetCandidates('auto', { ...opts, inlineSheet: 'data:image/webp;base64,AAAA' }))
      .toEqual([{ image: 'data:image/webp;base64,AAAA', meta: valid }]);
  });

  it("'procedural', or no embedded metadata, loads nothing", () => {
    expect(sheetCandidates('procedural', opts)).toEqual([]);
    expect(sheetCandidates('auto', { ...opts, embeddedMeta: null })).toEqual([]);
  });

  it('a JSON URL brings its own metadata; an image URL uses the embedded metadata', () => {
    expect(sheetCandidates('../art/custom.json', opts)).toEqual([{ image: null, meta: 'https://example.org/my-repo/art/custom.json' }]);
    expect(sheetCandidates('/art/sheet.png', opts)).toEqual([{ image: 'https://example.org/art/sheet.png', meta: valid }]);
  });
});
