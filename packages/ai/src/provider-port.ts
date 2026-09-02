/**
 * Port every AI provider adapter implements (real Anthropic/Google/Azure/local adapters
 * land behind AI SDK 7 in sub-phase 7.x). Roles (`smart`, `cheap`, `vision`, `audio`,
 * `embed`, `local`) are assigned to a concrete provider by app config, never hardcoded here.
 */
export type ProviderRole = 'smart' | 'cheap' | 'vision' | 'audio' | 'embed' | 'local'

export interface ProviderPort {
  readonly role: ProviderRole
  readonly id: string
  complete(prompt: string): Promise<string>
}
