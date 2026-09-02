import { useEffect, useMemo } from 'react'
import { SoundKit, type SoundName } from './sound-kit'
import { useSoundSettingsStore } from './sound-settings-store'

/** One shared `SoundKit`/`AudioContext` per tab — `AudioContext` is a scarce browser
 * resource (most engines cap how many can exist at once), so every `useSoundKit()` caller
 * plays through the same instance rather than each mounting its own. */
let sharedKit: SoundKit | undefined

function getSharedKit(): SoundKit {
  sharedKit ??= new SoundKit()
  return sharedKit
}

/**
 * Plays `SoundKit`'s five interaction sounds at the current volume/mute settings
 * (`useSoundSettingsStore`). Preloads them on first mount so the first `play()` call
 * doesn't stutter.
 */
export function useSoundKit() {
  const volume = useSoundSettingsStore((state) => state.volume)
  const muted = useSoundSettingsStore((state) => state.muted)
  const kit = useMemo(() => getSharedKit(), [])

  useEffect(() => {
    void kit.preload()
  }, [kit])

  return useMemo(
    () => ({
      play: (name: SoundName) => {
        void kit.play(name, { volume, muted })
      },
    }),
    [kit, volume, muted],
  )
}
