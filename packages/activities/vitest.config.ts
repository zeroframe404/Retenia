import { baseVitestConfig } from '@retenia/config/vitest.base'

export default baseVitestConfig({
  test: {
    environment: 'jsdom',
    setupFiles: ['@retenia/config/vitest.setup'],
  },
})
