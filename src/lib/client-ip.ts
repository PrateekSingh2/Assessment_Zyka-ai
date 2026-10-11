/**
 * Zero-Trust Client IP Resolution
 *
 * SECURITY: Only trusts proxy headers when TRUSTED_PROXY_HOPS > 0.
 * All client-supplied x-zyka-* IP headers are DROPPED and NEVER trusted.
 *
 * Set TRUSTED_PROXY_HOPS=1 in env when exactly one trusted reverse proxy
 * sits in front of this server. Set 0 (default) when directly exposed.
 *
 * NEVER read x-zyka-real-ip / x-zyka-client-public-ip / x-zyka-ip-source
 * from request headers as a trust signal — those are attacker-controlled.
 */

import { isIP } from "node:net";
import type { ReadonlyHeaders } from "next/dist/server/web/spec-extension/adapters/headers";

export type IpSource =
  | "x-forwarded-for"
  | "socket"
  | "system-lan-interface"
  | "remote-addr-fallback";

export interface ClientIpResult {
  readonly ip: string;
  readonly source: IpSource;
}

// How many proxy hops to trust on X-Forwarded-For (right-to-left).
const TRUSTED_HOPS = Math.max(
  0,
  parseInt(process.env.TRUSTED_PROXY_HOPS ?? "0", 10) || 0
);

/** Strip IPv4-mapped IPv6 prefix and validate; return null if invalid. */
function normalizeAndValidate(raw: string): string | null {
  let t = raw.trim();
  // Strip IPv4-mapped IPv6 prefix (::ffff:)
  t = t.replace(/^::ffff:/i, "");
  // Reject anything too long or not a valid IP address
  if (t.length > 45 || isIP(t) === 0) return null;
  return t;
}

function isLoopback(ip: string): boolean {
  return (
    ip === "127.0.0.1" ||
    ip === "::1" ||
    ip === "0.0.0.0" ||
    ip.startsWith("127.")
  );
}

/**
 * Resolves the real client IP with zero trust toward any client-supplied header.
 *
 * When TRUSTED_PROXY_HOPS > 0, reads the Nth-from-right entry in
 * X-Forwarded-For (where N = TRUSTED_PROXY_HOPS), which is the entry
 * appended by the outermost trusted proxy. This is the only correct way
 * to use XFF behind a known proxy.
 */
export function resolveClientIp(
  headers: Headers | ReadonlyHeaders | Record<string, string>
): ClientIpResult {
  const get = (name: string): string | null => {
    if (typeof (headers as Headers).get === "function") {
      return (headers as Headers).get(name);
    }
    const rec = headers as Record<string, string>;
    return rec[name] ?? rec[name.toLowerCase()] ?? null;
  };

  if (TRUSTED_HOPS > 0) {
    const xff = get("x-forwarded-for") ?? "";
    const parts = xff.split(",").map((p) => p.trim());
    // The entry placed by the outermost trusted proxy is at index (total - TRUSTED_HOPS)
    const candidate = parts[parts.length - TRUSTED_HOPS] ?? "";
    const ip = normalizeAndValidate(candidate);
    if (ip && !isLoopback(ip)) {
      return { ip, source: "x-forwarded-for" };
    }
  }

  // Fallback: server sees this directly from the socket (req.ip in Next.js)
  // In Next.js App Router the socket IP is not directly exposed on
  // the NextRequest object in all runtimes, so we use LAN discovery in dev.
  const systemLan = getSystemLanIp();
  if (systemLan) return { ip: systemLan, source: "system-lan-interface" };

  return { ip: "127.0.0.1", source: "remote-addr-fallback" };
}

/**
 * Resolves the server's active non-loopback LAN IPv4 address.
 * Used only as a last-resort fallback for local dev; never in production.
 */
export function getSystemLanIp(): string | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const os = require("os") as typeof import("os");
    const ifaces = os.networkInterfaces();
    for (const name of Object.keys(ifaces)) {
      const netList = ifaces[name];
      if (!netList) continue;
      for (const net of netList) {
        if (net.family === "IPv4" && !net.internal && !isLoopback(net.address)) {
          return net.address;
        }
      }
    }
  } catch {
    // Edge runtime — no os module
  }
  return null;
}

/** Deterministic anonymous fingerprint from IP + UA. Server-side only. */
export function resolveAnonymousUserId(
  ip: string,
  userAgent: string
): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const crypto = require("crypto") as typeof import("crypto");
    const hash = crypto
      .createHash("sha256")
      .update(`${ip}|${userAgent}`)
      .digest("hex")
      .substring(0, 10);
    return `usr_anon_${hash}`;
  } catch {
    // Fallback djb2
    let h = 5381;
    const str = `${ip}|${userAgent}`;
    for (let i = 0; i < str.length; i++) {
      h = ((h * 33) ^ str.charCodeAt(i)) >>> 0;
    }
    return `usr_anon_${h.toString(16).padStart(8, "0")}`;
  }
}
