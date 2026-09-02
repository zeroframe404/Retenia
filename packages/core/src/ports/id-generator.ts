/** Abstracts id creation so `core` never depends on a concrete UUID library. */
export interface IdGenerator {
  /** Returns a new UUIDv7 string (see `docs/spec/00-conventions.md` — ids are UUIDv7, never v4 or autoincrement). */
  next(): string
}
