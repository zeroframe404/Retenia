import { readFileSync, writeFileSync } from 'node:fs'
import { uuidv7 } from '@retenia/core'
import type { Settings } from '@retenia/ipc-contract'
import { settingsSchema } from '@retenia/ipc-contract'
import { z } from 'zod'

/**
 * Sober placeholder for the real `settings` table landing in sub-phase 3.5
 * (docs/spec/07-architecture.md §5): a single JSON file at `userData/settings.json`,
 * read into memory once at startup and rewritten whole on every change. It only ever
 * needs to hold the two fields this sub-phase introduces — the updater channel and the
 * telemetry opt-in — so a key/value table would be premature here.
 */
export const defaultSettings: Settings = {
  updateChannel: 'latest',
  telemetryEnabled: false,
  theme: 'system',
  density: 'comfortable',
  gamification: { profile: 'arcade' },
}

/**
 * What the file holds: everything the renderer may see, plus the device id, which it may not.
 *
 * `deviceId` stamps every row this installation writes (`docs/spec/07-architecture.md` §5's
 * sync-ready conventions) and is what a future sync layer uses to attribute a change. The
 * renderer has no use for it and a stable per-installation identifier is exactly the sort of
 * thing not to hand to a context that renders remote content, so it is deliberately outside
 * `settingsSchema` — the output type of `app.getSettings`. Zod strips unknown keys, so
 * `get()` returning `Settings` drops it without any extra work here.
 *
 * Sub-phase 3.5 moves it to the `settings` table under `app.deviceId`, which
 * `RepositoryOptions` already anticipates.
 */
const storedSettingsSchema = settingsSchema.extend({ deviceId: z.uuid() })
type StoredSettings = z.infer<typeof storedSettingsSchema>

/** Read `file`, falling back to `defaultSettings` when it is missing, unreadable, or its
 * contents no longer match the schema (e.g. a future migration changed its shape). A file
 * written before device ids existed is topped up with one rather than discarded. */
export function loadSettings(file: string): StoredSettings {
  try {
    const raw: unknown = JSON.parse(readFileSync(file, 'utf-8'))
    const parsed = storedSettingsSchema.safeParse(raw)
    if (parsed.success) return parsed.data
    // The device id is the only field that cannot be defaulted — losing it would orphan
    // every row this installation has already written — so an otherwise-valid file missing
    // just that gets a fresh id rather than being reset wholesale.
    const withoutDeviceId = settingsSchema.safeParse(raw)
    if (withoutDeviceId.success) return { ...withoutDeviceId.data, deviceId: uuidv7() }
    return { ...defaultSettings, deviceId: uuidv7() }
  } catch {
    return { ...defaultSettings, deviceId: uuidv7() }
  }
}

export function saveSettings(file: string, settings: StoredSettings): void {
  writeFileSync(file, JSON.stringify(settings, null, 2))
}

/**
 * In-memory settings, backed by `file`. Main holds exactly one of these; every IPC handler
 * that reads or writes settings goes through it rather than the file functions directly, so
 * a read always sees the latest write within the same process.
 */
export class SettingsStore {
  #file: string
  #settings: StoredSettings

  constructor(file: string) {
    this.#file = file
    this.#settings = loadSettings(file)
    // Persist immediately so a freshly minted device id survives a crash before the first
    // settings change — otherwise the next launch would mint a different one and the rows
    // written in between would be attributed to a device that never existed again.
    saveSettings(file, this.#settings)
  }

  /** What crosses the IPC bridge. `settingsSchema.parse` strips `deviceId`. */
  get(): Settings {
    return settingsSchema.parse(this.#settings)
  }

  /** This installation's identity, for `createRepositories`. Main-process only. */
  get deviceId(): string {
    return this.#settings.deviceId
  }

  #update(patch: Partial<Settings>): Settings {
    this.#settings = { ...this.#settings, ...patch }
    saveSettings(this.#file, this.#settings)
    return this.get()
  }

  setUpdateChannel(channel: Settings['updateChannel']): Settings {
    return this.#update({ updateChannel: channel })
  }

  setTelemetryEnabled(enabled: boolean): Settings {
    return this.#update({ telemetryEnabled: enabled })
  }

  setTheme(theme: Settings['theme']): Settings {
    return this.#update({ theme })
  }

  setDensity(density: Settings['density']): Settings {
    return this.#update({ density })
  }

  setGamificationProfile(profile: Settings['gamification']['profile']): Settings {
    return this.#update({ gamification: { profile } })
  }
}
