import type {
  ChunkSummary,
  ContextualizationEstimateDto,
  SectionDto,
  SourceDocDto,
  SourceSummary,
} from '@retenia/ipc-contract'
import {
  Badge,
  IconButton,
  ScrollArea,
  Tabs,
  TabsIndicator,
  TabsList,
  TabsPanel,
  TabsTab,
} from '@retenia/ui'
import { ArrowLeftIcon } from 'lucide-react'
import { useT } from '../../i18n/use-t'
import { SourceChunks } from './source-chunks'

export interface SourceDetailProps {
  source: SourceSummary | undefined
  /** The parser's own output — `undefined` before the source has ever finished parsing. */
  doc: SourceDocDto | undefined
  /** The chunks sub-phase 6.2 cut from it, and how many there are in total. */
  chunks: readonly ChunkSummary[]
  chunkTotal: number
  estimate: ContextualizationEstimateDto | undefined
  excludeFrontmatter: boolean
  onExcludeFrontmatterChange: (value: boolean) => void
  onBack: () => void
}

function SectionNode({
  section,
  doc,
  depth,
}: {
  section: SectionDto
  doc: SourceDocDto
  depth: number
}) {
  const blocks = section.blocks
    .map((id) => doc.blocks.find((b) => b.id === id))
    .filter((b) => b !== undefined)

  return (
    <li>
      <details open={depth < 2} className="group">
        <summary className="text-text cursor-pointer text-sm font-medium marker:content-none">
          {section.title}
        </summary>
        <div className="mt-1 flex flex-col gap-2 border-l border-border pl-3">
          {blocks.map((block) => (
            <div key={block.id} className="flex flex-col gap-0.5">
              <span className="text-muted text-[10px] tracking-wide uppercase">{block.type}</span>
              <p className="text-text text-sm whitespace-pre-wrap">{block.text}</p>
            </div>
          ))}
          {section.children.length > 0 && (
            <ul className="flex flex-col gap-2">
              {section.children.map((child) => (
                <SectionNode key={child.id} section={child} doc={doc} depth={depth + 1} />
              ))}
            </ul>
          )}
        </div>
      </details>
    </li>
  )
}

/**
 * A source's own content, two ways: the parser's section tree read straight from the
 * `SourceDoc` blob (sub-phase 6.1), and the chunks the structural chunker cut from it
 * (sub-phase 6.2) — the ones retrieval and citations use.
 */
export function SourceDetail({
  source,
  doc,
  chunks,
  chunkTotal,
  estimate,
  excludeFrontmatter,
  onExcludeFrontmatterChange,
  onBack,
}: SourceDetailProps) {
  const t = useT('library')

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="flex items-center gap-2">
        <IconButton variant="ghost" size="sm" aria-label={t('detail.backToList')} onClick={onBack}>
          <ArrowLeftIcon />
        </IconButton>
        <h2 className="text-text truncate text-lg font-semibold">{source?.title}</h2>
      </div>

      {source?.meta?.needsOcr && <Badge variant="incorrect">{t('needsOcr')}</Badge>}

      {doc === undefined ? (
        <p className="text-muted text-sm">{t('detail.notParsedYet')}</p>
      ) : (
        <>
          {doc.meta.warnings.length > 0 && (
            <div className="border-border rounded-md border p-3">
              <p className="text-text text-xs font-medium">{t('detail.warnings')}</p>
              <ul className="text-muted list-inside list-disc text-xs">
                {doc.meta.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            </div>
          )}

          <Tabs defaultValue="sections" className="flex min-h-0 flex-1 flex-col gap-3">
            <TabsList className="self-start">
              <TabsIndicator />
              <TabsTab value="sections">{t('detail.sections')}</TabsTab>
              <TabsTab value="chunks">{t('chunks.title')}</TabsTab>
            </TabsList>

            <TabsPanel value="sections" className="flex min-h-0 flex-1 flex-col">
              <ScrollArea className="min-h-0 flex-1">
                {doc.sections.length === 0 ? (
                  <p className="text-muted text-sm">{t('detail.noSections')}</p>
                ) : (
                  <ul className="flex flex-col gap-3 pb-6">
                    {doc.sections.map((section) => (
                      <SectionNode key={section.id} section={section} doc={doc} depth={0} />
                    ))}
                  </ul>
                )}
              </ScrollArea>
            </TabsPanel>

            <TabsPanel value="chunks" className="flex min-h-0 flex-1 flex-col">
              <SourceChunks
                chunks={chunks}
                total={chunkTotal}
                unitCount={source?.meta?.unitCount ?? 0}
                estimate={estimate}
                excludeFrontmatter={excludeFrontmatter}
                onExcludeFrontmatterChange={onExcludeFrontmatterChange}
              />
            </TabsPanel>
          </Tabs>
        </>
      )}
    </div>
  )
}
