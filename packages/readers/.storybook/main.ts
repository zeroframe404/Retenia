import type { StorybookConfig } from '@storybook/react-vite'
import tailwindcss from '@tailwindcss/vite'

const config: StorybookConfig = {
  stories: ['../src/**/*.stories.@(ts|tsx)'],
  addons: ['@storybook/addon-themes'],
  // Serves `test/fixtures/pdf/five-pages.pdf` at `/pdf/five-pages.pdf` — a real file `PdfReader`'s
  // story can hand to pdf.js, since Storybook runs in an actual browser (unlike this package's
  // jsdom-based Vitest tests, which never have a real canvas 2D context to render into).
  staticDirs: ['../test/fixtures'],
  framework: {
    name: '@storybook/react-vite',
    options: {},
  },
  async viteFinal(viteConfig) {
    viteConfig.plugins = [...(viteConfig.plugins ?? []), tailwindcss()]
    return viteConfig
  },
}

export default config
