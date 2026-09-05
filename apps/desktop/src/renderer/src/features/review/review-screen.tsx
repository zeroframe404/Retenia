import {
  Button,
  Card,
  IconButton,
  SHORTCUTS,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  Skeleton,
  toast,
} from '@retenia/ui'
import { useNavigate } from '@tanstack/react-router'
import { PencilIcon, Undo2Icon } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useHotkeys, useHotkeysContext } from 'react-hotkeys-hook'
import { useT } from '../../i18n/use-t'
import { useSetting } from '../../ipc/use-setting'
import { ActivityRunner } from './activity-runner'
import { CardActionsMenu } from './components/card-actions-menu'
import { CardView } from './components/card-view'
import { GradeButtons } from './components/grade-buttons'
import { SessionProgressBar } from './components/session-progress-bar'
import { StrengthChip } from './components/strength-chip'
import { SessionSummary } from './session-summary'
import type { ReviewGrade } from './use-review-session'
import { useReviewSession } from './use-review-session'

/** Looks up a shortcut's registration combo (`matchKeys` when it differs from the display
 *  `keys`) from the single `SHORTCUTS` registry, so the bindings below cannot drift from
 *  what the shortcuts sheet advertises. */
function keyFor(id: string): string {
  const shortcut = SHORTCUTS.find((s) => s.id === id)
  return shortcut?.matchKeys ?? shortcut?.keys ?? ''
}

/** A stable identity for the entry currently on screen, so `revealed` resets exactly when
 *  the card changes and not on every re-render. */
function entryKey(entry: ReturnType<typeof useReviewSession>['entry']): string | null {
  if (entry === null) return null
  return entry.kind === 'reinforcement' ? `r:${entry.node.id}` : `c:${entry.card.id}`
}

function useElapsedMs(active: boolean): number {
  const [startedAt] = useState(() => Date.now())
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!active) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [active])

  return active ? now - startedAt : 0
}

/**
 * The daily review session — one card per screen, no distractions (`docs/spec/08-ux.md`
 * §2 screen map). A `<Activity>`-persisted sticky screen (`shell/sticky-outlet.tsx`):
 * `useReviewSession` keeps the running session alive while the user navigates elsewhere,
 * and the `review` hotkey scope is only live while this screen is the one on screen.
 */
