/**
 * Server-side request forgery guard for the embed snapshotter.
 *
 * The snapshotter's generic Open Graph adapter is deliberately "any URL", and
 * `embed-snapshot.ts --all` sweeps bare URLs out of `src/content/**` and fetches them with no
 * per-URL confirmation. Content is not always owner-authored — a site can be imported from
 * another platform, or carry a contributed post — so a URL pointing at a private address can
 * reach the fetcher without anyone choosing it.
 *
 * That matters because the result is *published*: an attacker-controlled page can return real
 * `og:` tags plus an `og:image` pointing at an internal address, and `downloadAssets` would
 * fetch those bytes and commit them to the owner's public repo. This guard blocks the request
 * instead.
 *
 * Every hop is checked, because a public URL may redirect to a private one.
 *
 * Known limitation: the check resolves the hostname and inspects the answer, but the socket
 * resolves it again independently, so a DNS entry that changes between the two (rebinding)
 * is not covered. Closing that needs connection-level pinning, which Node's `fetch` does not
 * expose. The guard raises the bar from "trivial" to "requires an active rebinding attack".
 */
import { isIPv4, isIPv6 } from "node:net";
import { lookup as dnsLookup } from "node:dns/promises";

/** Signature of the resolver, injectable so tests never touch DNS. */
export type HostLookup = (hostname: string) => Promise<string[]>;

const defaultLookup: HostLookup = async (hostname) =>
  (await dnsLookup(hostname, { all: true })).map((entry) => entry.address);

/** IPv4 ranges that must never be fetched, as [firstAddress, prefixLength]. */
const BLOCKED_V4: ReadonlyArray<readonly [string, number]> = [
  ["0.0.0.0", 8], // "this network"
  ["10.0.0.0", 8], // RFC1918 private
  ["100.64.0.0", 10], // RFC6598 carrier-grade NAT
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local — includes the 169.254.169.254 cloud metadata endpoint
  ["172.16.0.0", 12], // RFC1918 private
  ["192.0.0.0", 24], // IETF protocol assignments
  ["192.168.0.0", 16], // RFC1918 private
  ["198.18.0.0", 15], // benchmarking
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved, includes 255.255.255.255 broadcast
];

function v4ToInt(address: string): number | null {
  const parts = address.split(".");
  if (parts.length !== 4) return null;
  let out = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    out = out * 256 + octet;
  }
  return out;
}

/**
 * Whether an IP literal is one the snapshotter must refuse. Unparseable input is treated as
 * blocked: this is a denylist guarding a network call, so anything it cannot positively
 * classify as a public address is refused rather than allowed through.
 */
export function isBlockedAddress(address: string): boolean {
  if (isIPv4(address)) {
    const value = v4ToInt(address);
    if (value === null) return true;
    return BLOCKED_V4.some(([base, bits]) => {
      const baseValue = v4ToInt(base);
      if (baseValue === null) return true;
      const mask = bits === 0 ? 0 : (-1 << (32 - bits)) >>> 0;
      return (value & mask) >>> 0 === (baseValue & mask) >>> 0;
    });
  }

  if (isIPv6(address)) {
    const lower = address.toLowerCase();
    // IPv4-mapped (::ffff:127.0.0.1) and IPv4-compatible forms carry a v4 address; judge that.
    const embedded = lower.match(/:((?:\d{1,3}\.){3}\d{1,3})$/)?.[1];
    if (embedded) return isBlockedAddress(embedded);
    const compact = lower.replace(/[\[\]]/g, "");
    if (compact === "::1" || compact === "::") return true;
    const firstHextet = compact.split(":")[0];
    if (firstHextet === "") return true; // begins with "::" — unspecified or loopback-adjacent
    const value = parseInt(firstHextet.padEnd(4, "0"), 16);
    if (Number.isNaN(value)) return true;
    if ((value & 0xfe00) === 0xfc00) return true; // fc00::/7 unique-local
    if ((value & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
    if ((value & 0xff00) === 0xff00) return true; // ff00::/8 multicast
    return false;
  }

  return true; // not an IP literal at all
}

/**
 * Reject a URL whose host is — or resolves to — a non-public address. Throws with a message
 * the CLI surfaces verbatim, so an owner who hits this understands why rather than seeing a
 * bare network error.
 */
export async function assertPublicURL(url: string, lookup: HostLookup = defaultLookup): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`refusing to fetch a malformed URL: ${url}`);
  }

  // A bracketed IPv6 literal keeps its brackets in `hostname`; strip them before classifying.
  const host = parsed.hostname.replace(/^\[|\]$/g, "");

  if (isIPv4(host) || isIPv6(host)) {
    if (isBlockedAddress(host)) {
      throw new Error(`refusing to fetch a private or reserved address: ${host}`);
    }
    return;
  }

  let addresses: string[];
  try {
    addresses = await lookup(host);
  } catch {
    throw new Error(`refusing to fetch ${host}: hostname did not resolve`);
  }
  if (addresses.length === 0) {
    throw new Error(`refusing to fetch ${host}: hostname did not resolve`);
  }
  // Every answer must be public — one private address is enough to refuse, so a hostname
  // deliberately published with both a public and a private A record cannot slip through.
  for (const address of addresses) {
    if (isBlockedAddress(address)) {
      throw new Error(`refusing to fetch ${host}: resolves to a private or reserved address (${address})`);
    }
  }
}
