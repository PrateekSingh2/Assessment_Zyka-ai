/**
 * GET /api/logs — Server error log inspection endpoint.
 *
 * SECURITY CHANGES over original:
 * 1. Gate: endpoint returns 404 in production unless a valid ADMIN_API_TOKEN
 *    Bearer token is provided. Timing-safe comparison prevents oracle attacks.
 * 2. DELETE method is REMOVED — audit logs must be append-only. The original
 *    DELETE was also a lie: clearServerLogs() only wiped memory; the on-disk
 *    JSONL file still returned all entries on the next GET.
 * 3. Query parameters are validated and bounded via Zod (max 200 results,
 *    max 45-char IP, max 128-char userId, max 64-char code).
 * 4. Cache-Control: no-store to prevent any proxy/CDN caching of log data.
 *
 * In production: Set ADMIN_API_TOKEN to a cryptographically random string
 * of at least 32 characters before deploying. Keep it secret.
 */

import { NextRequest, NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { getServerLogs } from "@/lib/server-logger";
import { generateSecureTraceId } from "@/lib/middleware/error-interceptor";

const QuerySchema = z.object({
  ip: z.string().max(45).optional(),
  userId: z.string().max(128).optional(),
  code: z.string().max(64).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

/**
 * Timing-safe Bearer token validation.
 * Uses SHA-256 digests to normalize buffer lengths before timingSafeEqual,
 * preventing length-leak oracles and multibyte UTF-8 comparison bugs.
 */
function isAdmin(req: NextRequest): boolean {
  const expected = process.env.ADMIN_API_TOKEN ?? "";
  if (expected.length < 32) return false;

  const authHeader = (req.headers.get("authorization") ?? "").trim();
  if (!authHeader.toLowerCase().startsWith("bearer ")) return false;
  const given = authHeader.slice(7).trim();
  if (given.length === 0) return false;

  const expHash = createHash("sha256").update(expected, "utf8").digest();
  const gotHash = createHash("sha256").update(given, "utf8").digest();

  return timingSafeEqual(expHash, gotHash);
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const traceId = generateSecureTraceId();

  // SECURITY (N6): Fail-closed by default across all environments (production, staging, test, unset)
  // Only permit unauthenticated access if explicitly in development AND ALLOW_PUBLIC_LOGS=1
  const allowDevPublic =
    process.env.NODE_ENV === "development" && process.env.ALLOW_PUBLIC_LOGS === "1";

  if (!allowDevPublic && !isAdmin(req)) {
    // Return 404 with unified error structure
    return NextResponse.json(
      {
        success: false as const,
        statusCode: 404,
        traceId,
        sanitizedError: {
          userMessage: "Endpoint not found.",
          category: "SYSTEM" as const,
          actionableTip: "Verify your request route and authorization credentials.",
        },
      },
      { status: 404, headers: { "Cache-Control": "no-store" } }
    );
  }

  const rawParams = Object.fromEntries(req.nextUrl.searchParams);
  const parsed = QuerySchema.safeParse(rawParams);

  if (!parsed.success) {
    return NextResponse.json(
      {
        success: false as const,
        statusCode: 400,
        traceId,
        sanitizedError: {
          userMessage: "Invalid query parameters.",
          category: "VALIDATION" as const,
          actionableTip: "Ensure query parameters conform to schema bounds.",
        },
      },
      { status: 400 }
    );
  }

  const logs = await getServerLogs(parsed.data);

  return NextResponse.json(
    {
      success: true,
      count: logs.length,
      logs,
      meta: {
        logFile: "logs/server-errors.jsonl",
        timestamp: new Date().toISOString(),
      },
    },
    {
      status: 200,
      headers: {
        "Cache-Control": "no-store",
        "x-zyka-server-log-count": logs.length.toString(),
      },
    }
  );
}

// DELETE is intentionally NOT exported.
// Audit logs are append-only. Wiping them would destroy forensic evidence.
