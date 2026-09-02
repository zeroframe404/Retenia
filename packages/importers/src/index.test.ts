import { describe, expect, it } from 'vitest'
import type { Importer } from './index'

interface CsvRow {
  front: string
  back: string
}

describe('@retenia/importers Importer', () => {
  it('is a structural port a format-specific importer can implement', () => {
    const csvImporter: Importer<CsvRow> = {
      format: 'csv',
      parse: (raw) =>
        String(raw)
          .trim()
          .split('\n')
          .map((line) => {
            const [front, back] = line.split(',')
            return { front: front ?? '', back: back ?? '' }
          }),
    }

    expect(csvImporter.parse('hola,hello')).toEqual([{ front: 'hola', back: 'hello' }])
  })
})
