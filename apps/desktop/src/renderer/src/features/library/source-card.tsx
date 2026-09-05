import type { SourceKind, SourceStatus, SourceSummary } from '@retenia/ipc-contract'
import { Badge, IconButton } from '@retenia/ui'
import {
  AlertCircleIcon,
  FileTextIcon,
  ImageIcon,
  LibraryBigIcon,
  PresentationIcon,
  RotateCwIcon,
  Trash2Icon,
} from 'lucide-react'
import { useT } from '../../i18n/use-t'

/** One card per kind — the same set `library/detect-kind.ts` recognises. Audio/video/
 *  YouTube/web have no parser yet (sub-phases 6.4/6.5) so they fall back to the generic icon;
 *  nothing currently creates a source of those kinds. */
const KIND_ICON: Record<SourceKind, typeof FileTextIcon> = {
  pdf: FileTextIcon,
  docx: FileTextIcon,
  epub: LibraryBigIcon,
  pptx: PresentationIcon,
  markdown: FileTextIcon,
  text: FileTextIcon,
  image: ImageIcon,
  audio: FileTextIcon,
  video: FileTextIcon,
  youtube: FileTextIcon,
  web: FileTextIcon,
}

const STATUS_VARIANT: Record<SourceStatus, 'neutral' | 'brand' | 'correct' | 'incorrect'> = {
  pending: 'neutral',
  processing: 'brand',
  ready: 'correct',
  failed: 'incorrect',
}

export interface SourceCardProps {
  source: SourceSummary
  onOpen: (id: string) => void
  onRetry: (id: string) => void
  onDelete: (id: string) => void
}

/** One source in the Library grid: kind icon, title, status, and — for a failed parse — the
 *  error plus a retry action (sub-phase 6.1). Clicking the card opens `SourceDetail`. */
export function SourceCard({ source, onOpen, onRetry, onDelete }: SourceCardProps) {
  const t = useT('library')
  const Icon = KIND_ICON[source.kind]
  const failed = source.status === 'failed'

  return (
    <div
      data-testid={`source-card-${source.id}`}
      className="border-border bg-surface flex flex-col gap-2 rounded-lg border p-4 text-left shadow-soft"
    >
      <button
        type="button"
        onClick={() => onOpen(source.id)}
        className="flex min-w-0 flex-1 items-start gap-3 text-left"
      >
        <Icon aria-hidden="true" className="text-muted mt-0.5 size-6 shrink-0" />
        <span className="min-w-0 flex-1">
          <span className="text-text block truncate text-sm font-medium">{source.title}</span>
          {source.meta && (
            <span className="text-muted block text-xs">
              {t('summary', { blocks: source.meta.blockCount, assets: source.meta.assetCount })}
            </span>
          )}
        </span>
      </button>

      <div className="flex items-center justify-between gap-2">
        <Badge variant={STATUS_VARIANT[source.status]}>{t(`status.${source.status}`)}</Badge>
        <div className="flex items-center gap-1">
          {failed && (
            <IconButton
              variant="ghost"
              size="sm"
              aria-label={t('retry')}
              onClick={() => onRetry(source.id)}
              data-testid={`source-retry-${source.id}`}
            >
              <RotateCwIcon />
            </IconButton>
          )}
          <IconButton
            variant="ghost"
            size="sm"
            aria-label={t('delete')}
            onClick={() => onDelete(source.id)}
            data-testid={`source-delete-${source.id}`}
          >
            <Trash2Icon />
          </IconButton>
        </div>
      </div>

      {failed && source.error !== null && (
        <p className="text-incorrect flex items-start gap-1 text-xs">
          <AlertCircleIcon aria-hidden="true" className="mt-0.5 size-3 shrink-0" />
          <span>{source.error}</span>
        </p>
      )}
    </div>
  )
}
