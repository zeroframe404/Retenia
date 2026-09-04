import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  IconButton,
  toast,
} from '@retenia/ui'
import { MoreVerticalIcon } from 'lucide-react'
import { useT } from '../../../i18n/use-t'
import { useIpcMutation } from '../../../ipc/hooks'

export interface CardActionsMenuProps {
  cardId: string
  leech: boolean
}

/** §2 screen map's "Marcar leech / bajar importancia" menu. Leech toggles `cards.setLeech`
 *  directly; lowering importance overrides the card to Maintenance (`cards.overrideImportance`
 *  already covers the general form). */
export function CardActionsMenu({ cardId, leech }: CardActionsMenuProps) {
  const t = useT('review')
  const setLeech = useIpcMutation('cards.setLeech', {
    onSuccess: () =>
      toast.success(leech ? t('screen.menu.unmarkLeech') : t('screen.menu.markLeech')),
  })
  const lowerImportance = useIpcMutation('cards.overrideImportance', {
    onSuccess: () => toast.success(t('screen.menu.lowerImportance')),
  })

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <IconButton
            variant="ghost"
            size="sm"
            aria-label={t('screen.menu.trigger')}
            data-testid="card-menu-trigger"
          />
        }
      >
        <MoreVerticalIcon />
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuItem
          data-testid="card-menu-leech"
          onClick={() => setLeech.mutate({ ids: [cardId], leech: !leech })}
        >
          {leech ? t('screen.menu.unmarkLeech') : t('screen.menu.markLeech')}
        </DropdownMenuItem>
        <DropdownMenuItem
          data-testid="card-menu-lower-importance"
          onClick={() => lowerImportance.mutate({ ids: [cardId], level: 'maintenance' })}
        >
          {t('screen.menu.lowerImportance')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
