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
  "x-zyka-resolved-ip",
  "x-zyka-resolved-ip-source",
  "x-zyka-resolved-user-id",
  "x-zyka-proxy-intercepted",
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
        recordServerError({
          resolvedIp: "0.0.0.0",
          ipSource: "remote-addr-fallback",
          resolvedUserId: "usr_anon_untrusted",
          userAgent: cleanedHeaders.get("user-agent") ?? "unknown-client",
          statusCode: 403,
          errorCode: "ERR_UNTRUSTED_ORIGIN",
          category: "SYSTEM",
          rawTechnicalMessage: "Request origin rejected: Untrusted proxy topology or direct server bypass attempt",
          sanitizedUserMessage: "Access denied. Request must originate from an authorized gateway.",
          actionableTip: "Please ensure your connection originates from an authorized network.",
          upstreamService: "Zyka-Edge-Proxy-Gateway",
          route: pathname,
          method: request.method,
          traceId,
        });
        return buildErrorResponse(
          403,
          traceId,
          "Access denied. Request must originate from an authorized gateway.",
          "Please ensure your connection originates from an authorized network.",
          "SYSTEM",
          {
            "x-zyka-middleware-processed": "true",
            "x-zyka-trace-id": traceId,
            "x-zyka-error-code": "ERR_UNTRUSTED_ORIGIN",
          }
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
        recordServerError({
          resolvedIp: realClientIp,
          ipSource,
          resolvedUserId,
          userAgent,
          statusCode: 405,
          errorCode: "ERR_METHOD_NOT_ALLOWED",
          category: "SYSTEM",
          rawTechnicalMessage: `HTTP 405: ${request.method} method not allowed on /api/generate`,
          sanitizedUserMessage: "Method Not Allowed. Only POST requests are accepted.",
          actionableTip: "Send a POST request with a JSON prompt payload.",
          upstreamService: "Zyka-Edge-Proxy-Gateway",
          route: pathname,
          method: request.method,
          traceId,
        });
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
            "x-zyka-resolved-ip-source": ipSource,
            "x-zyka-resolved-user-id": resolvedUserId,
          }
        );
      }

      // For /api/logs: enforce GET method check BEFORE rate limit consumption
      if (pathname.startsWith("/api/logs") && request.method !== "GET") {
        const traceId = generateSecureTraceId();
        recordServerError({
          resolvedIp: realClientIp,
          ipSource,
          resolvedUserId,
          userAgent,
          statusCode: 405,
          errorCode: "ERR_METHOD_NOT_ALLOWED",
          category: "SYSTEM",
          rawTechnicalMessage: `HTTP 405: ${request.method} method not allowed on /api/logs`,
          sanitizedUserMessage: "Method Not Allowed. Only GET requests are accepted.",
          actionableTip: "Send a GET request to query server logs.",
          upstreamService: "Zyka-Edge-Proxy-Gateway",
          route: pathname,
          method: request.method,
          traceId,
        });
        return buildErrorResponse(
          405,
          traceId,
          "Method Not Allowed. Only GET requests are accepted.",
          "Send a GET request to query server logs.",
          "SYSTEM",
          {
            Allow: "GET",
            "x-zyka-middleware-processed": "true",
            "x-zyka-resolved-ip": realClientIp,
            "x-zyka-resolved-ip-source": ipSource,
            "x-zyka-resolved-user-id": resolvedUserId,
          }
        );
      }

      // Check partitioned rate limit: 5 req/min for generate, 30 req/min for logs
      const isGenerate = pathname.startsWith("/api/generate");
      const limit = isGenerate ? 5 : 30;
      const namespace = isGenerate ? "gen" : "logs";
      const rateLimit = checkSlidingWindowRateLimit(realClientIp, limit, 60_000, namespace);

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
            "x-zyka-resolved-ip-source": ipSource,
            "x-zyka-resolved-user-id": resolvedUserId,
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
            "x-zyka-resolved-ip-source": ipSource,
            "x-zyka-resolved-user-id": resolvedUserId,
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
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error("[proxy] Error:", errorMsg);
    const traceId = generateSecureTraceId();
    recordServerError({
      resolvedIp: "127.0.0.1",
      ipSource: "remote-addr-fallback",
      resolvedUserId: "usr_anon_system",
      userAgent: request.headers.get("user-agent") ?? "unknown-client",
      statusCode: 500,
      errorCode: "ERR_PROXY_INTERNAL_FAULT",
      category: "SYSTEM",
      rawTechnicalMessage: `Proxy unhandled exception: ${errorMsg}`,
      sanitizedUserMessage: "Internal gateway error.",
      actionableTip: "Please retry shortly.",
      upstreamService: "Zyka-Edge-Proxy-Gateway",
      route: pathname,
      method: request.method,
      traceId,
    });
    return buildErrorResponse(
      500,
      traceId,
      "Internal gateway error.",
      "Please retry shortly.",
      "SYSTEM",
      { "x-zyka-middleware-processed": "true", "x-zyka-trace-id": traceId }
    );
  }
}

export const config = {
  matcher: ["/api/:path*"],
};
