import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist', 'node_modules'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: globals.browser },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    // The logic layer (and the isometric projection) must stay engine-free so it can be unit-tested in Node.
    files: ['src/logic/**/*.ts', 'src/data/**/*.ts', 'src/scenes/iso.ts', 'src/scenes/iso.test.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        { paths: [{ name: 'phaser', message: 'src/logic, src/data and src/scenes/iso.ts must not depend on Phaser.' }] },
      ],
    },
  },
);
