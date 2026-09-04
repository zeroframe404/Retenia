import { baseVitestConfig } from '@retenia/config/vitest.base'

export default baseVitestConfig({
  test: {
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts'],
      thresholds: {
        'src/**': { lines: 100, functions: 100, branches: 100, statements: 100 },
      },
    },
  },
})
