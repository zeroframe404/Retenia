import { create } from 'zustand'

interface SoundSettingsStoreState {
  /** 0–1. */
  volume: number
  muted: boolean
  setVolume: (volume: number) => void
  setMuted: (muted: boolean) => void
}

/** Mirrors a future `settings.sound` entry (docs/spec/08-ux.md §2 Settings: "volume and
 * mute"). Same pattern as `useThemeStore`/`useGamificationProfileStore` — `packages/ui`
 * has no IPC access, so `apps/desktop` wires `setVolume`/`setMuted` to the real settings
 * store; anything mounted without that sync (Storybook, tests) sees these defaults. */
export const useSoundSettingsStore = create<SoundSettingsStoreState>()((set) => ({
  volume: 0.7,
  muted: false,
  setVolume: (volume) => set({ volume: Math.max(0, Math.min(1, volume)) }),
  setMuted: (muted) => set({ muted }),
}))
