import { UploadCloudIcon } from 'lucide-react'
import type { ChangeEvent, DragEvent, ReactNode } from 'react'
import { useId, useState } from 'react'
import { cn } from '../lib/cn'

export interface FileDropZoneProps {
  /** Called with the dropped or browsed files. Resolving a dropped file to an on-disk
   * path (Electron's `webUtils.getPathForFile`) is the app's job — this component only
   * ever emits `File` objects. */
  onFiles: (files: File[]) => void
  /** Forwarded to the native file input, e.g. `".pdf,.docx,video/*"`. */
  accept?: string
  multiple?: boolean
  disabled?: boolean
  label: ReactNode
  hint?: ReactNode
  className?: string
}

/** A drag-and-drop target with a click-to-browse fallback. Source ingestion
 * (docs/spec/05-ingestion-rag.md): drop a PDF, a folder of images, an audio file. */
export function FileDropZone({
  onFiles,
  accept,
  multiple = true,
  disabled,
  label,
  hint,
  className,
}: FileDropZoneProps) {
  const [isDragActive, setDragActive] = useState(false)
  const inputId = useId()

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    setDragActive(false)
    if (disabled) return
    const files = Array.from(event.dataTransfer.files)
    if (files.length > 0) onFiles(files)
  }

  function handleDragOver(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    if (!disabled) setDragActive(true)
  }

  function handleDragLeave(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    setDragActive(false)
  }

  function handleInputChange(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? [])
    if (files.length > 0) onFiles(files)
    event.target.value = ''
  }

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: drag events aren't reachable from the visually-hidden <label>/<input> pair below, which alone carry the real interactive (click/keyboard) semantics.
    <div
      data-testid="file-drop-zone"
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      data-drag-active={isDragActive || undefined}
      className={cn(
        'border-border flex flex-col items-center gap-2 rounded-lg border-2 border-dashed px-6 py-10 text-center',
        'transition-colors duration-fast ease-standard',
        isDragActive && 'border-brand-500 bg-brand-50 dark:bg-brand-950',
        disabled && 'pointer-events-none opacity-50',
        className,
      )}
    >
      <UploadCloudIcon aria-hidden="true" className="text-muted size-8" />
      <label htmlFor={inputId} className="text-text cursor-pointer text-sm font-medium">
        {label}
        <input
          id={inputId}
          type="file"
          className="sr-only"
          accept={accept}
          multiple={multiple}
          disabled={disabled}
          onChange={handleInputChange}
        />
      </label>
      {hint && <p className="text-muted text-xs">{hint}</p>}
    </div>
  )
}
