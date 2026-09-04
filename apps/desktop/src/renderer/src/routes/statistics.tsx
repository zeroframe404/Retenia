import { createFileRoute } from '@tanstack/react-router'
import { StatsScreen } from '../features/stats'

export const Route = createFileRoute('/statistics')({
  component: StatsScreen,
})
