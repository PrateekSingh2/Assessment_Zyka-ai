import type { AspectRatio, Duration } from "@/types";

export interface UpstreamErrorPayload {
  code?: string;
  technicalMessage?: string;
  upstreamService?: string;
  traceId?: string;
  metadata?: {
    conflictingRatio?: string;
    selectedRatio?: string;
    promptRatio?: string;
    dropdownRatio?: string;
    conflictingDuration?: string;
    selectedDuration?: string;
    promptDuration?: string;
    dropdownDuration?: string;
    invalidRatio?: string;
    requestedDuration?: string;
    maxDuration?: string;
    maxWordLimit?: number;
    detectedWordCount?: number;
    unsupportedFormat?: string;
    [key: string]: any;
  };
}

export const MAX_HEADER_VALUE_LENGTH = 1000;
export const MAX_TOTAL_HEADERS_BYTES = 4096;

/**
 * STRICT SECURITY ALLOWLIST: Permissible upstream headers forwarded through proxy layer.
 * Mitigates cumulative header stuffing attacks and proxy 431 crashes.
 * PART 2: Any upstream header not explicitly listed here is strictly dropped.
 * (Wildcard 'x-zyka-' bypass has been completely eliminated).
 */
export const ALLOWED_UPSTREAM_HEADERS: ReadonlySet<string> = new Set([
  "x-upstream-error-code",
  "x-upstream-service",
  "x-upstream-trace-id",
  "x-ratelimit-limit",
  "x-ratelimit-remaining",
  "x-ratelimit-reset",
  "retry-after",
  "x-invalid-ratio",
  "x-upstream-invalid-ratio",
  "x-conflicting-prompt-ratio",
  "x-upstream-conflicting-ratio",
  "x-selected-dropdown-ratio",
  "x-upstream-selected-ratio",
  "x-conflicting-prompt-duration",
  "x-upstream-conflicting-duration",
  "x-selected-dropdown-duration",
  "x-upstream-selected-duration",
]);

/**
 * STRICT RUNTIME LITERAL SETS: Prevents Blind Type Casting & Runtime Corruption.
 */
export const ALLOWED_ASPECT_RATIOS: ReadonlySet<string> = new Set([
  "1:1",
  "16:9",
  "9:16",
  "4:3",
  "21:9",
]);

export const ALLOWED_DURATIONS: ReadonlySet<string> = new Set([
  "2s",
  "5s",
  "10s",
  "15s",
  "30s",
]);

export const ALLOWED_SERVICES: ReadonlySet<string> = new Set(["image", "video", "voice"]);

/**
 * DANGEROUS KEYS: Blocked to prevent Prototype Pollution attacks.
 */
export const DANGEROUS_PROTO_KEYS: ReadonlySet<string> = new Set([
  "__proto__",
  "constructor",
  "prototype",
]);

/**
 * ZERO-TRUST SECURITY: Eliminate Double-Escaping (XSS vs UI Degradation)
 * Strictly removes <, >, {, }, =, (, ) to prevent HTML/payload injection while
 * avoiding HTML entity encoding (&lt;, &gt;) that causes literal UI text degradation in React.
 */
export function stripDangerousChars(str: unknown): string {
  if (typeof str !== "string") return "";
  return str.replace(/[<>{}=()]/g, "").trim();
}

/**
 * ZERO-TRUST SECURITY: Patch Type Leaks in Metadata
 * Safely accesses metadata properties returning `unknown` (eliminating any-type leaks).
 * Blocks poisoned prototype keys (__proto__, constructor, prototype) and verifies own properties.
 */
export function getSafeMetadata(
  metadata: unknown,
  key: string
): unknown {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return undefined;
  }
  if (DANGEROUS_PROTO_KEYS.has(key)) {
    return undefined;
  }
  if (!Object.prototype.hasOwnProperty.call(metadata, key)) {
    return undefined;
  }
  return (metadata as Record<string, unknown>)[key];
}

/**
 * ZERO-TRUST SECURITY: Safe String Extraction from Metadata
 * Defensively extracts primitive strings, safely discarding accidental objects or arrays
 * without interpolating '[object Object]' into user-facing messages.
 */
