import { defaultLocale, fallbackLocale, resources } from '@retenia/i18n'
import { withThemeByDataAttribute } from '@storybook/addon-themes'
import type { Preview } from '@storybook/react-vite'
import i18n from 'i18next'
import { MotionConfig } from 'motion/react'
import { I18nextProvider, initReactI18next } from 'react-i18next'
import { Toaster } from '../src/components/toast'
import { TooltipProvider } from '../src/components/tooltip'
import './tailwind.css'

i18n.use(initReactI18next).init({
  resources,
  lng: defaultLocale,
  fallbackLng: fallbackLocale,
  ns: ['common'],
  defaultNS: 'common',
  interpolation: { escapeValue: false },
})

const preview: Preview = {
  decorators: [
    (Story) => (
      <I18nextProvider i18n={i18n}>
        <MotionConfig reducedMotion="user">
          <TooltipProvider>
            <div className="bg-bg text-text min-h-screen p-8">
              <Story />
            </div>
            <Toaster />
          </TooltipProvider>
        </MotionConfig>
      </I18nextProvider>
    ),
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
