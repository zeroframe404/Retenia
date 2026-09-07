import { ErrorState, IconButton, Input, Skeleton, Toolbar } from '@retenia/ui'
import { ChevronLeftIcon, ChevronRightIcon, SearchIcon } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { createReaderShortcutHandler } from '../annotate/reader-shortcuts'
import { SelectionToolbar } from '../annotate/selection-toolbar'
import type { EpubBook } from './epub-book'
import { openEpubBook } from './epub-book'
import { computeAnnotationCfi, resolveAnnotationCfi } from './epub-cfi'
import { clearHighlightMarks, markRange } from './epub-highlight-dom'
import type { EpubSearchMatch } from './epub-search'
import { findMatchesInSection, stepMatch } from './epub-search'
import type { EpubReaderProps, EpubTextSelection } from './types'

type BookState = { status: 'loading' } | { status: 'ready'; epub: EpubBook } | { status: 'error' }

/**
 * The EPUB half of "Biblioteca de fuentes": one spine section at a time, rendered inside a
 * sandboxed `<iframe srcdoc>`, with CFI-anchored highlights and the shared highlight → item
 * flow.
 *
 * `sandbox="allow-same-origin"` **without** `allow-scripts` is the deliberate choice here —
 * not the "untrusted content, no bridge at all" pattern `docs/spec/07-architecture.md` §4
 * uses for H5P/Sandpack. That pattern would leave this reader unable to read the section's
 * own `Selection`/`Range` at all (a `sandbox` with no `allow-same-origin` gives the frame an
 * opaque origin, which cross-frame script access is blocked from regardless of who owns the
 * parent). `allow-same-origin` alone is the safe half of that combination: the frame's
 * content becomes readable/selectable from here, and — because `allow-scripts` is absent —
 * nothing in it can ever execute, which is the actual security property this needs (an EPUB
 * is static XHTML; nothing in it is supposed to run). `<script>` elements are stripped from
 * the serialized document before it is ever assigned to `srcdoc`, as defense in depth.
 *
 * Book-wide search and a table-of-contents pane are deliberately out of scope for this pass:
 * `epub-search.ts` searches only the section on screen (see its own docstring for why), and
 * navigation is section-by-section (N/P) rather than by a TOC list. Both are additive later —
 * neither changes how a highlight is anchored or restored.
 */
