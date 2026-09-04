import type { ActivityType } from '@retenia/activity-schema'
import { ACTIVITY_TYPES } from '@retenia/activity-schema'

/**
 * The `generator.promptTemplate` stub of §9's registry entry.
 *
 * These are **stubs on purpose**: §11's real generation prompts (P1–P11, `docs/spec/04-path-generation.md`)
 * are written in sub-phase 8.3 against the retrieval pipeline, with the source chunks, the
 * skill-kind × type matrix and the blind-solve critic around them. What the registry needs today is
 * that every type *has* a template, that it names the family schema the call must be given (§7's
 * "one schema per family per call"), and that the fixed per-type rules of §11 — "the answer cannot
 * appear in the stem", plausible distractors, option counts — travel with the type rather than
 * being remembered by whoever writes the prompt.
 *
 * `{{count}}`, `{{lang}}` and `{{source}}` are the placeholders `packages/ai` fills in.
 */

export interface PromptStubInput {
  type: ActivityType
  /** One sentence: what this type asks the learner to do. */
  focus: string
  /** The §11 rules specific to this type, on top of the shared ones below. */
  rules?: readonly string[]
}

/** Rules §11 applies to every generated item, whatever the type. */
export const SHARED_GENERATION_RULES: readonly string[] = Object.freeze([
  'Every substantive claim is supported by the source; add a `sources[]` entry with the block id.',
  'The answer must not appear in `prompt` or in `instructions`.',
  'Ids inside the payload are short, unique within the activity, and never reused.',
  'Write `prompt`, options and feedback in {{lang}}.',
])

export function promptStub({ type, focus, rules = [] }: PromptStubInput): string {
  const meta = ACTIVITY_TYPES[type]
  return [
    `# Generate \`${type}\` activities`,
    '',
    focus,
    '',
    `Produce {{count}} items for the \`${meta.family}\` payload schema you were given, with`,
    `\`type\` set to \`${type}\`. Source material:`,
    '',
    '{{source}}',
    '',
    '## Rules',
    ...[...rules, ...SHARED_GENERATION_RULES].map((rule) => `- ${rule}`),
  ].join('\n')
}
