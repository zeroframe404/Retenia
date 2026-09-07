import { toast } from '@retenia/ui'
import { useState } from 'react'
import { useT } from '../../i18n/use-t'
import { SourceDetail } from './source-detail'
import { SourceList } from './source-list'
import {
  useAddCourseFromFolder,
  useAddSourceFromDialog,
  useAddSourceFromFiles,
  useAddSourceFromText,
  useAddSourceFromUrl,
  useContextualizationEstimate,
  useCreateCardFromClip,
  useDeleteSource,
  useLibraryJobEvents,
  useRetrySource,
  useSource,
  useSourceChunks,
  useSourceDoc,
  useSources,
} from './use-library'

/** What `library.addSourceFromFiles` takes for each dropped `File`: its bytes and name. The
 *  renderer never learns a path, let alone sends one. */
async function readDroppedFiles(files: File[]) {
  return Promise.all(
    files.map(async (file) => ({
      name: file.name,
      bytes: new Uint8Array(await file.arrayBuffer()),
    })),
  )
}

export function ConnectedSourceDetail({
  id,
  onBack,
  initialReaderLocator,
}: {
  id: string
  onBack: () => void
  /** Opens straight to the reader tab at this page/CFI — "ver en la fuente" (sub-phase 6.6). */
  initialReaderLocator?: { page?: number; cfi?: string }
}) {
  const [excludeFrontmatter, setExcludeFrontmatter] = useState(false)
  const sourceQuery = useSource(id)
  const docQuery = useSourceDoc(id)
  const chunksQuery = useSourceChunks(id, { excludeFrontmatter })
  const estimateQuery = useContextualizationEstimate(id)
  const createClip = useCreateCardFromClip()
  return (
    <SourceDetail
      source={sourceQuery.data?.source ?? undefined}
      doc={docQuery.data?.doc ?? undefined}
      chunks={chunksQuery.data?.chunks ?? []}
      chunkTotal={chunksQuery.data?.total ?? 0}
      estimate={estimateQuery.data}
      excludeFrontmatter={excludeFrontmatter}
      onExcludeFrontmatterChange={setExcludeFrontmatter}
      onBack={onBack}
      onCreateClip={({ startSec, endSec, text }) =>
        createClip.mutate({
          sourceId: id,
          startSec,
          endSec,
          // A clip over silence has no transcript to be the card's back; the mutation's own
          // fallback (the source title and the timestamp) is better than an empty string,
          // which the contract would reject anyway.
          ...(text.length > 0 ? { back: text } : {}),
        })
      }
      {...(initialReaderLocator === undefined ? {} : { initialReaderLocator })}
    />
  )
}

export interface LibraryPageProps {
  /** From the route's `?q=` search param — filters the grid by title, client-side (the
   *  library is small enough that a server-side search is not worth it yet). */
  searchQuery?: string
  /** Set by a deep link or a card's citation — "ver en la fuente" (sub-phase 6.6): opens
   *  straight to this source's reader tab, bypassing the grid. Controlled by the route so the
   *  URL carries it and a refresh does not lose it. */
  openSourceId?: string
  initialReaderLocator?: { page?: number; cfi?: string }
  onCloseSource?: () => void
}

/** The Library screen (sub-phases 6.1 and 6.2): import sources, watch them parse and chunk via
 *  the job tray, open one to see its section tree, its block preview and its chunks. */
export function LibraryPage({
  searchQuery,
  openSourceId,
  initialReaderLocator,
  onCloseSource,
}: LibraryPageProps) {
  const t = useT('library')
  useLibraryJobEvents()
  const [selectedId, setSelectedId] = useState<string | undefined>()
  const effectiveId = openSourceId ?? selectedId

  const sourcesQuery = useSources()
  const addFromDialog = useAddSourceFromDialog()
  const addCourse = useAddCourseFromFolder()
  const addFromFiles = useAddSourceFromFiles()
  const addFromText = useAddSourceFromText()
  const addFromUrl = useAddSourceFromUrl()
  const retry = useRetrySource()
  const remove = useDeleteSource()

  if (effectiveId !== undefined) {
    return (
      <ConnectedSourceDetail
        id={effectiveId}
        onBack={() => {
          if (openSourceId !== undefined) onCloseSource?.()
          else setSelectedId(undefined)
        }}
        {...(openSourceId !== undefined && initialReaderLocator !== undefined
          ? { initialReaderLocator }
          : {})}
      />
    )
  }

  const query = searchQuery?.trim().toLowerCase()
  const sources = (sourcesQuery.data?.sources ?? []).filter(
    (source) => !query || source.title.toLowerCase().includes(query),
  )

  return (
    <SourceList
      sources={sources}
      onOpen={setSelectedId}
      onRetry={(id) => retry.mutate({ id })}
      onDelete={(id) => remove.mutate({ id })}
      onAddFromDialog={() => addFromDialog.mutate(undefined)}
      onAddCourseFromFolder={() => addCourse.mutate(undefined)}
      onDropFiles={(files) => {
        void readDroppedFiles(files).then((read) => addFromFiles.mutate({ files: read }))
      }}
      onAddFromText={(text, title) => addFromText.mutate({ text, title })}
      onAddFromUrl={(url) =>
        addFromUrl.mutate(
          { url },
          {
            // A 404, a size-cap rejection, an SSRF refusal, an empty playlist, a rendering
            // timeout — all of it used to fail with no feedback at all: the dialog closed and
            // nothing appeared in the Library, with no way to tell why (`reviewer` finding).
            onError: (error) => toast.error(error.message),
            // A playlist whose public feed hit its own entry limit imports only its most recent
            // videos with no other sign anything was left out — surfaced here rather than
            // silently importing a partial collection (`reviewer` finding).
            onSuccess: (result) => {
              if (result.truncated) toast.warning(t('playlistTruncated'))
            },
          },
        )
      }
    />
  )
}
