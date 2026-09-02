import { defaultLocale, fallbackLocale, resources } from '@retenia/i18n'
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'

i18n.use(initReactI18next).init({
  resources,
  lng: defaultLocale,
  fallbackLng: fallbackLocale,
  ns: ['common'],
  defaultNS: 'common',
  interpolation: { escapeValue: false },
})

export default i18n
