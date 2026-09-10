import type {
  CoreLessonNodeDto,
  ModuleNodeDto,
  PathDraftDto,
  PathEditOpDto,
  SectionNodeDto,
} from '@retenia/ipc-contract'
import {
  Badge,
  Button,
  ConfirmDialog,
  ErrorState,
  IconButton,
  Input,
  Switch,
  toast,
} from '@retenia/ui'
import { ArrowDownIcon, ArrowUpIcon, Trash2Icon } from 'lucide-react'
import { useState } from 'react'
import { useT } from '../../i18n/use-t'
import { useEditDraft, useFreeze, usePathVersion } from './use-pathgen'
import { useUndoStack } from './use-undo-stack'

export interface PreviewPageProps {
  pathVersionId: string
  onFrozen: (pathVersionId: string) => void
}

export function PreviewPage({ pathVersionId, onFrozen }: PreviewPageProps) {
  const t = useT('path')
  const version = usePathVersion(pathVersionId)
  const editDraft = useEditDraft(pathVersionId)
  const freeze = useFreeze()
  const undoStack = useUndoStack(version.data?.draft)
  const [selectedLessonIds, setSelectedLessonIds] = useState<string[]>([])
  const [deepenTarget, setDeepenTarget] = useState<string | null>(null)

  if (version.isLoading) return null
  if (version.error || !version.data) {
    return <ErrorState title={t('preview.loadError')} />
  }

  const { draft, version: versionDto } = version.data
  const frozen = versionDto.frozenAt !== null
  const primarySourceId = draft.sources.find((source) => source.primary)?.source_id

  function applyOp(op: Parameters<typeof editDraft.mutate>[0]['op'], previous: PathDraftDto): void {
    undoStack.record(previous)
    editDraft.mutate(
      { pathVersionId, op },
      {
        onError: (error) => toast.error(error.message),
      },
    )
  }

  function handleUndo(): void {
    const previous = undoStack.undo()
    if (previous === null) return
    editDraft.mutate({ pathVersionId, op: { kind: 'replace', draft: previous } })
  }

  function handleRedo(): void {
    const next = undoStack.redo()
    if (next === null) return
    editDraft.mutate({ pathVersionId, op: { kind: 'replace', draft: next } })
  }

  function handleDeepen(lessonId: string, parts: 2 | 3): void {
    editDraft.mutate(
      { pathVersionId, op: { kind: 'deepenLesson', lessonId, parts } },
      {
        onSuccess: (result) => {
          if (result.projectedCostDeltaUsd !== undefined) {
            toast.success(
              t('preview.deepenApplied', { usd: result.projectedCostDeltaUsd.toFixed(2) }),
            )
          }
        },
        onError: (error) => toast.error(error.message),
      },
    )
    setDeepenTarget(null)
  }

  function handleMerge(): void {
    if (selectedLessonIds.length < 2) return
    const [first, second, ...rest] = selectedLessonIds
    if (first === undefined || second === undefined) return
    applyOp({ kind: 'mergeLessons', lessonIds: [first, second, ...rest] }, draft)
    setSelectedLessonIds([])
  }

  return (
    <div className="flex h-full flex-col gap-4 p-6" data-testid="pathgen-preview">
      <div className="flex items-center justify-between gap-4">
        <h1 className="font-display text-2xl font-semibold">{draft.title}</h1>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={handleUndo}
            disabled={!undoStack.canUndo || frozen}
            data-testid="preview-undo"
          >
            {t('preview.undo')}
          </Button>
          <Button
            variant="outline"
            onClick={handleRedo}
            disabled={!undoStack.canRedo || frozen}
            data-testid="preview-redo"
          >
            {t('preview.redo')}
          </Button>
          {selectedLessonIds.length >= 2 && !frozen && (
            <Button variant="outline" onClick={handleMerge} data-testid="preview-merge">
              {t('preview.mergeLessons', { count: selectedLessonIds.length })}
            </Button>
          )}
          <Button
            onClick={() =>
              freeze.mutate({ pathVersionId }, { onSuccess: () => onFrozen(pathVersionId) })
            }
            disabled={frozen || freeze.isPending}
            data-testid="preview-freeze"
          >
            {frozen ? t('preview.frozen') : t('preview.freeze')}
          </Button>
        </div>
      </div>

      {draft.sources.length > 1 && (
        <label className="flex items-center gap-2 text-sm">
          {t('preview.primarySource')}
          <select
            value={primarySourceId ?? ''}
            disabled={frozen}
            onChange={(event) =>
              applyOp({ kind: 'setPrimarySource', sourceId: event.target.value }, draft)
            }
            className="border-border bg-surface text-text h-9 rounded-md border px-2 text-sm"
            data-testid="preview-primary-source"
          >
            {draft.sources.map((source) => (
              <option key={source.source_id} value={source.source_id}>
                {source.title}
              </option>
            ))}
          </select>
        </label>
      )}

      {draft.warnings.length > 0 && (
        <ul className="border-border bg-surface flex flex-col gap-1 rounded-md border p-3 text-xs">
          {draft.warnings.map((warning, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: warnings carry no stable id
            <li key={index} className="text-muted">
              {t(`generation.warning.${warning.code}`, warning.params)}
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-col gap-4 overflow-y-auto">
        {draft.sections.map((section, sectionIndex) => (
          <SectionRow
            key={section.id}
            section={section}
            index={sectionIndex}
            count={draft.sections.length}
            frozen={frozen}
            knownIds={draft.known_node_ids}
            selectedLessonIds={selectedLessonIds}
            onToggleLessonSelected={(lessonId) =>
              setSelectedLessonIds((ids) =>
                ids.includes(lessonId) ? ids.filter((id) => id !== lessonId) : [...ids, lessonId],
              )
            }
            onOp={(op) => applyOp(op, draft)}
            onDeepen={(lessonId) => setDeepenTarget(lessonId)}
            t={t}
          />
        ))}
      </div>

      <ConfirmDialog
        open={deepenTarget !== null}
        onOpenChange={(open) => !open && setDeepenTarget(null)}
        title={t('preview.deepenTitle')}
        description={t('preview.deepenDescription')}
        confirmLabel={t('preview.deepenConfirm')}
        onConfirm={() => deepenTarget !== null && handleDeepen(deepenTarget, 2)}
      />
    </div>
  )
}

type RowT = (key: string, params?: Record<string, unknown>) => string

/** What a section/module row can ask for — a subset of `PathEditOpDto`. */
type NodeEditOp = Extract<
  PathEditOpDto,
  { kind: 'rename' | 'reorder' | 'exclude' | 'markKnown' | 'unmarkKnown' }
>
/** A lesson row never marks itself known — see `markKnown`'s own "not on a lesson" guard. */
type LessonEditOp = Extract<PathEditOpDto, { kind: 'rename' | 'reorder' | 'exclude' }>

function SectionRow(props: {
  section: SectionNodeDto
  index: number
  count: number
  frozen: boolean
  knownIds: readonly string[]
  selectedLessonIds: string[]
  onToggleLessonSelected: (lessonId: string) => void
  onOp: (op: NodeEditOp) => void
  onDeepen: (lessonId: string) => void
  t: RowT
}) {
  const { section, index, count, frozen, knownIds, onOp, t } = props
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState(section.title)
  const known = knownIds.includes(section.id)

  return (
    <div className="border-border rounded-md border p-3" data-testid={`section-${section.id}`}>
      <div className="flex items-center gap-2">
        {editing ? (
          <Input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            onBlur={() => {
              setEditing(false)
              if (title.trim() !== section.title)
                onOp({ kind: 'rename', nodeId: section.id, title })
            }}
            autoFocus
            className="h-8"
          />
        ) : (
          <button
            type="button"
            className="text-left text-lg font-semibold"
            onClick={() => !frozen && setEditing(true)}
            data-testid={`section-title-${section.id}`}
          >
            {section.title}
          </button>
        )}
        <div className="flex-1" />
        <label className="flex items-center gap-2 text-xs" htmlFor={`section-known-${section.id}`}>
          {t('preview.knownToggle')}
          <Switch
            id={`section-known-${section.id}`}
            checked={known}
            disabled={frozen}
            onCheckedChange={(checked) =>
              onOp({ kind: checked ? 'markKnown' : 'unmarkKnown', nodeId: section.id })
            }
            data-testid={`section-known-${section.id}`}
          />
        </label>
        <IconButton
          aria-label={t('preview.moveUp')}
          variant="ghost"
          disabled={frozen || index === 0}
          onClick={() => onOp({ kind: 'reorder', nodeId: section.id, toIndex: index - 1 })}
        >
          <ArrowUpIcon />
        </IconButton>
        <IconButton
          aria-label={t('preview.moveDown')}
          variant="ghost"
          disabled={frozen || index === count - 1}
          onClick={() => onOp({ kind: 'reorder', nodeId: section.id, toIndex: index + 1 })}
        >
          <ArrowDownIcon />
        </IconButton>
        <IconButton
          aria-label={t('preview.exclude')}
          variant="ghost"
          disabled={frozen}
          onClick={() => onOp({ kind: 'exclude', nodeId: section.id })}
          data-testid={`section-exclude-${section.id}`}
        >
          <Trash2Icon />
        </IconButton>
      </div>

      <div className="mt-2 flex flex-col gap-2 pl-4">
        {section.modules.map((module, moduleIndex) => (
          <ModuleRow
            key={module.id}
            module={module}
            index={moduleIndex}
            count={section.modules.length}
            frozen={frozen}
            knownIds={knownIds}
            selectedLessonIds={props.selectedLessonIds}
            onToggleLessonSelected={props.onToggleLessonSelected}
            onOp={onOp}
            onDeepen={props.onDeepen}
            t={t}
          />
        ))}
      </div>
    </div>
  )
}

function ModuleRow(props: {
  module: ModuleNodeDto
  index: number
  count: number
  frozen: boolean
  knownIds: readonly string[]
  selectedLessonIds: string[]
  onToggleLessonSelected: (lessonId: string) => void
  onOp: (op: NodeEditOp) => void
  onDeepen: (lessonId: string) => void
  t: RowT
}) {
  const { module, index, count, frozen, knownIds, onOp, t } = props
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState(module.title)
  const known = knownIds.includes(module.id)

  return (
    <div className="border-border rounded-md border p-2" data-testid={`module-${module.id}`}>
      <div className="flex items-center gap-2">
        {editing ? (
          <Input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            onBlur={() => {
              setEditing(false)
              if (title.trim() !== module.title) onOp({ kind: 'rename', nodeId: module.id, title })
            }}
            autoFocus
            className="h-8"
          />
        ) : (
          <button
            type="button"
            className="text-left font-medium"
            onClick={() => !frozen && setEditing(true)}
            data-testid={`module-title-${module.id}`}
          >
            {module.title}
          </button>
        )}
        <Badge variant="neutral">{Math.round(module.estimated_minutes)} min</Badge>
        <div className="flex-1" />
        <label className="flex items-center gap-2 text-xs" htmlFor={`module-known-${module.id}`}>
          {t('preview.knownToggle')}
          <Switch
            id={`module-known-${module.id}`}
            checked={known}
            disabled={frozen}
            onCheckedChange={(checked) =>
              onOp({ kind: checked ? 'markKnown' : 'unmarkKnown', nodeId: module.id })
            }
            data-testid={`module-known-${module.id}`}
          />
        </label>
        <IconButton
          aria-label={t('preview.moveUp')}
          variant="ghost"
          disabled={frozen || index === 0}
          onClick={() => onOp({ kind: 'reorder', nodeId: module.id, toIndex: index - 1 })}
        >
          <ArrowUpIcon />
        </IconButton>
        <IconButton
          aria-label={t('preview.moveDown')}
          variant="ghost"
          disabled={frozen || index === count - 1}
          onClick={() => onOp({ kind: 'reorder', nodeId: module.id, toIndex: index + 1 })}
        >
          <ArrowDownIcon />
        </IconButton>
        <IconButton
          aria-label={t('preview.exclude')}
          variant="ghost"
          disabled={frozen}
          onClick={() => onOp({ kind: 'exclude', nodeId: module.id })}
          data-testid={`module-exclude-${module.id}`}
        >
          <Trash2Icon />
        </IconButton>
      </div>

      <ul className="mt-2 flex flex-col gap-1 pl-4">
        {module.lessons.map((lesson, lessonIndex) => (
          <LessonRow
            key={lesson.id}
            lesson={lesson}
            index={lessonIndex}
            count={module.lessons.length}
            frozen={frozen}
            selected={props.selectedLessonIds.includes(lesson.id)}
            onToggleSelected={() => props.onToggleLessonSelected(lesson.id)}
            onOp={onOp}
            onDeepen={() => props.onDeepen(lesson.id)}
            t={t}
          />
        ))}
      </ul>
    </div>
  )
}

function LessonRow(props: {
  lesson: CoreLessonNodeDto
  index: number
  count: number
  frozen: boolean
  selected: boolean
  onToggleSelected: () => void
  onOp: (op: LessonEditOp) => void
  onDeepen: () => void
  t: RowT
}) {
  const { lesson, index, count, frozen, onOp, t } = props
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState(lesson.title)

  return (
    <li className="flex items-center gap-2 text-sm" data-testid={`lesson-${lesson.id}`}>
      <input
        type="checkbox"
        checked={props.selected}
        disabled={frozen}
        onChange={props.onToggleSelected}
        aria-label={t('preview.selectLesson')}
        data-testid={`lesson-select-${lesson.id}`}
      />
      {editing ? (
        <Input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          onBlur={() => {
            setEditing(false)
            if (title.trim() !== lesson.title) onOp({ kind: 'rename', nodeId: lesson.id, title })
          }}
          autoFocus
          className="h-7"
        />
      ) : (
        <button
          type="button"
          className="flex-1 truncate text-left"
          onClick={() => !frozen && setEditing(true)}
          data-testid={`lesson-title-${lesson.id}`}
        >
          {lesson.title}
        </button>
      )}
      <Badge variant="neutral">{Math.round(lesson.estimated_minutes)} min</Badge>
      <Button
        variant="ghost"
        size="sm"
        disabled={frozen}
        onClick={props.onDeepen}
        data-testid={`lesson-deepen-${lesson.id}`}
      >
        {t('preview.deepen')}
      </Button>
      <IconButton
        aria-label={t('preview.moveUp')}
        variant="ghost"
        size="sm"
        disabled={frozen || index === 0}
        onClick={() => onOp({ kind: 'reorder', nodeId: lesson.id, toIndex: index - 1 })}
      >
        <ArrowUpIcon />
      </IconButton>
      <IconButton
        aria-label={t('preview.moveDown')}
        variant="ghost"
        size="sm"
        disabled={frozen || index === count - 1}
        onClick={() => onOp({ kind: 'reorder', nodeId: lesson.id, toIndex: index + 1 })}
      >
        <ArrowDownIcon />
      </IconButton>
      <IconButton
        aria-label={t('preview.exclude')}
        variant="ghost"
        size="sm"
        disabled={frozen}
        onClick={() => onOp({ kind: 'exclude', nodeId: lesson.id })}
        data-testid={`lesson-exclude-${lesson.id}`}
      >
        <Trash2Icon />
      </IconButton>
    </li>
  )
}
