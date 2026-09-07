import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Textarea,
} from '@retenia/ui'
import { useEffect, useId, useState } from 'react'
import { useT } from '../../i18n/use-t'

export interface CardComposerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** "p. 12", "Sección 3" — shown under the answer so the citation this card will keep is
   *  visible before it is created. */
  citation: string
  /** The highlighted text, prefilled as the back: a card whose front is a passage and whose
   *  back is the same passage tests nothing (`docs/spec/01-decisions.md` §7). */
  initialBack: string
  onSubmit: (input: { front: string; back: string }) => void
  submitting?: boolean
}

/**
 * The reader's "Crear tarjeta" dialog (sub-phase 6.6): the question is the user's own, the
 * answer defaults to the selected text, and the citation the card keeps is shown but not
 * editable here — it comes from the highlight this composer was opened for.
 */
export function CardComposer({
  open,
  onOpenChange,
  citation,
  initialBack,
  onSubmit,
  submitting = false,
}: CardComposerProps) {
  const t = useT('library')
  const frontId = useId()
  const backId = useId()
  const [front, setFront] = useState('')
  const [back, setBack] = useState(initialBack)

  // Reseeds the answer (and clears the question) every time the composer opens for a new
  // highlight — `initialBack` changes with it, but the fields must not keep editing what the
  // user typed for the previous card once this one closes and a different one opens.
  // biome-ignore lint/correctness/useExhaustiveDependencies: only re-seed on the open transition, not on every initialBack identity change while already open (that would clobber what the user is typing).
  useEffect(() => {
    if (open) {
      setFront('')
      setBack(initialBack)
    }
  }, [open])

  function submit() {
    if (front.trim().length === 0 || back.trim().length === 0) return
    onSubmit({ front: front.trim(), back: back.trim() })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('reader.composer.title')}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <label htmlFor={frontId} className="flex flex-col gap-1 text-sm">
            <span className="text-text font-medium">{t('reader.composer.frontLabel')}</span>
            <Textarea
              id={frontId}
              value={front}
              onChange={(event) => setFront(event.target.value)}
              placeholder={t('reader.composer.frontPlaceholder')}
              rows={2}
              data-testid="card-composer-front"
            />
          </label>
          <label htmlFor={backId} className="flex flex-col gap-1 text-sm">
            <span className="text-text font-medium">{t('reader.composer.backLabel')}</span>
            <Textarea
              id={backId}
              value={back}
              onChange={(event) => setBack(event.target.value)}
              rows={5}
              data-testid="card-composer-back"
            />
          </label>
          <p className="text-muted text-xs" data-testid="card-composer-citation">
            {citation}
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('pasteCancel')}
          </Button>
          <Button
            onClick={submit}
            disabled={front.trim().length === 0 || back.trim().length === 0 || submitting}
            data-testid="card-composer-submit"
          >
            {t('reader.composer.submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
