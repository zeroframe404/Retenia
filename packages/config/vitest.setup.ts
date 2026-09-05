import '@testing-library/jest-dom/vitest'
import { cleanup, configure } from '@testing-library/react'
import { afterEach } from 'vitest'

/**
 * Give the async queries a budget that a dynamic `import()` can actually meet.
 *
 * Testing Library's default `asyncUtilTimeout` is 1 s. That is generous for the re-render it was
 * chosen for, and far too tight for what this workspace's `waitFor`/`findBy*` calls actually wait
 * on: `@retenia/activities` lazy-loads every renderer through `ActivityHost`, and `@retenia/ui`
 * waits on Shiki's oniguruma WASM engine, a mermaid chunk, or KaTeX. On a cold CI runner those
 * lose the race — and they fail as `Unable to find an element…` or `expected null not to be null`,
 * which reads like a broken component rather than a slow import. Both packages have now failed
 * that way on a first run, in `long-text.test.tsx` (Windows) and `markdown-view.test.tsx` (Linux).
 *
 * `SLOW_INTERACTION_MS` in `long-text.test.tsx` already relaxed the *test* timeout for this exact
 * reason, citing a measured ~50x slowdown when `pnpm test` runs sixteen packages at once; it left
 * the *query* clock at the default. This is the same remedy applied to that clock, in the one
 * place every jsdom package already shares. Only the clock is relaxed: no assertion and no test
 * body changes, and an element that never appears still fails, just later.
 *
 * 15 s sits above any plausible cold import and below that file's 30 s test timeout, so a genuine
 * miss still reports through Testing Library, naming what it looked for.
 */
configure({ asyncUtilTimeout: 15_000 })

// Testing Library only auto-registers cleanup when Vitest runs with `globals: true`, which
// this workspace does not. Without it, every render in a file stacks up in the same DOM.
//
// Shared across every jsdom package (ui, activities, editor, readers, apps/desktop's renderer
// project) via `@retenia/config/vitest.setup` — see each package's `setupFiles`.
afterEach(() => {
  cleanup()
})
