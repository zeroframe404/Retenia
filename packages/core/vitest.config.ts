import { baseVitestConfig } from '@retenia/config/vitest.base'

export default baseVitestConfig({
  test: {
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/**/*.bench.ts', 'src/testing/**'],
      // The scheduler is the foundation of the product (`docs/spec/07-architecture.md`
      // §10: "100 % of core's logic (FSRS, grading, sessions) covered").
      thresholds: {
        'src/memory/**': { lines: 100, functions: 100, branches: 100, statements: 100 },
        // The session generator decides what the learner is asked for every due skill
        // (`docs/spec/03-activities.md` §5); it is held to the same bar as the scheduler.
        'src/sessions/**': { lines: 100, functions: 100, branches: 100, statements: 100 },
      },
    },
  },
})
