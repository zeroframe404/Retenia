/**
 * Structured outputs: the schema adapter, the sanitizer, the injection envelope and the
 * validation/repair loop (sub-phase 7.2). Pure — nothing here imports the AI SDK.
 */

export type { JsonSchemaNode } from './json-schema'
export {
  relaxJsonSchema,
  SchemaNotRepresentableError,
  toStrictJsonSchema,
} from './json-schema'
export {
  buildRepairPrompt,
  describeIssues,
  extractJsonText,
  MAX_COMPLETION_CHARS,
  MAX_QUOTED_OUTPUT_CHARS,
  MAX_REPORTED_ISSUES,
  parseJsonCompletion,
} from './parse'
export type {
  StructuredArrayRequest,
  StructuredObjectRequest,
  StructuredRequestBase,
  StructuredResult,
} from './run-structured'
export {
  DEFAULT_MAX_CONTINUATIONS,
  runStructured,
  structuredRequestFor,
  tolerantArray,
  validateStructuredCompletion,
} from './run-structured'
export type { SanitizeLimits } from './sanitize'
export { DEFAULT_SANITIZE_LIMITS, sanitizeOutput, sanitizeString } from './sanitize'
export type { WrappedUserContent } from './user-content'
export { USER_CONTENT_INSTRUCTIONS, USER_CONTENT_TAG, wrapUserContent } from './user-content'
