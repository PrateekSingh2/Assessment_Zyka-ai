import { OperationLogEntry } from "@/types";

const OPERATIONS_STORAGE_KEY = "zyka_operations_audit_logs";
const MAX_LOGS = 100;

type LogListener = (logs: OperationLogEntry[]) => void;
const listeners = new Set<LogListener>();

function getStorage(): Storage | null {
  if (typeof window !== "undefined" && window.localStorage) {
    return window.localStorage;
  }
  if (typeof globalThis !== "undefined" && (globalThis as { localStorage?: Storage }).localStorage) {
    return (globalThis as { localStorage?: Storage }).localStorage ?? null;
  }
  return null;
}

/**
 * Reads logs from localStorage
 */
export function getOperationLogs(): OperationLogEntry[] {
  const storage = getStorage();
  if (!storage) return [];

  try {
    const raw = storage.getItem(OPERATIONS_STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

/**
 * Saves logs and notifies listeners
 */
function saveAndNotify(logs: OperationLogEntry[]): void {
  const storage = getStorage();
  try {
    storage?.setItem(OPERATIONS_STORAGE_KEY, JSON.stringify(logs.slice(0, MAX_LOGS)));
  } catch {}

  listeners.forEach((listener) => {
    try {
      listener(logs);
    } catch {}
  });
}

// Deduplication guard against rapid double-triggers
let lastRecordedTime = 0;
let lastRecordedSignature = "";

/**
 * Adds an operation log entry (exactly 1 log per unique operation)
 */
export function recordOperationLog(
  entryData: Omit<OperationLogEntry, "id" | "timestamp" | "formattedTime">
): OperationLogEntry | null {
  const nowMs = Date.now();
  const signature = `${entryData.type}|${entryData.statusCode || 0}|${entryData.summary}|${entryData.promptSnippet || ""}`;

  // Deduplicate if identical operation is fired within 1200ms
  if (signature === lastRecordedSignature && nowMs - lastRecordedTime < 1200) {
    return null;
  }

  lastRecordedTime = nowMs;
  lastRecordedSignature = signature;

  const now = new Date();
  const hours = String(now.getHours()).padStart(2, "0");
  const minutes = String(now.getMinutes()).padStart(2, "0");
  const seconds = String(now.getSeconds()).padStart(2, "0");
  const formattedTime = `${hours}:${minutes}:${seconds}`;

  const entry: OperationLogEntry = {
    ...entryData,
    id: `op_${now.getTime()}_${Math.random().toString(36).substring(2, 7)}`,
    timestamp: now.toISOString(),
    formattedTime,
  };

  const current = getOperationLogs();
  const updated = [entry, ...current].slice(0, MAX_LOGS);
  saveAndNotify(updated);

  return entry;
}

/**
 * Clears all operations logs
 */
export function clearOperationLogs(): void {
  const storage = getStorage();
  try {
    storage?.removeItem(OPERATIONS_STORAGE_KEY);
  } catch {}
  listeners.forEach((listener) => listener([]));
}

/**
 * Subscribe to log changes
 */
export function subscribeToLogs(listener: LogListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
