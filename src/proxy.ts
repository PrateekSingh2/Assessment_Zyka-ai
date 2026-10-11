import { NextResponse, type NextRequest } from "next/server";
import { checkSlidingWindowRateLimit } from "@/lib/rate-limit";
import { interceptAndTranslateUpstreamError, generateSecureTraceId } from "@/lib/middleware/error-interceptor";
import { extractRealClientIp, resolveUserIdentifier, recordServerError } from "@/lib/server-logger";

export function proxy(request: NextRequest) {
  // Only intercept /api/generate
  if (request.nextUrl.pathname.startsWith("/api/generate")) {
    // Enterprise Real IP & User Resolution
    const { ip: realClientIp, source: ipSource } = extractRealClientIp(request.headers);
    const userAgent = request.headers.get("user-agent") || "unknown-client";
    const resolvedUserId = resolveUserIdentifier(request.headers, realClientIp, userAgent);

    // 1. Edge Sliding-Window Rate Limit check (5 req / 60s)
    const rateLimit = checkSlidingWindowRateLimit(realClientIp, 5, 60000);

    if (!rateLimit.success) {
      const traceId = generateSecureTraceId();
      const technicalMsg = `[FATAL] HTTP 429 Too Many Requests: IP client sliding-window limit breached. | Code: 0x1AD - Max 5 requests per 60 seconds exceeded. Throttle engaged at edge proxy gateway for IP: ${realClientIp} (${ipSource}). | Remaining: 0 tokens. Reset in ${rateLimit.resetSeconds}s. | TraceID: ${traceId}`;
      
      const upstreamHeaders = {
        "x-upstream-error-code": "ERR_RATE_LIMIT_EXCEEDED",
        "x-upstream-raw-error": technicalMsg,
        "x-upstream-service": "Zyka-Edge-Proxy-Gateway",
        "x-upstream-trace-id": traceId,
        "x-ratelimit-limit": rateLimit.limit.toString(),
        "x-ratelimit-remaining": "0",
        "x-ratelimit-reset": rateLimit.resetSeconds.toString(),
      };

      const translated = interceptAndTranslateUpstreamError(
        429,
        upstreamHeaders
      );

      // Record Server-Level Error Log
      const serverLog = recordServerError({
        headers: request.headers,
        statusCode: 429,
        errorCode: "ERR_RATE_LIMIT_EXCEEDED",
        category: "RATE_LIMIT",
        rawTechnicalMessage: technicalMsg,
        sanitizedUserMessage: translated.sanitizedError.userMessage,
        actionableTip: translated.sanitizedError.actionableTip,
        upstreamService: "Zyka-Edge-Proxy-Gateway",
        route: "/api/generate",
        method: request.method,
        traceId,
      });

      const responseHeaders = {
        ...translated.responseHeaders,
        "x-zyka-real-ip": realClientIp,
        "x-zyka-ip-source": ipSource,
        "x-zyka-user-id": resolvedUserId,
      };

      return NextResponse.json(
        {
          success: false,
          statusCode: 429,
          rawError: translated.rawError,
          sanitizedError: translated.sanitizedError,
          serverLog,
          debug: {
            requestHeaders: Object.fromEntries(request.headers.entries()),
            responseHeaders,
          },
        },
        {
          status: 429,
          headers: responseHeaders,
        }
      );
    }

    // 2. Block non-POST methods on /api/generate
    if (request.method !== "POST") {
      const traceId = generateSecureTraceId();
      const technicalMsg = `[ERROR] HttpMethodDisallowed: Received ${request.method} request on endpoint /api/generate. Allowed: [POST]. | TraceID: ${traceId}`;
      
      const serverLog = recordServerError({
        headers: request.headers,
        statusCode: 405,
        errorCode: "ERR_METHOD_NOT_ALLOWED",
        category: "SYSTEM",
        rawTechnicalMessage: technicalMsg,
        sanitizedUserMessage: "Method Not Allowed. Only POST requests are accepted at /api/generate.",
        actionableTip: "Send a POST request with prompt payload to generate media on Zyka AI.",
        upstreamService: "Zyka-Edge-Proxy-Gateway",
        route: "/api/generate",
        method: request.method,
        traceId,
      });

      return NextResponse.json(
        {
          success: false,
          statusCode: 405,
          error: "Method Not Allowed. Only POST requests are accepted at /api/generate.",
          serverLog,
        },
        {
          status: 405,
          headers: {
            Allow: "POST",
            "x-zyka-middleware-processed": "true",
            "x-zyka-real-ip": realClientIp,
            "x-zyka-ip-source": ipSource,
            "x-zyka-user-id": resolvedUserId,
          },
        }
      );
    }

    // 3. Validate Ingress x-zyka-media-type Header
    const mediaTypeHeader = request.headers.get("x-zyka-media-type");
    if (mediaTypeHeader && !["image", "video", "audio", "voice"].includes(mediaTypeHeader)) {
      const traceId = generateSecureTraceId();
      const technicalMsg = `[ERROR] HeaderValidationException: 'x-zyka-media-type' header value '${mediaTypeHeader}' is not registered in valid media codec catalog. | Code: 0x7E1 - Supported values are: [image, video, voice]. | TraceID: ${traceId}`;
      
      const upstreamHeaders = {
        "x-upstream-error-code": "ERR_UNSUPPORTED_MEDIA_TYPE",
        "x-upstream-raw-error": technicalMsg,
        "x-upstream-service": "Zyka-Edge-Header-Validator",
        "x-upstream-trace-id": traceId,
      };

      const translated = interceptAndTranslateUpstreamError(415, upstreamHeaders);

      const serverLog = recordServerError({
        headers: request.headers,
        statusCode: 415,
        errorCode: "ERR_UNSUPPORTED_MEDIA_TYPE",
        category: "FORMAT",
        rawTechnicalMessage: technicalMsg,
        sanitizedUserMessage: translated.sanitizedError.userMessage,
        actionableTip: translated.sanitizedError.actionableTip,
        upstreamService: "Zyka-Edge-Header-Validator",
        route: "/api/generate",
        method: request.method,
        traceId,
      });

      const responseHeaders = {
        ...translated.responseHeaders,
        "x-zyka-real-ip": realClientIp,
        "x-zyka-ip-source": ipSource,
        "x-zyka-user-id": resolvedUserId,
      };

      return NextResponse.json(
        {
          success: false,
          statusCode: 415,
          rawError: translated.rawError,
          sanitizedError: translated.sanitizedError,
          serverLog,
          debug: {
            requestHeaders: Object.fromEntries(request.headers.entries()),
            responseHeaders,
          },
        },
        { status: 415, headers: responseHeaders }
      );
    }

    // Pass through with injected gateway telemetry and real IP headers
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set("x-zyka-proxy-intercepted", "true");
    requestHeaders.set("x-zyka-proxy-timestamp", new Date().toISOString());
    requestHeaders.set("x-zyka-real-ip", realClientIp);
    requestHeaders.set("x-zyka-ip-source", ipSource);
    requestHeaders.set("x-zyka-user-id", resolvedUserId);

    return NextResponse.next({
      request: {
        headers: requestHeaders,
      },
    });
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/api/:path*"],
};
