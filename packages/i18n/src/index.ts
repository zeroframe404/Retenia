import en from './en/common.json'
import esAR from './es-AR/common.json'

/** i18next `es-AR` (default) and `en` (second) resources, namespace `common`. */
export const resources = {
  'es-AR': { common: esAR },
  en: { common: en },
} as const

export const defaultLocale = 'es-AR' as const
export const fallbackLocale = 'en' as const
