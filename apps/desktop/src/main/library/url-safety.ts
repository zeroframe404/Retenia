import { lookup } from 'node:dns/promises'
import { isIPv4, isIPv6 } from 'node:net'

/**
 * Blocks the web importer from being turned into an SSRF primitive against the user's own
 * machine or LAN (`security-reviewer` finding H1). The importer is reachable not only from the
 * "Pegar URL" dialog but from a `retenia://import?src=<url>` deep link a hostile *webpage* can
 * fire with nothing more than the OS's one-time "open Retenia?" prompt — so a URL like
 * `http://192.168.1.1/admin` or `http://169.254.169.254/latest/meta-data/` must never reach
 * `net.fetch` (or, worse, the hidden `BrowserWindow` SPA fallback, which runs the target's own
 * JavaScript with that origin's privileges). Scheme restriction alone (`http`/`https` only,
 * enforced in `packages/ipc-contract`) says nothing about *which* http(s) host this is.
 *
 * DNS-resolves the hostname rather than trusting a literal IP in the URL, since the attack this
 * defends is exactly "the hostname *looks* public" (`internal.example.com` resolving to
 * `10.0.0.5` on the user's own network, or a public-looking host that 302s to a private one —
 * `assertPublicHttpUrl` is called again on every redirect hop by `web-fetch.ts`, not just once
 * on the input URL).
 *
 * Accepted residual risk (`security-reviewer` finding "New-2"): this resolves the hostname once,
 * here, via `dns.lookup`; the actual request is then issued independently by `net.fetch` (in
 * `web-fetch.ts`) or by Chromium's own navigation stack (in `spa-render.ts`'s hidden
 * `BrowserWindow`), each of which may resolve the *same* hostname again through a different
 * resolver (DNS-over-HTTPS, a corporate proxy, a stale cache) and could in principle land on a
 * different address than the one just checked — a DNS TOCTOU/rebinding window this module does
 * not close. Closing it fully would mean resolving once and connecting to the pinned IP directly
 * (with an explicit `Host` header), which neither `net.fetch` nor a `BrowserWindow` navigation
 * exposes a way to do. Treated as acceptable here because the realistic attacker (a hostile
 * webpage driving a deep link, or a hostile page fetched as a source) cannot control the
 * resolution race window with any precision, and the common, high-confidence cases — a literal
 * private IP, a hostname that resolves privately every time, a redirect straight to one — are
 * exactly what this module does close.
 */

export class UnsafeImportUrlError extends Error {
  constructor(
    readonly url: string,
    readonly reason: string,
  ) {
    // Deliberately not "Refusing to import ...": electron-vite's main-bundle shim inserter
    // uses a regex that matches the word "import" immediately followed by a quote, and a log
    // message of that shape gets mistaken for a real `import` statement at build time
    // (`import-shaped-strings.test.ts` — the very test this rewording keeps green).
    super(`Refusing to fetch "${url}": ${reason}`)
    this.name = 'UnsafeImportUrlError'
  }
}

/** IPv4 ranges that are never a legitimate public web page: loopback, link-local, the three
 *  RFC 1918 private blocks, carrier-grade NAT, the documentation/benchmark TEST-NETs, and
 *  multicast/reserved space. Not exhaustive of every IANA special-purpose block — exhaustive of
 *  every one that resolves to something reachable from this machine or its LAN. */
function isPrivateOrReservedIPv4(ip: string): boolean {
  const octets = ip.split('.').map(Number)
  if (octets.length !== 4 || octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return true // Malformed input is refused, not let through.
  }
  const [a, b, c] = octets as [number, number, number, number]
  if (a === 0) return true // "this network"
  if (a === 10) return true // RFC 1918
  if (a === 127) return true // loopback
  if (a === 169 && b === 254) return true // link-local (also cloud metadata endpoints)
  if (a === 172 && b >= 16 && b <= 31) return true // RFC 1918
  if (a === 192 && b === 168) return true // RFC 1918
  if (a === 100 && b >= 64 && b <= 127) return true // carrier-grade NAT (RFC 6598)
  if (a === 192 && b === 0 && c === 0) return true // IETF protocol assignments
  if (a === 192 && b === 0 && c === 2) return true // TEST-NET-1
  if (a === 198 && (b === 18 || b === 19)) return true // benchmarking
  if (a === 198 && b === 51 && c === 100) return true // TEST-NET-2
  if (a === 203 && b === 0 && c === 113) return true // TEST-NET-3
  if (a >= 224) return true // multicast (224-239) and reserved (240-255), incl. 255.255.255.255
  return false
}

