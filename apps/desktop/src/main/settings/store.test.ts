import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { defaultSettings, loadSettings, SettingsStore, saveSettings } from './store'

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
  it('falls back to defaults when the file does not exist', () => {
    expect(loadSettings(file)).toEqual(defaultSettings)
  })

  it('falls back to defaults for malformed JSON', () => {
    saveSettingsRaw(file, '{not json')
    expect(loadSettings(file)).toEqual(defaultSettings)
  })

  it('falls back to defaults when the schema no longer matches', () => {
    saveSettingsRaw(file, JSON.stringify({ updateChannel: 'nightly' }))
    expect(loadSettings(file)).toEqual(defaultSettings)
  })

  it('round-trips a saved value', () => {
    saveSettings(file, { updateChannel: 'beta', telemetryEnabled: true, theme: 'dark' })
    expect(loadSettings(file)).toEqual({
      updateChannel: 'beta',
      telemetryEnabled: true,
      theme: 'dark',
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
    })
    expect(store.get().updateChannel).toBe('beta')
    expect(loadSettings(file).updateChannel).toBe('beta')

    expect(store.setTelemetryEnabled(true).telemetryEnabled).toBe(true)
    expect(store.setTheme('dark').theme).toBe('dark')
    // Earlier changes survive a later, unrelated one.
    expect(store.get()).toEqual({ updateChannel: 'beta', telemetryEnabled: true, theme: 'dark' })
  })

  it('reloads a previously saved file on construction', () => {
    saveSettings(file, { updateChannel: 'beta', telemetryEnabled: true, theme: 'dark' })
    const store = new SettingsStore(file)
    expect(store.get()).toEqual({ updateChannel: 'beta', telemetryEnabled: true, theme: 'dark' })
  })
})

function saveSettingsRaw(path: string, contents: string): void {
  writeFileSync(path, contents)
}
