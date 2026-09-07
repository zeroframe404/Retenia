import { ErrorState, IconButton, Input, ScrollArea, Skeleton, Toolbar } from '@retenia/ui'
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  ListIcon,
  SearchIcon,
  ZoomInIcon,
  ZoomOutIcon,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createReaderShortcutHandler } from '../annotate/reader-shortcuts'
import { SelectionToolbar } from '../annotate/selection-toolbar'
import type { PDFDocumentProxy } from './pdf-engine'
import { loadPdfDocument } from './pdf-engine'
import { PdfPage } from './pdf-page'
import { findMatches, stepMatch } from './pdf-search'
import { selectionToPdfSelection } from './pdf-selection'
import { PdfThumbnails } from './pdf-thumbnails'
import type { PdfReaderProps, PdfSearchMatch, PdfTextSelection } from './types'

const MIN_SCALE = 0.5
const MAX_SCALE = 3
const SCALE_STEP = 0.25
const DEFAULT_SCALE = 1.2

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; pdf: PDFDocumentProxy; pageCount: number }
  | { status: 'error' }

/**
 * The PDF half of "Biblioteca de fuentes" (`docs/spec/08-ux.md` §2): viewer, zoom, page
 * thumbnails, in-document search, real selectable text (pdf.js's own `TextLayer`), and the
 * highlight → item flow via the shared `SelectionToolbar`.
 *
 * Every page renders at once rather than through a virtualized viewport. That is a real
 * scope decision, not an oversight: pdf.js's own render cost is dominated by page count for
 * documents in the hundreds of pages, which is the range `docs/spec/05-ingestion-rag.md`'s
 * "300-page book" sizing targets, and a virtualized scroller (`react-window` or hand-rolled)
 * is meaningfully more code for a win that only shows up well past that — worth doing when a
 * real multi-thousand-page source makes it a problem, not before.
 */