export function extractSafeString(val: unknown): string | undefined {
  if (typeof val === "string") {
    const trimmed = val.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  if (typeof val === "number" || typeof val === "boolean") {
    return String(val);
  }
  return undefined;
}

/**
 * Runtime literal validation for AspectRatio union type.
 * Drops invalid or injected strings to undefined.
 */
export function validateAspectRatio(val: unknown): AspectRatio | undefined {
  if (typeof val === "string") {
    const cleaned = stripDangerousChars(val);
    if (ALLOWED_ASPECT_RATIOS.has(cleaned)) {
      return cleaned as AspectRatio;
    }
  }
  return undefined;
}

/**
 * Runtime literal validation for Duration union type.
 * Drops invalid or injected strings to undefined.
 */
export function validateDuration(val: unknown): Duration | undefined {
  if (typeof val === "string") {
    const cleaned = stripDangerousChars(val).toLowerCase();
    if (ALLOWED_DURATIONS.has(cleaned)) {
      return cleaned as Duration;
    }
  }
  return undefined;
}

/**
 * Runtime literal validation for Service union type.
 */
export function validateService(val: unknown): "image" | "video" | "voice" | undefined {
  if (typeof val === "string") {
    const cleaned = stripDangerousChars(val).toLowerCase();
    if (ALLOWED_SERVICES.has(cleaned)) {
      return cleaned as "image" | "video" | "voice";
    }
  }
  return undefined;
}

/**
 * Status Code Sanity Checks:
 * Coerces and clamps upstreamStatus to a valid integer in [100, 599].
 * Defaults safely to 500 if NaN, null, undefined, 0, or out of range.
 */
export function normalizeStatusCode(status: unknown): number {
  const parsed = typeof status === "number" ? status : Number(status);
  if (!Number.isInteger(parsed) || parsed < 100 || parsed > 599) {
    return 500;
  }
  return parsed;
}

/**
 * Null/Malformed Input Resilience & Header Case-Insensitivity:
 * Canonicalizes header keys to lowercase and drops dangerous prototype keys.
 */
export function normalizeHeaders(
  rawHeaders: unknown
): Record<string, string> {
  if (!rawHeaders || typeof rawHeaders !== "object" || Array.isArray(rawHeaders)) {
    return {};
  }
  const normalized: Record<string, string> = {};
  for (const [key, val] of Object.entries(rawHeaders as Record<string, unknown>)) {
    if (typeof key === "string" && !DANGEROUS_PROTO_KEYS.has(key)) {
      normalized[key.toLowerCase()] = typeof val === "string" ? val : String(val ?? "");
    }
  }
  return normalized;
}

/**
 * Safely performs bounded, shallow serialization of an object without
 * deep recursive traversal. Protects the Node.js event loop from DoS attacks.
 */
export function safeShallowSerialize(obj: object): string {
  try {
    if (Array.isArray(obj)) {
      const items = obj.slice(0, 10).map((item) => {
        if (item === null) return "null";
        if (typeof item === "object") return "[Nested]";
        return String(item).substring(0, 50);
      });
      return `[${items.join(",")}]`;
    }
    const keys = Object.keys(obj).slice(0, 10);
    const entries = keys
      .map((key) => {
        if (DANGEROUS_PROTO_KEYS.has(key)) return null;
        const v = (obj as Record<string, unknown>)[key];
        const formattedVal =
          v === null
            ? "null"
            : typeof v === "object"
            ? "[Nested]"
            : JSON.stringify(String(v).substring(0, 50));
        return `${JSON.stringify(key)}:${formattedVal}`;
      })
      .filter(Boolean);
    return `{${entries.join(",")}}`;
  } catch {
    return "[Object]";
  }
}

/**
 * Sanitizes header values for safe, spec-compliant HTTP transport:
 * 1. Prevents Event Loop DoS: Bounded shallow serialization for objects
 * 2. Prevents HTTP Response Splitting: Converts CR/LF newlines to " | "
 * 3. Prevents ERR_INVALID_CHAR Crashes: Strips non-ASCII/control characters outside 0x20-0x7E
 * 4. Prevents 431 Request Header Too Large: Enforces strict per-header length limit (1,000 chars)
 */
export function sanitizeHeaderValue(
  val: unknown,
  maxLength: number = MAX_HEADER_VALUE_LENGTH
): string {
  if (val === null || val === undefined) return "";

  let rawString: string;
  if (typeof val === "object") {
    rawString = safeShallowSerialize(val);
  } else {
    rawString = String(val);
  }

  return rawString
    .replace(/[\r\n]+/g, " | ")
    .replace(/[^\x20-\x7E]/g, "") // Strict ASCII printable range [0x20-0x7E]
    .trim()
    .substring(0, maxLength);
}

/**
 * Generates an RFC 4122 compliant collision-resistant trace ID using native Web Crypto API.
 * 100% Edge Runtime and Turbopack compatible (zero bundler-hostile require() calls).
 */
export function generateSecureTraceId(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return `trace-${crypto.randomUUID()}`;
    }
  } catch {}
  return `trace-${Date.now()}-${Math.random().toString(36).substring(2, 10)}`;
}
