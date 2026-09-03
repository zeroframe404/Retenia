import { z } from 'zod'
import { defineContract } from '../define'

/**
 * Mirrors `SECRET_NAMES` in `packages/core/src/ports/secret-store.ts`. Redeclared rather
 * than imported: this package is a leaf by architectural rule (`tooling/scripts/
 * check-deps.mjs` pins `ipc-contract: []`), so it cannot depend on `@retenia/core`.
 * `secrets.test.ts` asserts the two lists still agree.
 */
export const SECRET_NAMES = [
  'anthropic',
  'google',
  'openai',
  'azure_speech',
  'elevenlabs',
  'openrouter',
  'deepgram',
  'bfl',
  'recraft',
] as const
export const secretNameSchema = z.enum(SECRET_NAMES)
export type SecretName = z.infer<typeof secretNameSchema>

/**
 * API keys and tokens (`docs/spec/06-ai-providers.md`). The main process is the only place
 * that ever sees plaintext (CLAUDE.md): `secrets.get` answers with `hasSecret` and a masked
 * preview only, never the key itself.
 */
export const secretsChannels = defineContract({
  'secrets.set': {
    input: z.object({ name: secretNameSchema, value: z.string().min(1) }),
    output: z.object({ ok: z.literal(true) }),
  },
  'secrets.get': {
    input: z.object({ name: secretNameSchema }),
    output: z.object({
      hasSecret: z.boolean(),
      /** `••••` plus the last 4 characters, or `null` when nothing is stored. */
      preview: z.string().nullable(),
    }),
  },
  'secrets.delete': {
    input: z.object({ name: secretNameSchema }),
    output: z.object({ ok: z.literal(true) }),
  },
})
