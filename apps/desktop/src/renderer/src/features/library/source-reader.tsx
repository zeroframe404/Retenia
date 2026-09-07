import type { AnnotationDto } from '@retenia/ipc-contract'
import type {
  DetectedQuestion,
  EpubHighlight,
  EpubTextSelection,
  FractionalRect,
  PdfHighlight,
  PdfTextSelection,
  QuestionPanelLabels,
} from '@retenia/readers'
import {
  detectQuestions,
  EpubReader,
  PdfReader,
  QuestionPanel,
  ReaderSplitView,
} from '@retenia/readers'
import { Button, EmptyState, ScrollArea, SegmentedControl, toast } from '@retenia/ui'
import { useMemo, useState } from 'react'
import { useT } from '../../i18n/use-t'
import { CardComposer } from './card-composer'
import {
  useAnnotations,
  useCreateAnnotation,
  useCreateCardFromAnnotation,
  useDeleteAnnotation,
  useRecordProgress,
} from './use-annotations'
import { useSourceDoc } from './use-library'

/** Mirrors `MEDIA_SCHEME`/`MEDIA_BLOB_HOST` in main's protocol handler — the same helper
 *  `source-media.tsx` has, restated here because the renderer shares no module with main. */
function mediaUrl(sha256: string, ext: string): string {
  return `media://blob/${sha256}.${ext}`
}

function isPdfAnchor(
  anchor: AnnotationDto['anchor'],
): anchor is { page: number; rects: FractionalRect[] } {
  return 'page' in anchor && 'rects' in anchor
}

function isEpubAnchor(anchor: AnnotationDto['anchor']): anchor is { cfi: string } {
  return 'cfi' in anchor && !('page' in anchor)
}

interface CurrentLocator {
  page?: number
  cfi?: string
}

interface PendingCard {
  annotationId: string
  citation: string
  back: string
}

export interface SourceReaderProps {
  sourceId: string
  kind: 'pdf' | 'epub'
  title: string
  /** The source's own file — `library.getSource`'s `blobSha256`, `null` before it has ever
   *  ingested (in which case there is nothing to read yet). */
  blobSha256: string | null
  /** Where to open: `library.getSource`'s `lastLocator`, or a deep link's page/CFI. */
  initialLocator?: CurrentLocator
}

/**
 * The connected reader (sub-phase 6.6): DTOs and IPC mutations in, `@retenia/readers`' pure
 * `PdfReader`/`EpubReader` out, with a highlights/questions panel on the right
 * (`ReaderSplitView`). Mirrors `source-media.tsx`'s role for `MediaPlayer` — the mapping lives
 * here because `packages/readers` may depend only on `core` and `ui`
 * (`tooling/scripts/check-deps.mjs`), which keeps the readers renderable from a Storybook
 * story with no IPC bridge behind them.
 */
