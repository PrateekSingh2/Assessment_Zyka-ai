import type { SanitizedErrorDetail, UpstreamErrorDetail } from "@/types";
import {
  type UpstreamErrorPayload,
  ALLOWED_UPSTREAM_HEADERS,
  MAX_TOTAL_HEADERS_BYTES,
  normalizeStatusCode,
  normalizeErrorStatus,
  normalizeHeaders,
  sanitizeHeaderValue,
  generateSecureTraceId,
} from "./error-utils.ts";
import {
  ErrorHandlers,
  handleFallbackStatusCodes,
  type ErrorHandlerFn,
} from "./error-handlers.ts";

export interface ErrorTranslationResult {
  statusCode: number;
  rawError: UpstreamErrorDetail;
  sanitizedError: SanitizedErrorDetail;
  responseHeaders: Record<string, string>;
}

// Re-export all utilities, types, and handlers for complete backward compatibility
export * from "./error-utils.ts";
export * from "./error-handlers.ts";

/**
 * Enterprise Zero-Trust Middleware Error Interceptor:
 * Orchestrates the Strategy Pattern dispatch table, enforces strict security boundaries,
 * and translates upstream technical errors into creator-actionable feedback.
 *
 * Flow:
 * 1. Normalize and sanitize inputs (clamped status codes, lowercase proto-safe headers)
 * 2. O(1) Strategy Pattern lookup via ErrorHandlers dispatch table
 * 3. Fallback to status-code matrix when error code is unknown or unhandled
 * 4. Merge partial strategy outputs with resilient defaults
 * 5. Construct spec-compliant, length-bounded ASCII headers under strict 4KB budget
 */
export function interceptAndTranslateUpstreamError(
  upstreamStatus: unknown,
  upstreamHeaders: unknown,
  errorPayload?: unknown
): ErrorTranslationResult {
  // Step 1: Input Normalization & Sanity Checks (E1: errors must be 4xx/5xx)
  const validStatus = normalizeErrorStatus(upstreamStatus);
  const normalizedHeaders = normalizeHeaders(upstreamHeaders);

  const safePayload =
    errorPayload && typeof errorPayload === "object" && !Array.isArray(errorPayload)
      ? (errorPayload as UpstreamErrorPayload)
      : undefined;

  // Step 2: Extract Telemetry & Tracking Fields
  const errorCode =
    normalizedHeaders["x-upstream-error-code"] ||
    (typeof safePayload?.code === "string" ? safePayload.code : "") ||
    "ERR_UNKNOWN_UPSTREAM_FAILURE";

  const rawTechnicalMessage =
    normalizedHeaders["x-upstream-raw-error"] ||
    (typeof safePayload?.technicalMessage === "string" ? safePayload.technicalMessage : "") ||
    `[ERROR] UnhandledUpstreamFaultException: Code 0x500 at gateway edge.\nTraceID: ${normalizedHeaders["x-upstream-trace-id"] || "trace-unknown"}`;

  const traceId =
    normalizedHeaders["x-upstream-trace-id"] ||
    (typeof safePayload?.traceId === "string" ? safePayload.traceId : "") ||
    generateSecureTraceId();

  const upstreamService =
    normalizedHeaders["x-upstream-service"] ||
    (typeof safePayload?.upstreamService === "string" ? safePayload.upstreamService : "") ||
    "Zyka-Upstream-Gateway";

  // Step 3: Strategy Pattern Lookup (O(1) Execution with Prototype Protection)
  const isOwnHandler = Object.prototype.hasOwnProperty.call(ErrorHandlers, errorCode);
  const handler: ErrorHandlerFn | undefined = isOwnHandler ? ErrorHandlers[errorCode] : undefined;

  const strategyResult = handler
    ? handler(safePayload, normalizedHeaders, rawTechnicalMessage)
    : handleFallbackStatusCodes(validStatus);

  // Step 4: Merge Strategy Output with Resilient Defaults
  const sanitizedError: SanitizedErrorDetail = {
    userMessage: strategyResult.userMessage || "An unexpected error occurred. Please try again.",
    category: strategyResult.category || "SYSTEM",
    actionableTip: strategyResult.actionableTip || "Please review your input and retry.",
    suggestedService: strategyResult.suggestedService,
    suggestedRatio: strategyResult.suggestedRatio,
    suggestedDuration: strategyResult.suggestedDuration,
    actionLabel: strategyResult.actionLabel,
  };

  // Step 5: Core Interceptor Response Headers (Strictly Sanitized & ASCII-Safe)
  // SECURITY (N3): Never include 'x-raw-upstream-error' or stack details in client headers
  const coreHeaders: Record<string, string> = {
    "x-zyka-sanitized-error": sanitizeHeaderValue(sanitizedError.userMessage),
    "x-zyka-error-code": sanitizeHeaderValue(errorCode),
    "x-zyka-middleware-processed": "true",
    "x-zyka-error-category": sanitizeHeaderValue(sanitizedError.category),
    "x-zyka-trace-id": sanitizeHeaderValue(traceId),
  };

  // Step 6: Cumulative Header Budgeting & Forwarding Allowlist
  let cumulativeHeaderBytes = 0;
  for (const [k, v] of Object.entries(coreHeaders)) {
    cumulativeHeaderBytes += k.length + v.length + 4; // key + ": " + val + "\r\n"
  }

  // Iterate directly over normalizedHeaders (already lowercase and proto-safe).
  // Zero wildcard 'x-zyka-' bypass: only headers strictly in ALLOWED_UPSTREAM_HEADERS are forwarded.
  const cleanUpstreamHeaders: Record<string, string> = {};
  for (const [headerKey, rawHeaderVal] of Object.entries(normalizedHeaders)) {
    if (ALLOWED_UPSTREAM_HEADERS.has(headerKey)) {
      const sanitizedVal = sanitizeHeaderValue(rawHeaderVal);
      const entryBytes = headerKey.length + sanitizedVal.length + 4;
      if (cumulativeHeaderBytes + entryBytes <= MAX_TOTAL_HEADERS_BYTES) {
        cleanUpstreamHeaders[headerKey] = sanitizedVal;
        cumulativeHeaderBytes += entryBytes;
      }
    }
  }

  const rawEnrichedHeaders: Record<string, string> = {
    ...cleanUpstreamHeaders,
    ...coreHeaders,
  };

  // SECURITY (N3): Enforce client-safe allowlist on response headers
  const CLIENT_SAFE_RESPONSE_HEADERS = new Set([
    "x-zyka-sanitized-error",
    "x-zyka-error-code",
    "x-zyka-error-category",
    "x-zyka-middleware-processed",
    "x-zyka-trace-id",
    "retry-after",
    "x-ratelimit-limit",
    "x-ratelimit-remaining",
    "x-ratelimit-reset",
    "x-conflicting-prompt-ratio",
    "x-selected-dropdown-ratio",
    "x-conflicting-prompt-duration",
    "x-selected-dropdown-duration",
  ]);

  const clientSafeHeaders: Record<string, string> = {};
  for (const [k, v] of Object.entries(rawEnrichedHeaders)) {
    if (CLIENT_SAFE_RESPONSE_HEADERS.has(k)) {
      clientSafeHeaders[k] = v;
    }
  }

  return {
    statusCode: validStatus,
    rawError: {
      code: errorCode,
      technicalMessage: rawTechnicalMessage,
      upstreamService,
      traceId,
      metadata: safePayload?.metadata,
    },
    sanitizedError,
    responseHeaders: clientSafeHeaders,
  };
}
