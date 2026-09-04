import { coverageConfigDefaults, defineConfig } from 'vitest/config'

/**
 * Aggregate entry point. `pnpm test` runs each package's own `vitest run` through Turborepo
 * (cacheable, package-scoped, what CI's per-package matrix relies on). This root config exists
 * so a single `vitest run --coverage` (via `pnpm test:coverage`) can execute every project in
 * one process and produce one merged coverage report — Turborepo has no way to combine
 * per-package coverage into a repo-wide threshold gate.
 */
export default defineConfig({
  test: {
    projects: [
      'packages/*/vitest.config.ts',
      // apps/desktop's own vitest.config.ts nests two named projects (main/renderer, see
      // that file) so it can pick a jsdom vs. node environment per test; Vitest's workspace
      // loader doesn't recurse into a referenced config's own `projects`, so they're
      // re-declared inline here instead of pointing at apps/desktop/vitest.config.ts directly
      // (which — with `include` unset at its top level — would otherwise fall back to
      // matching every default-glob test file under apps/desktop, e2e specs included, and
      // run them all under one plain-node environment).
      {
        extends: false,
        test: {
          name: 'desktop-main',
          root: 'apps/desktop',
          environment: 'node',
          include: [
            'src/main/**/*.test.ts',
            'src/preload/**/*.test.ts',
            // The job definitions and the worker entry are plain Node, shared by main and
            // the `utilityProcess` bundle, so they live outside `src/main`.
            'src/jobs/**/*.test.ts',
            'src/worker/**/*.test.ts',
          ],
        },
      },
      {
        extends: false,
        test: {
          name: 'desktop-renderer',
          root: 'apps/desktop',
          environment: 'jsdom',
          setupFiles: ['@retenia/config/vitest.setup'],
          include: ['src/renderer/**/*.test.{ts,tsx}'],
        },
      },
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      reportsDirectory: './coverage',
      exclude: [
        ...coverageConfigDefaults.exclude,
        // Test scaffolding, not product code: the shared repository contract suites in
        // `@retenia/core/testing` are *executed* by the `db` project, so counting them
        // would inflate core's numerator — the more contracts we write, the easier the
        // threshold below would get, which is backwards.
        'packages/*/src/testing/**',
        'packages/db/src/test-fixtures.ts',
      ],
      // `packages/core` is pure domain logic and zero-dependency by design (see CLAUDE.md);
      // it is the one package required to ship with real coverage, and the activity graders
      // are held to 100 % because `docs/spec/03-activities.md` §10 makes them "pure and
      // testable with fixtures" — an untested branch there is an untested score. Every other
      // package is still placeholder scaffolding pending its real sub-phase, so coverage there
      // is informational only — reported, not gated.
      thresholds: {
        'packages/core/src/**': {
          lines: 80,
        },
        'packages/activity-graders/src/**': {
          lines: 100,
          functions: 100,
          branches: 100,
          statements: 100,
        },
      },
    },
  },
})
