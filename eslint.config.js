import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['dist/', 'coverage/', 'test-results/', 'playwright-report/', 'pipeline/'] },
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2020,
      sourceType: 'module',
      globals: { ...globals.browser, __DEBUG__: 'readonly', __INLINE_SHEET__: 'readonly', __SHEET_META__: 'readonly' },
    },
  },
  {
    files: ['*.config.js', '*.config.mjs', 'scripts/**', 'test/**'],
    languageOptions: { ecmaVersion: 2022, globals: { ...globals.node } },
  },
];
