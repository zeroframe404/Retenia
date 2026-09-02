import { ProcessingTray, SHORTCUTS, Sidebar, TopBar } from '@retenia/ui'
import { Outlet, useNavigate, useRouterState } from '@tanstack/react-router'
import { useState } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'
import { Group, Panel } from 'react-resizable-panels'
import { useT } from '../i18n/use-t'
import { useChromeStore } from './chrome-store'
import { CommandPalette } from './command-palette'
import { KeyboardShortcutsSheet } from './keyboard-shortcuts-sheet'
import { SECTIONS } from './sections'
import { StickyRegion } from './sticky-outlet'
import { useDueCount } from './use-due-count'
import { useProcessingJobs } from './use-processing-jobs'
import { useSettings } from './use-settings'

const GLOBAL_SHORTCUTS = SHORTCUTS.filter((s) => s.scope === 'global')

/**
 * The application shell: sidebar + top bar + main content (with the sticky Review region
 * and `react-resizable-panels` split-view support) + processing tray, plus the command
 * palette and shortcuts sheet, both reachable by global hotkey from anywhere.
 */
export function AppShell() {
  const t = useT('shell')
  const tCommon = useT('common')
  const navigate = useNavigate()
  const pathname = useRouterState({ select: (s) => s.location.pathname })

  const sidebarCollapsed = useChromeStore((s) => s.sidebarCollapsed)
  const toggleSidebarCollapsed = useChromeStore((s) => s.toggleSidebarCollapsed)
  const trayCollapsed = useChromeStore((s) => s.processingTrayCollapsed)
  const toggleTrayCollapsed = useChromeStore((s) => s.toggleProcessingTrayCollapsed)

  const dueCount = useDueCount()
  const jobs = useProcessingJobs()
  const settings = useSettings()

  const [paletteOpen, setPaletteOpen] = useState(false)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)

  // The registry (`packages/ui/src/shortcuts.ts`) is the single source of truth for both
  // *what* the global shortcuts are and *which combo* actually fires them (`matchKeys`,
  // when a shortcut's display string doesn't match its own `KeyboardEvent.code`) — one
  // `useHotkeys` call, dispatching by which combo matched, rather than one call per
  // shortcut with its combo typed out a second time.
  useHotkeys(
    GLOBAL_SHORTCUTS.map((s) => s.matchKeys ?? s.keys).join(','),
    (_event, handler) => {
      const shortcut = GLOBAL_SHORTCUTS.find((s) => (s.matchKeys ?? s.keys) === handler.hotkey)
      switch (shortcut?.id) {
        case 'shell.commandPalette':
          setPaletteOpen(true)
          break
        case 'shell.openSettings':
          navigate({ to: '/settings' })
          break
        case 'shell.shortcutsSheet':
          setShortcutsOpen(true)
          break
      }
    },
    { scopes: ['global'] },
    [navigate],
  )

  const density = settings.data?.density ?? 'comfortable'
  const soberMode = settings.data?.gamification.profile === 'sober'
  const activeSection = SECTIONS.find((s) => s.path === pathname)

  return (
    <div data-density={density} className="flex h-screen flex-col overflow-hidden">
      <div className="flex flex-1 overflow-hidden">
        <Sidebar
          items={SECTIONS.map((section) => ({
            id: section.id,
            label: t(section.labelKey),
            icon: section.icon,
            active: section.id === activeSection?.id,
            badge: section.id === 'review' ? dueCount : undefined,
          }))}
          collapsed={sidebarCollapsed}
          onToggleCollapsed={toggleSidebarCollapsed}
          onSelect={(id) => {
            const section = SECTIONS.find((s) => s.id === id)
            if (section) navigate({ to: section.path })
          }}
          collapseLabel={t('nav.collapse')}
          expandLabel={t('nav.expand')}
        />
        <div className="flex flex-1 flex-col overflow-hidden">
          <TopBar
            breadcrumbs={
              activeSection
                ? [{ label: tCommon('appTitle') }, { label: t(activeSection.labelKey) }]
                : [{ label: tCommon('appTitle') }, { label: t('notFound.title') }]
            }
            onSearchClick={() => setPaletteOpen(true)}
            searchLabel={t('topBar.search')}
            xpLabel={t('xpBadge', { xp: 1240 })}
            xpHidden={soberMode}
          />
          <Group orientation="horizontal" className="flex-1 overflow-hidden">
            <Panel className="h-full overflow-y-auto">
              {/* Skip-link target (WCAG 2.2 SC 2.4.1 Bypass Blocks) and the page's single
               * `main` landmark — `tabIndex={-1}` lets the skip link move keyboard focus
               * here even though a `<main>` is not itself normally focusable. `Panel`
               * always renders its own wrapping `<div>`, so `main` nests one level in. */}
              <main id="main-content" tabIndex={-1} className="outline-none">
                <StickyRegion />
                <Outlet />
              </main>
            </Panel>
          </Group>
          <ProcessingTray
            jobs={jobs}
            collapsed={trayCollapsed}
            onToggleCollapsed={toggleTrayCollapsed}
            title={t('processingTray.title')}
            emptyState={t('processingTray.emptyState')}
            collapseLabel={t('processingTray.collapse')}
            expandLabel={t('processingTray.expand')}
            jobCountLabel={t('processingTray.jobCount', { count: jobs.length })}
          />
        </div>
      </div>
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
      <KeyboardShortcutsSheet open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
    </div>
  )
}
