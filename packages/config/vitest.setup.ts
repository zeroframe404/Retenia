import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

// Testing Library only auto-registers cleanup when Vitest runs with `globals: true`, which
// this workspace does not. Without it, every render in a file stacks up in the same DOM.
//
// Shared across every jsdom package (ui, activities, editor, readers, apps/desktop's renderer
// project) via `@retenia/config/vitest.setup` — see each package's `setupFiles`.
afterEach(() => {
  cleanup()
})
