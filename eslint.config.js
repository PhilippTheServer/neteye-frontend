// @ts-check
const tseslint = require('typescript-eslint');
const angular = require('@angular-eslint/eslint-plugin');
const angularTemplate = require('@angular-eslint/eslint-plugin-template');
const angularTemplateParser = require('@angular-eslint/template-parser');

module.exports = tseslint.config(
  // ── TypeScript source files ───────────────────────────────────────────────
  {
    files: ['**/*.ts'],
    extends: [...tseslint.configs.recommended, ...tseslint.configs.stylistic],
    plugins: {
      '@angular-eslint': angular,
    },
    // Extract inline templates from @Component({ template: `...` }) for linting
    processor: angularTemplate.processors['extract-inline-html'],
    rules: {
      // Angular-specific
      '@angular-eslint/component-class-suffix': 'error',
      '@angular-eslint/directive-class-suffix': 'error',
      '@angular-eslint/no-input-rename': 'error',
      '@angular-eslint/no-output-rename': 'error',
      '@angular-eslint/use-lifecycle-interface': 'error',
      '@angular-eslint/no-empty-lifecycle-method': 'error',

      // TypeScript quality
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/no-non-null-assertion': 'warn',

      // General
      'no-console': 'warn', // prefer LogService over bare console calls
      eqeqeq: ['error', 'always'],
    },
  },

  // ── Angular HTML templates ────────────────────────────────────────────────
  {
    files: ['**/*.html'],
    plugins: {
      '@angular-eslint/template': angularTemplate,
    },
    languageOptions: {
      parser: angularTemplateParser,
    },
    rules: {
      '@angular-eslint/template/banana-in-box': 'error',
      '@angular-eslint/template/no-negated-async': 'error',
      '@angular-eslint/template/eqeqeq': 'error',
    },
  },

  // ── Ignored paths ─────────────────────────────────────────────────────────
  {
    ignores: ['dist/', 'node_modules/', '.angular/', '*.config.js'],
  },
);
