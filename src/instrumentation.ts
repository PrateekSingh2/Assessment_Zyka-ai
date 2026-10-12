/**
 * Next.js Instrumentation Hook
 * Executes at server startup to hydrate log ring buffer from persistent disk.
 */

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    try {
      const { validateProductionProxyConfig } = await import("@/lib/client-ip");
      validateProductionProxyConfig();
    } catch (e) {
      console.warn("[instrumentation] Proxy config check:", e);
    }
    try {
      const { hydrateLogsFromDisk } = await import("@/lib/server-logger");
      await hydrateLogsFromDisk();
    } catch (e) {
      console.warn("[instrumentation] Log hydration check:", e);
    }
  }
}
