import enCommon from './en/common.json'
import enExams from './en/exams.json'
import enHome from './en/home.json'
import enLanguages from './en/languages.json'
import enLibrary from './en/library.json'
import enNotes from './en/notes.json'
import enPath from './en/path.json'
import enReview from './en/review.json'
import enSettings from './en/settings.json'
import enShell from './en/shell.json'
import enStatistics from './en/statistics.json'
import esARCommon from './es-AR/common.json'
import esARExams from './es-AR/exams.json'
import esARHome from './es-AR/home.json'
import esARLanguages from './es-AR/languages.json'
import esARLibrary from './es-AR/library.json'
import esARNotes from './es-AR/notes.json'
import esARPath from './es-AR/path.json'
import esARReview from './es-AR/review.json'
import esARSettings from './es-AR/settings.json'
import esARShell from './es-AR/shell.json'
import esARStatistics from './es-AR/statistics.json'

/** One namespace per shell section (`docs/spec/08-ux.md` §2's screen map), plus `common`
 * (shared strings) and `shell` (sidebar, top bar, command palette, shortcuts sheet). */
export const namespaces = [
  'common',
  'shell',
  'home',
  'path',
  'review',
  'library',
  'exams',
  'languages',
  'notes',
  'statistics',
  'settings',
] as const
export type Namespace = (typeof namespaces)[number]

/** i18next `es-AR` (default) and `en` (second) resources, one entry per namespace. */
export const resources = {
  'es-AR': {
    common: esARCommon,
    shell: esARShell,
    home: esARHome,
    path: esARPath,
    review: esARReview,
    library: esARLibrary,
    exams: esARExams,
    languages: esARLanguages,
    notes: esARNotes,
    statistics: esARStatistics,
    settings: esARSettings,
  },
  en: {
    common: enCommon,
    shell: enShell,
    home: enHome,
    path: enPath,
    review: enReview,
    library: enLibrary,
    exams: enExams,
    languages: enLanguages,
    notes: enNotes,
    statistics: enStatistics,
    settings: enSettings,
  },
} as const

export const defaultLocale = 'es-AR' as const
export const fallbackLocale = 'en' as const
