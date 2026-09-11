/**
 * Port every AI provider adapter implements (real Anthropic/Google/Azure/local adapters
 * land behind AI SDK 7 in sub-phase 7.x). Roles (`smart`, `cheap`, `judge`, `vision`,
 * `audio`, `embed`, `local`) are assigned to a concrete provider by app config, never
 * hardcoded here. `judge` is the pedagogy judge of `docs/spec/04-path-generation.md` §5
 * gate 9 — "a model different from the generator" — and `roles.ts` is what keeps it so.
 */
export type ProviderRole = 'smart' | 'cheap' | 'judge' | 'vision' | 'audio' | 'embed' | 'local'

export interface ProviderPort {
  readonly role: ProviderRole
  readonly id: string
  complete(prompt: string): Promise<string>
}
