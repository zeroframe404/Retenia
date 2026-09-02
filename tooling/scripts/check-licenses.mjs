#!/usr/bin/env node

/**
 * Check licenses of all dependencies against an allowlist.
 *
 * Usage: node check-licenses.mjs
 *
 * Fails if any dependency has a disallowed license (GPL, AGPL, SSPL, unknown).
 * Exceptions can be configured in tooling/scripts/license-exceptions.json
 */

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(__dirname, '../..')

// Allowed licenses (SPDX identifiers)
const ALLOWED_LICENSES = new Set([
  'MIT',
  'Apache-2.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'ISC',
  'MPL-2.0',
  '0BSD',
  'CC0-1.0',
  'Unlicense',
  'Python-2.0',
])

// Disallowed licenses that fail hard
const DISALLOWED_LICENSES = new Set(['GPL', 'GPL-2.0', 'GPL-3.0', 'AGPL', 'AGPL-3.0', 'SSPL-1.0'])

// Load exceptions. The file is `{ description, exceptions: { <pkg>: <reason> } }`,
// so the map has to be read out of the `exceptions` key.
let exceptions = {}
try {
  const exceptionPath = path.resolve(__dirname, 'license-exceptions.json')
  const data = JSON.parse(readFileSync(exceptionPath, 'utf-8'))
  exceptions = data.exceptions ?? {}
} catch {
  // No exceptions file; that's OK
}

/**
 * Check a single SPDX license identifier (no operators).
 */
export function isTermAllowed(term) {
  const license = term
    .trim()
    .replace(/^\(|\)$/g, '')
    .trim()

  if (!license || license === 'UNKNOWN') {
    return false
  }

  for (const disallowed of DISALLOWED_LICENSES) {
    if (
      license === disallowed ||
      license.startsWith(`${disallowed}-`) ||
      license.includes('GPL') ||
      license.includes('SSPL')
    ) {
      return false
    }
  }

  return ALLOWED_LICENSES.has(license)
}

/**
 * Evaluate an SPDX expression.
 *
 * `OR` is a choice, so the package is usable when *any* branch is allowed
 * ("MIT OR GPL-3.0" is fine: we take the MIT branch). `AND` means every
 * license applies at once, so *all* terms have to be allowed.
 */
export function isLicenseAllowed(licenseStr) {
  if (!licenseStr || typeof licenseStr !== 'string') {
    return false
  }

  const expression = licenseStr.trim().replace(/^\((.*)\)$/, '$1')

  const orTerms = expression.split(/\s+OR\s+/i)
  if (orTerms.length > 1) {
    return orTerms.some((term) => isLicenseAllowed(term))
  }

  const andTerms = expression.split(/\s+AND\s+/i)
  if (andTerms.length > 1) {
    return andTerms.every((term) => isLicenseAllowed(term))
  }

  return isTermAllowed(expression)
}

/**
 * Get all packages and their licenses.
 *
 * Uses `pnpm licenses list`, which understands pnpm's symlinked virtual store;
 * `npm ls` cannot read that layout and returns nothing in a pnpm workspace.
 */
function getAllPackageLicenses() {
  let output
  try {
    output = execFileSync('pnpm', ['licenses', 'list', '--json'], {
      cwd: projectRoot,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      maxBuffer: 64 * 1024 * 1024,
    })
  } catch (error) {
    console.error('Failed to run `pnpm licenses list --json`.')
    console.error('Run `pnpm install` first, then retry.')
    if (error?.stderr) {
      console.error(String(error.stderr).trim())
    }
    process.exit(1)
  }

  // Shape: { "<license expression>": [{ name, versions, license, ... }, ...] }
  const byLicense = JSON.parse(output || '{}')
  const packages = {}

  for (const [licenseKey, entries] of Object.entries(byLicense)) {
    if (!Array.isArray(entries)) continue
    for (const entry of entries) {
      if (!entry?.name) continue
      packages[entry.name] = entry.license ?? licenseKey
    }
  }

  return packages
}

/**
 * Main check
 */
function main() {
  console.log('Checking licenses...\n')

  const packages = getAllPackageLicenses()

  if (Object.keys(packages).length === 0) {
    console.log('No dependencies to check.')
    process.exit(0)
  }

  const violations = []

  for (const [name, license] of Object.entries(packages)) {
    // Check exceptions first
    if (exceptions[name]) {
      console.log(`  ⓘ ${name}: ${license} (excepted: ${exceptions[name]})`)
      continue
    }

    if (!isLicenseAllowed(license)) {
      violations.push({ name, license })
      console.log(`  ✘ ${name}: ${license}`)
    } else {
      console.log(`  ✓ ${name}: ${license}`)
    }
  }

  console.log()

  if (violations.length > 0) {
    console.error(`\n❌ Found ${violations.length} license violation(s):\n`)
    for (const { name, license } of violations) {
      console.error(`  - ${name}: ${license}`)
      console.error('    Add to tooling/scripts/license-exceptions.json to allow')
    }
    console.error('\nDisallowed licenses: GPL*, AGPL*, SSPL*, or unknown.')
    console.error('Allowed licenses:', Array.from(ALLOWED_LICENSES).join(', '))
    process.exit(1)
  }

  console.log('✓ All licenses are allowed')
  process.exit(0)
}

// Only run when invoked directly, so the pure helpers above stay importable in tests.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main()
}
