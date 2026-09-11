import type { ActivityDraft } from '@retenia/activity-schema'

/**
 * The NBME item-writing rules (`docs/spec/04-path-generation.md` §1.4: *"NBME clinical
 * vignettes (one-best-answer, homogeneous options, no 'all of the above')"*; §4 and §9's P9
 * row), as code — the half of §7's "the AI proposes, the code validates" that the P9 prompt
 * asks for and this refuses when it was not delivered.
 *
 * Generation rules, like `mcqIssue`: an item the bank will serve blind, in a diagnostic or an
 * exam form, must not be answerable from its wording alone. They are not properties of every
 * multiple-choice question that can exist, so they live here, where over-generation makes a
 * rejection free, and not in the shared validator that also judges hand-written fixtures.
 *
 * Spanish and English, because those are the two languages a path is written in.
 */

export const NBME_CODES = [
  'nbme_single_best_answer',
  'nbme_all_none_of_the_above',
  'nbme_absolute_term',
  'nbme_heterogeneous_options',
  'nbme_longest_is_answer',
  'nbme_stem_not_question',
  'nbme_vague_lead_in',
  'nbme_distractor_without_misconception',
] as const
export type NbmeCode = (typeof NBME_CODES)[number]

export interface NbmeIssue {
  readonly code: NbmeCode
  readonly message: string
}

export interface NbmeContext {
  /** The request listed misconceptions, so every distractor must name the one it came from. */
  readonly misconceptionsAvailable: boolean
  /** Option id → misconception id, as the author declared it. */
  readonly misconceptionByOption: Readonly<Record<string, string>>
}

/** A letter or digit on either side is a word boundary JavaScript's `\b` cannot see in "sólo". */
function wordPattern(words: readonly string[]): RegExp {
  return new RegExp(`(?<![\\p{L}\\p{N}])(?:${words.join('|')})(?![\\p{L}\\p{N}])`, 'iu')
}

/** "All/none of the above", "both", "A and B" — options that are about the other options. */
const ABOUT_OTHER_OPTIONS: readonly RegExp[] = [
  /\b(?:all|none|both)\s+of\s+(?:the\s+)?(?:above|these|them|the\s+options|the\s+previous)\b/iu,
  wordPattern([
    'todas\\s+(?:las\\s+)?(?:anteriores|opciones|respuestas)',
    'ninguna\\s+(?:de\\s+)?(?:las\\s+)?(?:anteriores|opciones|respuestas)',
    'ambas\\s+(?:son\\s+)?(?:correctas|anteriores|opciones)',
    'todas\\s+son\\s+correctas',
  ]),
  /^\s*(?:both|ambas|ambos)\b/iu,
  /(?<![\p{L}\p{N}])[a-d]\s*\)?\s+(?:and|y|e)\s+[a-d](?![\p{L}\p{N}])/iu,
]

/** Absolutes that tell a test-wise learner which options are wrong. */
const ABSOLUTE_TERMS = wordPattern([
  'always',
  'never',
  'only',
  'none',
  'every',
  'siempre',
  'nunca',
  'jam[aá]s',
  '[uú]nicamente',
  'solamente',
  'ninguno',
  'ninguna',
  'todos',
  'todas',
])

/** Lead-ins that cannot be answered with the options covered. */
const VAGUE_LEAD_INS: readonly RegExp[] = [
  /which\s+of\s+the\s+following\s+(?:statements?\s+)?(?:is|are)\s+(?:true|correct|false|incorrect|right)/iu,
  /which\s+(?:statement|option|answer)\s+is\s+(?:true|correct|false|incorrect)/iu,
  /what\s+is\s+true\s+(?:about|of|regarding)/iu,
  /cu[aá]l(?:es)?\s+de\s+(?:las|los)\s+siguientes\s+(?:afirmaciones\s+|opciones\s+|enunciados\s+)?(?:es|son)\s+(?:verdader|correct|fals|incorrect)/iu,
  /qu[eé]\s+es\s+(?:verdad|cierto|correcto)\s+(?:sobre|acerca\s+de|respecto\s+de)/iu,
  /se[nñ]al[aáe]\s+la\s+(?:opci[oó]n|afirmaci[oó]n|respuesta)\s+correcta/iu,
  /eleg[ií]\s+la\s+(?:opci[oó]n|afirmaci[oó]n)\s+correcta/iu,
]

