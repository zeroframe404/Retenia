import { baseVitestConfig } from '@retenia/config/vitest.base'

export default baseVitestConfig({
  test: {
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/testing/**'],
      // The sequencer is the only deterministic stage of a non-deterministic pipeline
      // (`docs/spec/04-path-generation.md` §7: "reproducibility comes from … the
      // sequencing being pure code"), so an untested branch there is a path that silently
      // differs between two runs of the same book. Informational here — CI's threshold is
      // the matching entry in the root `vitest.config.ts`, which is the config it runs.
      thresholds: {
        'src/graph/**': { lines: 100, functions: 100, branches: 100, statements: 100 },
        'src/validate/**': { lines: 100, functions: 100, branches: 100, statements: 100 },
        'src/sequencing/**': { lines: 100, functions: 100, branches: 100, statements: 100 },
      },
    },
  },
})
