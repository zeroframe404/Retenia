import { defineConfig, mergeConfig, type ViteUserConfig } from 'vitest/config'

/** Shared Vitest defaults; packages merge their own overrides (e.g. `environment: 'jsdom'`) on top. */
export function baseVitestConfig(overrides: ViteUserConfig = {}) {
  return mergeConfig(
    defineConfig({
      test: {
        environment: 'node',
        passWithNoTests: false,
        // Vitest's own default (5s) is tight for a test doing real I/O (temp dirs, real
        // parsing) or `userEvent` interaction sequences once CI is running every package's
        // suite concurrently on one machine — several such tests have hit exactly that
        // wall on a loaded Windows runner without anything actually being slow in isolation.
        testTimeout: 15_000,
      },
    }),
    defineConfig(overrides),
  )
}
