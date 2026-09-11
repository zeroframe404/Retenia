import type { ActivityLabels } from '@retenia/activities'
import { useMemo } from 'react'
import { useT } from '../../i18n/use-t'

/**
 * `<ActivityHost/>`'s strings in the app's language, worded for the diagnostic.
 *
 * `@retenia/activities` ships English defaults and takes translations through `labels`
 * (`packages/activities/src/labels.ts`), because the i18n instance lives in the app. The
 * diagnostic words a few of them its own way — "Responder" rather than "Comprobar", and a
 * deferred-feedback line that says there are no corrections at all rather than "at the end of
 * the exam" — so these live under `path:diagnostic.activity`, not in a shared namespace.
 *
 * The host fills its own `{name}` placeholders with `formatLabel` *after* i18next has already
 * run ICU over the string. A label that carries one is therefore asked for with the
 * placeholder handed back as its own value, which leaves `{n}` in the text for the host.
 */
export function useDiagnosticActivityLabels(): Partial<ActivityLabels> {
  const t = useT('path')
  return useMemo(() => {
    const label = (key: string, keep: readonly string[] = []) =>
      t(`diagnostic.activity.${key}`, Object.fromEntries(keep.map((name) => [name, `{${name}}`])))
    return {
      check: label('check'),
      skip: label('skip'),
      grading: label('grading'),
      gradeFailed: label('gradeFailed'),
      elapsed: label('elapsed'),
      timeUp: label('timeUp'),
      deferredFeedback: label('deferredFeedback'),
      confidenceHeading: label('confidenceHeading'),
      confidence: {
        sure: label('confidence.sure'),
        unsure: label('confidence.unsure'),
        guessed: label('confidence.guessed'),
      },
      loadingRenderer: label('loadingRenderer'),
      unsupportedType: label('unsupportedType'),
      gapLabel: label('gapLabel', ['n']),
      yourAnswer: label('yourAnswer'),
      answerAreaHeading: label('answerAreaHeading'),
      unplacedHeading: label('unplacedHeading'),
      dragKeyboardHint: label('dragKeyboardHint'),
      pickUp: label('pickUp'),
      drop: label('drop'),
      removePlacement: label('removePlacement'),
      moveUp: label('moveUp'),
      moveDown: label('moveDown'),
      pickedUpAnnouncement: label('pickedUpAnnouncement', ['item']),
      placedAnnouncement: label('placedAnnouncement', ['item', 'zone']),
      cancelledAnnouncement: label('cancelledAnnouncement', ['item']),
      removedAnnouncement: label('removedAnnouncement', ['item', 'zone']),
      movedAnnouncement: label('movedAnnouncement', ['item', 'position', 'total']),
      playAudio: label('playAudio'),
      audioUnavailable: label('audioUnavailable'),
    }
  }, [t])
}