/**
 * Expands any valid textual IPv6 form (`::` compression, an embedded-IPv4 tail like
 * `::ffff:127.0.0.1` or `64:ff9b::1.2.3.4`) into its 16 address bytes, or `null` if it isn't
 * well-formed. A previous version of the range checks below worked off the *first hex group*
 * as a number, which is only ever exact for prefixes aligned to a 16-bit boundary — `fe80::/10`
 * and `fc00::/7` happen to be, but this misses e.g. `::127.0.0.1` (`security-reviewer` finding
 * "New-5": an IPv4-compatible or NAT64/6to4 address encoding a private IPv4 was never checked
 * at all). Byte-level prefix matching below is exact for any prefix length.
 */
function parseIPv6Bytes(ip: string): Uint8Array | null {
  const withoutZone = ip.split('%')[0] ?? ip
  const halves = withoutZone.split('::')
  if (halves.length > 2) return null // more than one "::" is never valid

  // The last group of either half may be a dotted IPv4 literal (`::ffff:127.0.0.1`,
  // `64:ff9b::1.2.3.4`) — folded into two hex groups before the rest is parsed as plain IPv6.
  function groupsOf(half: string | undefined): string[] | null {
    if (half === undefined || half.length === 0) return []
    const groups = half.split(':')
    const last = groups.at(-1)
    if (last?.includes('.')) {
      const octets = last.split('.')
      if (octets.length !== 4) return null
      const bytes = octets.map(Number)
      if (bytes.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null
      const [a, b, c, d] = bytes as [number, number, number, number]
      groups.splice(groups.length - 1, 1, ((a << 8) | b).toString(16), ((c << 8) | d).toString(16))
    }
    return groups
  }

  const head = groupsOf(halves[0])
  const tail = halves.length === 2 ? groupsOf(halves[1]) : []
  if (head === null || tail === null) return null

  let allGroups: string[]
  if (halves.length === 2) {
    const missing = 8 - head.length - tail.length
    if (missing < 0) return null
    allGroups = [...head, ...(Array(missing).fill('0') as string[]), ...tail]
  } else {
    if (head.length !== 8) return null
    allGroups = head
  }
  if (allGroups.length !== 8 || allGroups.some((g) => g.length === 0)) return null

  const bytes = new Uint8Array(16)
  for (const [i, group] of allGroups.entries()) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(group)) return null
    const value = Number.parseInt(group, 16)
    bytes[i * 2] = (value >> 8) & 0xff
    bytes[i * 2 + 1] = value & 0xff
  }
  return bytes
}

/** Whether `bytes`' leading `bitLength` bits equal `prefix`'s. */
function hasIPv6Prefix(bytes: Uint8Array, prefix: number[], bitLength: number): boolean {
  const fullBytes = Math.floor(bitLength / 8)
  for (let i = 0; i < fullBytes; i += 1) {
    if (bytes[i] !== prefix[i]) return false
  }
  const remainingBits = bitLength % 8
  if (remainingBits === 0) return true
  const mask = (0xff << (8 - remainingBits)) & 0xff
  return ((bytes[fullBytes] ?? 0) & mask) === ((prefix[fullBytes] ?? 0) & mask)
}

function ipv4StringFromLastBytes(bytes: Uint8Array): string {
  return `${bytes[12]}.${bytes[13]}.${bytes[14]}.${bytes[15]}`
}

/** IPv6 equivalents: loopback, unspecified, link-local (`fe80::/10`), unique local
 *  (`fc00::/7`, the IPv6 analogue of RFC 1918), multicast, and every address family that embeds
 *  an IPv4 address — IPv4-mapped (`::ffff:0:0/96`), IPv4-compatible (`::/96`, deprecated but
 *  still parsed by every stack), NAT64 (`64:ff9b::/96`) and 6to4 (`2002::/16`) — delegated to
 *  the IPv4 table above so a private address encoded any of these ways is still refused. */
