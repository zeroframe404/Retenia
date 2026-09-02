import { create } from 'zustand'

export type GamificationProfile = 'arcade' | 'sober'

interface GamificationProfileStoreState {
  /** Mirrors `packages/ipc-contract`'s `gamificationProfileSchema`
   * (`settings.gamification.profile`). `packages/ui` has no IPC access of its own — same
   * pattern as `useThemeStore` — so `apps/desktop` is what actually wires `setProfile` to
   * `window.api.app.{getSettings,setGamificationProfile}`. Defaults to `arcade` so a
   * component rendered before settings load (or in Storybook) shows the full experience
   * rather than assuming the quieter one. */
  profile: GamificationProfile
  setProfile: (profile: GamificationProfile) => void
}

export const useGamificationProfileStore = create<GamificationProfileStoreState>()((set) => ({
  profile: 'arcade',
  setProfile: (profile) => set({ profile }),
}))
