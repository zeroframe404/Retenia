import Ajv2020, { type ErrorObject } from 'ajv/dist/2020.js'
import { type JsonSchema, STRICT_FORMATS } from '../json-schema/strict'

/**
 * A draft 2020-12 validator over an exported activity schema — the "dry run" of Claude's
 * strict mode: the schema must compile under ajv's own strict mode (no unknown keywords) and
 * accept every valid fixture. Dev-only; `ajv` is not a runtime dependency.
 */

export interface StrictValidation {
  ok: boolean
  errors: string[]
}

export function compileStrictSchema(schema: JsonSchema): (data: unknown) => StrictValidation {
  const ajv = new Ajv2020({ strict: true, strictTypes: false, allErrors: true })
  // Strict mode's formats are validated by Claude; here they only need to be known keywords.
  for (const format of STRICT_FORMATS) ajv.addFormat(format, true)
  const validate = ajv.compile(schema)
  return (data) => {
    const ok = validate(data)
    const errors = (validate.errors ?? []).map((error: ErrorObject) =>
      `${error.instancePath || '/'} ${error.message ?? ''}`.trim(),
    )
    return { ok: ok === true, errors }
  }
}
