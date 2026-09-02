import { useRive, useStateMachineInput } from '@rive-app/react-canvas'
import { SparklesIcon } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { cn } from '../lib/cn'

export type MascotMood = 'idle' | 'happy' | 'thinking' | 'sad' | 'celebrate'

/** One-shot reactions distinct from the sustained `mood` — a correct/wrong answer, a
 * streak milestone, a bigger celebration burst. */
export type MascotReactKind = 'correct' | 'wrong' | 'streak' | 'celebrate'

export interface MascotHandle {
  /** Fires a one-shot reaction on top of the current mood (docs/spec/08-ux.md §4
   * "Mascot": "it reacts to correct answers, errors, streaks and closes"). */
  react: (kind: MascotReactKind) => void
}

export interface MascotProps {
  /** Sustained emotional state. */
  mood?: MascotMood
  /** How strongly `mood` reads, 0–1 (e.g. a bigger bounce for a longer streak). */
  intensity?: number
  /** URL of the final authored `.riv` character — see the state-machine contract
   * documented below. Omit (the default) to use the built-in placeholder shape, which
   * implements the same `mood`/`intensity`/`react` contract without needing a `.riv`
   * asset, so every caller and story works before the real character exists. */
  src?: string
  /** Pixel size of the (square) mascot canvas. @default 96 */
  size?: number
  className?: string
  /** Accessible label. The mascot is decorative by default (`aria-hidden`); pass a label
   * when it is the only indicator of something (e.g. no adjacent toast). */
  label?: string
}

const MOOD_INDEX: Record<MascotMood, number> = {
  idle: 0,
  happy: 1,
  thinking: 2,
  sad: 3,
  celebrate: 4,
}

const REACT_TRIGGER: Record<MascotReactKind, string> = {
  correct: 'reactCorrect',
  wrong: 'reactWrong',
  streak: 'reactStreak',
  celebrate: 'reactCelebrate',
}

/** `MascotSM`'s inputs, mirrored 1:1 by `MOOD_INDEX`/`REACT_TRIGGER` above — read this
 * alongside `MASCOT_RIVE_CONTRACT` when authoring the final `.riv` in the Rive editor. */
const MASCOT_STATE_MACHINE = 'MascotSM'

/**
 * The contract the final Rive character must satisfy for `Mascot` to drive it — hand this
 * to whoever authors the `.riv` in the Rive editor:
 *
 * - Artboard name: `"Mascot"`.
 * - State machine name: `"MascotSM"`.
 * - Number input `"mood"`: 0 = idle, 1 = happy, 2 = thinking, 3 = sad, 4 = celebrate.
 * - Number input `"intensity"`: 0–1.
 * - Trigger inputs `"reactCorrect"`, `"reactWrong"`, `"reactStreak"`, `"reactCelebrate"`:
 *   one-shot reactions layered on top of whatever `mood` is currently set.
 *
 * Once such a file exists, pass its URL as `<Mascot src="…" />` — no code change needed;
 * the built-in placeholder shape (used when `src` is omitted) implements the identical
 * `mood`/`intensity`/`react` contract so behavior does not change, only the visual.
 */
export const MASCOT_RIVE_CONTRACT = {
  artboard: 'Mascot',
  stateMachine: MASCOT_STATE_MACHINE,
  inputs: { mood: MOOD_INDEX, intensity: 'number 0-1', ...REACT_TRIGGER },
} as const

const MOOD_SHAPE_VARIANTS = {
  idle: { rotate: 0, scale: 1, y: [0, -3, 0] },
  happy: { rotate: 0, scale: 1.08, y: [0, -8, 0] },
  thinking: { rotate: -6, scale: 1, y: 0 },
  sad: { rotate: 0, scale: 0.94, y: 4 },
  celebrate: { rotate: [0, -8, 8, -4, 0], scale: [1, 1.15, 1.05], y: [0, -12, 0] },
} as const satisfies Record<MascotMood, Record<string, number | number[]>>

const MOOD_FILL: Record<MascotMood, string> = {
  idle: 'var(--color-brand-500)',
  happy: 'var(--color-teal-500)',
  thinking: 'var(--color-brand-400)',
  sad: 'var(--color-neutral-400)',
  celebrate: 'var(--color-amber-500)',
}

/** Rive-backed rendering, used once `src` is provided and the asset loads. */
function RiveMascot({
  src,
  mood,
  intensity,
  reactHandleRef,
}: {
  src: string
  mood: MascotMood
  intensity: number
  reactHandleRef: React.RefObject<((kind: MascotReactKind) => void) | null>
}) {
  const { rive, RiveComponent } = useRive({
    src,
    stateMachines: MASCOT_STATE_MACHINE,
    autoplay: true,
  })
  const moodInput = useStateMachineInput(rive, MASCOT_STATE_MACHINE, 'mood')
  const intensityInput = useStateMachineInput(rive, MASCOT_STATE_MACHINE, 'intensity')
  const triggers = {
    correct: useStateMachineInput(rive, MASCOT_STATE_MACHINE, REACT_TRIGGER.correct),
    wrong: useStateMachineInput(rive, MASCOT_STATE_MACHINE, REACT_TRIGGER.wrong),
    streak: useStateMachineInput(rive, MASCOT_STATE_MACHINE, REACT_TRIGGER.streak),
    celebrate: useStateMachineInput(rive, MASCOT_STATE_MACHINE, REACT_TRIGGER.celebrate),
  }

  useEffect(() => {
    if (moodInput) moodInput.value = MOOD_INDEX[mood]
  }, [moodInput, mood])

  useEffect(() => {
    if (intensityInput) intensityInput.value = intensity
  }, [intensityInput, intensity])

  useEffect(() => {
    reactHandleRef.current = (kind) => triggers[kind]?.fire()
    return () => {
      reactHandleRef.current = null
    }
  })

  return <RiveComponent className="h-full w-full" />
}

