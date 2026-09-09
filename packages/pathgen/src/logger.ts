/** The two methods every stage logs through — the shape `@retenia/ai`'s deps already take. */
export interface PathgenLogger {
  warn(message: string): void
  error(message: string, error?: unknown): void
}

/** For tests and for a caller that has nowhere to send a line. */
export const silentLogger: PathgenLogger = Object.freeze({
  warn: () => {},
  error: () => {},
})
