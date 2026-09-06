import { defaultLocale, fallbackLocale, namespaces, resources } from '@retenia/i18n'
import { Toaster, TooltipProvider } from '@retenia/ui'
import { withThemeByDataAttribute } from '@storybook/addon-themes'
import type { Preview } from '@storybook/react-vite'
import i18n from 'i18next'
import ICU from 'i18next-icu'
import { MotionConfig } from 'motion/react'
import { I18nextProvider, initReactI18next } from 'react-i18next'
import './tailwind.css'

/**
 * Mirrors `packages/ui`'s preview, with one difference: the providers come from
 * `@retenia/ui`'s public entry rather than from relative paths, because this package consumes
 * the design system rather than being it.
 */
i18n
  .use(ICU)
  .use(initReactI18next)
  .init({
    resources,
    lng: defaultLocale,
    fallbackLng: fallbackLocale,
    ns: [...namespaces],
    defaultNS: 'common',
    interpolation: { escapeValue: false },
  })

const preview: Preview = {
  parameters: { controls: { expanded: true } },
  decorators: [
    withThemeByDataAttribute({
      themes: { light: 'light', dark: 'dark' },
      defaultTheme: 'light',
      attributeName: 'data-theme',
    }),
    (Story) => (
      <I18nextProvider i18n={i18n}>
        <MotionConfig reducedMotion="user">
          <TooltipProvider>
            <div className="bg-bg text-text min-h-screen p-8">
              <Story />
              <Toaster />
            </div>
          </TooltipProvider>
        </MotionConfig>
      </I18nextProvider>
    ),
  ],
}

export default preview