export function ReviewScreen() {
  const t = useT('review')
  const navigate = useNavigate()
  const session = useReviewSession()
  const { enableScope, disableScope } = useHotkeysContext()
  const simpleGrading = useSetting<boolean>('review.simpleGrading')
  const [revealed, setRevealed] = useState(false)
  /** An exercise finished without a rating of its own; the buttons take over for this card. */
  const [awaitingRating, setAwaitingRating] = useState(false)
  const [editorOpen, setEditorOpen] = useState(false)
  const elapsedMs = useElapsedMs(session.phase === 'active')

  const key = entryKey(session.entry)
  // A ref, not a bare `[key]`-dependency effect: `<Activity>` tears down and re-runs every
  // effect across a hide/show transition (same as the hotkey-scope effect just below), so a
  // plain `useEffect(() => setRevealed(false), [key])` would wipe `revealed` every time the
  // user merely navigates back to an unchanged card. The ref persists across that
  // transition (only effects reset, not state), so the comparison here tells "the card
  // actually changed" apart from "the screen became visible again".
  const previousKey = useRef<string | null>(null)
  useEffect(() => {
    if (previousKey.current !== key) {
      setRevealed(false)
      setAwaitingRating(false)
    }
    previousKey.current = key
  }, [key])

  useEffect(() => {
    enableScope('review')
    return () => disableScope('review')
  }, [enableScope, disableScope])

  const gradeable = session.entry !== null && session.entry.kind !== 'reinforcement'

  function reveal() {
    if (!revealed) setRevealed(true)
  }

  function continueEntry() {
    if (!revealed) {
      reveal()
      return
    }
    if (session.entry?.kind === 'reinforcement') void session.skip()
  }

  function grade(value: ReviewGrade) {
    if (!revealed || !gradeable || session.busy) return
    void session.answer(value)
  }

  useHotkeys(keyFor('review.reveal'), reveal, { scopes: ['review'], enableOnFormTags: false }, [
    revealed,
  ])
  useHotkeys(
    keyFor('review.continue'),
    continueEntry,
    { scopes: ['review'], enableOnFormTags: false },
    [revealed, session.entry],
  )
  useHotkeys(
    keyFor('review.grade1'),
    () => grade(1),
    { scopes: ['review'], enableOnFormTags: false },
    [revealed, gradeable, session.busy],
  )
  useHotkeys(
    keyFor('review.grade2'),
    () => grade(2),
    { scopes: ['review'], enableOnFormTags: false },
    [revealed, gradeable, session.busy],
  )
  useHotkeys(
    keyFor('review.grade3'),
    () => grade(3),
    { scopes: ['review'], enableOnFormTags: false },
    [revealed, gradeable, session.busy],
  )
  useHotkeys(
    keyFor('review.grade4'),
    () => grade(4),
    { scopes: ['review'], enableOnFormTags: false },
    [revealed, gradeable, session.busy],
  )
  useHotkeys(
    keyFor('review.skip'),
    () => void session.skip(),
    { scopes: ['review'], enableOnFormTags: false },
    [session.skip],
  )
  useHotkeys(
    keyFor('review.undo'),
    () => {
      void session.undo().then(() => toast(t('screen.undoneToast')))
    },
    { scopes: ['review'], enableOnFormTags: false },
    [session.undo],
  )
  useHotkeys(
    keyFor('review.explain'),
    () => toast(t('screen.explainComingSoon')),
    { scopes: ['review'] },
    [t],
  )
  useHotkeys(keyFor('review.back'), () => navigate({ to: '/' }), { scopes: ['review'] }, [navigate])

  const entry = session.entry

  if (session.phase === 'idle' || session.phase === 'starting') {
    return (
      <div data-testid="screen-review" className="flex flex-col gap-4 p-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-12 w-full" />
      </div>
    )
  }

  if (session.phase === 'error') {
    return (
      <div data-testid="screen-review" className="flex flex-col gap-4 p-6">
        <p className="text-incorrect text-sm" role="alert">
          {session.error}
        </p>
        <Button onClick={() => void session.start()}>{t('screen.startReview')}</Button>
      </div>
    )
  }

  if (session.phase === 'finished') {
    return (
      <div data-testid="screen-review" className="flex flex-col gap-4 p-6">
        <SessionSummary
          summary={session.summary}
          onBackHome={() => navigate({ to: '/' })}
          onReviewMore={() => void session.reviewMore()}
        />
      </div>
    )
  }

  return (
    <div data-testid="screen-review" className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-6">
      {entry !== null && session.progress !== null && (
        <SessionProgressBar progress={session.progress} elapsedMs={elapsedMs} />
      )}

      {entry === null ? (
        <Skeleton className="h-64 w-full" />
      ) : entry.kind === 'reinforcement' ? (
        <Card
          className="flex flex-col items-center gap-4 p-8 text-center"
          data-testid="card-reinforcement"
        >
          <p className="text-muted text-sm">{t('screen.why.reinforcement')}</p>
          <Button onClick={() => void session.skip()}>{t('screen.startReview')}</Button>
        </Card>
      ) : (
        <>
          <div className="flex items-center justify-between gap-3">
            <StrengthChip entry={entry} />
            <div className="flex items-center gap-1">
              <IconButton
                variant="ghost"
                size="sm"
                aria-label={t('screen.edit')}
                data-testid="card-edit-button"
                onClick={() => setEditorOpen(true)}
              >
                <PencilIcon />
              </IconButton>
              <IconButton
                variant="ghost"
                size="sm"
                aria-label={t('screen.undo')}
                data-testid="card-undo-button"
                onClick={() => {
                  void session.undo().then(() => toast(t('screen.undoneToast')))
                }}
              >
                <Undo2Icon />
              </IconButton>
              <CardActionsMenu cardId={entry.card.id} leech={entry.card.leech} />
            </div>
          </div>

          {entry.activity !== null && !awaitingRating ? (
            <ActivityRunner
              served={entry.activity}
              disabled={session.busy}
              onAnswer={(input) => {
                void session.answerActivity(input)
              }}
              // The exercise graded itself but not onto the 1–4 scale (an M-self type, or an
              // AI rubric that declined): fall through to the buttons for this card only.
              onAwaitingRating={() => {
                setAwaitingRating(true)
                // The exercise has already shown the answer, so there is nothing left to
                // reveal — going back behind the flip would hide what was just read.
                setRevealed(true)
              }}
              fallback={
                <Card className="p-6" data-testid="card-body">
                  <CardView
                    template={entry.card.template}
                    fields={session.item?.fields}
                    revealed={revealed}
                    onReveal={reveal}
                  />
                </Card>
              }
            />
          ) : (
            <Card className="p-6" data-testid="card-body">
              <CardView
                template={entry.card.template}
                fields={session.item?.fields}
                revealed={revealed}
                onReveal={reveal}
              />
            </Card>
          )}

          <div className="flex items-center justify-between gap-3">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void session.skip()}
              data-testid="skip-button"
            >
              {t('screen.skip')}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => toast(t('screen.explainComingSoon'))}
              data-testid="explain-button"
            >
              {t('screen.explain')}
            </Button>
          </div>

          {(entry.activity === null || awaitingRating) && revealed && (
            <GradeButtons
              preview={session.preview}
              simple={simpleGrading.value ?? false}
              disabled={session.busy}
              onGrade={grade}
            />
          )}
        </>
      )}

      <Sheet open={editorOpen} onOpenChange={setEditorOpen}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>{t('screen.edit')}</SheetTitle>
            <SheetDescription>{t('screen.editComingSoon')}</SheetDescription>
          </SheetHeader>
        </SheetContent>
      </Sheet>
    </div>
  )
}
