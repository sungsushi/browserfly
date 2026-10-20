// The README parameter table is generated from the schema; this fails if it has drifted.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { updatedReadme } from '../../scripts/params-table.mjs';
import { SCHEMA } from '../../src/params.js';
import { PARAM_DOCS } from '../../src/param-docs.js';

describe('README', () => {
  it('parameter table matches src/params.js (run `npm run docs` to regenerate)', () => {
    const text = readFileSync(new URL('../../README.md', import.meta.url), 'utf8');
    expect(updatedReadme(text)).toBe(text);
  });

  it('every option has a description', () => {
    expect(Object.keys(PARAM_DOCS).sort()).toEqual(Object.keys(SCHEMA).sort());
  });
});
