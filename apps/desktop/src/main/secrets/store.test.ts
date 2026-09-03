import type { JsonValue, SettingsRepository } from '@retenia/core'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// `createSecretStore`'s default parameter references `electron`'s `safeStorage`; every
// test here passes an explicit fake instead, but the import itself still has to resolve
// without pulling in the real (unbuilt-in-this-workspace) Electron binary.
vi.mock('electron', () => ({ safeStorage: undefined }))

const { createSecretStore, maskSecret } = await import('./store')
type SafeStorageLike = import('./store').SafeStorageLike

/** A fake `SettingsRepository`, just enough for `getRaw`/`setRaw`/`unset` (what
 *  `SecretStore` actually calls). */
function fakeSettingsRepo(): SettingsRepository {
  const store = new Map<string, JsonValue>()
  return {
    get: vi.fn(),
    getStored: vi.fn(),
    getRaw: vi.fn(async (key: string) => store.get(key)),
    set: vi.fn(),
    setRaw: vi.fn(async (key: string, value: JsonValue) => {
      store.set(key, value)
    }),
    all: vi.fn(),
    unset: vi.fn(async (key: string) => {
      store.delete(key)
    }),
  } as unknown as SettingsRepository
}

/** A fake `safeStorage`: real "encryption" here is just base64, which is enough to prove
 *  `SecretStore` never stores or returns the plaintext directly. */
function fakeSafeStorage(available = true): SafeStorageLike {
  return {
    isEncryptionAvailable: () => available,
    encryptString: (plainText: string) => Buffer.from(`enc:${plainText}`, 'utf-8'),
    decryptString: (encrypted: Buffer) => {
      const text = encrypted.toString('utf-8')
      if (!text.startsWith('enc:')) throw new Error('not valid ciphertext')
      return text.slice('enc:'.length)
    },
  }
}

describe('createSecretStore', () => {
  let settings: SettingsRepository

  beforeEach(() => {
    settings = fakeSettingsRepo()
  })

  it('round-trips a secret through safeStorage', async () => {
    const store = createSecretStore(settings, fakeSafeStorage())

    await store.setSecret('anthropic', 'sk-ant-super-secret')

    expect(await store.hasSecret('anthropic')).toBe(true)
    expect(await store.getSecret('anthropic')).toBe('sk-ant-super-secret')
  })

  it('never stores the plaintext in the settings row', async () => {
    const store = createSecretStore(settings, fakeSafeStorage())
    await store.setSecret('openai', 'sk-openai-abcdef')

    expect(settings.setRaw).toHaveBeenCalledWith('secrets.openai', expect.any(String))
    const [, stored] = vi.mocked(settings.setRaw).mock.calls[0] as [string, string]
    expect(stored).not.toContain('sk-openai-abcdef')
  })

  it('hasSecret/getSecret report nothing before anything is set', async () => {
    const store = createSecretStore(settings, fakeSafeStorage())

    expect(await store.hasSecret('google')).toBe(false)
    expect(await store.getSecret('google')).toBeUndefined()
  })

  it('deleteSecret clears it', async () => {
    const store = createSecretStore(settings, fakeSafeStorage())
    await store.setSecret('deepgram', 'dg-key')
    await store.deleteSecret('deepgram')

    expect(await store.hasSecret('deepgram')).toBe(false)
    expect(await store.getSecret('deepgram')).toBeUndefined()
  })

  it('refuses to store a secret when OS-level encryption is unavailable', async () => {
    const store = createSecretStore(settings, fakeSafeStorage(false))
    await expect(store.setSecret('elevenlabs', 'x')).rejects.toThrow(/encryption is unavailable/)
    expect(settings.setRaw).not.toHaveBeenCalled()
  })

  it('degrades to undefined rather than throwing when ciphertext no longer decrypts', async () => {
    const store = createSecretStore(settings, fakeSafeStorage())
    await store.setSecret('bfl', 'a-real-key')

    const brokenSafeStorage: SafeStorageLike = {
      isEncryptionAvailable: () => true,
      encryptString: () => Buffer.from(''),
      decryptString: () => {
        throw new Error('OSStatus -25293')
      },
    }
    const storeWithDifferentKey = createSecretStore(settings, brokenSafeStorage)

    expect(await storeWithDifferentKey.getSecret('bfl')).toBeUndefined()
  })
})

describe('maskSecret', () => {
  it('shows only the last 4 characters behind a bullet mask', () => {
    expect(maskSecret('sk-ant-abcdwxyz')).toBe('••••wxyz')
  })

  it('is null for nothing stored', () => {
    expect(maskSecret(undefined)).toBeNull()
  })
})
