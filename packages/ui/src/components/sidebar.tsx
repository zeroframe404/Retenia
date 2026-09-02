import type { LucideIcon } from 'lucide-react'
import { ChevronsLeftIcon, ChevronsRightIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '../lib/cn'
import { Badge } from './badge'
import { IconButton } from './button'
import { Tooltip, TooltipContent, TooltipTrigger } from './tooltip'

export interface SidebarItem {
  id: string
  label: string
  icon: LucideIcon
  /** Due-count style badge; omitted or `0` renders no badge. */
  badge?: number
  active?: boolean
}

export interface SidebarProps {
  items: SidebarItem[]
  collapsed: boolean
  onToggleCollapsed: () => void
  onSelect: (id: string) => void
  collapseLabel: string
  expandLabel: string
}

/**
 * The primary navigation (`docs/spec/08-ux.md` §2 screen map: Hoy/Camino/Repasar/…).
 * Presentational only — `apps/desktop` supplies translated labels, router-aware `onSelect`,
 * and the due-count data.
 */
export function Sidebar({
  items,
  collapsed,
  onToggleCollapsed,
  onSelect,
  collapseLabel,
  expandLabel,
}: SidebarProps) {
  return (
    <nav
      aria-label="Primary"
      className={cn(
        'bg-surface border-border flex h-full flex-col border-r transition-[width] duration-base ease-standard',
        collapsed ? 'w-16' : 'w-56',
      )}
    >
      <ul className="flex flex-1 flex-col gap-1 overflow-y-auto p-2">
        {items.map((item) => (
          <li key={item.id}>
            {collapsed ? (
              <Tooltip>
                <TooltipTrigger render={<SidebarNavButton item={item} onSelect={onSelect} />}>
                  <item.icon className="size-5 shrink-0" aria-hidden="true" />
                </TooltipTrigger>
                <TooltipContent>{item.label}</TooltipContent>
              </Tooltip>
            ) : (
              <SidebarNavButton item={item} onSelect={onSelect}>
                <item.icon className="size-5 shrink-0" aria-hidden="true" />
                <span className="flex-1 truncate text-left">{item.label}</span>
                {!!item.badge && (
                  <Badge variant={item.active ? 'brand' : 'neutral'} className="shrink-0">
                    {item.badge}
                  </Badge>
                )}
              </SidebarNavButton>
            )}
          </li>
        ))}
      </ul>
      <div className="border-border border-t p-2">
        <IconButton
          variant="ghost"
          size="sm"
          aria-label={collapsed ? expandLabel : collapseLabel}
          onClick={onToggleCollapsed}
        >
          {collapsed ? <ChevronsRightIcon /> : <ChevronsLeftIcon />}
        </IconButton>
      </div>
    </nav>
  )
}

interface SidebarNavButtonProps {
  item: SidebarItem
  onSelect: (id: string) => void
  children?: ReactNode
  className?: string
}

function SidebarNavButton({ item, onSelect, children, className }: SidebarNavButtonProps) {
  return (
    <button
      type="button"
      data-testid={`sidebar-item-${item.id}`}
      aria-current={item.active ? 'page' : undefined}
      onClick={() => onSelect(item.id)}
      className={cn(
        'flex h-10 w-full items-center gap-3 rounded-md px-3 text-sm font-medium transition-colors duration-fast ease-standard',
        'hover:bg-neutral-100 dark:hover:bg-neutral-800',
        item.active
          ? 'bg-brand-100 text-brand-800 dark:bg-brand-900 dark:text-brand-100'
          : 'text-text',
        className,
      )}
    >
      {children}
    </button>
  )
}
