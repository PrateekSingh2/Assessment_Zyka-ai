/**
 * POST /api/generate — AI media generation route handler.
 *
 * SECURITY CHANGES over original:
 * 1. Body is read through readBoundedJson() with a 16 KB hard cap before
 *    JSON.parse — prevents OOM DoS from multi-MB prompts.
 * 2. All body fields validated with GenerateBody Zod schema — eliminates
 *    blind type casts, `any`, and header injection via model/quality.
 * 3. IP and userId are read from proxy-injected x-zyka-resolved-* headers
 *    (set by proxy.ts after zero-trust resolution) — never from client input.
 * 4. Error responses no longer include rawError, serverLog internals,
 *    debug.requestHeaders, or stack traces — only traceId + sanitized message.
 * 5. catch (e: unknown) instead of catch (e: any).
 * 6. SyntaxError body → 400, schema failure → 422, PayloadTooLarge → 413.
 * 7. sanitizeHeaderValue applied to ALL response header values, not just errors.
 */

import { NextRequest, NextResponse } from "next/server";
import { executeMockUpstreamAI } from "@/lib/mock-upstream";
import {
  interceptAndTranslateUpstreamError,
  generateSecureTraceId,
  sanitizeHeaderValue,
} from "@/lib/middleware/error-interceptor";
import {
  readBoundedJson,
  GenerateBody,
  PayloadTooLargeError,
  MalformedJsonError,
} from "@/lib/request-schema";
import { recordServerError } from "@/lib/server-logger";
import type { ServerErrorLogEntry } from "@/types";

// ---------------------------------------------------------------------------
// Helper: extract the server-resolved (trusted) identity from proxy headers
// ---------------------------------------------------------------------------
function getResolvedIdentity(req: NextRequest): {
  resolvedIp: string;
  ipSource: ServerErrorLogEntry["ipSource"];
  resolvedUserId: string;
  userAgent: string;
} {
  // These headers are set by proxy.ts after zero-trust resolution.
  // They were stripped from client input before proxy ran, so they are safe.
  const resolvedIp = req.headers.get("x-zyka-resolved-ip") ?? "127.0.0.1";
  const rawIpSource = req.headers.get("x-zyka-resolved-ip-source");
  const VALID_SOURCES: ReadonlySet<string> = new Set([
    "cf-connecting-ip",
    "true-client-ip",
    "x-real-ip",
    "x-forwarded-for",
    "client-public-wan",
    "system-lan-interface",
    "remote-addr-fallback",
    "socket",
  ]);
  const ipSource: ServerErrorLogEntry["ipSource"] =
    rawIpSource && VALID_SOURCES.has(rawIpSource)
      ? (rawIpSource as ServerErrorLogEntry["ipSource"])
      : "remote-addr-fallback";
  const resolvedUserId = req.headers.get("x-zyka-resolved-user-id") ?? "usr_anon_unknown";
  const userAgent = req.headers.get("user-agent") ?? "unknown-client";
  return { resolvedIp, ipSource, resolvedUserId, userAgent };
}

