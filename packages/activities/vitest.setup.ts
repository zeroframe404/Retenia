import { configure } from '@testing-library/react'
import '@retenia/config/vitest.setup'

/**
 * Give Testing Library's async queries a budget that a dynamic `import()` can actually meet.
 *
 * Every renderer in this package is lazily loaded by `<ActivityHost/>`, so the first
 * `findByTestId('renderer-…')` of a test is waiting on a chunk to be transformed and evaluated,
 * not on a React state update. Testing Library's default `asyncUtilTimeout` is 1 s, which is
 * generous for a re-render and far too tight for that import: `long-text.test.tsx` measures this
 * file at a ~50x slowdown on a Windows CI runner (transform 104 s against 1.8 s) when `pnpm test`
 * runs sixteen packages at once, and there the import loses that race — the failure surfaces as
 * `Unable to find an element by: [data-testid="renderer-long_text"]`, an element that does
 * appear, just later than a second.
 *
 * `SLOW_INTERACTION_MS` in that file already relaxed the *test* timeout for the same reason; this
 * is the same remedy applied to the *query* clock, which it left at the default. Only the clock
 * is relaxed: not one assertion, and not one line of any test body, changes.
 *
 * 15 s sits above any plausible cold import and below that file's 30 s test timeout, so a
 * renderer that genuinely never mounts still fails with Testing Library's own message naming the
 * missing test id rather than as a bare test timeout.
 */
configure({ asyncUtilTimeout: 15_000 })
