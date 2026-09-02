/** Abstracts "now" so domain logic (FSRS scheduling, sessions...) stays deterministic in tests. */
export interface Clock {
  now(): Date
}

/** The real-time `Clock` implementation. No Node/Electron imports — just `Date`. */
export const systemClock: Clock = {
  now: () => new Date(),
}
