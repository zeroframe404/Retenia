import type { LucideIcon } from 'lucide-react'
import {
  BarChart3Icon,
  BookOpenIcon,
  GraduationCapIcon,
  HomeIcon,
  LanguagesIcon,
  LibraryIcon,
  NotebookPenIcon,
  RouteIcon,
  SettingsIcon,
} from 'lucide-react'

export interface Section {
  id: string
  path: string
  icon: LucideIcon
  /** i18n key, relative to the `shell` namespace's `nav.*` block. */
  labelKey: string
}

/** The 9 sidebar sections (`docs/spec/08-ux.md` §2 screen map). Single source of truth for
 * the `Sidebar` and the command palette's "navigate" group, so they can't drift apart. */
export const SECTIONS: Section[] = [
  { id: 'home', path: '/', icon: HomeIcon, labelKey: 'nav.home' },
  { id: 'path', path: '/path', icon: RouteIcon, labelKey: 'nav.path' },
  { id: 'review', path: '/review', icon: BookOpenIcon, labelKey: 'nav.review' },
  { id: 'library', path: '/library', icon: LibraryIcon, labelKey: 'nav.library' },
  { id: 'exams', path: '/exams', icon: GraduationCapIcon, labelKey: 'nav.exams' },
  { id: 'languages', path: '/languages', icon: LanguagesIcon, labelKey: 'nav.languages' },
  { id: 'notes', path: '/notes', icon: NotebookPenIcon, labelKey: 'nav.notes' },
  { id: 'statistics', path: '/statistics', icon: BarChart3Icon, labelKey: 'nav.statistics' },
  { id: 'settings', path: '/settings', icon: SettingsIcon, labelKey: 'nav.settings' },
]
