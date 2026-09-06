import { useState } from 'react'
import { SourceDetail } from './source-detail'
import { SourceList } from './source-list'
import {
  useAddCourseFromFolder,
  useAddSourceFromDialog,
  useAddSourceFromFiles,
  useAddSourceFromText,
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

function ConnectedSourceDetail({ id, onBack }: { id: string; onBack: () => void }) {
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
    />
  )
}

export interface LibraryPageProps {
  /** From the route's `?q=` search param — filters the grid by title, client-side (the
   *  library is small enough that a server-side search is not worth it yet). */
  searchQuery?: string
}

/** The Library screen (sub-phases 6.1 and 6.2): import sources, watch them parse and chunk via
 *  the job tray, open one to see its section tree, its block preview and its chunks. */
export function LibraryPage({ searchQuery }: LibraryPageProps) {
  useLibraryJobEvents()
  const [selectedId, setSelectedId] = useState<string | undefined>()

  const sourcesQuery = useSources()
  const addFromDialog = useAddSourceFromDialog()
  const addCourse = useAddCourseFromFolder()
  const addFromFiles = useAddSourceFromFiles()
  const addFromText = useAddSourceFromText()
  const retry = useRetrySource()
  const remove = useDeleteSource()

  if (selectedId !== undefined) {
    return <ConnectedSourceDetail id={selectedId} onBack={() => setSelectedId(undefined)} />
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
    />
  )
}
