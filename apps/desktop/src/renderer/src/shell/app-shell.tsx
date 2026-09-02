import { ProcessingTray, Sidebar, TopBar } from '@retenia/ui'
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

  useHotkeys('ctrl+k', () => setPaletteOpen(true), { scopes: ['global'] }, [])
  // react-hotkeys-hook matches by `KeyboardEvent.code` by default, not `.key` — "," and "?"
  // (SHORTCUTS' display strings, shown as-is in the shortcuts sheet) don't match their own
  // codes ("Comma"/"Slash"), so the registration uses the code-based names instead.
  useHotkeys('ctrl+comma', () => navigate({ to: '/settings' }), { scopes: ['global'] }, [navigate])
  useHotkeys('shift+slash', () => setShortcutsOpen(true), { scopes: ['global'] }, [])

  const density = settings.data?.density ?? 'comfortable'
  const soberMode = settings.data?.gamification.profile === 'sober'
  const activeSection = SECTIONS.find((s) => s.path === pathname) ?? SECTIONS[0]

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
            breadcrumbs={[
              { label: tCommon('appTitle') },
              { label: t(activeSection?.labelKey ?? 'nav.home') },
            ]}
            onSearchClick={() => setPaletteOpen(true)}
            searchLabel={t('topBar.search')}
            xpLabel={t('xpBadge', { xp: 1240 })}
            xpHidden={soberMode}
          />
          <Group orientation="horizontal" className="flex-1 overflow-hidden">
            <Panel className="h-full overflow-y-auto">
              <StickyRegion />
              <Outlet />
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
          />
        </div>
      </div>
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
      <KeyboardShortcutsSheet open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
    </div>
  )
}
