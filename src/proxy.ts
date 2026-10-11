import { NextResponse, type NextRequest } from "next/server";
import { checkSlidingWindowRateLimit } from "@/lib/rate-limit";
import {
  interceptAndTranslateUpstreamError,
  generateSecureTraceId,
} from "@/lib/middleware/error-interceptor";
import { resolveClientIp, resolveAnonymousUserId } from "@/lib/client-ip";
import { recordServerError } from "@/lib/server-logger";

// ---------------------------------------------------------------------------
// SECURITY: Strip all client-supplied identity/IP spoofing headers BEFORE
// they reach the route handler. The route reads x-zyka-real-ip and
// x-zyka-user-id from headers set BY US (below), so we must ensure no
// attacker-controlled values pollute those header slots.
// ---------------------------------------------------------------------------
const CLIENT_SPOOFABLE_HEADERS = [
  "x-zyka-real-ip",
  "x-zyka-ip-source",
  "x-zyka-user-id",
  "x-zyka-username",
  "x-zyka-client-public-ip",
  "x-client-public-ip",
  "x-client-ip",
  "cf-connecting-ip",
  "true-client-ip",
  "x-real-ip",
] as const;

/**
 * Builds a sanitized error JSON response with a minimal, non-leaking body.
 * Never includes rawError, serverLog internals, requestHeaders, or stack traces.
 */
function buildErrorResponse(
  statusCode: number,
  traceId: string,
  sanitizedMessage: string,
  actionableTip: string,
  responseHeaders: Record<string, string>
): NextResponse {
  return NextResponse.json(
    {
      success: false,
      statusCode,
      traceId,
      error: {
        userMessage: sanitizedMessage,
        actionableTip,
      },
    },
    { status: statusCode, headers: responseHeaders }
  );
}

