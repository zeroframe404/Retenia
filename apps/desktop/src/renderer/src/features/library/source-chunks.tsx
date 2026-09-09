import type { ChunkSummary, ContextualizationEstimateDto } from '@retenia/ipc-contract'
import { AiUnavailableNotice, Badge, ScrollArea, Switch } from '@retenia/ui'
import { useT } from '../../i18n/use-t'

/**
 * A source's chunks — what retrieval and citations actually use, as opposed to the parser's
 * raw blocks (sub-phase 6.2, `docs/spec/05-ingestion-rag.md` §4).
 *
 * The "improved index" row is the one §4.2 asks for by name: *"optional contextualization
 * (toggle 'improved index' **with the cost shown**)"*. The cost is quoted before anything can
 * be switched on, and it counts only the chunks that still have no context, so a second look
 * after a partial run quotes what is left rather than the whole book again. The switch itself
 * stays disabled until sub-phase 7.1 configures a provider for the `cheap` role — an honest
 * "not yet" beats a button that fails when pressed.
 */

export interface SourceChunksProps {
  chunks: readonly ChunkSummary[]
  total: number
  unitCount: number
  estimate: ContextualizationEstimateDto | undefined
  excludeFrontmatter: boolean
  onExcludeFrontmatterChange: (value: boolean) => void
  /**
   * Whether an AI provider for the `cheap` role exists. Still false.
   *
   * Sub-phase 7.1 wired the provider in *main* — `LibraryService.contextualize` works and no
   * longer throws — but nothing here can turn it on yet, for two reasons: there is no screen
   * on which a user can enter an API key (7.5), and the `<Switch>` below has no
   * `onCheckedChange`, so setting this true would ship a control that looks clickable and
   * does nothing. Enabling it needs a `library.contextualize` channel and its handler
   * alongside the settings screen; an honest disabled control beats a live no-op.
   */
  contextualizationAvailable?: boolean
}

/** Two decimals, and never `0.00` for something that does cost money — the point of showing a
 *  price is that the user can trust it. */
function formatUsd(usd: number): string {
  if (usd === 0) return '0.00'
  return usd < 0.01 ? '<0.01' : usd.toFixed(2)
}

function ChunkRow({ chunk }: { chunk: ChunkSummary }) {
  const t = useT('library')
  return (
    <li className="border-border flex flex-col gap-1 border-b py-2 last:border-b-0">
      <div className="flex items-center gap-2">
        <span className="text-muted font-mono text-[10px]">#{chunk.ordinal + 1}</span>
        {chunk.label !== null && (
          <span className="text-muted text-[10px] tracking-wide uppercase">{chunk.label}</span>
        )}
        {chunk.isFrontmatter && <Badge variant="neutral">{t('chunks.frontmatter')}</Badge>}
        <span className="text-muted ml-auto text-[10px]">{chunk.tokenCount} tok</span>
      </div>
      {chunk.headingPath !== null && (
        <p className="text-muted truncate text-xs">{chunk.headingPath}</p>
      )}
      {chunk.context !== null && (
        <p className="text-muted border-border border-l-2 pl-2 text-xs italic">{chunk.context}</p>
      )}
      <p className="text-text line-clamp-4 text-sm whitespace-pre-wrap">{chunk.text}</p>
    </li>
  )
}

export function SourceChunks({
  chunks,
  total,
  unitCount,
  estimate,
  excludeFrontmatter,
  onExcludeFrontmatterChange,
  contextualizationAvailable = false,
}: SourceChunksProps) {
  const t = useT('library')

  if (total === 0 && chunks.length === 0 && !excludeFrontmatter) {
    return <p className="text-muted text-sm">{t('chunks.notChunkedYet')}</p>
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex items-center gap-3">
        <h3 className="text-muted text-xs font-semibold tracking-wide uppercase">
          {t('chunks.title')}
        </h3>
        <span className="text-muted text-xs">
          {t('chunks.summary', { chunks: total, units: unitCount })}
        </span>
        <span className="text-muted ml-auto flex items-center gap-2 text-xs">
          <Switch
            id="chunks-hide-frontmatter"
            checked={excludeFrontmatter}
            onCheckedChange={onExcludeFrontmatterChange}
            aria-label={t('chunks.hideFrontmatter')}
          />
          <span aria-hidden="true">{t('chunks.hideFrontmatter')}</span>
        </span>
      </div>

      <div className="border-border flex items-start gap-3 rounded-md border p-3">
        <Switch
          checked={false}
          disabled={!contextualizationAvailable}
          aria-label={t('chunks.improvedIndexTitle')}
        />
        <div className="flex flex-col gap-0.5">
          <p className="text-text text-xs font-medium">{t('chunks.improvedIndexTitle')}</p>
          <p className="text-muted text-xs">{t('chunks.improvedIndexDescription')}</p>
          <p className="text-text text-xs font-medium">
            {estimate === undefined
              ? null
              : estimate.chunkCount === 0
                ? t('chunks.improvedIndexDone')
                : t('chunks.improvedIndexEstimate', {
                    usd: formatUsd(estimate.usd),
                    chunks: estimate.chunkCount,
                  })}
          </p>
          {!contextualizationAvailable && (
            <AiUnavailableNotice reason={t('chunks.improvedIndexUnavailable')} />
          )}
        </div>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <ul className="flex flex-col pb-6">
          {chunks.map((chunk) => (
            <ChunkRow key={chunk.id} chunk={chunk} />
          ))}
        </ul>
      </ScrollArea>
    </div>
  )
}
