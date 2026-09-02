import { create } from 'zustand'
import { persist } from 'zustand/middleware'

const MAX_RECENT_COMMANDS = 5

interface ChromeState {
  /** Ephemeral shell chrome — not a documented Settings field (unlike density/theme/
   * gamification, which persist through `app.getSettings`), so plain `localStorage` is the
   * right home for it. */
  sidebarCollapsed: boolean
  processingTrayCollapsed: boolean
  recentCommandIds: string[]
  toggleSidebarCollapsed: () => void
  toggleProcessingTrayCollapsed: () => void
  recordCommand: (id: string) => void
}

export const useChromeStore = create<ChromeState>()(
  persist(
    (set) => ({
      sidebarCollapsed: false,
      processingTrayCollapsed: false,
      recentCommandIds: [],
      toggleSidebarCollapsed: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      toggleProcessingTrayCollapsed: () =>
        set((s) => ({ processingTrayCollapsed: !s.processingTrayCollapsed })),
      recordCommand: (id) =>
        set((s) => ({
          recentCommandIds: [id, ...s.recentCommandIds.filter((c) => c !== id)].slice(
            0,
            MAX_RECENT_COMMANDS,
          ),
        })),
    }),
    { name: 'retenia.shell-chrome' },
  ),
)