export function PdfReader({
  src,
  highlights,
  labels,
  initialPage,
  onPageChange,
  onHighlight,
  onCreateCard,
  onAskAi,
  onCopyWithCitation,
}: PdfReaderProps) {
  const [state, setState] = useState<LoadState>({ status: 'loading' })
  const [scale, setScale] = useState(DEFAULT_SCALE)
  const [currentPage, setCurrentPage] = useState(initialPage ?? 1)
  const [pageInput, setPageInput] = useState(String(initialPage ?? 1))
  const [showThumbnails, setShowThumbnails] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [currentMatchIndex, setCurrentMatchIndex] = useState(-1)
  const [selection, setSelection] = useState<PdfTextSelection | null>(null)

  const pageTexts = useRef(new Map<number, string>())
  const [textVersion, setTextVersion] = useState(0)
  const pageRefs = useRef(new Map<number, HTMLDivElement>())

  useEffect(() => {
    let cancelled = false
    let loaded: PDFDocumentProxy | null = null
    setState({ status: 'loading' })
    loadPdfDocument(src)
      .then((pdf) => {
        // A `src` change (switching sources) or unmount while the load was in flight: the
        // document this effect asked for is no longer wanted, so it is torn down immediately
        // rather than left to whatever the next `PdfReader` happens to do with it.
        if (cancelled) {
          void pdf.loadingTask.destroy()
          return
        }
        loaded = pdf
        setState({ status: 'ready', pdf, pageCount: pdf.numPages })
      })
      .catch(() => {
        if (!cancelled) setState({ status: 'error' })
      })
    return () => {
      cancelled = true
      void loaded?.loadingTask.destroy()
    }
  }, [src])

  const onTextExtracted = useCallback((pageNumber: number, text: string) => {
    pageTexts.current.set(pageNumber, text)
    setTextVersion((v) => v + 1)
  }, [])

  // biome-ignore lint/correctness/useExhaustiveDependencies: textVersion is a recompute trigger, not a value the callback reads — it forces the search index to refresh once more pages have extracted their text into pageTexts.current.
  const matches: PdfSearchMatch[] = useMemo(
    () => (searchOpen ? findMatches(pageTexts.current, searchQuery) : []),
    [searchOpen, searchQuery, textVersion],
  )

  const goToPage = useCallback((page: number, pageCount: number) => {
    const clamped = Math.max(1, Math.min(pageCount, page))
    setCurrentPage(clamped)
    setPageInput(String(clamped))
    pageRefs.current.get(clamped)?.scrollIntoView({ block: 'start' })
  }, [])

  // biome-ignore lint/correctness/useExhaustiveDependencies: onPageChange is read at call time, not tracked as a re-run trigger — including it would fire again whenever the caller passes a new closure for the same page.
  useEffect(() => {
    if (state.status === 'ready') onPageChange?.(currentPage)
  }, [currentPage, state.status])

  // biome-ignore lint/correctness/useExhaustiveDependencies: only on the document becoming ready, not on every initialPage/goToPage identity change — a deep link opens to a page, it does not keep following one.
  useEffect(() => {
    if (state.status !== 'ready' || initialPage === undefined) return
    goToPage(initialPage, state.pageCount)
  }, [state.status])

  const jumpToMatch = useCallback(
    (index: number) => {
      const match = matches[index]
      if (match === undefined || state.status !== 'ready') return
      setCurrentMatchIndex(index)
      goToPage(match.page, state.pageCount)
    },
    [matches, state, goToPage],
  )

  const findHost = useCallback((node: Node) => {
    const element = node instanceof Element ? node : node.parentElement
    const pageEl = element?.closest<HTMLElement>('[data-page]')
    const pageAttr = pageEl?.dataset.page
    if (pageEl === undefined || pageEl === null || pageAttr === undefined) return null
    return { pageNumber: Number(pageAttr), containerRect: pageEl.getBoundingClientRect() }
  }, [])

  const onSelectionChange = useCallback(() => {
    const next = selectionToPdfSelection(window.getSelection(), findHost)
    setSelection(next)
  }, [findHost])

  useEffect(() => {
    document.addEventListener('selectionchange', onSelectionChange)
    return () => document.removeEventListener('selectionchange', onSelectionChange)
  }, [onSelectionChange])

  const clearSelection = useCallback(() => {
    window.getSelection()?.removeAllRanges()
    setSelection(null)
  }, [])

  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    const onKeyDown = createReaderShortcutHandler({
      onNextPage: () => state.status === 'ready' && goToPage(currentPage + 1, state.pageCount),
      onPrevPage: () => state.status === 'ready' && goToPage(currentPage - 1, state.pageCount),
      onHighlight: () => {
        if (selection === null) return
        onHighlight?.(selection)
        clearSelection()
      },
      onCreateCard: () => {
        if (selection === null) return
        onCreateCard?.(selection)
        clearSelection()
      },
    })
    root.addEventListener('keydown', onKeyDown)
    return () => root.removeEventListener('keydown', onKeyDown)
  }, [state, currentPage, goToPage, selection, onHighlight, onCreateCard, clearSelection])

  if (state.status === 'loading') {
    return (
      <div className="flex h-full flex-col gap-3 p-4">
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-full w-full" />
      </div>
    )
  }
  if (state.status === 'error') {
    return <ErrorState title={labels.loadError} />
  }

  const { pdf, pageCount } = state

  return (
    <div ref={rootRef} className="flex h-full flex-col">
      <Toolbar
        start={
          <>
            <IconButton
              variant="ghost"
              size="sm"
              aria-label={labels.thumbnails}
              aria-pressed={showThumbnails}
              onClick={() => setShowThumbnails((value) => !value)}
            >
              <ListIcon />
            </IconButton>
            <IconButton
              variant="ghost"
              size="sm"
              aria-label={labels.zoomOut}
              onClick={() => setScale((value) => Math.max(MIN_SCALE, value - SCALE_STEP))}
            >
              <ZoomOutIcon />
            </IconButton>
            <IconButton
              variant="ghost"
              size="sm"
              aria-label={labels.zoomIn}
              onClick={() => setScale((value) => Math.min(MAX_SCALE, value + SCALE_STEP))}
            >
              <ZoomInIcon />
            </IconButton>
          </>
        }
        end={
          <IconButton
            variant="ghost"
            size="sm"
            aria-label={labels.searchPlaceholder}
            aria-pressed={searchOpen}
            onClick={() => setSearchOpen((value) => !value)}
          >
            <SearchIcon />
          </IconButton>
        }
      >
        <IconButton
          variant="ghost"
          size="sm"
          aria-label={labels.pageOf(currentPage - 1, pageCount)}
          disabled={currentPage <= 1}
          onClick={() => goToPage(currentPage - 1, pageCount)}
        >
          <ChevronLeftIcon />
        </IconButton>
        <Input
          aria-label={labels.pageInputLabel}
          value={pageInput}
          onChange={(event) => setPageInput(event.target.value)}
          onBlur={() => goToPage(Number(pageInput) || currentPage, pageCount)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') goToPage(Number(pageInput) || currentPage, pageCount)
          }}
          className="w-14 text-center"
        />
        <span className="text-muted text-xs">{labels.pageOf(currentPage, pageCount)}</span>
        <IconButton
          variant="ghost"
          size="sm"
          aria-label={labels.pageOf(currentPage + 1, pageCount)}
          disabled={currentPage >= pageCount}
          onClick={() => goToPage(currentPage + 1, pageCount)}
        >
          <ChevronRightIcon />
        </IconButton>
      </Toolbar>

      {searchOpen && (
        <div className="border-border flex items-center gap-2 border-b p-2">
          <Input
            autoFocus
            aria-label={labels.searchPlaceholder}
            placeholder={labels.searchPlaceholder}
            value={searchQuery}
            onChange={(event) => {
              setSearchQuery(event.target.value)
              setCurrentMatchIndex(-1)
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter')
                jumpToMatch(stepMatch(matches.length, currentMatchIndex, 1))
            }}
            className="max-w-xs"
          />
          <span className="text-muted text-xs tabular-nums">
            {matches.length === 0
              ? labels.noMatches
              : labels.matchOf(currentMatchIndex + 1, matches.length)}
          </span>
          <IconButton
            variant="ghost"
            size="sm"
            aria-label={labels.searchPrev}
            disabled={matches.length === 0}
            onClick={() => jumpToMatch(stepMatch(matches.length, currentMatchIndex, -1))}
          >
            <ChevronLeftIcon />
          </IconButton>
          <IconButton
            variant="ghost"
            size="sm"
            aria-label={labels.searchNext}
            disabled={matches.length === 0}
            onClick={() => jumpToMatch(stepMatch(matches.length, currentMatchIndex, 1))}
          >
            <ChevronRightIcon />
          </IconButton>
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        {showThumbnails && (
          <div className="border-border w-36 shrink-0 border-r">
            <PdfThumbnails
              pdf={pdf}
              pageCount={pageCount}
              currentPage={currentPage}
              onSelectPage={(page) => goToPage(page, pageCount)}
              label={labels.thumbnails}
            />
          </div>
        )}

        <ScrollArea className="min-h-0 flex-1">
          <PdfPages
            pdf={pdf}
            pageCount={pageCount}
            scale={scale}
            highlights={highlights}
            onTextExtracted={onTextExtracted}
            registerPageRef={(page, element) => {
              if (element) pageRefs.current.set(page, element)
              else pageRefs.current.delete(page)
            }}
          />
        </ScrollArea>
      </div>

      {selection !== null && (
        <SelectionToolbar
          labels={labels.selectionToolbar}
          position={selection.toolbarPosition}
          onHighlight={() => {
            onHighlight?.(selection)
            clearSelection()
          }}
          onCreateCard={() => {
            onCreateCard?.(selection)
            clearSelection()
          }}
          {...(onAskAi === undefined
            ? {}
            : {
                onAskAi: () => {
                  onAskAi(selection)
                  clearSelection()
                },
              })}
          onCopyWithCitation={() => {
            onCopyWithCitation?.(selection)
            clearSelection()
          }}
        />
      )}
    </div>
  )
}

