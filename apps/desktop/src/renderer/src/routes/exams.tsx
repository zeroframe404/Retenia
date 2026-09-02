import { createFileRoute } from '@tanstack/react-router'
import { PlaceholderScreen } from '../shell/placeholder-screen'

export const Route = createFileRoute('/exams')({
  component: () => <PlaceholderScreen ns="exams" />,
})
