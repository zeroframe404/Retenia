import { createFileRoute } from '@tanstack/react-router'
import { TodayCard } from '../features/review'
import { useT } from '../i18n/use-t'

/**
 * Home / Today (`docs/spec/08-ux.md` §2). `TodayCard` (`features/review/today-card.tsx`)
 * is the screen map's full "Today" card: due per level, new, reinforcement, the nearest
 * exam's readiness placeholder, a streak-ring placeholder, the importance-mix bias warning
 * and the "Modo urgente" entry point, all driven by `session.plan` — never invented
 * numbers. §1's "one primary action per screen" still holds: the card's single primary
 * "Repasar" button is the one call to action this screen offers.
 */
export function HomeScreen() {
  const t = useT('home')

  return (
    <div data-testid="screen-home" className="flex flex-col gap-6 p-6 compact:gap-4 compact:p-4">
      <h1 className="font-display text-2xl font-semibold">{t('title')}</h1>
      <TodayCard />
    </div>
  )
}

export const Route = createFileRoute('/')({
  component: HomeScreen,
})
