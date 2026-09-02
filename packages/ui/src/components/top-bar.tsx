import { SearchIcon } from 'lucide-react'
import { cn } from '../lib/cn'
import { Badge } from './badge'
import { Button } from './button'

export interface Breadcrumb {
  label: string
}

export interface TopBarProps {
  breadcrumbs: Breadcrumb[]
  onSearchClick: () => void
  searchLabel: string
  /** XP badge content (e.g. "1,240 XP"); omit or hide it entirely in sober mode
   * (`docs/spec/08-ux.md` §4 "Sober mode": XP is one of the things it hides). */
  xpLabel?: string
  xpHidden?: boolean
  className?: string
}

/** Breadcrumb + global search trigger. Presentational — `apps/desktop` derives the
 * breadcrumb from the router's matched routes and opens the command palette on click. */
export function TopBar({
  breadcrumbs,
  onSearchClick,
  searchLabel,
  xpLabel,
  xpHidden,
  className,
}: TopBarProps) {
  return (
    <header
      className={cn(
        'border-border bg-surface flex h-14 shrink-0 items-center gap-4 border-b px-4',
        className,
      )}
    >
      <nav aria-label="Breadcrumb" className="min-w-0 flex-1">
        <ol className="text-muted flex items-center gap-1.5 truncate text-sm">
          {breadcrumbs.map((crumb, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: breadcrumb order is stable within one render, labels alone are not guaranteed unique
            <li key={index} className="flex items-center gap-1.5">
              {index > 0 && <span aria-hidden="true">/</span>}
              <span className={cn(index === breadcrumbs.length - 1 && 'text-text font-medium')}>
                {crumb.label}
              </span>
            </li>
          ))}
        </ol>
      </nav>
      {xpLabel && !xpHidden && (
        <Badge variant="xp" data-testid="xp-badge">
          {xpLabel}
        </Badge>
      )}
      <Button
        variant="outline"
        size="sm"
        onClick={onSearchClick}
        data-testid="open-command-palette"
      >
        <SearchIcon />
        {searchLabel}
      </Button>
    </header>
  )
}
