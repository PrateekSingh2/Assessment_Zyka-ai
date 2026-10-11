import { NextRequest, NextResponse } from "next/server";
import { getServerLogs, clearServerLogs } from "@/lib/server-logger";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const ip = searchParams.get("ip") || undefined;
    const userId = searchParams.get("userId") || undefined;
    const code = searchParams.get("code") || undefined;
    const limit = searchParams.get("limit")
      ? parseInt(searchParams.get("limit")!, 10)
      : 50;

    const logs = getServerLogs({ ip, userId, code, limit });

    return NextResponse.json(
      {
        success: true,
        count: logs.length,
        logs,
        meta: {
          logFiles: {
            formattedTextLog: "logs/server-errors.log",
            structuredJsonlLog: "logs/server-errors.jsonl",
          },
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
  } catch (error: any) {
    return NextResponse.json(
      {
        success: false,
        error: error.message || "Failed to retrieve server logs",
      },
      { status: 500 }
    );
  }
}

export async function DELETE() {
  clearServerLogs();
  return NextResponse.json({
    success: true,
    message: "Server logs cleared successfully.",
  });
}