/** Built-in placeholder shape, used when no `.riv` is supplied — see `MASCOT_RIVE_CONTRACT`
 * above for how to swap in the final character. Implements the same `mood`/`intensity`
 * contract with a Motion-animated blob, plus a `react(kind)` sparkle burst overlay. */
function PlaceholderMascot({
  mood,
  intensity,
  reactHandleRef,
}: {
  mood: MascotMood
  intensity: number
  reactHandleRef: React.RefObject<((kind: MascotReactKind) => void) | null>
}) {
  const [reaction, setReaction] = useState<{ id: number; kind: MascotReactKind } | null>(null)
  const nextId = useRef(0)

  useEffect(() => {
    reactHandleRef.current = (kind) => {
      nextId.current += 1
      setReaction({ id: nextId.current, kind })
    }
    return () => {
      reactHandleRef.current = null
    }
  })

  useEffect(() => {
    if (!reaction) return
    const timeout = setTimeout(() => setReaction(null), 600)
    return () => clearTimeout(timeout)
  }, [reaction])

  const shape = MOOD_SHAPE_VARIANTS[mood]
  // Intensity interpolates each animated property between its neutral resting value
  // (1 for `scale`, 0 for everything else) and the mood's full value — 1 = full mood
  // expression, 0 = visually neutral.
  const scaled = useMemo(() => {
    const baseline = (key: string) => (key === 'scale' ? 1 : 0)
    const lerp = (key: string, v: number) => baseline(key) + (v - baseline(key)) * intensity
    return Object.fromEntries(
      Object.entries(shape).map(([key, value]) => [
        key,
        Array.isArray(value) ? value.map((v) => lerp(key, v)) : lerp(key, value as number),
      ]),
    )
  }, [shape, intensity])

  return (
    <div className="relative flex h-full w-full items-center justify-center">
      <motion.div
        animate={scaled}
        transition={{ duration: 0.6, repeat: mood === 'idle' ? Number.POSITIVE_INFINITY : 0 }}
        className="h-3/4 w-3/4 rounded-full"
        style={{ backgroundColor: MOOD_FILL[mood] }}
      />
      <AnimatePresence>
        {reaction && (
          <motion.div
            key={reaction.id}
            initial={{ opacity: 0, scale: 0.4, y: 0 }}
            animate={{ opacity: 1, scale: 1, y: -12 }}
            exit={{ opacity: 0, scale: 0.6 }}
            transition={{ duration: 0.3, ease: [0.34, 1.56, 0.64, 1] }}
            className="absolute -top-1 -right-1"
          >
            <SparklesIcon
              className={cn('size-5', reaction.kind === 'wrong' ? 'text-muted' : 'text-xp')}
              aria-hidden="true"
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

/**
 * A mascot with a state machine contract (docs/spec/08-ux.md §4 "Mascot"): sustained
 * `mood`, `intensity` (0–1), and a one-shot `react(kind)` trigger. Backed by a `.riv`
 * character when `src` is given (see `MASCOT_RIVE_CONTRACT`), otherwise by a built-in
 * placeholder shape with the identical contract.
 */
export const Mascot = forwardRef<MascotHandle, MascotProps>(function Mascot(
  { mood = 'idle', intensity = 1, src, size = 96, className, label },
  ref,
) {
  const clampedIntensity = Math.max(0, Math.min(1, intensity))
  const reactHandleRef = useRef<((kind: MascotReactKind) => void) | null>(null)

  useImperativeHandle(
    ref,
    () => ({
      react: (kind) => reactHandleRef.current?.(kind),
    }),
    [],
  )

  // A dynamic prop bag rather than static `role`/`aria-label`/`aria-hidden` JSX
  // attributes: with a fixed `role="img"` markup, a linter can't see that `aria-label`
  // is only ever paired with it (never with `aria-hidden`), and flags the pairing as
  // invalid for a plain `<div>`.
  const a11yProps = label
    ? { role: 'img' as const, 'aria-label': label }
    : { 'aria-hidden': 'true' as const }

  return (
    <div
      {...a11yProps}
      className={cn('inline-block', className)}
      style={{ width: size, height: size }}
      data-testid="mascot"
      data-mood={mood}
    >
      {src ? (
        <RiveMascot
          src={src}
          mood={mood}
          intensity={clampedIntensity}
          reactHandleRef={reactHandleRef}
        />
      ) : (
        <PlaceholderMascot
          mood={mood}
          intensity={clampedIntensity}
          reactHandleRef={reactHandleRef}
        />
      )}
    </div>
  )
})
