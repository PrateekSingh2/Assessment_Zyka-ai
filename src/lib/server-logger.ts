import path from "path";
import { ServerErrorLogEntry } from "@/types";

/**
 * In-memory ring buffer of recent server error logs for immediate
 * consumption by API endpoints and the frontend DevTools Inspector.
 */
const MAX_IN_MEMORY_LOGS = 200;
const inMemoryLogs: ServerErrorLogEntry[] = [];

/**
 * Log directories and file paths
 */
const LOGS_DIR = path.join(process.cwd(), "logs");
const FORMATTED_LOG_FILE = path.join(LOGS_DIR, "server-errors.log");
const JSONL_LOG_FILE = path.join(LOGS_DIR, "server-errors.jsonl");

/**
 * Safely acquire fs module if in Node.js runtime
 */
function getFs() {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require("fs");
  } catch {
    return null;
  }
}

/**
 * Ensure the logs directory exists
 */
function ensureLogDir(): void {
  const fs = getFs();
  if (!fs) return;
  try {
    if (!fs.existsSync(LOGS_DIR)) {
      fs.mkdirSync(LOGS_DIR, { recursive: true });
    }
  } catch {
    // Edge runtime or read-only filesystem fallback
  }
}

/**
 * Checks whether an IP address is a localhost/loopback address
 */
export function isLoopbackIp(ip?: string | null): boolean {
  if (!ip) return true;
  const trimmed = ip.trim().toLowerCase();
  return (
    trimmed === "::1" ||
    trimmed === "127.0.0.1" ||
    trimmed === "localhost" ||
    trimmed === "0.0.0.0" ||
    trimmed === "::" ||
    trimmed === "unknown" ||
    trimmed.startsWith("127.") ||
    trimmed === "::ffff:127.0.0.1" ||
    trimmed.startsWith("::ffff:127.") ||
    trimmed.startsWith("fe80:")
  );
}

/**
 * Normalizes an IP string (strips IPv4-mapped IPv6 prefix ::ffff:)
 */
export function normalizeIp(ip: string): string {
  let cleaned = ip.trim();
  if (cleaned.startsWith("::ffff:")) {
    cleaned = cleaned.substring(7);
  }
  return cleaned;
}

/**
 * Safely resolves the host machine's active non-internal IPv4 LAN IP
 */
export function getSystemLanIp(): string | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const os = require("os");
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
      const netList = interfaces[name];
      if (!netList) continue;
      for (const net of netList) {
        // Skip internal/loopback and non-IPv4 addresses
        if (net.family === "IPv4" && !net.internal && !isLoopbackIp(net.address)) {
          return net.address;
        }
      }
    }
  } catch {
    // Fallback if in Edge or restricted environment
  }
  return null;
}

/**
 * Enterprise Real-IP Extraction:
 * Evaluates proxy headers in accordance with RFC 7239 and Cloudflare/Nginx/AWS standards.
 * When tested locally on localhost, prevents logging loopback (::1 or 127.0.0.1) by inspecting
 * the client-discovered public WAN IP (x-zyka-client-public-ip) or active host LAN interface.
 *
 * Priority:
 * 1. cf-connecting-ip (Cloudflare Edge CDN)
 * 2. true-client-ip (Akamai / Cloudflare Enterprise)
 * 3. x-real-ip (Standard Nginx Reverse Proxy)
 * 4. x-forwarded-for (Client origin IP if non-loopback)
 * 5. x-zyka-client-public-ip / x-zyka-real-ip (Client public WAN IP discovery via ipify)
 * 6. Active host LAN network interface (e.g. 10.56.x.x / 192.168.x.x)
 * 7. Fallback (127.0.0.1)
 */
