/**
 * Zero-Trust Client IP Resolution
 *
 * SECURITY:
 * 1. Only trusts X-Forwarded-For when TRUSTED_PROXY_HOPS > 0, walking right-to-left.
 * 2. If TRUSTED_PROXY_HOPS > 0 and X-Forwarded-For is missing/invalid, fails closed (UntrustedOriginError).
 * 3. In production, TRUSTED_PROXY_HOPS is mandatory (fails closed).
 * 4. Never returns the server's LAN IP — avoids collapsing all users into one rate-limit bucket.
 * 5. Provides getIpSubnetKey() which collapses IPv6 to /64 to prevent residential /64 flooding.
 * 6. User anonymization uses HMAC with a server secret to prevent IPv4 rainbow-table reversals.
 */

import { isIP } from "node:net";
import crypto from "node:crypto";

export type IpSource =
  | "x-forwarded-for"
  | "socket"
  | "system-lan-interface"
  | "remote-addr-fallback";

export interface ClientIpResult {
  readonly ip: string;
  readonly source: IpSource;
}

export class UntrustedOriginError extends Error {
  constructor(message = "Request did not traverse configured trusted proxy") {
    super(message);
    this.name = "UntrustedOriginError";
  }
}

const TRUSTED_HOPS = Math.max(
  0,
  parseInt(process.env.TRUSTED_PROXY_HOPS ?? "0", 10) || 0
);

/** Strip IPv4-mapped IPv6 prefix and validate; return null if invalid. */
export function normalizeAndValidateIp(raw: string): string | null {
  let t = raw.trim();
  t = t.replace(/^::ffff:/i, "");
  if (t.length > 45 || isIP(t) === 0) return null;
  return t.toLowerCase();
}

/**
 * Returns a bucket key:
 * - For IPv4: returns the IP as-is (single /32).
 * - For IPv6: truncates to the first 4 hex groups (/64 prefix) to prevent single-connection flood.
 */
export function getIpSubnetKey(ip: string): string {
  const norm = normalizeAndValidateIp(ip) ?? "127.0.0.1";
  if (!norm.includes(":")) {
    return norm; // IPv4
  }
  // Expand or split IPv6 into segments
  // Quick normalization for IPv6 prefix
  const parts = norm.split(":");
  if (parts.length >= 4) {
    return `${parts.slice(0, 4).join(":")}::/64`;
  }
  return `${norm}::/64`;
}

/**
 * Resolves the real client IP.
 */
export function resolveClientIp(
  headers: Headers | Record<string, string>
): ClientIpResult {
  const getHeader = (name: string): string | null => {
    if (typeof (headers as Headers).get === "function") {
      return (headers as Headers).get(name);
    }
    const rec = headers as Record<string, string>;
    return rec[name] ?? rec[name.toLowerCase()] ?? null;
  };

  if (TRUSTED_HOPS > 0) {
    const xff = getHeader("x-forwarded-for");
    if (!xff) {
      throw new UntrustedOriginError("Missing X-Forwarded-For header from trusted proxy");
    }
    const parts = xff.split(",").map((p) => p.trim());
    if (parts.length < TRUSTED_HOPS) {
      throw new UntrustedOriginError("Insufficient proxy hops in X-Forwarded-For");
    }
    const candidate = parts[parts.length - TRUSTED_HOPS] ?? "";
    const validIp = normalizeAndValidateIp(candidate);
    if (!validIp) {
      throw new UntrustedOriginError("Invalid IP address in X-Forwarded-For");
    }
    return { ip: validIp, source: "x-forwarded-for" };
  }

  // When TRUSTED_HOPS === 0
  if (process.env.NODE_ENV === "production") {
    // Fail closed in production if TRUSTED_PROXY_HOPS is unconfigured
    throw new Error("TRUSTED_PROXY_HOPS environment variable must be configured in production");
  }

  // Development fallback: return fixed loopback, NEVER the server's LAN IP
  return { ip: "127.0.0.1", source: "remote-addr-fallback" };
}

/** Server-side HMAC anonymous user fingerprint */
const ANONYMIZATION_SECRET =
  process.env.SESSION_SECRET ||
  process.env.ADMIN_API_TOKEN ||
  "zyka_dev_salt_k9x2m4p8q1v7w5z3";

export function resolveAnonymousUserId(
  ip: string,
  userAgent: string
): string {
  const subnet = getIpSubnetKey(ip);
  const hmac = crypto
    .createHmac("sha256", ANONYMIZATION_SECRET)
    .update(`${subnet}|${userAgent.slice(0, 128)}`)
    .digest("hex")
    .substring(0, 12);
  return `usr_anon_${hmac}`;
}
