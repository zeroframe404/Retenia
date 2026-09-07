import { describe, expect, it } from 'vitest'
import { assertPublicHttpUrl, UnsafeImportUrlError } from './url-safety'

function resolvesTo(...addresses: string[]) {
  return async () => addresses.map((address) => ({ address }))
}

describe('assertPublicHttpUrl', () => {
  it('accepts an https URL that resolves to a public address', async () => {
    await expect(
      assertPublicHttpUrl('https://example.com/article', { resolve: resolvesTo('93.184.216.34') }),
    ).resolves.toBeUndefined()
  })

  it('accepts an http URL that resolves to a public address', async () => {
    await expect(
      assertPublicHttpUrl('http://example.com/article', { resolve: resolvesTo('93.184.216.34') }),
    ).resolves.toBeUndefined()
  })

  it('rejects a non-http(s) scheme', async () => {
    await expect(assertPublicHttpUrl('file:///etc/passwd')).rejects.toThrow(UnsafeImportUrlError)
  })

  it('rejects an invalid URL', async () => {
    await expect(assertPublicHttpUrl('not a url')).rejects.toThrow(UnsafeImportUrlError)
  })

  it('rejects "localhost"', async () => {
    await expect(assertPublicHttpUrl('http://localhost:11434/api/tags')).rejects.toThrow(
      UnsafeImportUrlError,
    )
  })

  it('rejects a ".local" mDNS hostname', async () => {
    await expect(assertPublicHttpUrl('http://printer.local/')).rejects.toThrow(UnsafeImportUrlError)
  })

  it('rejects a ".internal" hostname', async () => {
    await expect(assertPublicHttpUrl('http://service.internal/')).rejects.toThrow(
      UnsafeImportUrlError,
    )
  })

  it.each([
    ['loopback', '127.0.0.1'],
    ['this-network', '0.5.5.5'],
    ['link-local / cloud metadata', '169.254.169.254'],
    ['RFC1918 10/8', '10.0.0.5'],
    ['RFC1918 172.16/12', '172.16.0.1'],
    ['RFC1918 172.16/12 upper bound', '172.31.255.255'],
    ['RFC1918 192.168/16', '192.168.1.1'],
    ['carrier-grade NAT', '100.64.0.1'],
    ['TEST-NET-1', '192.0.2.1'],
    ['TEST-NET-2', '198.51.100.1'],
    ['TEST-NET-3', '203.0.113.1'],
    ['benchmarking', '198.18.0.1'],
    ['multicast', '224.0.0.1'],
    ['broadcast', '255.255.255.255'],
  ])('rejects a literal IPv4 host that is %s (%s)', async (_label, ip) => {
    await expect(assertPublicHttpUrl(`http://${ip}/`)).rejects.toThrow(UnsafeImportUrlError)
  })

  it.each([
    ['loopback', '[::1]'],
    ['unspecified', '[::]'],
    ['link-local', '[fe80::1]'],
    ['unique local', '[fd00::1]'],
    ['unique local upper bound', '[fdff::1]'],
    ['multicast', '[ff02::1]'],
    ['IPv4-mapped loopback', '[::ffff:127.0.0.1]'],
    ['IPv4-mapped private', '[::ffff:192.168.1.1]'],
    // IPv4-compatible (deprecated, still parsed): a bare IPv4 address in the last 32 bits with
    // an all-zero 96-bit prefix — not the same form as `::ffff:a.b.c.d` above (no `ffff`).
    ['IPv4-compatible loopback', '[::127.0.0.1]'],
    ['IPv4-compatible link-local/cloud-metadata', '[::169.254.169.254]'],
    ['IPv4-compatible loopback (hex groups)', '[::7f00:1]'],
    // NAT64's well-known prefix, embedding an IPv4 address in the last 32 bits.
    ['NAT64-embedded loopback', '[64:ff9b::127.0.0.1]'],
    ['NAT64-embedded private', '[64:ff9b::192.168.1.1]'],
    // 6to4: the embedded IPv4 address sits right after the fixed 2002:: prefix.
    ['6to4-embedded loopback', '[2002:7f00:1::]'],
    ['6to4-embedded private', '[2002:c0a8:101::]'],
  ])('rejects a literal IPv6 host that is %s (%s)', async (_label, host) => {
    await expect(assertPublicHttpUrl(`http://${host}/`)).rejects.toThrow(UnsafeImportUrlError)
  })

  it('accepts a public literal IPv4 address', async () => {
    await expect(assertPublicHttpUrl('http://93.184.216.34/')).resolves.toBeUndefined()
  })

  it('accepts a public literal IPv6 address', async () => {
    await expect(
      assertPublicHttpUrl('http://[2606:2800:220:1:248:1893:25c8:1946]/'),
    ).resolves.toBeUndefined()
  })

  it('accepts a 6to4 address whose embedded IPv4 is public', async () => {
    // 2002:5db8:d800:: encodes the public address 93.184.216.0.
    await expect(assertPublicHttpUrl('http://[2002:5db8:d800::]/')).resolves.toBeUndefined()
  })

  it('rejects a public-looking hostname that resolves to a private address (DNS rebinding)', async () => {
    await expect(
      assertPublicHttpUrl('http://internal.example.com/', { resolve: resolvesTo('10.0.0.5') }),
    ).rejects.toThrow(UnsafeImportUrlError)
  })

  it('rejects when only one of several resolved addresses is private', async () => {
    await expect(
      assertPublicHttpUrl('http://multi.example.com/', {
        resolve: resolvesTo('93.184.216.34', '127.0.0.1'),
      }),
    ).rejects.toThrow(UnsafeImportUrlError)
  })

  it('rejects when the hostname resolves to nothing', async () => {
    await expect(
      assertPublicHttpUrl('http://nowhere.example.com/', { resolve: async () => [] }),
    ).rejects.toThrow(UnsafeImportUrlError)
  })

  it('rejects when DNS resolution itself fails', async () => {
    await expect(
      assertPublicHttpUrl('http://nxdomain.example.com/', {
        resolve: async () => {
          throw new Error('ENOTFOUND')
        },
      }),
    ).rejects.toThrow(UnsafeImportUrlError)
  })
})
