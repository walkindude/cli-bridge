// @ts-check
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['dist/', 'node_modules/', 'coverage/'],
  },
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.ts', 'tests/**/*.ts'],
    rules: {
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'error',
    },
  }
);
