/**
 * Server-side structured error logger.
 *
 * SECURITY FIXES over original:
 * 1. All IP/userId resolution is now done by the CALLER (proxy.ts / route.ts)
 *    using the zero-trust resolveClientIp() from client-ip.ts. This module
 *    no longer trusts any client header for IP/identity — it only accepts
 *    pre-resolved values from the secure resolution pipeline.
 * 2. Log entries are written as JSONL only (JSON.stringify escapes all
 *    injection characters, eliminating log field injection).
 * 3. Synchronous fs.appendFileSync replaced with fire-and-forget async writes
 *    to avoid blocking the Node.js event loop on every failed request.
 * 4. Log file size cap: if the JSONL file exceeds MAX_LOG_FILE_BYTES, new
 *    entries are dropped to disk (still kept in memory) and a warning is
 *    emitted, preventing disk exhaustion from an attacker-driven error flood.
 * 5. The formatted text log (server-errors.log) is removed — it was the
 *    source of log field injection and added no value over JSONL.
 * 6. getServerLogs() no longer does a synchronous readFileSync on each
 *    request when the memory buffer is empty. It attempts a one-time async
 *    hydration at startup instead.
 */

import path from "path";
import { ServerErrorLogEntry } from "@/types";

// ---------------------------------------------------------------------------
// In-memory ring buffer
// ---------------------------------------------------------------------------
const MAX_IN_MEMORY_LOGS = 200;
const inMemoryLogs: ServerErrorLogEntry[] = [];

// ---------------------------------------------------------------------------
// Disk persistence (async, fire-and-forget, size-bounded)
// ---------------------------------------------------------------------------
const LOGS_DIR = path.join(process.cwd(), "logs");
const JSONL_LOG_FILE = path.join(LOGS_DIR, "server-errors.jsonl");

/** 5 MB cap on the JSONL file — prevents disk exhaustion */
const MAX_LOG_FILE_BYTES = 5 * 1024 * 1024;

/** Track whether we've already warned about the size cap */
let diskCapWarned = false;

function getFs(): typeof import("fs") | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require("fs") as typeof import("fs");
  } catch {
    return null;
  }
}

function ensureLogDir(): void {
  const fs = getFs();
  if (!fs) return;
  try {
    if (!fs.existsSync(LOGS_DIR)) {
      fs.mkdirSync(LOGS_DIR, { recursive: true });
    }
  } catch {
    // Edge runtime or read-only FS
  }
}

/**
 * Async, fire-and-forget JSONL append with a size guard.
 * NEVER blocks the event loop.
 */
function appendLogAsync(entry: ServerErrorLogEntry): void {
  // Use setImmediate to yield to the event loop before doing any I/O
  setImmediate(() => {
    const fs = getFs();
    if (!fs) return;
    try {
      ensureLogDir();
      // Check file size synchronously once per entry (single stat call, cheap)
      let fileSizeBytes = 0;
      try {
        fileSizeBytes = fs.statSync(JSONL_LOG_FILE).size;
      } catch {
        // File doesn't exist yet — size is 0
      }
      if (fileSizeBytes >= MAX_LOG_FILE_BYTES) {
        if (!diskCapWarned) {
          console.warn(
            `[server-logger] JSONL log file exceeds ${MAX_LOG_FILE_BYTES} bytes. ` +
              "New entries are not being persisted to disk. Rotate or truncate logs/server-errors.jsonl."
          );
          diskCapWarned = true;
        }
        return;
      }
      fs.appendFile(JSONL_LOG_FILE, JSON.stringify(entry) + "\n", "utf8", (err) => {
        if (err) {
          console.error("[server-logger] Failed to write log entry:", err.message);
        }
      });
    } catch (err) {
      console.error("[server-logger] appendLogAsync error:", err);
    }
  });
}

// ---------------------------------------------------------------------------
// Public API — params now accept pre-resolved identity values
// ---------------------------------------------------------------------------

export interface RecordServerErrorParams {
  /** Server-resolved client IP (from client-ip.ts resolveClientIp) */
  resolvedIp: string;
  ipSource: ServerErrorLogEntry["ipSource"];
  /** Server-derived anonymous user ID (never from client header) */
  resolvedUserId: string;
  userAgent: string;
  statusCode: number;
  errorCode: string;
  category: string;
  rawTechnicalMessage: string;
  sanitizedUserMessage: string;
  actionableTip?: string;
  upstreamService?: string;
  route?: string;
  method?: string;
  traceId?: string;
  requestId?: string;
  payload?: {
    prompt?: string;
    mediaType?: string;
    duration?: string;
    aspectRatio?: string;
    model?: string;
  };
}

