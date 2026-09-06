import { useState } from 'react'
import { SourceDetail } from './source-detail'
import { SourceList } from './source-list'
import {
  useAddSourceFromDialog,
  useAddSourceFromFiles,
  useAddSourceFromText,
  useDeleteSource,
  useLibraryJobEvents,
  useRetrySource,
  useSource,
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
  const sourceQuery = useSource(id)
  const docQuery = useSourceDoc(id)
  return (
    <SourceDetail
      source={sourceQuery.data?.source ?? undefined}
      doc={docQuery.data?.doc ?? undefined}
      onBack={onBack}
    />
  )
}

export interface LibraryPageProps {
  /** From the route's `?q=` search param — filters the grid by title, client-side (the
   *  library is small enough that a server-side search is not worth it yet). */
  searchQuery?: string
}

/** The Library screen (sub-phase 6.1): import sources, watch them parse via the job tray,
 *  open one to see its section tree and block preview. */
export function LibraryPage({ searchQuery }: LibraryPageProps) {
  useLibraryJobEvents()
  const [selectedId, setSelectedId] = useState<string | undefined>()

  const sourcesQuery = useSources()
  const addFromDialog = useAddSourceFromDialog()
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
      onDropFiles={(files) => {
        void readDroppedFiles(files).then((read) => addFromFiles.mutate({ files: read }))
      }}
      onAddFromText={(text, title) => addFromText.mutate({ text, title })}
    />
  )
}
