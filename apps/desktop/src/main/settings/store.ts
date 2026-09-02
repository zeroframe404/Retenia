import { readFileSync, writeFileSync } from 'node:fs'
import type { Settings } from '@retenia/ipc-contract'
import { settingsSchema } from '@retenia/ipc-contract'

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

/** Read `file`, falling back to `defaultSettings` when it is missing, unreadable, or its
 * contents no longer match the schema (e.g. a future migration changed its shape). */
export function loadSettings(file: string): Settings {
  try {
    const raw: unknown = JSON.parse(readFileSync(file, 'utf-8'))
    const parsed = settingsSchema.safeParse(raw)
    return parsed.success ? parsed.data : defaultSettings
  } catch {
    return defaultSettings
  }
}

export function saveSettings(file: string, settings: Settings): void {
  writeFileSync(file, JSON.stringify(settings, null, 2))
}

/**
 * In-memory settings, backed by `file`. Main holds exactly one of these; every IPC handler
 * that reads or writes settings goes through it rather than the file functions directly, so
 * a read always sees the latest write within the same process.
 */
export class SettingsStore {
  #file: string
  #settings: Settings

  constructor(file: string) {
    this.#file = file
    this.#settings = loadSettings(file)
  }

  get(): Settings {
    return this.#settings
  }

  #update(patch: Partial<Settings>): Settings {
    this.#settings = { ...this.#settings, ...patch }
    saveSettings(this.#file, this.#settings)
    return this.#settings
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
