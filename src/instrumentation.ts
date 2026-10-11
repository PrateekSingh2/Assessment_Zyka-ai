/**
 * Next.js Instrumentation Hook
 * Executes at server startup to hydrate log ring buffer from persistent disk.
 */

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { hydrateLogsFromDisk } = await import("@/lib/server-logger");
    await hydrateLogsFromDisk();
  }
}