function isPrivateOrReservedIPv6(ip: string): boolean {
  const bytes = parseIPv6Bytes(ip)
  if (bytes === null) return true // Not well-formed — refused, not let through.

  if (bytes.every((b) => b === 0)) return true // ::
  if (bytes.every((b, i) => b === (i === 15 ? 1 : 0))) return true // ::1

  if (hasIPv6Prefix(bytes, [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0xff, 0xff], 96)) {
    return isPrivateOrReservedIPv4(ipv4StringFromLastBytes(bytes)) // IPv4-mapped
  }
  if (hasIPv6Prefix(bytes, new Array(12).fill(0), 96)) {
    return isPrivateOrReservedIPv4(ipv4StringFromLastBytes(bytes)) // IPv4-compatible
  }
  if (hasIPv6Prefix(bytes, [0x00, 0x64, 0xff, 0x9b, 0, 0, 0, 0, 0, 0, 0, 0], 96)) {
    return isPrivateOrReservedIPv4(ipv4StringFromLastBytes(bytes)) // NAT64
  }
  if (bytes[0] === 0x20 && bytes[1] === 0x02) {
    return isPrivateOrReservedIPv4(`${bytes[2]}.${bytes[3]}.${bytes[4]}.${bytes[5]}`) // 6to4
  }
  if (bytes[0] === 0xfe && ((bytes[1] ?? 0) & 0xc0) === 0x80) return true // fe80::/10
  if (((bytes[0] ?? 0) & 0xfe) === 0xfc) return true // fc00::/7
  if (bytes[0] === 0xff) return true // ff00::/8 multicast
  return false
}

function isPrivateOrReservedIp(ip: string): boolean {
  if (isIPv4(ip)) return isPrivateOrReservedIPv4(ip)
  if (isIPv6(ip)) return isPrivateOrReservedIPv6(ip)
  return true // Not a literal IP at all — treated as unsafe by the caller.
}

/** mDNS/NetBIOS-style hostnames resolve only inside the local network and never go through
 *  public DNS the same way a real domain does. */
function isLocalHostname(hostname: string): boolean {
  const lower = hostname.toLowerCase()
  return lower === 'localhost' || lower.endsWith('.local') || lower.endsWith('.internal')
}

export interface AssertPublicHttpUrlDeps {
  /** Test seam; `dns.lookup` otherwise. */
  resolve?: (hostname: string) => Promise<{ address: string }[]>
}

/**
 * Throws `UnsafeImportUrlError` unless `url` is `http(s)` and every address its host resolves
 * to is a public, non-reserved IP. Called on the original URL and again on each redirect hop
 * (`web-fetch.ts`), and before the SPA fallback ever loads a URL in a real `BrowserWindow`
 * (`spa-render.ts` is only ever reached through `web-fetch.ts`, so one call site covers both).
 */
export async function assertPublicHttpUrl(
  url: string,
  deps: AssertPublicHttpUrlDeps = {},
): Promise<void> {
  const resolve = deps.resolve ?? ((hostname: string) => lookup(hostname, { all: true }))

  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new UnsafeImportUrlError(url, 'not a valid URL')
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new UnsafeImportUrlError(url, `scheme "${parsed.protocol}" is not http(s)`)
  }

  // Unlike `url.host`, `url.hostname` keeps an IPv6 literal's brackets (`[::1]`, not `::1`) —
  // `net.isIPv6` and the range checks below both need the bracket-free form.
  const hostname = parsed.hostname
  const literalHost =
    hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname

  if (isLocalHostname(hostname)) {
    throw new UnsafeImportUrlError(url, `"${hostname}" is a local-only hostname`)
  }

  if (isIPv4(literalHost) || isIPv6(literalHost)) {
    if (isPrivateOrReservedIp(literalHost)) {
      throw new UnsafeImportUrlError(url, `"${hostname}" is a private or reserved address`)
    }
    return
  }

  let addresses: { address: string }[]
  try {
    addresses = await resolve(hostname)
  } catch (error) {
    throw new UnsafeImportUrlError(
      url,
      `could not resolve "${hostname}": ${error instanceof Error ? error.message : String(error)}`,
    )
  }

  if (addresses.length === 0) {
    throw new UnsafeImportUrlError(url, `"${hostname}" did not resolve to any address`)
  }

  for (const { address } of addresses) {
    if (isPrivateOrReservedIp(address)) {
      throw new UnsafeImportUrlError(
        url,
        `"${hostname}" resolves to ${address}, a private or reserved address`,
      )
    }
  }
}