export function proxy(request: NextRequest) {
  // Only intercept /api/generate
  if (!request.nextUrl.pathname.startsWith("/api/generate")) {
    return NextResponse.next();
  }

  try {
    // -----------------------------------------------------------------------
    // Step 1: Strip all client-spoofable headers from the incoming request
    // before doing ANY processing. This must happen first.
    // -----------------------------------------------------------------------
    const cleanedHeaders = new Headers(request.headers);
    for (const h of CLIENT_SPOOFABLE_HEADERS) {
      cleanedHeaders.delete(h);
    }

    // -----------------------------------------------------------------------
    // Step 2: Zero-trust IP resolution (reads only from trusted proxy chain)
    //         User identity is server-derived, never client-supplied.
    // -----------------------------------------------------------------------
    const { ip: realClientIp, source: ipSource } = resolveClientIp(cleanedHeaders);
    const userAgent = cleanedHeaders.get("user-agent") ?? "unknown-client";
    const resolvedUserId = resolveAnonymousUserId(realClientIp, userAgent);

    // -----------------------------------------------------------------------
    // Step 3: Method gate BEFORE rate limiting.
    //         Rate limit only POST traffic; wrong-method requests must NOT
    //         consume a quota slot (prevents targeted lockout via OPTIONS/GET).
    // -----------------------------------------------------------------------
    if (request.method !== "POST") {
      return NextResponse.json(
        {
          success: false,
          statusCode: 405,
          traceId: generateSecureTraceId(),
          error: {
            userMessage: "Method Not Allowed. Only POST requests are accepted.",
            actionableTip: "Send a POST request with a JSON prompt payload.",
          },
        },
        {
          status: 405,
          headers: {
            Allow: "POST",
            "x-zyka-middleware-processed": "true",
          },
        }
      );
    }

    // -----------------------------------------------------------------------
    // Step 4: Sliding-window rate limit (keyed on server-resolved IP)
    // -----------------------------------------------------------------------
    const rateLimit = checkSlidingWindowRateLimit(realClientIp, 5, 60_000);

    if (!rateLimit.success) {
      const traceId = generateSecureTraceId();

      const upstreamHeaders = {
        "x-upstream-error-code": "ERR_RATE_LIMIT_EXCEEDED",
        "x-upstream-raw-error": `[FATAL] HTTP 429: Sliding-window limit exceeded. TraceID: ${traceId}`,
        "x-upstream-service": "Zyka-Edge-Proxy-Gateway",
        "x-upstream-trace-id": traceId,
        "x-ratelimit-limit": rateLimit.limit.toString(),
        "x-ratelimit-remaining": "0",
        "x-ratelimit-reset": rateLimit.resetSeconds.toString(),
      };

      const translated = interceptAndTranslateUpstreamError(429, upstreamHeaders);

      // Log server-side only — do not echo internal log back to client
      recordServerError({
        resolvedIp: realClientIp,
        ipSource,
        resolvedUserId,
        userAgent,
        statusCode: 429,
        errorCode: "ERR_RATE_LIMIT_EXCEEDED",
        category: "RATE_LIMIT",
        rawTechnicalMessage: upstreamHeaders["x-upstream-raw-error"],
        sanitizedUserMessage: translated.sanitizedError.userMessage,
        actionableTip: translated.sanitizedError.actionableTip,
        upstreamService: "Zyka-Edge-Proxy-Gateway",
        route: "/api/generate",
        method: request.method,
        traceId,
      });

      return buildErrorResponse(
        429,
        traceId,
        translated.sanitizedError.userMessage,
        translated.sanitizedError.actionableTip ?? "",
        {
          ...translated.responseHeaders,
          // RFC 7231: Retry-After in seconds
          "Retry-After": rateLimit.resetSeconds.toString(),
          "x-zyka-middleware-processed": "true",
        }
      );
    }

    // -----------------------------------------------------------------------
    // Step 5: Validate x-zyka-media-type header (if provided)
    //         Note: body.mediaType is validated separately in route.ts
    //         via GenerateBody schema. This guards the pre-parse header.
    // -----------------------------------------------------------------------
    const mediaTypeHeader = request.headers.get("x-zyka-media-type");
    if (mediaTypeHeader) {
      const VALID_MEDIA_TYPES = new Set(["image", "video", "audio", "voice"]);
      if (!VALID_MEDIA_TYPES.has(mediaTypeHeader)) {
        const traceId = generateSecureTraceId();
        const translated = interceptAndTranslateUpstreamError(422, {
          "x-upstream-error-code": "ERR_UNSUPPORTED_MEDIA_TYPE",
          "x-upstream-raw-error": `[ERROR] Invalid x-zyka-media-type header. TraceID: ${traceId}`,
          "x-upstream-service": "Zyka-Edge-Header-Validator",
          "x-upstream-trace-id": traceId,
        });

        recordServerError({
          resolvedIp: realClientIp,
          ipSource,
          resolvedUserId,
          userAgent,
          statusCode: 422,
          errorCode: "ERR_UNSUPPORTED_MEDIA_TYPE",
          category: "FORMAT",
          rawTechnicalMessage: `Invalid x-zyka-media-type: ${mediaTypeHeader.substring(0, 32)}`,
          sanitizedUserMessage: translated.sanitizedError.userMessage,
          actionableTip: translated.sanitizedError.actionableTip,
          upstreamService: "Zyka-Edge-Header-Validator",
          route: "/api/generate",
          method: request.method,
          traceId,
        });

        return buildErrorResponse(
          422,
          traceId,
          translated.sanitizedError.userMessage,
          translated.sanitizedError.actionableTip ?? "",
          { ...translated.responseHeaders, "x-zyka-middleware-processed": "true" }
        );
      }
    }

    // -----------------------------------------------------------------------
    // Step 6: Forward request with server-resolved identity injected.
    //         These are the ONLY x-zyka-* identity headers the route handler
    //         should ever read — they are now authoritative (set by us).
    // -----------------------------------------------------------------------
    cleanedHeaders.set("x-zyka-proxy-intercepted", "true");
    cleanedHeaders.set("x-zyka-proxy-timestamp", new Date().toISOString());
    // Inject server-resolved (trusted) identity for the route handler
    cleanedHeaders.set("x-zyka-resolved-ip", realClientIp);
    cleanedHeaders.set("x-zyka-resolved-ip-source", ipSource);
    cleanedHeaders.set("x-zyka-resolved-user-id", resolvedUserId);

    return NextResponse.next({ request: { headers: cleanedHeaders } });
  } catch (err: unknown) {
    // Proxy must never crash — catch-all returns a generic 500
    console.error("[proxy] Unexpected error:", err instanceof Error ? err.message : err);
    return NextResponse.json(
      { success: false, statusCode: 500, error: "Internal gateway error." },
      { status: 500 }
    );
  }
}

export const config = {
  matcher: ["/api/:path*"],
};
