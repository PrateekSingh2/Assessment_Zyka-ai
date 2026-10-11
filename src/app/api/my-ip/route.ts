import { NextResponse, type NextRequest } from "next/server";
import os from "os";
import { extractRealClientIp } from "@/lib/server-logger";

export async function GET(req: NextRequest) {
  const { ip: ingressIp } = extractRealClientIp(req.headers);

  // System network interface discovery (resolves real machine LAN IP on localhost)
  let systemLanIp = "127.0.0.1";
  try {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
      const netList = interfaces[name];
      if (!netList) continue;
      for (const net of netList) {
        // Skip internal/loopback and non-IPv4 addresses
        if (net.family === "IPv4" && !net.internal) {
          systemLanIp = net.address;
          break;
        }
      }
      if (systemLanIp !== "127.0.0.1") break;
    }
  } catch {}

  const isLocalhost =
    ingressIp === "127.0.0.1" ||
    ingressIp === "::1" ||
    ingressIp.startsWith("127.");

  const chosenIp = isLocalhost && systemLanIp !== "127.0.0.1" ? systemLanIp : ingressIp;

  return NextResponse.json(
    {
      ip: chosenIp,
      lanIp: systemLanIp,
      ingressIp,
      isLocalhost,
      timestamp: new Date().toISOString(),
    },
    {
      status: 200,
      headers: {
        "Cache-Control": "no-store",
        "x-zyka-real-ip": chosenIp,
      },
    }
  );
}