export function extractRealClientIp(
  headers: Headers | Record<string, string>
): { ip: string; source: ServerErrorLogEntry["ipSource"] } {
  const getHeader = (name: string): string | null => {
    if (typeof (headers as Headers).get === "function") {
      return (headers as Headers).get(name);
    }
    const record = headers as Record<string, string>;
    return record[name] || record[name.toLowerCase()] || null;
  };

  // 0. Upstream edge proxy resolved IP & source (passes through edge proxy decisions)
  const proxyRealIp = getHeader("x-zyka-real-ip");
  const proxyIpSource = getHeader("x-zyka-ip-source") as ServerErrorLogEntry["ipSource"] | null;
  if (proxyRealIp && proxyIpSource && !isLoopbackIp(proxyRealIp)) {
    return { ip: normalizeIp(proxyRealIp), source: proxyIpSource };
  }

  // 1. Cloudflare Connecting IP
  const cfIp = getHeader("cf-connecting-ip");
  if (cfIp && cfIp.trim()) {
    const norm = normalizeIp(cfIp);
    if (!isLoopbackIp(norm)) {
      return { ip: norm, source: "cf-connecting-ip" };
    }
  }

  // 2. Akamai / Cloudflare Enterprise True Client IP
  const trueClientIp = getHeader("true-client-ip");
  if (trueClientIp && trueClientIp.trim()) {
    const norm = normalizeIp(trueClientIp);
    if (!isLoopbackIp(norm)) {
      return { ip: norm, source: "true-client-ip" };
    }
  }

  // 3. Nginx / Ingress X-Real-IP
  const realIp = getHeader("x-real-ip");
  if (realIp && realIp.trim()) {
    const norm = normalizeIp(realIp);
    if (!isLoopbackIp(norm)) {
      return { ip: norm, source: "x-real-ip" };
    }
  }

  // 4. X-Forwarded-For: Check for valid non-loopback client IP
  const xForwardedFor = getHeader("x-forwarded-for");
  if (xForwardedFor && xForwardedFor.trim()) {
    const parts = xForwardedFor.split(",").map((p) => normalizeIp(p.trim())).filter(Boolean);
    const nonLoopback = parts.find((p) => !isLoopbackIp(p));
    if (nonLoopback) {
      return { ip: nonLoopback, source: "x-forwarded-for" };
    }
  }

  // 5. Client Public WAN IP header discovered by browser (e.g. api.ipify.org)
  const clientPublicIp =
    getHeader("x-zyka-client-public-ip") ||
    getHeader("x-zyka-real-ip") ||
    getHeader("x-client-public-ip") ||
    getHeader("x-client-ip");
  if (clientPublicIp && clientPublicIp.trim()) {
    const norm = normalizeIp(clientPublicIp);
    if (!isLoopbackIp(norm)) {
      return { ip: norm, source: "client-public-wan" };
    }
  }

  // 6. Host System LAN Interface Discovery (for local dev server without public header)
  const systemLan = getSystemLanIp();
  if (systemLan && !isLoopbackIp(systemLan)) {
    return { ip: systemLan, source: "system-lan-interface" };
  }

  // 7. Ultimate fallback
  return { ip: "127.0.0.1", source: "remote-addr-fallback" };
}

/**
 * Resolves user identity user-wise:
 * 1. Explicit 'x-zyka-user-id' or 'x-user-id' from client / session auth.
 * 2. Deterministic fingerprint based on SHA256 of IP + User-Agent for anonymous creators.
 */
export function resolveUserIdentifier(
  headers: Headers | Record<string, string>,
  clientIp: string,
  userAgent: string
): string {
  const getHeader = (name: string): string | null => {
    if (typeof (headers as Headers).get === "function") {
      return (headers as Headers).get(name);
    }
    const record = headers as Record<string, string>;
    return record[name] || record[name.toLowerCase()] || null;
  };

  const explicitUserId = getHeader("x-zyka-user-id") || getHeader("x-user-id");
  if (explicitUserId && explicitUserId.trim()) {
    return explicitUserId.trim();
  }

  // Anonymous user fingerprinting (deterministic hash: usr_a8f3b2c1)
  let hash = "";
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const crypto = require("crypto");
    hash = crypto
      .createHash("sha256")
      .update(`${clientIp}|${userAgent}`)
      .digest("hex")
      .substring(0, 10);
  } catch {
    // Fallback simple djb2 hash if crypto is not accessible
    let h = 5381;
    const str = `${clientIp}|${userAgent}`;
    for (let i = 0; i < str.length; i++) {
      h = (h * 33) ^ str.charCodeAt(i);
    }
    hash = Math.abs(h).toString(16).padStart(8, "0").substring(0, 8);
  }

  return `usr_anon_${hash}`;
}

export interface RecordServerErrorParams {
  headers: Headers | Record<string, string>;
  statusCode: number;
  errorCode: string;
  category: string;
  rawTechnicalMessage: string;
  sanitizedUserMessage: string;
  actionableTip?: string;
  upstreamService?: string;
  route?: string;
  method?: string;
  requestId?: string;
  traceId?: string;
  payload?: {
    prompt?: string;
    mediaType?: string;
    duration?: string;
    aspectRatio?: string;
    model?: string;
  };
}

/**
 * Records a server-level error log with real-IP extraction and user-wise tracing.
 * Writes to both:
 * 1. Formatted server text log (logs/server-errors.log)
 * 2. Structured JSON Lines log (logs/server-errors.jsonl)
 * 3. In-memory buffer for real-time API inspection
 */