export function SourceReader({
  sourceId,
  kind,
  title,
  blobSha256,
  initialLocator,
}: SourceReaderProps) {
  const t = useT('library')
  const annotationsQuery = useAnnotations(sourceId)
  const docQuery = useSourceDoc(sourceId)
  const createAnnotation = useCreateAnnotation(sourceId)
  const deleteAnnotation = useDeleteAnnotation(sourceId)
  const createCard = useCreateCardFromAnnotation()
  const recordProgress = useRecordProgress()

  const [currentLocator, setCurrentLocator] = useState<CurrentLocator>(initialLocator ?? {})
  const [pending, setPending] = useState<PendingCard | undefined>()
  const [panelView, setPanelView] = useState<'highlights' | 'questions'>('highlights')

  const annotations = annotationsQuery.data?.annotations ?? []
  const highlights = annotations.filter((a) => a.kind === 'highlight')

  const pdfHighlights: PdfHighlight[] = useMemo(
    () =>
      highlights
        .filter((a): a is AnnotationDto & { anchor: { page: number; rects: FractionalRect[] } } =>
          isPdfAnchor(a.anchor),
        )
        .map((a) => ({
          id: a.id,
          page: a.anchor.page,
          rects: a.anchor.rects,
          color: a.color ?? 'rgba(250, 204, 21, 0.45)',
        })),
    [highlights],
  )

  const epubHighlights: EpubHighlight[] = useMemo(
    () =>
      highlights
        .filter((a): a is AnnotationDto & { anchor: { cfi: string } } => isEpubAnchor(a.anchor))
        .map((a) => ({
          id: a.id,
          cfi: a.anchor.cfi,
          color: a.color ?? 'rgba(250, 204, 21, 0.45)',
        })),
    [highlights],
  )

  function citationFor(locator: CurrentLocator): string {
    return kind === 'pdf' && locator.page !== undefined
      ? t('reader.citationPage', { title, page: locator.page })
      : t('reader.citationSource', { title })
  }

  function openComposer(annotationId: string, quote: string, locator: CurrentLocator) {
    setPending({ annotationId, citation: citationFor(locator), back: quote })
  }

  function handlePdfHighlight(selection: PdfTextSelection) {
    createAnnotation.mutate(
      {
        sourceId,
        kind: 'highlight',
        anchor: { page: selection.page, rects: selection.rects },
        quote: selection.quote,
      },
      { onError: (error) => toast.error(error.message) },
    )
  }

  function handlePdfCreateCard(selection: PdfTextSelection) {
    createAnnotation.mutate(
      {
        sourceId,
        kind: 'highlight',
        anchor: { page: selection.page, rects: selection.rects },
        quote: selection.quote,
      },
      {
        onSuccess: (result) =>
          openComposer(result.annotation.id, selection.quote, { page: selection.page }),
        onError: (error) => toast.error(error.message),
      },
    )
  }

  function handlePdfCopyWithCitation(selection: PdfTextSelection) {
    void copyWithCitation(selection.quote, citationFor({ page: selection.page }))
  }

  function handleEpubHighlight(selection: EpubTextSelection) {
    createAnnotation.mutate(
      { sourceId, kind: 'highlight', anchor: { cfi: selection.cfi }, quote: selection.quote },
      { onError: (error) => toast.error(error.message) },
    )
  }

  function handleEpubCreateCard(selection: EpubTextSelection) {
    createAnnotation.mutate(
      { sourceId, kind: 'highlight', anchor: { cfi: selection.cfi }, quote: selection.quote },
      {
        onSuccess: (result) =>
          openComposer(result.annotation.id, selection.quote, { cfi: selection.cfi }),
        onError: (error) => toast.error(error.message),
      },
    )
  }

  function handleEpubCopyWithCitation(selection: EpubTextSelection) {
    void copyWithCitation(selection.quote, citationFor({ cfi: selection.cfi }))
  }

  async function copyWithCitation(quote: string, citation: string) {
    try {
      await navigator.clipboard.writeText(`${quote}\n\n— ${citation}`)
      toast.success(t('reader.citationCopied'))
    } catch {
      toast.error(t('reader.citationCopyFailed'))
    }
  }

  function submitCard(input: { front: string; back: string }) {
    if (!pending) return
    createCard.mutate(
      { annotationId: pending.annotationId, front: input.front, back: input.back },
      {
        onSuccess: () => {
          toast.success(t('reader.cardCreated'))
          setPending(undefined)
        },
        onError: (error) => toast.error(error.message),
      },
    )
  }

  const questionBlocks = useMemo(() => {
    const blocks = docQuery.data?.doc?.blocks ?? []
    // A PDF's blocks carry their own page: the panel scopes candidates to the page being read,
    // rather than the whole book at once. An EPUB block's locator is a parse-time chapter/element
    // offset with no live-DOM equivalent (`packages/ingest/src/parsers/epub.ts`), so its
    // candidates are not narrowed the same way.
    if (kind === 'pdf' && currentLocator.page !== undefined) {
      return blocks.filter((block) => block.locator.page === currentLocator.page)
    }
    return blocks
  }, [docQuery.data, kind, currentLocator.page])

  const questions = useMemo(
    () => detectQuestions(questionBlocks.map((block) => ({ id: block.id, text: block.text }))),
    [questionBlocks],
  )

  function handleConvertQuestion(question: DetectedQuestion) {
    const anchor =
      kind === 'pdf'
        ? { page: currentLocator.page ?? 1, rects: [] }
        : currentLocator.cfi === undefined
          ? undefined
          : { cfi: currentLocator.cfi }
    if (anchor === undefined) {
      toast.error(t('reader.panel.convertUnavailable'))
      return
    }
    createAnnotation.mutate(
      { sourceId, kind: 'highlight', anchor, quote: question.text },
      {
        onSuccess: (result) => openComposer(result.annotation.id, question.text, currentLocator),
        onError: (error) => toast.error(error.message),
      },
    )
  }

  const questionPanelLabels: QuestionPanelLabels = {
    title: t('reader.panel.questionsTab'),
    convert: t('reader.panel.convert'),
    empty: t('reader.panel.questionsEmpty'),
    kindLabel: (matchKind) => t(`reader.panel.questionKind.${matchKind}`),
  }

  const panel = (
    <div className="flex h-full flex-col gap-3 p-3">
      <SegmentedControl<'highlights' | 'questions'>
        value={panelView}
        onValueChange={setPanelView}
        options={[
          { value: 'highlights', label: t('reader.panel.highlightsTab') },
          { value: 'questions', label: t('reader.panel.questionsTab') },
        ]}
        aria-label={t('reader.panel.viewLabel')}
      />

      <ScrollArea className="min-h-0 flex-1">
        {panelView === 'highlights' ? (
          highlights.length === 0 ? (
            <EmptyState title={t('reader.panel.highlightsEmpty')} />
          ) : (
            <ul className="flex flex-col gap-2">
              {highlights.map((highlight) => (
                <li
                  key={highlight.id}
                  className="border-border flex flex-col gap-1.5 rounded-md border p-2"
                >
                  <p className="text-text text-sm whitespace-pre-wrap">{highlight.quote}</p>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        openComposer(
                          highlight.id,
                          highlight.quote ?? '',
                          isPdfAnchor(highlight.anchor) ? { page: highlight.anchor.page } : {},
                        )
                      }
                    >
                      {t('reader.panel.createCard')}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => deleteAnnotation.mutate({ id: highlight.id })}
                    >
                      {t('reader.panel.delete')}
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )
        ) : (
          <QuestionPanel
            questions={questions}
            labels={questionPanelLabels}
            onConvert={handleConvertQuestion}
          />
        )}
      </ScrollArea>
    </div>
  )

  if (blobSha256 === null) {
    return <p className="text-muted text-sm">{t('reader.notReady')}</p>
  }

  const src = mediaUrl(blobSha256, kind)

  const reader =
    kind === 'pdf' ? (
      <PdfReader
        src={src}
        title={title}
        highlights={pdfHighlights}
        labels={{
          pageOf: (page, total) => t('reader.pageOf', { page, total }),
          pageInputLabel: t('reader.pageInputLabel'),
          zoomIn: t('reader.zoomIn'),
          zoomOut: t('reader.zoomOut'),
          zoomReset: t('reader.zoomReset'),
          fitWidth: t('reader.fitWidth'),
          thumbnails: t('reader.thumbnails'),
          searchPlaceholder: t('reader.searchPlaceholder'),
          searchNext: t('reader.searchNext'),
          searchPrev: t('reader.searchPrev'),
          matchOf: (index, total) => t('reader.matchOf', { index, total }),
          noMatches: t('reader.noMatches'),
          loading: t('reader.loading'),
          loadError: t('reader.loadErrorPdf'),
          detectQuestions: t('reader.detectQuestions'),
          selectionToolbar: {
            highlight: t('reader.selectionToolbar.highlight'),
            createCard: t('reader.selectionToolbar.createCard'),
            askAi: t('reader.selectionToolbar.askAi'),
            copyWithCitation: t('reader.selectionToolbar.copyWithCitation'),
          },
        }}
        {...(currentLocator.page === undefined ? {} : { initialPage: currentLocator.page })}
        onPageChange={(page) => {
          setCurrentLocator({ page })
          recordProgress.mutate({ sourceId, locator: { page } })
        }}
        onHighlight={handlePdfHighlight}
        onCreateCard={handlePdfCreateCard}
        onCopyWithCitation={handlePdfCopyWithCitation}
      />
    ) : (
      <EpubReader
        src={src}
        title={title}
        highlights={epubHighlights}
        labels={{
          sectionOf: (index, total) => t('reader.sectionOf', { index, total }),
          tableOfContents: t('reader.tableOfContents'),
          searchPlaceholder: t('reader.searchPlaceholder'),
          searchNext: t('reader.searchNext'),
          searchPrev: t('reader.searchPrev'),
          matchOf: (index, total) => t('reader.matchOf', { index, total }),
          noMatches: t('reader.noMatches'),
          loading: t('reader.loading'),
          loadError: t('reader.loadErrorEpub'),
          detectQuestions: t('reader.detectQuestions'),
          selectionToolbar: {
            highlight: t('reader.selectionToolbar.highlight'),
            createCard: t('reader.selectionToolbar.createCard'),
            askAi: t('reader.selectionToolbar.askAi'),
            copyWithCitation: t('reader.selectionToolbar.copyWithCitation'),
          },
        }}
        {...(currentLocator.cfi === undefined ? {} : { initialCfi: currentLocator.cfi })}
        onLocationChange={(cfi) => {
          setCurrentLocator({ cfi })
          recordProgress.mutate({ sourceId, locator: { cfi } })
        }}
        onHighlight={handleEpubHighlight}
        onCreateCard={handleEpubCreateCard}
        onCopyWithCitation={handleEpubCopyWithCitation}
      />
    )

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ReaderSplitView reader={reader} panel={panel} panelLabel={t('reader.panel.viewLabel')} />
      {pending && (
        <CardComposer
          open
          onOpenChange={(open) => {
            if (!open) setPending(undefined)
          }}
          citation={pending.citation}
          initialBack={pending.back}
          onSubmit={submitCard}
          submitting={createCard.isPending}
        />
      )}
    </div>
  )
}
