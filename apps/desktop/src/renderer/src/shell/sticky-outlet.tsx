import { useRouterState } from '@tanstack/react-router'
import type { ComponentType } from 'react'
import { Activity, useEffect, useState } from 'react'
import { ReviewScreen } from './screens/review-screen'

/**
 * Routes that stay mounted (via React 19.2's `<Activity>`) instead of unmounting when the
 * user navigates elsewhere — today just Review; the task also names "Player", which has no
 * route until sub-phase 9.2 (the lesson player lands under `/path`), so this list — and
 * `STICKY_SCREENS` below — is the extension point for it rather than something built against
 * a route that doesn't exist yet.
 */
const STICKY_SCREENS: Record<string, ComponentType> = {
  '/review': ReviewScreen,
}

/**
 * Renders every sticky route's screen directly (not through the router's `<Outlet/>`, which
 * unmounts on navigation) once it's been visited, keeping not-currently-active ones mounted
 * but hidden. The matched route file for a sticky path (e.g. `routes/review.tsx`) renders
 * `null` — its content lives here instead, so it's never rendered twice.
 */
export function StickyRegion() {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const [visited, setVisited] = useState<Set<string>>(() => new Set())

  useEffect(() => {
    if (pathname in STICKY_SCREENS && !visited.has(pathname)) {
      setVisited((prev) => new Set(prev).add(pathname))
    }
  }, [pathname, visited])

  return (
    <>
      {[...visited].map((path) => {
        const Screen = STICKY_SCREENS[path]
        if (!Screen) return null
        return (
          <Activity key={path} mode={pathname === path ? 'visible' : 'hidden'}>
            <Screen />
          </Activity>
        )
      })}
    </>
  )
}
