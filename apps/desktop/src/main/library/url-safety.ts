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

/** IPv6 equivalents: loopback, unspecified, link-local (`fe80::/10`), unique local
 *  (`fc00::/7`, the IPv6 analogue of RFC 1918), multicast, and IPv4-mapped/-compatible
 *  addresses (checked against the IPv4 table above — `::ffff:127.0.0.1` is loopback too). */
function isPrivateOrReservedIPv6(ip: string): boolean {
  const normalized = ip.toLowerCase()
  if (normalized === '::1' || normalized === '::') return true

  const mappedV4 = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(normalized)
  if (mappedV4?.[1] !== undefined) return isPrivateOrReservedIPv4(mappedV4[1])

  const firstGroup = normalized.split(':').find((group) => group.length > 0)
  const value = firstGroup !== undefined ? Number.parseInt(firstGroup, 16) : Number.NaN
  if (Number.isNaN(value)) return true

  if (value >= 0xfe80 && value <= 0xfebf) return true // link-local, fe80::/10
  if (value >= 0xfc00 && value <= 0xfdff) return true // unique local, fc00::/7
  if (value >= 0xff00 && value <= 0xffff) return true // multicast, ff00::/8
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
