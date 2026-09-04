import type { Activity, Response, ResponseFamily } from '@retenia/activity-schema'

/**
 * The "nothing was answered" response of each family.
 *
 * A user can always submit — running out of time submits too (§7's `timeLimitSec`) — and the
 * graders take a *parsed* response, not `null`. Turning an untouched activity into an explicit
 * empty answer keeps that path inside the normal grading flow: it scores 0, it is logged as an
 * attempt, and `toRating` reads it as Again, which is exactly what an unanswered item is.
 */
export function emptyResponse(activity: Activity): unknown {
  switch (activity.family) {
    case 'choice':
      return {
        sets: activity.payload.sets.map(() => ({ selected: [] })),
      } satisfies Response<'choice'>
    case 'text_input':
      return { value: '' } satisfies Response<'text_input'>
    case 'cloze':
      return { gaps: {} } satisfies Response<'cloze'>
    case 'long_text':
      return { text: '' } satisfies Response<'long_text'>
    case 'pairs':
      return { matches: [] } satisfies Response<'pairs'>
    case 'ordering':
      return { order: [] } satisfies Response<'ordering'>
    case 'categorize':
      return { placements: {} } satisfies Response<'categorize'>
    case 'text_mark':
      return { markedIds: [] } satisfies Response<'text_mark'>
    // M-self: an untouched flashcard is one the user did not recall.
    case 'cards':
      return { rating: 1 } satisfies Response<'cards'>
    case 'disclosure':
      return { openedIds: [] } satisfies Response<'disclosure'>
    default:
      // A family with no response schema yet (the 13 placeholders of §7); its renderer, when it
      // lands, brings its own empty shape with it.
      return null
  }
}

/** The response families whose empty shape `emptyResponse` knows — the MVP ten. */
export function hasEmptyResponse(family: string): family is ResponseFamily {
  return (
    family === 'choice' ||
    family === 'text_input' ||
    family === 'cloze' ||
    family === 'long_text' ||
    family === 'pairs' ||
    family === 'ordering' ||
    family === 'categorize' ||
    family === 'text_mark' ||
    family === 'cards' ||
    family === 'disclosure'
  )
}