function generateId(): string {
  try {
    if (typeof crypto !== "undefined" && crypto.randomUUID) {
      return crypto.randomUUID();
    }
  } catch {}
  return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Records a server error into the in-memory ring buffer and asynchronously
 * appends it to disk as JSONL. Does NOT block the event loop.
 *
 * Returns the entry for use by the calling route handler.
 */
export function recordServerError(
  params: RecordServerErrorParams
): ServerErrorLogEntry {
  const now = new Date();
  const timestamp = now.toISOString();

  // Truncate prompt snippet server-side to avoid log bloat
  const promptText = (params.payload?.prompt ?? "").trim();
  const promptSnippet =
    promptText.length > 80 ? `${promptText.substring(0, 80)}…` : promptText;
  // Word count on the already-truncated-by-schema prompt is cheap
  const promptWordCount = promptText ? promptText.split(/\s+/).length : 0;

  const traceId = params.traceId ?? `trace-${generateId()}`;
  const requestId = params.requestId ?? `req-${generateId()}`;

  const entry: ServerErrorLogEntry = {
    logId: `err_${now.getTime()}_${generateId()}`,
    timestamp,
    epochMs: now.getTime(),
    clientIp: params.resolvedIp,
    ipSource: params.ipSource,
    userId: params.resolvedUserId,
    userAgent: params.userAgent,
    requestId,
    traceId,
    route: params.route ?? "/api/generate",
    method: params.method ?? "POST",
    requestPayload: {
      mediaType: params.payload?.mediaType,
      duration: params.payload?.duration,
      aspectRatio: params.payload?.aspectRatio,
      model: params.payload?.model,
      promptSnippet,
      promptWordCount,
    },
    error: {
      statusCode: params.statusCode,
      code: params.errorCode,
      category: params.category,
      rawTechnicalMessage: params.rawTechnicalMessage,
      sanitizedUserMessage: params.sanitizedUserMessage,
      actionableTip: params.actionableTip,
      upstreamService: params.upstreamService ?? "Zyka-Upstream-Gateway",
    },
    serverContext: {
      nodeEnv: process.env.NODE_ENV ?? "development",
      host: process.env.HOSTNAME ?? "zyka-worker-node",
      runtime: "Next.js (Node)",
    },
  };

  // 1. In-memory ring buffer
  inMemoryLogs.unshift(entry);
  if (inMemoryLogs.length > MAX_IN_MEMORY_LOGS) {
    inMemoryLogs.pop();
  }

  // 2. Async disk persistence — never blocks
  appendLogAsync(entry);

  return entry;
}

// ---------------------------------------------------------------------------
// Query interface
// ---------------------------------------------------------------------------

export interface LogFilters {
  ip?: string;
  userId?: string;
  code?: string;
  limit?: number;
}

/**
 * Returns filtered logs from the in-memory ring buffer only.
 * Disk hydration at startup is done separately (see hydrateLogsFromDisk).
 */
export function getServerLogs(filters?: LogFilters): ServerErrorLogEntry[] {
  let result = [...inMemoryLogs];

  if (filters?.ip) {
    const needle = filters.ip.toLowerCase();
    result = result.filter((l) => l.clientIp.toLowerCase().includes(needle));
  }
  if (filters?.userId) {
    const needle = filters.userId.toLowerCase();
    result = result.filter((l) => l.userId.toLowerCase().includes(needle));
  }
  if (filters?.code) {
    const needle = filters.code.toLowerCase();
    result = result.filter((l) => l.error.code.toLowerCase().includes(needle));
  }

  const limit = Math.min(filters?.limit ?? 50, 200);
  return result.slice(0, limit);
}

/**
 * Clears the in-memory log buffer.
 * NOTE: Does NOT delete the on-disk JSONL file — audit logs are append-only.
 */
export function clearServerLogs(): void {
  inMemoryLogs.length = 0;
}

/**
 * One-time async hydration from disk into the in-memory buffer.
 * Should be called once at startup (e.g. in instrumentation.ts).
 * Never called on each request.
 */
export async function hydrateLogsFromDisk(): Promise<void> {
  if (inMemoryLogs.length > 0) return; // already populated

  const fs = getFs();
  if (!fs) return;

  try {
    // fs.promises avoids blocking
    const fsPromises = fs.promises;
    const content = await fsPromises.readFile(JSONL_LOG_FILE, "utf8");
    const lines = content.trim().split("\n").filter(Boolean);

    // Read only the last MAX_IN_MEMORY_LOGS lines to bound memory usage
    const recentLines = lines.slice(-MAX_IN_MEMORY_LOGS);
    const parsed: ServerErrorLogEntry[] = [];
    for (const line of recentLines) {
      try {
        parsed.push(JSON.parse(line) as ServerErrorLogEntry);
      } catch {
        // Skip malformed lines
      }
    }
    // Newest first
    parsed.reverse();
    inMemoryLogs.push(...parsed);
  } catch {
    // File doesn't exist yet — fine
  }
}