export function recordServerError(
  params: RecordServerErrorParams
): ServerErrorLogEntry {
  const { ip, source } = extractRealClientIp(params.headers);

  const getHeader = (name: string): string => {
    if (typeof (params.headers as Headers).get === "function") {
      return (params.headers as Headers).get(name) || "";
    }
    const record = params.headers as Record<string, string>;
    return record[name] || record[name.toLowerCase()] || "";
  };

  const userAgent = getHeader("user-agent") || "unknown-client";
  const userId = resolveUserIdentifier(params.headers, ip, userAgent);
  const requestId =
    params.requestId ||
    getHeader("x-zyka-request-id") ||
    `req-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
  const traceId =
    params.traceId ||
    getHeader("x-upstream-trace-id") ||
    `trace-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;

  const promptText = (params.payload?.prompt || "").trim();
  const promptWords = promptText ? promptText.split(/\s+/).length : 0;
  const promptSnippet =
    promptText.length > 80 ? `${promptText.substring(0, 80)}...` : promptText;

  const now = new Date();
  const timestamp = now.toISOString();

  const entry: ServerErrorLogEntry = {
    logId: `err_${now.getTime()}_${Math.random().toString(36).substring(2, 8)}`,
    timestamp,
    epochMs: now.getTime(),
    clientIp: ip,
    ipSource: source,
    userId,
    userAgent,
    requestId,
    traceId,
    route: params.route || "/api/generate",
    method: params.method || "POST",
    requestPayload: {
      mediaType: params.payload?.mediaType || getHeader("x-zyka-media-type") || undefined,
      duration: params.payload?.duration || getHeader("x-zyka-duration") || undefined,
      aspectRatio: params.payload?.aspectRatio || getHeader("x-zyka-aspect-ratio") || undefined,
      model: params.payload?.model || undefined,
      promptSnippet,
      promptWordCount: promptWords,
    },
    error: {
      statusCode: params.statusCode,
      code: params.errorCode,
      category: params.category,
      rawTechnicalMessage: params.rawTechnicalMessage,
      sanitizedUserMessage: params.sanitizedUserMessage,
      actionableTip: params.actionableTip,
      upstreamService: params.upstreamService || "Zyka-Upstream-Gateway",
    },
    serverContext: {
      nodeEnv: process.env.NODE_ENV || "development",
      host: process.env.HOSTNAME || "zyka-worker-node",
      runtime: "Next.js 16 (Turbopack Edge/Node)",
    },
  };

  // 1. Maintain in-memory ring buffer
  inMemoryLogs.unshift(entry);
  if (inMemoryLogs.length > MAX_IN_MEMORY_LOGS) {
    inMemoryLogs.pop();
  }

  // 2. Persist to files (if Node fs is available)
  try {
    const fs = getFs();
    if (fs) {
      ensureLogDir();

      // Line format: [TIMESTAMP] [LEVEL] [HTTP STATUS] [IP (source)] [USER] [TRACE] CODE: Sanitized Msg | Upstream snippet
      const rawSnippet = params.rawTechnicalMessage
        .replace(/[\r\n]+/g, " ")
        .substring(0, 100);
      const formattedLine = `[${timestamp}] [ERROR] [HTTP ${params.statusCode}] [IP: ${ip} (${source})] [User: ${userId}] [TraceID: ${traceId}] [${params.errorCode}] "${params.sanitizedUserMessage}" | Raw: ${rawSnippet}\n`;

      fs.appendFileSync(FORMATTED_LOG_FILE, formattedLine, "utf8");
      fs.appendFileSync(JSONL_LOG_FILE, JSON.stringify(entry) + "\n", "utf8");
    }
  } catch {
    // Fallback if filesystem write is not permitted
  }

  return entry;
}

/**
 * Query and filter server error logs
 */
export function getServerLogs(filters?: {
  ip?: string;
  userId?: string;
  code?: string;
  limit?: number;
}): ServerErrorLogEntry[] {
  let result = [...inMemoryLogs];

  // If in-memory buffer is empty (e.g. worker isolation or hot reload), hydrate from persistent disk file
  if (result.length === 0) {
    try {
      const fs = getFs();
      if (fs && fs.existsSync(JSONL_LOG_FILE)) {
        const fileContent = fs.readFileSync(JSONL_LOG_FILE, "utf8");
        const lines = fileContent.trim().split("\n").filter(Boolean);
        const diskLogs = lines
          .map((l: string) => {
            try {
              return JSON.parse(l);
            } catch {
              return null;
            }
          })
          .filter(Boolean)
          .reverse(); // Newest first
        result = diskLogs as ServerErrorLogEntry[];
      }
    } catch {}
  }

  if (filters?.ip) {
    result = result.filter((l) =>
      l.clientIp.toLowerCase().includes(filters.ip!.toLowerCase())
    );
  }
  if (filters?.userId) {
    result = result.filter((l) =>
      l.userId.toLowerCase().includes(filters.userId!.toLowerCase())
    );
  }
  if (filters?.code) {
    result = result.filter((l) =>
      l.error.code.toLowerCase().includes(filters.code!.toLowerCase())
    );
  }

  const limit = filters?.limit || 50;
  return result.slice(0, limit);
}

/**
 * Clear in-memory logs (for test isolation)
 */
export function clearServerLogs(): void {
  inMemoryLogs.length = 0;
}
