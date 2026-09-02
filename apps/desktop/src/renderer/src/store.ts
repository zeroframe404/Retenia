import { create } from 'zustand'

interface AppState {
  ready: boolean
}

/** Trivial store proving the Zustand wiring; real app state lands with each feature. */
export const useAppStore = create<AppState>()(() => ({
  ready: true,
}))
