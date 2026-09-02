#!/usr/bin/env node

/**
 * Check that every locale under packages/i18n/src has the same set of keys, per namespace,
 * as every other locale — a key present in one locale and missing in another is a broken
 * translation the app would silently fall back on.
 *
 * Usage: node i18n-check.mjs
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const localesDir = path.resolve(__dirname, '../../packages/i18n/src')

function isDirectory(entryPath) {
  return statSync(entryPath).isDirectory()
}

/** Recursively flattens a nested translation object into dotted keys, e.g.
 * `{ nav: { home: 'Today' } }` → `['nav.home']`. ICU plural strings are plain leaf values,
 * so they need no special handling here. */
function flattenKeys(value, prefix = '') {
  const keys = []
  for (const [key, child] of Object.entries(value)) {
    const dotted = prefix ? `${prefix}.${key}` : key
    if (child !== null && typeof child === 'object' && !Array.isArray(child)) {
      keys.push(...flattenKeys(child, dotted))
    } else {
      keys.push(dotted)
    }
  }
  return keys
}

function readNamespaceKeys(locale, namespace) {
  const filePath = path.join(localesDir, locale, `${namespace}.json`)
  try {
    const raw = JSON.parse(readFileSync(filePath, 'utf-8'))
    return new Set(flattenKeys(raw))
  } catch {
    return null // missing or unparsable file
  }
}

const locales = readdirSync(localesDir).filter((entry) => isDirectory(path.join(localesDir, entry)))

if (locales.length === 0) {
  console.error(`No locale directories found under ${localesDir}`)
  process.exit(1)
}

const namespacesByLocale = new Map(
  locales.map((locale) => [
    locale,
    new Set(
      readdirSync(path.join(localesDir, locale))
        .filter((f) => f.endsWith('.json'))
        .map((f) => f.replace(/\.json$/, '')),
    ),
  ]),
)
const allNamespaces = [
  ...new Set(locales.flatMap((locale) => [...namespacesByLocale.get(locale)])),
].sort()

let hasErrors = false

for (const namespace of allNamespaces) {
  const keysByLocale = new Map(
    locales.map((locale) => [locale, readNamespaceKeys(locale, namespace)]),
  )

  for (const [locale, keys] of keysByLocale) {
    if (keys === null) {
      hasErrors = true
      console.error(`✗ [${namespace}] missing entirely for locale "${locale}"`)
    }
  }

  const unionKeys = new Set(
    [...keysByLocale.values()].filter((keys) => keys !== null).flatMap((keys) => [...keys]),
  )

  for (const [locale, keys] of keysByLocale) {
    if (keys === null) continue
    const missing = [...unionKeys].filter((key) => !keys.has(key)).sort()
    if (missing.length > 0) {
      hasErrors = true
      console.error(`✗ [${namespace}] locale "${locale}" is missing: ${missing.join(', ')}`)
    }
  }
}

if (hasErrors) {
  process.exit(1)
}

console.log(
  `✓ i18n key parity OK across ${locales.length} locales, ${allNamespaces.length} namespaces`,
)
