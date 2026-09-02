export type SoundName = 'correct' | 'wrong' | 'levelUp' | 'streak' | 'click'

/** Bundled placeholder tones (`packages/ui/sounds/LICENSES.md`) — self-authored CC0
 * synthesis, swap for a proper CC0 pack before shipping a polished build. `new URL(...,
 * import.meta.url)` is the ESM-native way to reference a sibling asset: Vite resolves and
 * bundles it statically, and outside a bundler (Node, Vitest) it still yields a valid
 * `file://` URL, so this needs no bundler-specific import syntax. */
const DEFAULT_SOURCES: Record<SoundName, string> = {
  correct: new URL('../../sounds/correct.wav', import.meta.url).href,
  wrong: new URL('../../sounds/wrong.wav', import.meta.url).href,
  levelUp: new URL('../../sounds/levelUp.wav', import.meta.url).href,
  streak: new URL('../../sounds/streak.wav', import.meta.url).href,
  click: new URL('../../sounds/click.wav', import.meta.url).href,
}

export interface SoundKitOptions {
  /** Overrides for one or more of the default bundled sources — e.g. once a final sound
   * pack replaces the CC0 placeholders and lives elsewhere. */
  sources?: Partial<Record<SoundName, string>>
  /** Injects an `AudioContext` (or a test double) instead of lazily creating one. */
  audioContext?: AudioContext
}

export interface PlayOptions {
  /** 0–1. @default 1 */
  volume?: number
  /** @default false */
  muted?: boolean
}

/**
 * A small Web Audio API player with preloaded buffers for the five interaction sounds
 * (docs/spec/01-decisions.md §10.2 sub-phase 2.4). `AudioContext` is created lazily (most
 * browsers require a user gesture before one can produce sound, and it does not exist at
 * all in SSR/jsdom) so constructing a `SoundKit` is always safe; `play()` never throws —
 * a missing or undecodable sound is a silent no-op rather than an interaction-breaking
 * error.
 */
export class SoundKit {
  private readonly sources: Record<SoundName, string>
  private readonly providedContext?: AudioContext
  private context: AudioContext | undefined
  private readonly buffers = new Map<SoundName, AudioBuffer>()
  private readonly pending = new Map<SoundName, Promise<AudioBuffer | undefined>>()

  constructor(options: SoundKitOptions = {}) {
    this.sources = { ...DEFAULT_SOURCES, ...options.sources }
    this.providedContext = options.audioContext
  }

  private getContext(): AudioContext | undefined {
    if (this.context) return this.context
    if (this.providedContext) {
      this.context = this.providedContext
      return this.context
    }
    try {
      this.context = new AudioContext()
      return this.context
    } catch {
      return undefined
    }
  }

  private load(name: SoundName): Promise<AudioBuffer | undefined> {
    const cached = this.buffers.get(name)
    if (cached) return Promise.resolve(cached)
    const existing = this.pending.get(name)
    if (existing) return existing

    const context = this.getContext()
    const promise = !context
      ? Promise.resolve(undefined)
      : fetch(this.sources[name])
          .then((response) => response.arrayBuffer())
          .then((data) => context.decodeAudioData(data))
          .then((buffer) => {
            this.buffers.set(name, buffer)
            return buffer
          })
          .catch(() => undefined)

    this.pending.set(name, promise)
    return promise
  }

  /** Fetches and decodes every sound (or a chosen subset) up front, so the first `play()`
   * of each never audibly stutters while it loads. */
  async preload(names: SoundName[] = Object.keys(this.sources) as SoundName[]): Promise<void> {
    await Promise.all(names.map((name) => this.load(name)))
  }

  /** Plays a sound at `volume` (0–1) unless `muted`. Resolves once playback has started
   * (or been skipped) — it does not wait for the sound to finish. */
  async play(name: SoundName, { volume = 1, muted = false }: PlayOptions = {}): Promise<void> {
    if (muted || volume <= 0) return
    const buffer = await this.load(name)
    const context = this.context
    if (!buffer || !context) return

    if (context.state === 'suspended') {
      await context.resume().catch(() => {})
    }

    const source = context.createBufferSource()
    source.buffer = buffer
    const gain = context.createGain()
    gain.gain.value = Math.max(0, Math.min(1, volume))
    source.connect(gain).connect(context.destination)
    source.start()
  }

  /** Releases the underlying `AudioContext`. Not needed for the app-lifetime shared kit
   * (`useSoundKit`) — for a `SoundKit` created with its own context (e.g. in a test). */
  dispose(): void {
    this.buffers.clear()
    this.pending.clear()
    if (this.context && !this.providedContext) {
      void this.context.close().catch(() => {})
    }
    this.context = undefined
  }
}
