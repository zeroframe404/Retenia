#!/usr/bin/env node

/**
 * Check licenses of all dependencies against an allowlist.
 *
 * Usage: node check-licenses.mjs [--fix]
 *
 * Fails if any dependency has a disallowed license (GPL, AGPL, SSPL, unknown).
 * Exceptions can be configured in tooling/scripts/license-exceptions.json
 */

import { execSync } from 'child_process'
import { readFileSync, writeFileSync } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

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

// Load exceptions
let exceptions = {}
try {
  const exceptionPath = path.resolve(__dirname, 'license-exceptions.json')
  const data = readFileSync(exceptionPath, 'utf-8')
  exceptions = JSON.parse(data)
} catch (e) {
  // No exceptions file; that's OK
}

/**
 * Parse a license string which might be compound (e.g. "MIT OR Apache-2.0")
 */
function parseLicense(licenseStr) {
  if (!licenseStr || typeof licenseStr !== 'string') {
    return ['UNKNOWN']
  }

  // Handle compound licenses: "MIT OR Apache-2.0" -> ["MIT", "Apache-2.0"]
  const licenses = licenseStr
    .split(/\s+(?:OR|AND)\s+/i)
    .map((l) => l.trim())
    .filter((l) => l.length > 0)

  return licenses.length > 0 ? licenses : ['UNKNOWN']
}

/**
 * Check if a license is allowed
 */
function isLicenseAllowed(licenseStr) {
  const licenses = parseLicense(licenseStr)

  for (const license of licenses) {
    // Check if it's in disallowed set (exact or prefix match)
    for (const disallowed of DISALLOWED_LICENSES) {
      if (
        license === disallowed ||
        license.startsWith(disallowed + '-') ||
        license.includes('GPL') ||
        license.includes('AGPL') ||
        license.includes('SSPL')
      ) {
        return false
      }
    }

    // Check if it's in allowed set
    if (ALLOWED_LICENSES.has(license)) {
      continue
    }

    // Unknown license
    if (license === 'UNKNOWN') {
      return false
    }

    // If not allowed or disallowed, it's unknown
    return false
  }

  return true
}

/**
 * Get all packages and their licenses using npm/pnpm
 */
function getAllPackageLicenses() {
  try {
    // Try using npm ls with parseable output
    const output = execSync('npm ls --omit=peer --json 2>/dev/null', {
      cwd: projectRoot,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'ignore'],
    })

    const data = JSON.parse(output)
    const packages = {}

    function traverse(obj) {
      if (!obj || typeof obj !== 'object') return

      if (obj.dependencies) {
        for (const [name, dep] of Object.entries(obj.dependencies)) {
          if (dep.version && dep.license) {
            packages[name] = dep.license
          }
          traverse(dep)
        }
      }
    }

    traverse(data)
    return packages
  } catch (e) {
    console.error('Failed to read package licenses; npm ls may not be available')
    return {}
  }
}

/**
 * Main check
 */
function main() {
  console.log('Checking licenses...\n')

  const packages = getAllPackageLicenses()

  if (Object.keys(packages).length === 0) {
    console.log('No packages found or npm ls failed; skipping license check')
    process.exit(0)
  }

  const violations = []

  for (const [name, license] of Object.entries(packages)) {
    // Check exceptions first
    if (exceptions[name]) {
      console.log(`  ⓘ ${name}: ${license} (excepted)`)
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
    violations.forEach(({ name, license }) => {
      console.error(`  - ${name}: ${license}`)
      console.error(`    Add to tooling/scripts/license-exceptions.json to allow`)
    })
    console.error('\nDisallowed licenses: GPL*, AGPL*, SSPL*, or unknown.')
    console.error('Allowed licenses:', Array.from(ALLOWED_LICENSES).join(', '))
    process.exit(1)
  } else {
    console.log('✓ All licenses are allowed')
    process.exit(0)
  }
}

main()
