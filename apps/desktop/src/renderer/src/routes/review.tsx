import { createFileRoute } from '@tanstack/react-router'

/**
 * `/review` is a "sticky" route (`shell/sticky-outlet.tsx`): its actual content
 * (`shell/screens/review-screen.tsx`) is rendered directly by `<StickyRegion>` in
 * `AppShell`, wrapped in React 19.2's `<Activity>`, so it survives navigating away instead
 * of unmounting the way a normal route component would. This route's own component renders
 * nothing — rendering it here too would show the screen twice.
 */
export const Route = createFileRoute('/review')({
  component: () => null,
})
