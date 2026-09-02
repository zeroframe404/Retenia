/**
 * Which URLs the app hands to the OS browser. Everything else is denied outright:
 * `setWindowOpenHandler` always returns `{ action: 'deny' }` (docs/spec/07-architecture.md §4).
 */
const EXTERNAL_PROTOCOL_ALLOWLIST: readonly string[] = Object.freeze(['https:', 'mailto:'])

/**
 * `http:` is deliberately absent: opening a plaintext link is a downgrade, and nothing in
 * the app has a reason to emit one. `file:`, `javascript:` and custom schemes never leave
 * the app.
 */
export function shouldOpenExternally(url: string): boolean {
  try {
    return EXTERNAL_PROTOCOL_ALLOWLIST.includes(new URL(url).protocol)
  } catch {
    return false
  }
}
