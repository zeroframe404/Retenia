import type { Response } from '@retenia/activity-schema'
import { cn } from '@retenia/ui'
import { ChevronDownIcon } from 'lucide-react'
import { useId } from 'react'
import { RichText } from '../components/rich-text'
import { useFamilyActivity } from '../host/activity-context'

/**
 * The `disclosure` family (§7): `disclosure_block` — the accordion / tabs / process / timeline
 * blocks a lesson's *theory* half is built from (§12).
 *
 * It is one of the nine lesson-only rows of §4: nothing here feeds the scheduler, and the "grade"
 * is completeness — which sections were opened. That is why the response is `openedIds` and why
 * the family grader returns a `null` rating: reading is not recall.
 *
 * Native `<details>`/`<summary>`, so it opens with Enter or Space, is announced as expandable, and
 * keeps working with JavaScript half-loaded.
 */
export function Renderer() {
  const { activity, response, respond } = useFamilyActivity('disclosure')
  const { items, presentation } = activity.payload
  const answer: Response<'disclosure'> = response ?? { openedIds: [] }
  const groupId = useId()

  function open(id: string) {
    if (answer.openedIds.includes(id)) return
    respond({ openedIds: [...answer.openedIds, id] })
  }

  return (
    <div
      className="flex flex-col gap-2"
      data-testid="renderer-disclosure"
      data-presentation={presentation ?? 'accordion'}
    >
      {items.map((item, index) => (
        <details
          key={item.id}
          name={presentation === 'tabs' ? groupId : undefined}
          data-testid={`disclosure-${item.id}`}
          onToggle={(event) => event.currentTarget.open && open(item.id)}
          className="border-border rounded-md border"
        >
          <summary
            className={cn(
              'flex cursor-pointer items-center gap-2 p-3 text-sm font-medium',
              'focus-visible:ring-brand-500 focus-visible:outline-none focus-visible:ring-2',
            )}
          >
            <ChevronDownIcon aria-hidden className="size-4" />
            {presentation === 'process' || presentation === 'timeline' ? (
              <span className="text-muted tabular-nums">{index + 1}.</span>
            ) : null}
            {item.title}
          </summary>
          <div className="px-3 pb-3">
            <RichText>{item.body}</RichText>
          </div>
        </details>
      ))}
    </div>
  )
}
