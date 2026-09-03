import { baseVitestConfig } from '@retenia/config/vitest.base'

/**
 * Two projects, because the two halves of the app run in different worlds: main and
 * preload code is Node, renderer code needs a DOM.
 */
export default baseVitestConfig({
  test: {
    projects: [
      {
        // Inline projects inherit nothing from this file unless asked to (that only
        // becomes the default in Vitest 5).
        extends: true,
        test: {
          name: 'main',
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
        extends: true,
        test: {
          name: 'renderer',
          environment: 'jsdom',
          setupFiles: ['@retenia/config/vitest.setup'],
          include: ['src/renderer/**/*.test.{ts,tsx}'],
        },
      },
    ],
  },
})
