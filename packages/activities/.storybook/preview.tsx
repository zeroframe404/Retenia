import type { Preview } from '@storybook/react-vite'
import './tailwind.css'

/**
 * Activities render inside the app shell, so the stories only need the design system's tokens and
 * a light/dark ground — no i18n provider: `@retenia/activities` takes its strings through the
 * `labels` prop (see `src/labels.ts`), exactly as `@retenia/ui` does.
 */
const preview: Preview = {
  parameters: {
    a11y: {
      // Fail the story on a violation rather than only reporting it, so `storybook:build` and the
      // interaction runner gate on accessibility the way the Vitest suite does.
      test: 'error',
      config: {
        rules: [
          // A story is not a page: the landmark rule is the lesson player's business.
          { id: 'region', enabled: false },
        ],
      },
    },
    backgrounds: {
      default: 'light',
      values: [
        { name: 'light', value: '#ffffff' },
        { name: 'dark', value: '#020617' },
      ],
    },
  },
}

export default preview