interface PdfPagesProps {
  pdf: PDFDocumentProxy
  pageCount: number
  scale: number
  highlights: PdfReaderProps['highlights']
  onTextExtracted: (pageNumber: number, text: string) => void
  registerPageRef: (page: number, element: HTMLDivElement | null) => void
}

/** Loads and renders every page in order. Split out from `PdfReader` so each page's own
 *  `PDFPageProxy` fetch (`pdf.getPage`) is a single effect per page, not re-run on every
 *  zoom/search keystroke in the parent. */
function PdfPages({
  pdf,
  pageCount,
  scale,
  highlights,
  onTextExtracted,
  registerPageRef,
}: PdfPagesProps) {
  const [pages, setPages] = useState<
    ReadonlyMap<number, Awaited<ReturnType<PDFDocumentProxy['getPage']>>>
  >(new Map())

  useEffect(() => {
    let cancelled = false
    void Promise.all(Array.from({ length: pageCount }, (_, index) => pdf.getPage(index + 1))).then(
      (loaded) => {
        if (cancelled) return
        setPages(new Map(loaded.map((page, index) => [index + 1, page])))
      },
    )
    return () => {
      cancelled = true
    }
  }, [pdf, pageCount])

  return (
    <>
      {Array.from({ length: pageCount }, (_, index) => index + 1).map((pageNumber) => {
        const page = pages.get(pageNumber)
        return (
          <div key={pageNumber} ref={(element) => registerPageRef(pageNumber, element)}>
            {page !== undefined && (
              <PdfPage
                page={page}
                pageNumber={pageNumber}
                scale={scale}
                highlights={highlights}
                onTextExtracted={onTextExtracted}
              />
            )}
          </div>
        )
      })}
    </>
  )
}
