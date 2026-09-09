/**
 * The PII redaction hook (`docs/spec/06-ai-providers.md` §8's privacy notes: DeepSeek and
 * other Chinese providers are "an explicit user choice, never for sensitive content").
 *
 * Deliberately a standalone function rather than something wired into `runOnce` for every
 * request: `TextGenerationRequest` is shared with `@retenia/ingest` and
 * `@retenia/activity-ai`, most of which send a book chunk or a learner's answer that is
 * *supposed* to reach the model verbatim — redacting it would corrupt the very content the
 * call exists to process. The one caller this is for is a feature that sends the user's own
 * free-form notes to a cloud provider (the notebook chat over notes) when "prefer local" is
 * off, and it decides for itself whether the setting is enabled and which field to run this
 * over before building the request.
 *
 * A placeholder, matching the sub-phase's brief exactly: two regexes, not an NLP model. It
 * over-redacts on invalid-looking input and under-redacts on anything cleverly obfuscated;
 * neither is a promise this function makes.
 */

const EMAIL_PATTERN = /[\w.+-]+@[\w-]+\.[\w.-]+/gu

/**
 * Loose on purpose: a run of 7+ digits, optionally grouped by spaces/dashes/dots/parens and
 * with a leading `+`. Tight enough to leave "3 chapters" and "page 42" alone, loose enough
 * to catch the phone-number shapes actually seen in personal notes across the six v1
 * locales without a per-locale format table.
 */
const PHONE_PATTERN = /(?:\+\d{1,3}[\s.-]?)?(?:\(\d{1,4}\)[\s.-]?)?\d[\d\s.-]{5,}\d/gu

export interface PiiRedactionResult {
  readonly text: string
  readonly redacted: boolean
}

/** Replace anything that looks like an email address or a phone number with a placeholder. */
export function redactPii(text: string): PiiRedactionResult {
  let redacted = false
  const withoutEmails = text.replace(EMAIL_PATTERN, () => {
    redacted = true
    return '«email»'
  })
  const withoutPhones = withoutEmails.replace(PHONE_PATTERN, () => {
    redacted = true
    return '«phone»'
  })
  return { text: withoutPhones, redacted }
}
