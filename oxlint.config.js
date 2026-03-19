import { defineConfig } from 'oxlint'

export default defineConfig({
  categories: {
    correctness: 'error',
    suspicious: 'warn',
    pedantic: 'off',
    style: 'warn',
    nursery: 'off',
  },
  rules: {
    'eslint/no-console': 'off',
    'eslint/no-undef': 'off',
    'eslint/no-unused-vars': 'error',
    'eslint/prefer-const': 'warn',
    'typescript/no-explicit-any': 'warn',
    'typescript/no-unused-vars': 'error',
    'typescript/explicit-function-return-type': 'off',
    'typescript/no-non-null-assertion': 'warn',
  },
  ignorePatterns: [
    '**/node_modules/**',
    '**/dist/**',
    '**/*.test.ts',
    '**/*.spec.ts',
  ],
})
