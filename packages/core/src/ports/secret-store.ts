/**
 * The names sub-phase 3.5 provisions storage for (`docs/spec/06-ai-providers.md`'s provider
 * matrix). Adding a provider later is a one-line addition here, not a schema change: secrets
 * live under `settings.secrets.<name>` (`SettingsRepository.setRaw`/`getRaw`), so the row
 * shape never changes.
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

export type SecretName = (typeof SECRET_NAMES)[number]

/**
 * API keys and tokens, main-process only (CLAUDE.md: "Secrets ... only ever stored via
 * Electron's `safeStorage`, in the main process — never in renderer state, localStorage, or
 * plain files"). The renderer only ever sees `hasSecret`/a masked preview through IPC —
 * never plaintext (`apps/desktop/src/main/secrets/store.ts` is the implementation, backed by
 * `safeStorage.encryptString`/`decryptString`).
 */
export interface SecretStore {
  setSecret(name: SecretName, plaintext: string): Promise<void>
  /** `undefined` when nothing is stored, or the stored ciphertext can no longer be
   *  decrypted (e.g. `safeStorage`'s OS-level key changed). */
  getSecret(name: SecretName): Promise<string | undefined>
  deleteSecret(name: SecretName): Promise<void>
  hasSecret(name: SecretName): Promise<boolean>
}
