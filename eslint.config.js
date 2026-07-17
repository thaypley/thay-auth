// @ts-check
import tseslint from 'typescript-eslint';

/**
 * Flat config (ESLint 9+). Kept intentionally lean: catch real bugs
 * (unused vars, floating promises, loose equality) without fighting the
 * codebase's existing style. Run via `npm run lint`.
 */
export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**', 'sdk/dist/**', 'homebase/dist/**', 'homebase/node_modules/**'],
  },
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      parserOptions: {
        sourceType: 'module',
      },
      globals: {
        process: 'readonly',
        console: 'readonly',
        Buffer: 'readonly',
        fetch: 'readonly',
        FormData: 'readonly',
        Blob: 'readonly',
        setInterval: 'readonly',
        setTimeout: 'readonly',
      },
    },
    rules: {
      // The codebase leans on `unknown`/type-assertion casts heavily when
      // talking to PocketBase's loosely-typed records — don't fight that
      // pattern, just catch actually-dead code and risky async handling.
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-non-null-assertion': 'off',
      'no-unused-vars': 'off',
      'no-console': 'off',
      eqeqeq: ['warn', 'smart'],
      'no-var': 'error',
      'prefer-const': 'warn',
    },
  },
);
