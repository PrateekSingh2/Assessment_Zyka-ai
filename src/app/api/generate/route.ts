import { NextRequest, NextResponse } from "next/server";
import { executeMockUpstreamAI } from "@/lib/mock-upstream";
import { interceptAndTranslateUpstreamError } from "@/lib/middleware/error-interceptor";
import { MediaType, AspectRatio, Duration } from "@/types";
import {
  recordServerError,
  extractRealClientIp,
  resolveUserIdentifier,
} from "@/lib/server-logger";

export async function POST(req: NextRequest) {
  try {
    // 1. Capture Ingress Request Headers
    const requestHeadersRecord: Record<string, string> = {};
    req.headers.forEach((val, key) => {
      requestHeadersRecord[key] = val;
    });

    // 2. Parse request payload
    let body: any = {};
    try {
      body = await req.json();
    } catch {
      body = {};
    }

    // Use nullish coalescing so falsy values like 0, false are preserved as strings
    const rawPrompt = body.prompt ?? "";
    const prompt = typeof rawPrompt === "string" ? rawPrompt : String(rawPrompt);

    // Normalize and validate mediaType — must be a valid string MediaType
    const rawMediaType = body.mediaType ?? req.headers.get("x-zyka-media-type") ?? "image";
    const mediaTypeStr = typeof rawMediaType === "string" ? rawMediaType.toLowerCase() : String(rawMediaType);
    const validMediaTypes = ["image", "video", "audio", "voice"];

    if (!validMediaTypes.includes(mediaTypeStr)) {
      const traceId = `trace-invalidmedia-${Date.now()}`;
      const technicalMsg = `[ERROR] HeaderValidationException: 'mediaType' body field value '${mediaTypeStr}' is not in valid media type registry. Code: 0x7E1 - Supported values are: [image, video, voice, audio]. TraceID: ${traceId}`;
      const fallbackHeaders = {
        "x-upstream-error-code": "ERR_UNSUPPORTED_MEDIA_TYPE",
        "x-upstream-raw-error": technicalMsg,
        "x-upstream-service": "Zyka-Route-Handler-Boundary",
        "x-upstream-trace-id": traceId,
      };
      const translated = interceptAndTranslateUpstreamError(415, fallbackHeaders);

      const serverLog = recordServerError({
        headers: req.headers,
        statusCode: 415,
        errorCode: "ERR_UNSUPPORTED_MEDIA_TYPE",
        category: "FORMAT",
        rawTechnicalMessage: technicalMsg,
        sanitizedUserMessage: translated.sanitizedError.userMessage,
        actionableTip: translated.sanitizedError.actionableTip,
        upstreamService: "Zyka-Route-Handler-Boundary",
        route: "/api/generate",
        method: "POST",
        traceId,
      });

      const responseHeaders = {
        ...translated.responseHeaders,
        "x-zyka-real-ip": serverLog.clientIp,
        "x-zyka-ip-source": serverLog.ipSource,
        "x-zyka-user-id": serverLog.userId,
      };

      return NextResponse.json(
        {
          success: false,
          statusCode: 415,
          rawError: translated.rawError,
          sanitizedError: translated.sanitizedError,
          serverLog,
          debug: { requestHeaders: requestHeadersRecord, responseHeaders },
        },
        { status: 415, headers: responseHeaders }
      );
    }

    const mediaType: MediaType = mediaTypeStr as MediaType;
    const duration: Duration | undefined =
      body.duration ||
      (req.headers.get("x-zyka-duration") as Duration) ||
      undefined;
    const aspectRatio: AspectRatio | undefined =
      body.aspectRatio ||
      (req.headers.get("x-zyka-aspect-ratio") as AspectRatio) ||
      undefined;

    const model = body.model || "Auto (Best model)";
    const quality = body.quality || "High Quality";

    // 3. Dispatch to Mock Upstream AI Engine
    const upstreamResult = await executeMockUpstreamAI({
      prompt,
      mediaType,
      duration,
      aspectRatio,
      model,
      quality,
      requestHeaders: requestHeadersRecord,
    });

    // 4. Intercept errors using Middleware Error Interceptor
    if (upstreamResult.status >= 400 || upstreamResult.error) {
      const translated = interceptAndTranslateUpstreamError(
        upstreamResult.status,
        upstreamResult.headers,
        upstreamResult.error
      );

      // Record Server-Level Error Log with Real Client IP and User Identity
      const serverLog = recordServerError({
        headers: req.headers,
        statusCode: translated.statusCode,
        errorCode: translated.rawError.code,
        category: translated.sanitizedError.category,
        rawTechnicalMessage: translated.rawError.technicalMessage,
        sanitizedUserMessage: translated.sanitizedError.userMessage,
        actionableTip: translated.sanitizedError.actionableTip,
        upstreamService: translated.rawError.upstreamService,
        route: "/api/generate",
        method: "POST",
        traceId: translated.rawError.traceId,
        payload: {
          prompt,
          mediaType,
          duration,
          aspectRatio,
          model,
        },
      });

      const responseHeaders = {
        ...translated.responseHeaders,
        "x-zyka-real-ip": serverLog.clientIp,
        "x-zyka-ip-source": serverLog.ipSource,
        "x-zyka-user-id": serverLog.userId,
      };

      return NextResponse.json(
        {
          success: false,
          statusCode: translated.statusCode,
          rawError: translated.rawError,
          sanitizedError: translated.sanitizedError,
          serverLog,
          debug: {
            requestHeaders: requestHeadersRecord,
            responseHeaders,
          },
        },
        {
          status: translated.statusCode,
          headers: responseHeaders,
        }
      );
    }

    // 5. Successful Response with telemetry headers
    const { ip: realClientIp, source: ipSource } = extractRealClientIp(req.headers);
    const userAgent = req.headers.get("user-agent") || "unknown-client";
    const resolvedUserId = resolveUserIdentifier(req.headers, realClientIp, userAgent);

    const enrichedSuccessHeaders: Record<string, string> = {
      ...upstreamResult.headers,
      "x-zyka-status": "SUCCESS",
      "x-zyka-sanitized-error": "none",
      "x-zyka-media-type": mediaType,
      "x-zyka-real-ip": realClientIp,
      "x-zyka-ip-source": ipSource,
      "x-zyka-user-id": resolvedUserId,
      "x-zyka-completed-at": new Date().toISOString(),
    };

    return NextResponse.json(
      {
        success: true,
        statusCode: 200,
        data: upstreamResult.data,
        debug: {
          requestHeaders: requestHeadersRecord,
          responseHeaders: enrichedSuccessHeaders,
        },
      },
      {
        status: 200,
        headers: enrichedSuccessHeaders,
      }
    );
  } catch (unexpectedError: any) {
    // Top-level crash handler
    console.error("Unhandled Exception in Route Handler:", unexpectedError);

    const traceId = `trace-panic-${Date.now()}`;
    const fallbackHeaders = {
      "x-upstream-error-code": "ERR_INTERNAL_GATEWAY_FAULT",
      "x-upstream-raw-error": `[CRITICAL] UnhandledServerException at route.ts:89\nError: ${unexpectedError?.message || "Unknown fault"}\nStack: ${unexpectedError?.stack?.split("\n").slice(0, 3).join("\n") || "No stack"}\nTraceID: ${traceId}`,
      "x-upstream-service": "Zyka-Route-Handler-Boundary",
      "x-upstream-trace-id": traceId,
    };

    const translated = interceptAndTranslateUpstreamError(500, fallbackHeaders);

    const serverLog = recordServerError({
      headers: req.headers,
      statusCode: 500,
      errorCode: "ERR_INTERNAL_GATEWAY_FAULT",
      category: "SYSTEM",
      rawTechnicalMessage: fallbackHeaders["x-upstream-raw-error"],
      sanitizedUserMessage: translated.sanitizedError.userMessage,
      actionableTip: translated.sanitizedError.actionableTip,
      upstreamService: "Zyka-Route-Handler-Boundary",
      route: "/api/generate",
      method: "POST",
      traceId,
    });

    const responseHeaders = {
      ...translated.responseHeaders,
      "x-zyka-real-ip": serverLog.clientIp,
      "x-zyka-ip-source": serverLog.ipSource,
      "x-zyka-user-id": serverLog.userId,
    };

    return NextResponse.json(
      {
        success: false,
        statusCode: 500,
        rawError: translated.rawError,
        sanitizedError: translated.sanitizedError,
        serverLog,
        debug: {
          requestHeaders: {},
          responseHeaders,
        },
      },
      {
        status: 500,
        headers: responseHeaders,
      }
    );
  }
}
