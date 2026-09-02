import { createFileRoute } from '@tanstack/react-router'
import { PlaceholderScreen } from '../shell/placeholder-screen'

export const Route = createFileRoute('/notes')({
  component: () => <PlaceholderScreen ns="notes" />,
})
