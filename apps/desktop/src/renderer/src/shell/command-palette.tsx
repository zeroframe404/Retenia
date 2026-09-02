import { Dialog, DialogContent, DialogTitle, toast, useThemeStore } from '@retenia/ui'
import { useNavigate } from '@tanstack/react-router'
import { Command } from 'cmdk'
import { useMemo, useState } from 'react'
import { useT } from '../i18n/use-t'
import { useChromeStore } from './chrome-store'
import { SECTIONS } from './sections'
import { useSetTheme } from './use-settings'

export interface CommandPaletteProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

interface Action {
  id: string
  labelKey: string
  run: () => void
}

/** Ctrl+K command palette (`docs/spec/08-ux.md` §1/§5): fuzzy-matched navigation to every
 * section plus a handful of shortcuts (start review, import, open settings, toggle theme).
 * `cmdk` inside `@retenia/ui`'s `Dialog` — the same controlled-open pattern the shortcuts
 * sheet uses, so both can be driven by the same global hotkeys. */
export function CommandPalette({ open, onOpenChange }: CommandPaletteProps) {
  const t = useT('shell')
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const recentCommandIds = useChromeStore((s) => s.recentCommandIds)
  const recordCommand = useChromeStore((s) => s.recordCommand)
  const themePreference = useThemeStore((s) => s.preference)
  const setTheme = useSetTheme()

  const runAndClose = (id: string, fn: () => void) => {
    recordCommand(id)
    fn()
    onOpenChange(false)
    setQuery('')
  }

  const actions: Action[] = useMemo(
    () => [
      {
        id: 'action.startReview',
        labelKey: 'commandPalette.actions.startReview',
        run: () => navigate({ to: '/review' }),
      },
      {
        id: 'action.import',
        labelKey: 'commandPalette.actions.import',
        run: () => toast(t('commandPalette.actions.import')),
      },
      {
        id: 'action.openSettings',
        labelKey: 'commandPalette.actions.openSettings',
        run: () => navigate({ to: '/settings' }),
      },
      {
        id: 'action.toggleTheme',
        labelKey: 'commandPalette.actions.toggleTheme',
        run: () => {
          const next =
            themePreference === 'light' ? 'dark' : themePreference === 'dark' ? 'system' : 'light'
          setTheme.mutate({ theme: next })
        },
      },
    ],
    [navigate, t, themePreference, setTheme],
  )

  const commandsById = useMemo(() => {
    const byId = new Map<string, { label: string; run: () => void }>()
    for (const section of SECTIONS) {
      byId.set(`nav.${section.id}`, {
        label: t(section.labelKey),
        run: () => navigate({ to: section.path }),
      })
    }
    for (const action of actions) {
      byId.set(action.id, { label: t(action.labelKey), run: action.run })
    }
    return byId
  }, [actions, t, navigate])

  const recentCommands = recentCommandIds
    .map((id) => ({ id, ...commandsById.get(id) }))
    .filter((c): c is { id: string; label: string; run: () => void } => !!c.run)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showClose={false} className="max-w-lg p-0">
        <DialogTitle className="sr-only">{t('commandPalette.placeholder')}</DialogTitle>
        <Command shouldFilter className="flex max-h-96 flex-col overflow-hidden">
          <Command.Input
            value={query}
            onValueChange={setQuery}
            placeholder={t('commandPalette.placeholder')}
            className="border-border text-text placeholder:text-muted border-b bg-transparent px-4 py-3 text-sm outline-none"
            data-testid="command-palette-input"
          />
          <Command.List className="flex-1 overflow-y-auto p-2">
            <Command.Empty className="text-muted p-4 text-center text-sm">
              {t('commandPalette.noResults')}
            </Command.Empty>
            {!query && recentCommands.length > 0 && (
              <Command.Group
                heading={t('commandPalette.recent')}
                className="[&_[cmdk-group-heading]]:text-muted [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1 [&_[cmdk-group-heading]]:text-xs"
              >
                {recentCommands.map((c) => (
                  <PaletteItem
                    key={`recent-${c.id}`}
                    commandId={c.id}
                    onSelect={() => runAndClose(c.id, c.run)}
                  >
                    {c.label}
                  </PaletteItem>
                ))}
              </Command.Group>
            )}
            <Command.Group
              heading={t('commandPalette.groupNavigate')}
              className="[&_[cmdk-group-heading]]:text-muted [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1 [&_[cmdk-group-heading]]:text-xs"
            >
              {SECTIONS.map((section) => (
                <PaletteItem
                  key={section.id}
                  commandId={`nav.${section.id}`}
                  onSelect={() =>
                    runAndClose(`nav.${section.id}`, () => navigate({ to: section.path }))
                  }
                >
                  {t(section.labelKey)}
                </PaletteItem>
              ))}
            </Command.Group>
            <Command.Group
              heading={t('commandPalette.groupActions')}
              className="[&_[cmdk-group-heading]]:text-muted [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1 [&_[cmdk-group-heading]]:text-xs"
            >
              {actions.map((action) => (
                <PaletteItem
                  key={action.id}
                  commandId={action.id}
                  onSelect={() => runAndClose(action.id, action.run)}
                >
                  {t(action.labelKey)}
                </PaletteItem>
              ))}
            </Command.Group>
          </Command.List>
        </Command>
      </DialogContent>
    </Dialog>
  )
}

function PaletteItem({
  children,
  commandId,
  onSelect,
}: {
  children: string
  commandId: string
  onSelect: () => void
}) {
  return (
    <Command.Item
      onSelect={onSelect}
      data-testid={`command-item-${commandId}`}
      className="text-text data-[selected=true]:bg-brand-100 dark:data-[selected=true]:bg-brand-900 cursor-pointer rounded-md px-2 py-2 text-sm"
    >
      {children}
    </Command.Item>
  )
}
