/**
 * Port every external-format importer implements (Anki `.apkg`, RemNote, Obsidian, CSV —
 * real importers land in sub-phase 13.4). `parse` is pure so it can be unit-tested against
 * fixture files without touching the database.
 */
export interface Importer<Item> {
  readonly format: string
  parse(raw: Uint8Array | string): Item[]
}
