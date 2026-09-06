import type { SourceSummary } from '@retenia/ipc-contract'
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  FileDropZone,
  Input,
  Textarea,
} from '@retenia/ui'
import { ClipboardPasteIcon, FolderPlusIcon, LibraryBigIcon, PlusIcon } from 'lucide-react'
import { useId, useState } from 'react'
import { useT } from '../../i18n/use-t'
import { SourceCard } from './source-card'

export interface SourceListProps {
  sources: SourceSummary[]
  onOpen: (id: string) => void
  onRetry: (id: string) => void
  onDelete: (id: string) => void
  onAddFromDialog: () => void
  /** Opens a directory picker and imports a course folder as one source (sub-phase 6.4). */
  onAddCourseFromFolder: () => void
  onDropFiles: (files: File[]) => void
  onAddFromText: (text: string, title: string) => void
}

const IMPORTABLE_ACCEPT = '.pdf,.docx,.epub,.pptx,.md,.markdown,.txt,.png,.jpg,.jpeg,.gif,.webp'

/** The Library grid: import controls (a native dialog, a drop zone, pasted text) plus every
 *  source that has been added, each a `SourceCard` (sub-phase 6.1). Presentational — all
 *  data comes from `LibraryPage`'s hooks. */
export function SourceList({
  sources,
  onOpen,
  onRetry,
  onDelete,
  onAddFromDialog,
  onAddCourseFromFolder,
  onDropFiles,
  onAddFromText,
}: SourceListProps) {
  const t = useT('library')
  const titleInputId = useId()
  const textInputId = useId()
  const [pasteOpen, setPasteOpen] = useState(false)
  const [pasteTitle, setPasteTitle] = useState('')
  const [pasteText, setPasteText] = useState('')

  function submitPaste() {
    if (pasteText.trim().length === 0 || pasteTitle.trim().length === 0) return
    onAddFromText(pasteText, pasteTitle)
    setPasteOpen(false)
    setPasteTitle('')
    setPasteText('')
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" onClick={onAddFromDialog}>
          <PlusIcon aria-hidden="true" />
          {t('addFile')}
        </Button>
        <Button variant="outline" size="sm" onClick={onAddCourseFromFolder}>
          <FolderPlusIcon aria-hidden="true" />
          {t('addFolder')}
        </Button>
        <Button variant="outline" size="sm" onClick={() => setPasteOpen(true)}>
          <ClipboardPasteIcon aria-hidden="true" />
          {t('pasteText')}
        </Button>
      </div>

      <FileDropZone
        onFiles={onDropFiles}
        accept={IMPORTABLE_ACCEPT}
        label={t('dropLabel')}
        hint={t('dropHint')}
      />

      {sources.length === 0 ? (
        <EmptyState
          icon={<LibraryBigIcon />}
          title={t('empty.title')}
          description={t('empty.description')}
        />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {sources.map((source) => (
            <SourceCard
              key={source.id}
              source={source}
              onOpen={onOpen}
              onRetry={onRetry}
              onDelete={onDelete}
            />
          ))}
        </div>
      )}

      <Dialog open={pasteOpen} onOpenChange={setPasteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('pasteDialogTitle')}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <label htmlFor={titleInputId} className="flex flex-col gap-1 text-sm">
              <span className="text-text font-medium">{t('pasteTitleLabel')}</span>
              <Input
                id={titleInputId}
                value={pasteTitle}
                onChange={(event) => setPasteTitle(event.target.value)}
                placeholder={t('pasteTitlePlaceholder')}
                data-testid="paste-title-input"
              />
            </label>
            <label htmlFor={textInputId} className="flex flex-col gap-1 text-sm">
              <span className="text-text font-medium">{t('pasteTextLabel')}</span>
              <Textarea
                id={textInputId}
                value={pasteText}
                onChange={(event) => setPasteText(event.target.value)}
                placeholder={t('pasteTextPlaceholder')}
                rows={8}
                data-testid="paste-text-input"
              />
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPasteOpen(false)}>
              {t('pasteCancel')}
            </Button>
            <Button
              onClick={submitPaste}
              disabled={pasteText.trim().length === 0 || pasteTitle.trim().length === 0}
              data-testid="paste-submit"
            >
              {t('pasteSubmit')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
