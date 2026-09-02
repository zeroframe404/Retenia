import { defaultLocale, fallbackLocale, resources } from '@retenia/i18n'
import type { Preview } from '@storybook/react-vite'
import i18n from 'i18next'
import { I18nextProvider, initReactI18next } from 'react-i18next'
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
        <Story />
      </I18nextProvider>
    ),
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
