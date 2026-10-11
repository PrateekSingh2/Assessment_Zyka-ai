import { NextResponse, type NextRequest } from "next/server";
import { checkSlidingWindowRateLimit } from "@/lib/rate-limit";
import {
  interceptAndTranslateUpstreamError,
  generateSecureTraceId,
} from "@/lib/middleware/error-interceptor";
import {
  resolveClientIp,
  resolveAnonymousUserId,
  UntrustedOriginError,
} from "@/lib/client-ip";
import { recordServerError } from "@/lib/server-logger";
import type { SanitizedErrorDetail } from "@/types";

// Strip all client-supplied identity/IP spoofing headers
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
 * Builds a unified, sanitized error JSON response matching GenerationResponseError
 */
function buildErrorResponse(
  statusCode: number,
  traceId: string,
  userMessage: string,
  actionableTip: string,
  category: SanitizedErrorDetail["category"],
  responseHeaders: Record<string, string>,
  extras?: Partial<SanitizedErrorDetail>
): NextResponse {
  return NextResponse.json(
    {
      success: false as const,
      statusCode,
      traceId,
      sanitizedError: {
        userMessage,
        category,
        actionableTip,
        ...extras,
      },
    },
    { status: statusCode, headers: responseHeaders }
  );
}

export function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  // Intercept all /api/ routes
  if (!pathname.startsWith("/api/")) {
    return NextResponse.next();
  }

  try {
    // 1. Strip all client-spoofable headers
    const cleanedHeaders = new Headers(request.headers);
    for (const h of CLIENT_SPOOFABLE_HEADERS) {
      cleanedHeaders.delete(h);
    }

    // 2. Zero-trust IP resolution (fail-closed if proxy bypassed)
    let realClientIp: string;
    let ipSource: import("@/types").ServerErrorLogEntry["ipSource"];
    try {
      const res = resolveClientIp(cleanedHeaders);
      realClientIp = res.ip;
      ipSource = res.source;
    } catch (ipErr: unknown) {
      if (ipErr instanceof UntrustedOriginError) {
        const traceId = generateSecureTraceId();
        return buildErrorResponse(
          400,
          traceId,
          "Untrusted origin: Request did not traverse the configured gateway proxy.",
          "Ensure your request is routed through the official edge proxy.",
          "VALIDATION",
          { "x-zyka-middleware-processed": "true" }
        );
      }
      throw ipErr;
    }

    const userAgent = cleanedHeaders.get("user-agent") ?? "unknown-client";
    const resolvedUserId = resolveAnonymousUserId(realClientIp, userAgent);

    // 3. Rate limit protection across both /api/generate and /api/logs (brute-force defense)
    if (pathname.startsWith("/api/generate") || pathname.startsWith("/api/logs")) {
      // For /api/generate: enforce POST method check BEFORE rate limit consumption
      if (pathname.startsWith("/api/generate") && request.method !== "POST") {
        const traceId = generateSecureTraceId();
        return buildErrorResponse(
          405,
          traceId,
          "Method Not Allowed. Only POST requests are accepted.",
          "Send a POST request with a JSON prompt payload.",
          "SYSTEM",
          {
            Allow: "POST",
            "x-zyka-middleware-processed": "true",
            "x-zyka-resolved-ip": realClientIp,
          }
        );
      }

      // Check rate limit: 5 req/min for generate, 30 req/min for logs
      const limit = pathname.startsWith("/api/generate") ? 5 : 30;
      const rateLimit = checkSlidingWindowRateLimit(realClientIp, limit, 60_000);

      if (!rateLimit.success) {
        const traceId = generateSecureTraceId();
        const upstreamHeaders = {
          "x-upstream-error-code": "ERR_RATE_LIMIT_EXCEEDED",
          "x-upstream-service": "Zyka-Edge-Proxy-Gateway",
          "x-upstream-trace-id": traceId,
          "x-ratelimit-limit": rateLimit.limit.toString(),
          "x-ratelimit-remaining": "0",
          "x-ratelimit-reset": rateLimit.resetSeconds.toString(),
        };

        const translated = interceptAndTranslateUpstreamError(429, upstreamHeaders);

        recordServerError({
          resolvedIp: realClientIp,
          ipSource,
          resolvedUserId,
          userAgent,
          statusCode: 429,
          errorCode: "ERR_RATE_LIMIT_EXCEEDED",
          category: "RATE_LIMIT",
          rawTechnicalMessage: `HTTP 429: Rate limit exceeded for IP ${realClientIp}`,
          sanitizedUserMessage: translated.sanitizedError.userMessage,
          actionableTip: translated.sanitizedError.actionableTip,
          upstreamService: "Zyka-Edge-Proxy-Gateway",
          route: pathname,
          method: request.method,
          traceId,
        });

        return buildErrorResponse(
          429,
          traceId,
          translated.sanitizedError.userMessage,
          translated.sanitizedError.actionableTip ?? "",
          "RATE_LIMIT",
          {
            ...translated.responseHeaders,
            "Retry-After": rateLimit.resetSeconds.toString(),
            "x-zyka-middleware-processed": "true",
            "x-zyka-resolved-ip": realClientIp,
          }
        );
      }
    }

    // 4. Validate x-zyka-media-type header if present
    const mediaTypeHeader = request.headers.get("x-zyka-media-type");
    if (mediaTypeHeader) {
      const VALID_MEDIA_TYPES = new Set(["image", "video", "audio", "voice"]);
      if (!VALID_MEDIA_TYPES.has(mediaTypeHeader)) {
        const traceId = generateSecureTraceId();
        const translated = interceptAndTranslateUpstreamError(422, {
          "x-upstream-error-code": "ERR_UNSUPPORTED_MEDIA_TYPE",
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
          rawTechnicalMessage: `Invalid media-type header: ${mediaTypeHeader.substring(0, 32)}`,
          sanitizedUserMessage: translated.sanitizedError.userMessage,
          actionableTip: translated.sanitizedError.actionableTip,
          upstreamService: "Zyka-Edge-Header-Validator",
          route: pathname,
          method: request.method,
          traceId,
        });

        return buildErrorResponse(
          422,
          traceId,
          translated.sanitizedError.userMessage,
          translated.sanitizedError.actionableTip ?? "",
          "FORMAT",
          {
            ...translated.responseHeaders,
            "x-zyka-middleware-processed": "true",
            "x-zyka-resolved-ip": realClientIp,
          }
        );
      }
    }

    // 5. Inject authoritative server-resolved headers for downstream routes
    cleanedHeaders.set("x-zyka-proxy-intercepted", "true");
    cleanedHeaders.set("x-zyka-proxy-timestamp", new Date().toISOString());
    cleanedHeaders.set("x-zyka-resolved-ip", realClientIp);
    cleanedHeaders.set("x-zyka-resolved-ip-source", ipSource);
    cleanedHeaders.set("x-zyka-resolved-user-id", resolvedUserId);

    return NextResponse.next({ request: { headers: cleanedHeaders } });
  } catch (err: unknown) {
    console.error("[proxy] Error:", err instanceof Error ? err.message : err);
    const traceId = generateSecureTraceId();
    return buildErrorResponse(
      500,
      traceId,
      "Internal gateway error.",
      "Please retry shortly.",
      "SYSTEM",
      { "x-zyka-middleware-processed": "true" }
    );
  }
}

export const config = {
  matcher: ["/api/:path*"],
};
