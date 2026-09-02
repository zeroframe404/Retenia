import type { Transition, Variants } from 'motion/react'

/**
 * Motion 13 presets (docs/spec/01-decisions.md §10.2 sub-phase 2.1). Durations/easings come
 * from the design tokens in `theme.css` (`--duration-*`, `--ease-*`) so motion and the rest
 * of the design system share one source of truth.
 *
 * Every preset is a plain `Variants` object: `<motion.div variants={fadeIn} initial="initial"
 * animate="animate" exit="exit" />`. Wrap the app (or Storybook's preview) once in
 * `<MotionConfig reducedMotion="user">` — Motion then substitutes an instant, opacity-only
 * transition for every preset below whenever the OS "reduce motion" setting is on, with no
 * extra code at the call site (docs/spec/08-ux.md §1 accessibility).
 */

const standard: Transition = { duration: 0.2, ease: [0.4, 0, 0.2, 1] }
const emphasized: Transition = { duration: 0.32, ease: [0.2, 0, 0, 1] }
const bounce: Transition = { duration: 0.32, ease: [0.34, 1.56, 0.64, 1] }

/** A generic enter/exit fade — modals, tooltips, route transitions. */
export const fadeIn: Variants = {
  initial: { opacity: 0 },
  animate: { opacity: 1, transition: standard },
  exit: { opacity: 0, transition: standard },
}

/** Content rising into place — toasts, list items, a revealed answer. */
export const slideUp: Variants = {
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0, transition: emphasized },
  exit: { opacity: 0, y: 12, transition: standard },
}

/** A short scale pop — badges, XP counters, a newly-unlocked achievement. */
export const pop: Variants = {
  initial: { opacity: 0, scale: 0.85 },
  animate: { opacity: 1, scale: 1, transition: bounce },
  exit: { opacity: 0, scale: 0.85, transition: standard },
}

/** A wrong-answer shake — never punitive in tone (docs/spec/08-ux.md §4 "never punish"),
 * just a brief, low-amplitude acknowledgement that the answer didn't match. */
export const shake: Variants = {
  initial: { x: 0 },
  animate: {
    x: [0, -6, 6, -4, 4, 0],
    transition: { duration: 0.4, ease: 'easeInOut' },
  },
}

/** Lesson/checkpoint completion — a bigger, celebratory pop for "Done for today" and
 * similar moments (docs/spec/08-ux.md §4 mascot celebrations). */
export const celebrate: Variants = {
  initial: { opacity: 0, scale: 0.6, rotate: -8 },
  animate: {
    opacity: 1,
    scale: 1,
    rotate: 0,
    transition: { ...bounce, duration: 0.5 },
  },
  exit: { opacity: 0, scale: 0.6, transition: standard },
}

export const motionPresets = { fadeIn, slideUp, pop, shake, celebrate }