/** Past this many words the longest option is a paragraph beside a phrase. */
const HETEROGENEOUS_RATIO = 3
const HETEROGENEOUS_MIN_GAP_WORDS = 6
/** The answer is the one written with care: markedly longer than every distractor. */
const LONGEST_RATIO = 1.5
const LONGEST_MIN_GAP_CHARS = 15

function words(text: string): number {
  return text.trim().split(/\s+/u).filter(Boolean).length
}

function plain(markdown: string): string {
  return markdown
    .normalize('NFC')
    .replace(/[*_`#>]/gu, '')
    .replace(/\s+/gu, ' ')
    .trim()
}

/** The question as the learner reads it: the set's own stem when it has one, else the prompt. */
export function stemOf(draft: ActivityDraft): string {
  if (draft.payload.family !== 'choice') return plain(draft.prompt)
  const stem = draft.payload.sets[0]?.stem
  return plain(stem ?? draft.prompt)
}

export function nbmeIssues(draft: ActivityDraft, context: NbmeContext): NbmeIssue[] {
  if (draft.payload.family !== 'choice') return []
  const set = draft.payload.sets[0]
  if (set === undefined) return []
  const issues: NbmeIssue[] = []
  const stem = stemOf(draft)

  if (draft.type === 'true_false') {
    // A true/false item is a statement, not a question, and its options are labels: only the
    // absolute-term rule applies, to the statement itself — "always" is the classic tell.
    if (ABSOLUTE_TERMS.test(stem)) {
      issues.push({
        code: 'nbme_absolute_term',
        message: 'the statement uses an absolute term ("siempre", "nunca", …) that gives it away',
      })
    }
    return issues
  }

  const options = set.options.map((option) => ({ ...option, text: plain(option.text) }))
  const correct = options.filter((option) => option.correct)
  if (correct.length !== 1) {
    issues.push({
      code: 'nbme_single_best_answer',
      message: `a one-best-answer item has exactly one keyed option, got ${correct.length}`,
    })
  }

  if (options.some((option) => ABOUT_OTHER_OPTIONS.some((pattern) => pattern.test(option.text)))) {
    issues.push({
      code: 'nbme_all_none_of_the_above',
      message: 'an option refers to the other options ("all/none of the above", "A and B")',
    })
  }

  if (options.some((option) => ABSOLUTE_TERMS.test(option.text))) {
    issues.push({
      code: 'nbme_absolute_term',
      message: 'an option uses an absolute term ("always", "never", "solamente", …) that cues it',
    })
  }

  const counts = options.map((option) => words(option.text))
  const longest = Math.max(...counts)
  const shortest = Math.max(1, Math.min(...counts))
  if (
    longest / shortest >= HETEROGENEOUS_RATIO &&
    longest - shortest >= HETEROGENEOUS_MIN_GAP_WORDS
  ) {
    issues.push({
      code: 'nbme_heterogeneous_options',
      message: `options range from ${shortest} to ${longest} words; they must be homogeneous`,
    })
  }

  const key = correct[0]
  if (key !== undefined) {
    const distractors = options.filter((option) => !option.correct)
    const longestDistractor = Math.max(0, ...distractors.map((option) => option.text.length))
    if (
      distractors.length > 0 &&
      key.text.length >= longestDistractor * LONGEST_RATIO &&
      key.text.length - longestDistractor >= LONGEST_MIN_GAP_CHARS
    ) {
      issues.push({
        code: 'nbme_longest_is_answer',
        message: 'the keyed option is markedly longer than every distractor',
      })
    }
  }

  if (!/\?\s*$/u.test(stem)) {
    issues.push({
      code: 'nbme_stem_not_question',
      message: 'the stem must end in a question a learner could answer with the options covered',
    })
  }
  if (VAGUE_LEAD_INS.some((pattern) => pattern.test(stem))) {
    issues.push({
      code: 'nbme_vague_lead_in',
      message:
        'the lead-in ("which of the following is true?") cannot be answered without the options',
    })
  }

  if (context.misconceptionsAvailable) {
    const bare = options.filter(
      (option) => !option.correct && context.misconceptionByOption[option.id] === undefined,
    )
    if (bare.length > 0) {
      issues.push({
        code: 'nbme_distractor_without_misconception',
        message: `${bare.length} distractor(s) name no misconception; each must be a plausible error`,
      })
    }
  }

  return issues
}
