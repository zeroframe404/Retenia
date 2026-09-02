import { createFileRoute } from '@tanstack/react-router'
import { PlaceholderScreen } from '../shell/placeholder-screen'

export const Route = createFileRoute('/path')({
  component: () => <PlaceholderScreen ns="path" />,
})
