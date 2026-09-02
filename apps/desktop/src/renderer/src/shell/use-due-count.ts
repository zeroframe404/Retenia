/** The Repasar sidebar badge's due-card count. The review queue lands in sub-phase 4.x —
 * until then there is nothing to count, so this returns `0` rather than fake data. Swap
 * the body for a real `useIpcQuery('cards.dueCount', …)` once that channel exists. */
export function useDueCount(): number {
  return 0
}
