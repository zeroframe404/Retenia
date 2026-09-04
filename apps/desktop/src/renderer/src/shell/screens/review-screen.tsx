/**
 * The `/review` sticky route's real content (`shell/sticky-outlet.tsx`). The screen itself
 * lives in `features/review` — this file only keeps the import path `sticky-outlet.tsx`
 * already `lazy()`-loads stable.
 */
export { ReviewScreen } from '../../features/review/review-screen'
