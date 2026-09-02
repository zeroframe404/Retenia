import { defaultLocale, fallbackLocale, namespaces, resources } from '@retenia/i18n'
import i18n from 'i18next'
import ICU from 'i18next-icu'
import { initReactI18next } from 'react-i18next'

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

export default i18n
