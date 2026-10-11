import { NextResponse } from "next/server";
import { generateSecureTraceId } from "@/lib/middleware/error-interceptor";

function handleUnknownRoute() {
  const traceId = generateSecureTraceId();
  return NextResponse.json(
    {
      success: false as const,
      statusCode: 404,
      traceId,
      sanitizedError: {
        userMessage: "API endpoint not found.",
        category: "SYSTEM" as const,
        actionableTip: "Please verify the requested endpoint path.",
      },
    },
    {
      status: 404,
      headers: {
        "x-zyka-sanitized-error": "API endpoint not found.",
        "x-zyka-error-code": "ERR_ROUTE_NOT_FOUND",
        "x-zyka-middleware-processed": "true",
        "x-zyka-trace-id": traceId,
      },
    }
  );
}

export function GET() {
  return handleUnknownRoute();
}

export function POST() {
  return handleUnknownRoute();
}

export function PUT() {
  return handleUnknownRoute();
}

export function DELETE() {
  return handleUnknownRoute();
}

export function PATCH() {
  return handleUnknownRoute();
}

export function OPTIONS() {
  return handleUnknownRoute();
}
