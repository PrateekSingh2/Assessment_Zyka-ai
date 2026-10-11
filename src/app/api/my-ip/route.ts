/**
 * /api/my-ip — DEPRECATED AND REMOVED
 *
 * SECURITY: This endpoint was removed because:
 * 1. It disclosed the server's LAN IP address to any unauthenticated caller.
 * 2. The client-side IP it returned was then sent back in x-zyka-client-public-ip
 *    and x-zyka-real-ip headers, where it was trusted by the rate limiter — a
 *    complete bypass of IP-based rate limiting.
 * 3. IP discovery for UI display purposes does not require a server endpoint.
 *    The client can show a placeholder or use its own network information.
 *
 * Returns 410 Gone to signal permanent removal.
 */
import { NextResponse } from "next/server";

export function GET(): NextResponse {
  return NextResponse.json(
    { error: "This endpoint has been removed." },
    { status: 410 }
  );
}
