import { Dialog as BaseDialog } from '@base-ui/react/dialog'
import { DotLottieReact } from '@lottiefiles/dotlottie-react'
import confetti from 'canvas-confetti'
import { CheckCircle2Icon, FlameIcon, TargetIcon, TrophyIcon } from 'lucide-react'
import { motion } from 'motion/react'
import type { ReactNode } from 'react'
import { useEffect, useRef } from 'react'
import { useGamificationProfile } from '../gamification/use-gamification-profile'
import { cn } from '../lib/cn'
import { celebrate } from '../motion'

export type CelebrationVariant = 'lessonComplete' | 'streakMilestone' | 'examPassed' | 'dailyGoal'

export interface CelebrationProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  variant: CelebrationVariant
  title: ReactNode
  description?: ReactNode
  /** Optional dotLottie animation (e.g. the mascot doing a bigger celebration move),
   * shown above the icon. Omit for the confetti + Motion pop alone. */
  lottieSrc?: string
  className?: string
}

/** Hard cap regardless of what a caller passes — never longer than 2.5 s
 * (docs/spec/08-ux.md §4 "Mascot": "avoid overuse"). */
const MAX_DURATION_MS = 2500

const VARIANT_META: Record<CelebrationVariant, { icon: typeof CheckCircle2Icon; accent: string }> =
  {
    lessonComplete: { icon: CheckCircle2Icon, accent: 'text-correct' },
    streakMilestone: { icon: FlameIcon, accent: 'text-streak' },
    examPassed: { icon: TrophyIcon, accent: 'text-xp' },
    dailyGoal: { icon: TargetIcon, accent: 'text-brand-500' },
  }

/** Same guarded pattern as `theme-store.ts`'s `systemPrefersDark` — jsdom (tests) has no
 * `matchMedia`, so this has to check rather than assume it exists. */
function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

/**
 * A brief, skippable celebration overlay: confetti + a Motion pop-in, capped at 2.5 s
 * (docs/spec/08-ux.md §4 "Mascot": "end-of-session celebrations... with moderate
 * confetti", "avoid overuse"). Disabled outright in sober mode and under reduced motion
 * — `onOpenChange(false)` fires immediately in either case so the caller's flow does not
 * stall waiting for a celebration that will never show.
 */
export function Celebration({
  open,
  onOpenChange,
  variant,
  title,
  description,
  lottieSrc,
  className,
}: CelebrationProps) {
  const profile = useGamificationProfile()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const disabled = profile === 'sober' || prefersReducedMotion()

  useEffect(() => {
    if (!open) return
    if (disabled) {
      onOpenChange(false)
      return
    }
    const timeout = setTimeout(() => onOpenChange(false), MAX_DURATION_MS)
    return () => clearTimeout(timeout)
  }, [open, disabled, onOpenChange])

  useEffect(() => {
    if (!open || disabled || !canvasRef.current) return
    const burst = confetti.create(canvasRef.current, { resize: true, useWorker: true })
    burst({
      particleCount: 60,
      spread: 70,
      startVelocity: 32,
      origin: { y: 0.6 },
      disableForReducedMotion: true,
    })
    return () => burst.reset()
  }, [open, disabled])

  if (disabled) return null

  const { icon: Icon, accent } = VARIANT_META[variant]

  return (
    <BaseDialog.Root open={open} onOpenChange={onOpenChange}>
      <BaseDialog.Portal>
        <BaseDialog.Backdrop
          className={cn(
            'fixed inset-0 z-50 bg-black/40 duration-base ease-standard',
            'data-[starting-style]:opacity-0 data-[ending-style]:opacity-0',
          )}
        />
        <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-[51]">
          <canvas ref={canvasRef} className="h-full w-full" />
        </div>
        <BaseDialog.Popup
          className={cn(
            'bg-surface border-border fixed top-1/2 left-1/2 z-[52] w-full max-w-sm -translate-x-1/2 -translate-y-1/2',
            'rounded-lg border p-6 text-center shadow-soft',
            className,
          )}
        >
          {lottieSrc && (
            <DotLottieReact src={lottieSrc} autoplay loop={false} className="mx-auto h-24 w-24" />
          )}
          <motion.div variants={celebrate} initial="initial" animate="animate">
            <Icon className={cn('mx-auto size-10', accent)} aria-hidden="true" />
          </motion.div>
          <BaseDialog.Title className="font-display text-text mt-3 text-lg font-semibold">
            {title}
          </BaseDialog.Title>
          {description && (
            <BaseDialog.Description className="text-muted mt-1 text-sm">
              {description}
            </BaseDialog.Description>
          )}
        </BaseDialog.Popup>
      </BaseDialog.Portal>
    </BaseDialog.Root>
  )
}