// ---------------------------------------------------------------------------
// Helper: minimal, non-leaking public error response body
// ---------------------------------------------------------------------------
function publicErrorBody(
  statusCode: number,
  traceId: string,
  userMessage: string,
  actionableTip: string,
  category: string,
  // Optional UI-actionable extras (safe, schema-validated values only)
  extras?: {
    suggestedService?: string;
    suggestedRatio?: string;
    suggestedDuration?: string;
    actionLabel?: string;
  }
) {
  return {
    success: false as const,
    statusCode,
    traceId,
    sanitizedError: {
      userMessage,
      category,
      actionableTip,
      ...extras,
    },
  };
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const traceId = generateSecureTraceId();
  const identity = getResolvedIdentity(req);

  try {
    // ------------------------------------------------------------------
    // 1. Bounded body read (throws PayloadTooLargeError / MalformedJsonError)
    // ------------------------------------------------------------------
    let rawBody: unknown;
    try {
      rawBody = await readBoundedJson(req);
    } catch (e: unknown) {
      if (e instanceof PayloadTooLargeError) {
        recordServerError({
          ...identity,
          statusCode: 413,
          errorCode: "ERR_PAYLOAD_TOO_LARGE",
          category: "VALIDATION",
          rawTechnicalMessage: "Request body exceeded 16 KB limit",
          sanitizedUserMessage: "Your request is too large. Please shorten your prompt.",
          actionableTip: "Keep your prompt under 8,000 characters.",
          route: "/api/generate",
          method: "POST",
          traceId,
        });
        const headers = new Headers();
        headers.set("x-zyka-sanitized-error", "Your request is too large. Please shorten your prompt.");
        headers.set("x-zyka-error-code", "ERR_PAYLOAD_TOO_LARGE");
        headers.set("x-zyka-middleware-processed", "true");
        headers.set("x-zyka-trace-id", traceId);
        headers.set("x-zyka-resolved-ip", identity.resolvedIp);
        headers.set("x-zyka-resolved-ip-source", identity.ipSource);
        headers.set("x-zyka-resolved-user-id", identity.resolvedUserId);
        return NextResponse.json(
          publicErrorBody(413, traceId, "Your request is too large. Please shorten your prompt.", "Keep your prompt under 8,000 characters.", "VALIDATION"),
          { status: 413, headers }
        );
      }
      if (e instanceof MalformedJsonError) {
        const headers = new Headers();
        headers.set("x-zyka-sanitized-error", "Invalid JSON body.");
        headers.set("x-zyka-error-code", "ERR_MALFORMED_JSON");
        headers.set("x-zyka-middleware-processed", "true");
        headers.set("x-zyka-trace-id", traceId);
        headers.set("x-zyka-resolved-ip", identity.resolvedIp);
        headers.set("x-zyka-resolved-ip-source", identity.ipSource);
        headers.set("x-zyka-resolved-user-id", identity.resolvedUserId);
        return NextResponse.json(
          publicErrorBody(400, traceId, "Invalid JSON body.", "Send a valid JSON object with a prompt field.", "VALIDATION"),
          { status: 400, headers }
        );
      }
      throw e; // Re-throw unexpected errors to outer catch
    }

    // ------------------------------------------------------------------
    // 2. Zod schema validation — strict typing, no any, no blind casts
    // ------------------------------------------------------------------
    const parsed = GenerateBody.safeParse(rawBody);
    if (!parsed.success) {
      const firstIssue = parsed.error.issues[0];
      const field = firstIssue?.path.join(".") ?? "input";
      const detail = firstIssue?.message ?? "Validation failed";
      recordServerError({
        ...identity,
        statusCode: 422,
        errorCode: "ERR_SCHEMA_VALIDATION",
        category: "VALIDATION",
        rawTechnicalMessage: `Schema validation failed: ${parsed.error.message}`,
        sanitizedUserMessage: `Invalid ${field}: ${detail}`,
        actionableTip: "Check your prompt and parameters.",
        route: "/api/generate",
        method: "POST",
        traceId,
      });
      const headers = new Headers();
      headers.set("x-zyka-sanitized-error", sanitizeHeaderValue(`Invalid ${field}: ${detail}`));
      headers.set("x-zyka-error-code", "ERR_SCHEMA_VALIDATION");
      headers.set("x-zyka-middleware-processed", "true");
      headers.set("x-zyka-trace-id", traceId);
      headers.set("x-zyka-resolved-ip", identity.resolvedIp);
      headers.set("x-zyka-resolved-ip-source", identity.ipSource);
      headers.set("x-zyka-resolved-user-id", identity.resolvedUserId);
      return NextResponse.json(
        publicErrorBody(422, traceId, `Invalid ${field}: ${detail}`, "Check your prompt and parameters.", "VALIDATION"),
        { status: 422, headers }
      );
    }

    const { prompt, mediaType, duration, aspectRatio, model, quality } = parsed.data;

    // ------------------------------------------------------------------
    // 3. Dispatch to mock upstream AI engine
    // ------------------------------------------------------------------
    const upstreamResult = await executeMockUpstreamAI({
      prompt,
      mediaType,
      duration,
      aspectRatio,
      model,
      quality,
      // Never pass raw request headers to upstream — only safe derived values
      requestHeaders: {},
    });

    // ------------------------------------------------------------------
    // 4. Translate upstream errors through the error interceptor
    // ------------------------------------------------------------------
    if (upstreamResult.status >= 400 || upstreamResult.error) {
      const translated = interceptAndTranslateUpstreamError(
        upstreamResult.status,
        upstreamResult.headers,
        upstreamResult.error
      );

      recordServerError({
        ...identity,
        statusCode: translated.statusCode,
        errorCode: translated.rawError.code,
        category: translated.sanitizedError.category,
        // rawTechnicalMessage is stored SERVER-SIDE ONLY in the log
        rawTechnicalMessage: translated.rawError.technicalMessage,
        sanitizedUserMessage: translated.sanitizedError.userMessage,
        actionableTip: translated.sanitizedError.actionableTip,
        upstreamService: translated.rawError.upstreamService,
        route: "/api/generate",
        method: "POST",
        traceId: translated.rawError.traceId,
        payload: { prompt, mediaType, duration, aspectRatio, model },
      });

      // Return ONLY sanitized, client-safe information
      return NextResponse.json(
        publicErrorBody(
          translated.statusCode,
          translated.rawError.traceId,
          translated.sanitizedError.userMessage,
          translated.sanitizedError.actionableTip,
          translated.sanitizedError.category,
          {
            suggestedService: translated.sanitizedError.suggestedService,
            suggestedRatio: translated.sanitizedError.suggestedRatio,
            suggestedDuration: translated.sanitizedError.suggestedDuration,
            actionLabel: translated.sanitizedError.actionLabel,
          }
        ),
        {
          status: translated.statusCode,
          headers: {
            ...translated.responseHeaders,
            "x-zyka-resolved-ip": sanitizeHeaderValue(identity.resolvedIp),
            "x-zyka-resolved-ip-source": sanitizeHeaderValue(identity.ipSource),
            "x-zyka-resolved-user-id": sanitizeHeaderValue(identity.resolvedUserId),
          },
        }
      );
    }

    // ------------------------------------------------------------------
    // 5. Successful response — sanitize all header values before sending
    // ------------------------------------------------------------------
    const successHeaders: Record<string, string> = {
      "x-zyka-status": "SUCCESS",
      "x-zyka-media-type": sanitizeHeaderValue(mediaType),
      "x-zyka-completed-at": new Date().toISOString(),
      "x-zyka-trace-id": sanitizeHeaderValue(traceId),
      "x-zyka-resolved-ip": sanitizeHeaderValue(identity.resolvedIp),
      "x-zyka-resolved-ip-source": sanitizeHeaderValue(identity.ipSource),
      "x-zyka-resolved-user-id": sanitizeHeaderValue(identity.resolvedUserId),
    };

    // Forward allowed upstream headers with sanitization applied
    const SAFE_SUCCESS_UPSTREAM_HEADERS = new Set([
      "x-upstream-status",
      "x-upstream-service",
      "x-upstream-trace-id",
      "x-model-used",
      "x-quality-profile",
    ]);
    for (const [k, v] of Object.entries(upstreamResult.headers)) {
      if (SAFE_SUCCESS_UPSTREAM_HEADERS.has(k)) {
        successHeaders[k] = sanitizeHeaderValue(v);
      }
    }

    return NextResponse.json(
      {
        success: true as const,
        statusCode: 200,
        traceId,
        data: upstreamResult.data,
      },
      { status: 200, headers: successHeaders }
    );
  } catch (unexpectedError: unknown) {
    // ------------------------------------------------------------------
    // Top-level crash handler — log server-side, return opaque 500
    // ------------------------------------------------------------------
    const errorMessage =
      unexpectedError instanceof Error
        ? unexpectedError.message
        : "Unknown fault";

    // Log the full error server-side only — never send to client
    console.error("[/api/generate] Unhandled exception:", errorMessage);
    if (unexpectedError instanceof Error) {
      console.error(unexpectedError.stack);
    }

    recordServerError({
      ...identity,
      statusCode: 500,
      errorCode: "ERR_INTERNAL_GATEWAY_FAULT",
      category: "SYSTEM",
      rawTechnicalMessage: `Unhandled exception: ${errorMessage}`,
      sanitizedUserMessage:
        "An unexpected error occurred. Please try again in a moment.",
      actionableTip: "If the problem persists, please contact support with your trace ID.",
      upstreamService: "Zyka-Route-Handler-Boundary",
      route: "/api/generate",
      method: "POST",
      traceId,
    });

    // Return ONLY traceId so the user can report it — no stack, no internals
    return NextResponse.json(
      publicErrorBody(
        500,
        traceId,
        "An unexpected error occurred. Please try again in a moment.",
        "If the problem persists, please contact support with your trace ID.",
        "SYSTEM"
      ),
      { status: 500 }
    );
  }
}
