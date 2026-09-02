import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { baseVitestConfig, tailwindPreset } from './index'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

describe('@retenia/config', () => {
  it('ships a valid, strict base tsconfig', () => {
    const raw = readFileSync(path.resolve(__dirname, '../tsconfig.base.json'), 'utf-8')
    const parsed = JSON.parse(raw)
    expect(parsed.compilerOptions.strict).toBe(true)
    expect(parsed.compilerOptions.module).toBe('ESNext')
  })

  it('exports a Tailwind preset object', () => {
    expect(tailwindPreset).toMatchObject({ darkMode: 'class' })
  })

  it('builds a Vitest config with node as the default environment', () => {
    const config = baseVitestConfig()
    expect(config.test?.environment).toBe('node')
  })
})
