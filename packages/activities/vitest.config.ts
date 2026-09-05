import { baseVitestConfig } from '@retenia/config/vitest.base'

export default baseVitestConfig({
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
  },
})
