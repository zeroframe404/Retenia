import type { StorybookConfig } from '@storybook/react-vite'
import tailwindcss from '@tailwindcss/vite'

/**
 * The renderer's own component catalog, for `features/*` UI that lives in `apps/desktop`
 * rather than the shared `@retenia/ui` package (`packages/ui/.storybook/main.ts` is the
 * one for that). `add-activity-type`/CLAUDE.md's "every new module ships with... for UI, a
 * Storybook story" applies here the same way.
 */
const config: StorybookConfig = {
  stories: ['../src/renderer/src/**/*.stories.@(ts|tsx)'],
  addons: ['@storybook/addon-themes'],
  framework: {
    name: '@storybook/react-vite',
    options: {},
  },
  async viteFinal(viteConfig) {
    viteConfig.plugins = [...(viteConfig.plugins ?? []), tailwindcss()]
    // esbuild's automatic tsconfig discovery walks up from `.storybook/` to
    // `apps/desktop/tsconfig.json` — a project-references-only file with no `jsx` option of
    // its own (the real setting lives in the referenced `tsconfig.web.json`, which esbuild
    // never looks inside) — so without this it falls back to the classic runtime and every
    // story fails with "React is not defined". `packages/ui/tsconfig.json` sets `jsx`
    // directly, which is why its own Storybook needs no such override.
    viteConfig.esbuild = { ...viteConfig.esbuild, jsx: 'automatic' }
    return viteConfig
  },
}

export default config
