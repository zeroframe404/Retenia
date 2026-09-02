import type { ProcessingJob } from '@retenia/ui'

/** The processing tray's job list. The persistent job queue lands in sub-phase 3.4 — until
 * then there is nothing running, so this returns an empty list rather than fake data. Swap
 * the body for a real `useIpcQuery('jobs.list', …)` (or a push-event subscription) once
 * that channel exists. */
export function useProcessingJobs(): ProcessingJob[] {
  return []
}
