import type { SecretName, SecretStore, SettingsRepository } from '@retenia/core'
import { safeStorage as electronSafeStorage } from 'electron'

/** The slice of Electron's `safeStorage` this needs, so tests can pass a fake instead of
 *  depending on the OS keychain/DPAPI being available in CI. */
export interface SafeStorageLike {
  isEncryptionAvailable(): boolean
  encryptString(plainText: string): Buffer
  decryptString(encrypted: Buffer): string
}

function settingKey(name: SecretName): string {
  return `secrets.${name}`
}

/**
 * API keys and tokens, encrypted with `safeStorage` (DPAPI on Windows, Keychain on macOS)
 * before they ever reach disk. The ciphertext rides in the ordinary `settings` table under
 * `secrets.<name>` — `SettingsRepository.setRaw`/`getRaw` already handle keys outside the
 * typed registry — base64-encoded, since `settings.value` is `json_valid` text and a raw
 * `Buffer` is not representable there.
 *
 * Never returns plaintext to anything but the caller of `getSecret` (main-process only,
 * `docs/spec/07-architecture.md`'s AI gateway); the IPC handlers in `../ipc/handlers.ts`
 * only ever hand the renderer a boolean or a masked preview.
 */
export function createSecretStore(
  settings: SettingsRepository,
  safeStorage: SafeStorageLike = electronSafeStorage,
): SecretStore {
  return {
    async setSecret(name, plaintext) {
      if (!safeStorage.isEncryptionAvailable()) {
        throw new Error(
          `secrets: OS-level encryption is unavailable, refusing to store "${name}" in the clear`,
        )
      }
      const ciphertext = safeStorage.encryptString(plaintext).toString('base64')
      await settings.setRaw(settingKey(name), ciphertext)
    },

    async getSecret(name) {
      const stored = await settings.getRaw(settingKey(name))
      if (typeof stored !== 'string' || stored.length === 0) return undefined
      try {
        return safeStorage.decryptString(Buffer.from(stored, 'base64'))
      } catch {
        // The OS-level key changed (a different user account, a restored profile on
        // another machine) or the value was never valid ciphertext — either way, the
        // secret is unreadable, not a crash.
        return undefined
      }
    },

    async deleteSecret(name) {
      await settings.unset(settingKey(name))
    },

    async hasSecret(name) {
      const stored = await settings.getRaw(settingKey(name))
      return typeof stored === 'string' && stored.length > 0
    },
  }
}

/** `••••` plus the last 4 characters, or `null` when there is nothing to preview. What the
 *  renderer is allowed to see of a secret — never enough to reconstruct it. */
export function maskSecret(plaintext: string | undefined): string | null {
  if (!plaintext) return null
  const tail = plaintext.slice(-4)
  return `••••${tail}`
}
