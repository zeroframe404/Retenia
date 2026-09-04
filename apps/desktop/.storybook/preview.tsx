import { MotionConfig, Toaster, TooltipProvider } from '@retenia/ui'
import { withThemeByDataAttribute } from '@storybook/addon-themes'
import type { Preview } from '@storybook/react-vite'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import '../src/renderer/src/i18n'
import '../src/renderer/src/styles.css'

const preview: Preview = {
  decorators: [
    (Story) => {
      const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
      })
      return (
        <QueryClientProvider client={queryClient}>
          <MotionConfig reducedMotion="user">
            <TooltipProvider>
              <div className="bg-bg text-text min-h-screen p-8">
                <Story />
              </div>
              <Toaster />
            </TooltipProvider>
          </MotionConfig>
        </QueryClientProvider>
      )
    },
    withThemeByDataAttribute({
      themes: { light: 'light', dark: 'dark' },
      defaultTheme: 'light',
      attributeName: 'data-theme',
    }),
  ],
  parameters: {
    backgrounds: {
      default: 'light',
      values: [
        { name: 'light', value: '#ffffff' },
        { name: 'dark', value: '#020617' },
      ],
    },
  },
}

export default preview
