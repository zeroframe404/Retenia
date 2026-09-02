import { defineConfig, mergeConfig, type ViteUserConfig } from 'vitest/config'

/** Shared Vitest defaults; packages merge their own overrides (e.g. `environment: 'jsdom'`) on top. */
export function baseVitestConfig(overrides: ViteUserConfig = {}) {
  return mergeConfig(
    defineConfig({
      test: {
        environment: 'node',
        passWithNoTests: false,
      },
    }),
    defineConfig(overrides),
  )
}
