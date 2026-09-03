import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { defaultSettings, loadSettings, SettingsStore, saveSettings } from './store'

/** A fixed UUIDv7, so a round trip can assert the id survived rather than that one exists. */
const DEVICE_ID = '019213cd-0000-7000-8000-00000000d1d1'

let dir: string
let file: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'retenia-settings-'))
  file = join(dir, 'settings.json')
})

afterEach(() => {
  // Best-effort: a leaked temp dir does not fail the suite.
})

describe('loadSettings', () => {
  // `toMatchObject`, not `toEqual`: a load always carries a device id on top of the
  // defaults, minted when the file cannot supply one.
  it('falls back to defaults when the file does not exist', () => {
    expect(loadSettings(file)).toMatchObject(defaultSettings)
  })

  it('falls back to defaults for malformed JSON', () => {
    saveSettingsRaw(file, '{not json')
    expect(loadSettings(file)).toMatchObject(defaultSettings)
  })

  it('falls back to defaults when the schema no longer matches', () => {
    saveSettingsRaw(file, JSON.stringify({ updateChannel: 'nightly' }))
    expect(loadSettings(file)).toMatchObject(defaultSettings)
  })

  it('round-trips a saved value', () => {
    saveSettings(file, {
      updateChannel: 'beta',
      telemetryEnabled: true,
      theme: 'dark',
      density: 'compact',
      gamification: { profile: 'sober' },
      deviceId: DEVICE_ID,
    })
    expect(loadSettings(file)).toEqual({
      deviceId: DEVICE_ID,
      updateChannel: 'beta',
      telemetryEnabled: true,
      theme: 'dark',
      density: 'compact',
      gamification: { profile: 'sober' },
    })
  })
})

describe('SettingsStore', () => {
  it('starts from defaults and persists updates', () => {
    const store = new SettingsStore(file)
    expect(store.get()).toEqual(defaultSettings)

    expect(store.setUpdateChannel('beta')).toEqual({
      updateChannel: 'beta',
      telemetryEnabled: false,
      theme: 'system',
      density: 'comfortable',
      gamification: { profile: 'arcade' },
    })
    expect(store.get().updateChannel).toBe('beta')
    expect(loadSettings(file).updateChannel).toBe('beta')

    expect(store.setTelemetryEnabled(true).telemetryEnabled).toBe(true)
    expect(store.setTheme('dark').theme).toBe('dark')
    expect(store.setDensity('compact').density).toBe('compact')
    expect(store.setGamificationProfile('sober').gamification).toEqual({ profile: 'sober' })
    // Earlier changes survive a later, unrelated one.
    expect(store.get()).toEqual({
      updateChannel: 'beta',
      telemetryEnabled: true,
      theme: 'dark',
      density: 'compact',
      gamification: { profile: 'sober' },
    })
  })

  it('reloads a previously saved file on construction', () => {
    saveSettings(file, {
      updateChannel: 'beta',
      telemetryEnabled: true,
      theme: 'dark',
      density: 'compact',
      gamification: { profile: 'sober' },
      deviceId: DEVICE_ID,
    })
    const store = new SettingsStore(file)
    expect(store.get()).toEqual({
      updateChannel: 'beta',
      telemetryEnabled: true,
      theme: 'dark',
      density: 'compact',
      gamification: { profile: 'sober' },
    })
  })
})

function saveSettingsRaw(path: string, contents: string): void {
  writeFileSync(path, contents)
}

/**
 * The device id stamps every row this installation writes and a future sync layer uses it to
 * attribute changes, so losing or re-minting one silently would orphan history.
 */
describe('device id', () => {
  let dir: string
  let file: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'retenia-device-'))
    file = join(dir, 'settings.json')
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('mints one on first run', () => {
    const store = new SettingsStore(file)
    expect(store.deviceId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    )
  })

  it('persists it immediately, so a crash before the first change cannot lose it', () => {
    const minted = new SettingsStore(file).deviceId
    expect(loadSettings(file).deviceId).toBe(minted)
  })

  it('keeps the same id across restarts', () => {
    const first = new SettingsStore(file).deviceId
    expect(new SettingsStore(file).deviceId).toBe(first)
  })

  it('survives a settings change', () => {
    const store = new SettingsStore(file)
    const before = store.deviceId
    store.setTheme('dark')
    expect(store.deviceId).toBe(before)
    expect(loadSettings(file).deviceId).toBe(before)
  })

  it('tops up a file written before device ids existed, rather than resetting it', () => {
    writeFileSync(
      file,
      JSON.stringify({
        updateChannel: 'beta',
        telemetryEnabled: true,
        theme: 'dark',
        density: 'compact',
        gamification: { profile: 'sober' },
      }),
    )
    const loaded = loadSettings(file)
    expect(loaded.updateChannel).toBe('beta')
    expect(loaded.theme).toBe('dark')
    expect(loaded.deviceId).toEqual(expect.any(String))
  })

  it('never crosses the IPC bridge', () => {
    const store = new SettingsStore(file)
    expect(store.get()).not.toHaveProperty('deviceId')
  })
})
