/**
 * Server-side structured error logger.
 *
 * FIXES FOR N7:
 * 1. userAgent is capped at 256 chars and rawTechnicalMessage at 1024 chars to prevent log bloat DoS.
 * 2. Entire append and rotation pipeline uses async fs.promises — no sync event-loop stalls.
 * 3. Log rotation: when JSONL file exceeds 5 MB, it is rotated to .jsonl.1 instead of dropping logs.
 * 4. Automatic disk hydration on startup (exported register hook for Next.js instrumentation).
 */

import path from "path";
import { ServerErrorLogEntry } from "@/types";

const MAX_IN_MEMORY_LOGS = 200;
const inMemoryLogs: ServerErrorLogEntry[] = [];

const LOGS_DIR = path.join(process.cwd(), "logs");
const JSONL_LOG_FILE = path.join(LOGS_DIR, "server-errors.jsonl");
const ROTATED_LOG_FILE = path.join(LOGS_DIR, "server-errors.jsonl.1");
const MAX_LOG_FILE_BYTES = 5 * 1024 * 1024; // 5 MB

function getFs(): typeof import("fs") | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require("fs") as typeof import("fs");
  } catch {
    return null;
  }
}

let writeQueue: Promise<void> = Promise.resolve();

/**
 * Fully asynchronous append with rotation when file exceeds MAX_LOG_FILE_BYTES.
 * Serialized via writeQueue to prevent race conditions during rotation and concurrent writes.
 */
function appendLogAsync(entry: ServerErrorLogEntry): Promise<void> {
  writeQueue = writeQueue
    .then(async () => {
      const fs = getFs();
      if (!fs) return;
      const fsp = fs.promises;

      try {
        await fsp.mkdir(LOGS_DIR, { recursive: true }).catch(() => {});

        let currentSize = 0;
        try {
          const stat = await fsp.stat(JSONL_LOG_FILE);
          currentSize = stat.size;
        } catch {
          // File does not exist yet
        }

        // Rotate if over capacity: rename current to .1
        if (currentSize >= MAX_LOG_FILE_BYTES) {
          await fsp.rename(JSONL_LOG_FILE, ROTATED_LOG_FILE).catch(() => {});
        }

        await fsp.appendFile(JSONL_LOG_FILE, JSON.stringify(entry) + "\n", "utf8");
      } catch (err) {
        console.error(
          "[server-logger] Async append error:",
          err instanceof Error ? err.message : err
        );
      }
    })
    .catch(() => {});

  return writeQueue;
}

export interface RecordServerErrorParams {
  resolvedIp: string;
  ipSource: ServerErrorLogEntry["ipSource"];
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
 * Records a server error into the in-memory ring buffer and queues async disk persistence.
 */
export function recordServerError(
  params: RecordServerErrorParams
): ServerErrorLogEntry {
  const now = new Date();
  const timestamp = now.toISOString();

  // Bounded prompt snippet
  const promptText = (params.payload?.prompt ?? "").trim();
  const promptSnippet =
    promptText.length > 80 ? `${promptText.substring(0, 80)}…` : promptText;
  const promptWordCount = promptText ? promptText.split(/\s+/).length : 0;

  const traceId = params.traceId ?? `trace-${generateId()}`;
  const requestId = params.requestId ?? `req-${generateId()}`;

  // SECURITY (N7): Cap userAgent and rawTechnicalMessage length
  const safeUserAgent = (params.userAgent || "unknown-client").slice(0, 256);
  const safeRawTechnicalMessage = (params.rawTechnicalMessage || "").slice(0, 1024);

  const entry: ServerErrorLogEntry = {
    logId: `err_${now.getTime()}_${generateId()}`,
    timestamp,
    epochMs: now.getTime(),
    clientIp: params.resolvedIp,
    ipSource: params.ipSource,
    userId: params.resolvedUserId,
    userAgent: safeUserAgent,
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
      rawTechnicalMessage: safeRawTechnicalMessage,
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

  // 2. Purely async disk persistence (fire-and-forget Promise)
  appendLogAsync(entry);

  return entry;
}

export interface LogFilters {
  ip?: string;
  userId?: string;
  code?: string;
  limit?: number;
}

let hasHydrated = false;

/**
 * Returns filtered logs from the in-memory ring buffer.
 * If empty on initial request, awaits disk hydration.
 */
export async function getServerLogs(filters?: LogFilters): Promise<ServerErrorLogEntry[]> {
  if (!hasHydrated && inMemoryLogs.length === 0) {
    await hydrateLogsFromDisk();
  }

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

export function clearServerLogs(): void {
  inMemoryLogs.length = 0;
}

/**
 * One-time async hydration from disk into memory.
 */
export async function hydrateLogsFromDisk(): Promise<void> {
  hasHydrated = true;
  const fs = getFs();
  if (!fs) return;

  try {
    const content = await fs.promises.readFile(JSONL_LOG_FILE, "utf8");
    const lines = content.trim().split("\n").filter(Boolean);
    const recentLines = lines.slice(-MAX_IN_MEMORY_LOGS);
    const parsed: ServerErrorLogEntry[] = [];
    for (const line of recentLines) {
      try {
        parsed.push(JSON.parse(line) as ServerErrorLogEntry);
      } catch {}
    }
    parsed.reverse();
    inMemoryLogs.push(...parsed);
  } catch {}
}