export function EpubReader({
  src,
  highlights,
  labels,
  initialCfi,
  onLocationChange,
  onHighlight,
  onCreateCard,
  onAskAi,
  onCopyWithCitation,
}: EpubReaderProps) {
  const [state, setState] = useState<BookState>({ status: 'loading' })
  const [sectionIndex, setSectionIndex] = useState(0)
  const [sectionReady, setSectionReady] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [currentMatchIndex, setCurrentMatchIndex] = useState(-1)
  const [selection, setSelection] = useState<EpubTextSelection | null>(null)

  const iframeRef = useRef<HTMLIFrameElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const sectionTextRef = useRef('')
  const pendingScrollCfiRef = useRef<string | null>(initialCfi ?? null)

  // biome-ignore lint/correctness/useExhaustiveDependencies: only src — initialCfi seeds the opening section once (PdfReader's initialPage effect follows the same rule): a deep link opens to a place, it does not keep pulling the reader back there.
  useEffect(() => {
    let cancelled = false
    let opened: EpubBook | null = null
    setState({ status: 'loading' })
    openEpubBook(src)
      .then((epub) => {
        if (cancelled) {
          void epub.destroy()
          return
        }
        opened = epub
        const resolved = initialCfi === undefined ? null : epub.book.resolveCFI(initialCfi)
        setSectionIndex(resolved !== null && resolved.index >= 0 ? resolved.index : 0)
        setState({ status: 'ready', epub })
      })
      .catch(() => {
        if (!cancelled) setState({ status: 'error' })
      })
    return () => {
      cancelled = true
      void opened?.destroy()
    }
  }, [src])

  const sections = state.status === 'ready' ? state.epub.book.sections : []
  const sectionCount = sections.length

  const goToSection = useCallback(
    (index: number, cfiToScrollTo: string | null = null) => {
      const clamped = Math.max(0, Math.min(sectionCount - 1, index))
      pendingScrollCfiRef.current = cfiToScrollTo
      setSectionReady(false)
      setSectionIndex(clamped)
    },
    [sectionCount],
  )

  // Renders the current section into the iframe whenever it (or the book) changes.
  //
  // Highlights are marked and the search text is extracted on `doc` itself, *before* it is
  // serialized into `srcdoc` — not by waiting for the iframe's own `load` event and reaching
  // into `contentDocument` afterwards. `doc` (from `section.createDocument()`) is already a
  // complete, freestanding `Document`; nothing about marking a `Range` or reading
  // `body.textContent` needs it attached to a live browsing context first, and doing the work
  // here means a highlight is present in the very first paint rather than flashed in a beat
  // later. Only scrolling to a pending CFI (`pendingScrollCfiRef`) genuinely needs the
  // rendered frame — `scrollIntoView` is meaningless before layout exists — so that alone
  // waits for `load`.
  useEffect(() => {
    if (state.status !== 'ready') return
    const { book } = state.epub
    const section = sections[sectionIndex]
    const iframe = iframeRef.current
    if (section === undefined || iframe === null) return

    let cancelled = false
    void section.createDocument().then((doc) => {
      if (cancelled) return
      for (const script of Array.from(doc.querySelectorAll('script'))) script.remove()

      sectionTextRef.current = doc.body?.textContent ?? ''

      clearHighlightMarks(doc)
      for (const highlight of highlights) {
        const resolved = resolveAnnotationCfi(book, highlight.cfi)
        if (resolved === null || resolved.sectionIndex !== sectionIndex) continue
        try {
          markRange(resolved.resolveRange(doc), highlight.id, highlight.color)
        } catch {
          // A highlight whose anchor no longer resolves cleanly (the source was re-ingested
          // with a different structure) is skipped rather than crashing the whole section's
          // render.
        }
      }

      const html = new XMLSerializer().serializeToString(doc)

      const onLoad = () => {
        if (cancelled) return
        iframe.removeEventListener('load', onLoad)

        const pendingCfi = pendingScrollCfiRef.current
        pendingScrollCfiRef.current = null
        const frameDoc = iframe.contentDocument
        if (pendingCfi !== null && frameDoc !== null) {
          const target = resolveAnnotationCfi(book, pendingCfi)
          if (target !== null && target.sectionIndex === sectionIndex) {
            try {
              const range = target.resolveRange(frameDoc)
              const node = range.startContainer
              const element =
                node.nodeType === Node.TEXT_NODE ? node.parentElement : (node as Element)
              element?.scrollIntoView({ block: 'start' })
            } catch {
              // Same as above: an anchor that no longer resolves is not worth failing over.
            }
          }
        }

        setSectionReady(true)
      }

      iframe.addEventListener('load', onLoad)
      iframe.srcdoc = html
      onLocationChange?.(section.cfi)
    })

    return () => {
      cancelled = true
    }
  }, [state, sectionIndex, sections, highlights, onLocationChange])

  /** The current section's iframe, if it is the one a selection event fired in — the only
   *  translation an EPUB selection needs (unlike PDF's per-page fractional rects, a CFI is
   *  already anchored to the exact node and offset, so all that's left is turning the
   *  selection's iframe-local rect into the parent document's viewport coordinates for
   *  `SelectionToolbar`'s `position`). */
  const iframeHost = useCallback(() => {
    const iframe = iframeRef.current
    if (iframe === null || iframe.contentDocument === null) return null
    return { iframeRect: iframe.getBoundingClientRect() }
  }, [])

  const onSelectionChange = useCallback(() => {
    const iframe = iframeRef.current
    const frameDoc = iframe?.contentDocument
    const frameSelection = iframe?.contentWindow?.getSelection() ?? null
    if (frameDoc === null || frameDoc === undefined || frameSelection === null) {
      setSelection(null)
      return
    }
    if (frameSelection.isCollapsed || frameSelection.rangeCount === 0) {
      setSelection(null)
      return
    }
    const text = frameSelection.toString()
    if (text.trim().length === 0) {
      setSelection(null)
      return
    }
    const range = frameSelection.getRangeAt(0)
    const host = iframeHost()
    const section = sections[sectionIndex]
    if (host === null || section === undefined) {
      setSelection(null)
      return
    }
    const clientRects = Array.from(range.getClientRects())
    const first = clientRects[0]
    if (first === undefined) {
      setSelection(null)
      return
    }
    const cfi = computeAnnotationCfi(section.cfi, range)
    setSelection({
      cfi,
      quote: text,
      toolbarPosition: {
        x: host.iframeRect.left + first.left + first.width / 2,
        y: host.iframeRect.top + first.top,
      },
    })
  }, [iframeHost, sections, sectionIndex])

  useEffect(() => {
    const frameDoc = iframeRef.current?.contentDocument
    if (!sectionReady || frameDoc === null || frameDoc === undefined) return
    frameDoc.addEventListener('selectionchange', onSelectionChange)
    return () => frameDoc.removeEventListener('selectionchange', onSelectionChange)
  }, [sectionReady, onSelectionChange])

  const clearSelection = useCallback(() => {
    iframeRef.current?.contentWindow?.getSelection()?.removeAllRanges()
    setSelection(null)
  }, [])

  const matches: EpubSearchMatch[] = searchOpen
    ? findMatchesInSection(sectionTextRef.current, searchQuery)
    : []

  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    const onKeyDown = createReaderShortcutHandler({
      onNextPage: () => goToSection(sectionIndex + 1),
      onPrevPage: () => goToSection(sectionIndex - 1),
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
  }, [sectionIndex, goToSection, selection, onHighlight, onCreateCard, clearSelection])

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

  return (
    <div ref={rootRef} className="flex h-full flex-col">
      <Toolbar
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
          aria-label={labels.sectionOf(sectionIndex, sectionCount)}
          disabled={sectionIndex <= 0}
          onClick={() => goToSection(sectionIndex - 1)}
        >
          <ChevronLeftIcon />
        </IconButton>
        <span className="text-muted text-xs">
          {labels.sectionOf(sectionIndex + 1, sectionCount)}
        </span>
        <IconButton
          variant="ghost"
          size="sm"
          aria-label={labels.sectionOf(sectionIndex + 2, sectionCount)}
          disabled={sectionIndex >= sectionCount - 1}
          onClick={() => goToSection(sectionIndex + 1)}
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
            onClick={() => setCurrentMatchIndex(stepMatch(matches.length, currentMatchIndex, -1))}
          >
            <ChevronLeftIcon />
          </IconButton>
          <IconButton
            variant="ghost"
            size="sm"
            aria-label={labels.searchNext}
            disabled={matches.length === 0}
            onClick={() => setCurrentMatchIndex(stepMatch(matches.length, currentMatchIndex, 1))}
          >
            <ChevronRightIcon />
          </IconButton>
        </div>
      )}

      <div className="min-h-0 flex-1">
        <iframe
          ref={iframeRef}
          title={labels.sectionOf(sectionIndex + 1, sectionCount)}
          sandbox="allow-same-origin"
          className="h-full w-full border-0 bg-white"
          data-testid="epub-section-frame"
        />
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
