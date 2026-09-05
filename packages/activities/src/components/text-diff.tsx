import { cn } from '@retenia/ui'
import { useActivity } from '../host/activity-context'

/**
 * The character-level diff shown under a `text_input` answer that missed by a little (§4 row 5,
 * "typed input... shows the diff on a near miss"): the FUZ grader already tolerates a typo
 * (`docs/spec/03-activities.md` §10's relative edit distance ≤ 0.2), so once a response is close
 * but not exact, pointing at *which* characters differ is more useful than repeating the model
 * answer on its own.
 */

export type DiffOp = 'equal' | 'delete' | 'insert'
export interface DiffToken {
  type: DiffOp
  text: string
}

/**
 * A minimal Levenshtein alignment (no transposition, unlike the grader's Damerau-Levenshtein):
 * reconstructing a diff from a transposition-aware distance would need a different backtrace, and
 * a plain insert+delete pair reads just as clearly for the short answers this renders.
 */
export function diffChars(got: string, expected: string): DiffToken[] {
  const a = [...got]
  const b = [...expected]
  const n = a.length
  const m = b.length
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      const row = lcs[i] as number[]
      row[j] =
        a[i] === b[j]
          ? ((lcs[i + 1] as number[])[j + 1] as number) + 1
          : Math.max((lcs[i + 1] as number[])[j] as number, (lcs[i] as number[])[j + 1] as number)
    }
  }

  const tokens: DiffToken[] = []
  function push(type: DiffOp, text: string) {
    const last = tokens.at(-1)
    if (last && last.type === type) last.text += text
    else tokens.push({ type, text })
  }

  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      push('equal', a[i] as string)
      i += 1
      j += 1
    } else if (((lcs[i + 1] as number[])[j] as number) >= ((lcs[i] as number[])[j + 1] as number)) {
      push('delete', a[i] as string)
      i += 1
    } else {
      push('insert', b[j] as string)
      j += 1
    }
  }
  while (i < n) {
    push('delete', a[i] as string)
    i += 1
  }
  while (j < m) {
    push('insert', b[j] as string)
    j += 1
  }
  return tokens
}

export interface TextDiffProps {
  /** What the learner typed. */
  got: string
  /** The canonical answer it was matched against. */
  expected: string
}

/** Two lines built from one token stream: what was typed, struck through where it went wrong, and
 *  the model answer, underlined where it adds or changes a character. */
export function TextDiff({ got, expected }: TextDiffProps) {
  const { labels } = useActivity()
  const tokens = diffChars(got, expected)

  return (
    <div className="flex flex-col gap-1 text-sm" data-testid="answer-diff">
      <p>
        <span className="text-muted">{labels.yourAnswer}: </span>
        {tokens
          .filter((token) => token.type !== 'insert')
          .map((token, index) => (
            <span
              // biome-ignore lint/suspicious/noArrayIndexKey: tokens never reorder within one render.
              key={index}
              className={cn(token.type === 'delete' && 'text-incorrect line-through')}
            >
              {token.text}
            </span>
          ))}
      </p>
      <p>
        <span className="text-muted">{labels.modelAnswer}: </span>
        {tokens
          .filter((token) => token.type !== 'delete')
          .map((token, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: tokens never reorder within one render.
            <span key={index} className={cn(token.type === 'insert' && 'text-correct underline')}>
              {token.text}
            </span>
          ))}
      </p>
    </div>
  )
}
