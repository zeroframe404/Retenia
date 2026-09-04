import { IconButton } from '@retenia/ui'
import { Volume2Icon } from 'lucide-react'
import { useState } from 'react'
import { useActivity } from '../host/activity-context'

/**
 * Plays an activity's audio: a `MediaRef` that already has a `src`, or — for the listening types
 * whose audio is synthesized on demand — the `speak` port.
 *
 * The port is a no-op stub until sub-phase 11.3 wires Azure/local TTS, so the button is disabled
 * with an explicit "not available yet" label rather than silently doing nothing.
 */

export interface AudioButtonProps {
  /** A resolved `media://` or blob URL. Takes precedence over `text`. */
  src?: string
  /** Text to synthesize through the `speak` port. */
  text?: string
  voice?: string
  label?: string
}

export function AudioButton({ src, text, voice, label }: AudioButtonProps) {
  const { speak, labels } = useActivity()
  const [busy, setBusy] = useState(false)

  const available = src !== undefined || text !== undefined
  const name = label ?? labels.playAudio

  async function play() {
    setBusy(true)
    try {
      if (src !== undefined) {
        await new Audio(src).play()
        return
      }
      if (text !== undefined) await speak(text, voice)
    } finally {
      setBusy(false)
    }
  }

  return (
    <IconButton
      variant="ghost"
      size="sm"
      type="button"
      aria-label={available ? name : labels.audioUnavailable}
      disabled={!available || busy}
      data-testid="audio-button"
      onClick={() => void play()}
    >
      <Volume2Icon />
    </IconButton>
  )
}
