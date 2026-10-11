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
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { getServerLogs } from "@/lib/server-logger";

const QuerySchema = z.object({
  ip: z.string().max(45).optional(),
  userId: z.string().max(128).optional(),
  code: z.string().max(64).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

/**
 * Timing-safe Bearer token validation.
 * Returns false (deny) if ADMIN_API_TOKEN is not configured or too short.
 */
function isAdmin(req: NextRequest): boolean {
  const expected = process.env.ADMIN_API_TOKEN ?? "";
  // Require at least 32 characters — reject misconfigured short tokens
  if (expected.length < 32) return false;

  const given = (req.headers.get("authorization") ?? "").replace(
    /^Bearer\s+/i,
    ""
  );

  // Pad to equal length before comparing to avoid length oracle
  const exp = Buffer.from(expected, "utf8");
  const got = Buffer.from(given.padEnd(expected.length, "\0"), "utf8");

  if (exp.length !== got.length) return false;
  return timingSafeEqual(exp, got);
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  // In production, enforce admin authentication.
  // In development, allow unauthenticated access for local debugging.
  if (process.env.NODE_ENV === "production" && !isAdmin(req)) {
    // Return 404 instead of 401 to avoid revealing that the endpoint exists
    return NextResponse.json(
      { success: false, error: "Not found" },
      { status: 404, headers: { "Cache-Control": "no-store" } }
    );
  }

  const rawParams = Object.fromEntries(req.nextUrl.searchParams);
  const parsed = QuerySchema.safeParse(rawParams);

  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: "Invalid query parameters" },
      { status: 400 }
    );
  }

  const logs = getServerLogs(parsed.data);

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
