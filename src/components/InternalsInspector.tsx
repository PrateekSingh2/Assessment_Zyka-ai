"use client";

import { useState } from "react";
import {
  ChevronRight,
  ChevronDown,
  Copy,
  Check,
  ShieldAlert,
  ShieldCheck,
  Terminal,
  ArrowRight,
} from "lucide-react";
import { UpstreamErrorDetail, SanitizedErrorDetail, MediaType, AspectRatio, Duration } from "@/types";
import { cn } from "@/lib/utils";

interface InternalsInspectorProps {
  requestHeaders: Record<string, string>;
  responseHeaders: Record<string, string>;
  responsePayload: any;
  rawError?: UpstreamErrorDetail | null;
  sanitizedError?: SanitizedErrorDetail | null;
  statusCode?: number | null;
  isLoading: boolean;
  onSwitchService?: (service: MediaType) => void;
  onSetRatio?: (ratio: AspectRatio) => void;
  onSetDuration?: (duration: Duration) => void;
}

export function InternalsInspector({
  requestHeaders,
  responseHeaders,
  responsePayload,
  rawError,
  sanitizedError,
  statusCode,
  isLoading,
  onSwitchService,
  onSetRatio,
  onSetDuration,
}: InternalsInspectorProps) {
  // Accordion collapsed/expanded states (like browser DevTools in reference image)
  const [isResponseHeadersOpen, setIsResponseHeadersOpen] = useState(false);
  const [isRequestHeadersOpen, setIsRequestHeadersOpen] = useState(false);
  const [isPayloadOpen, setIsPayloadOpen] = useState(false);

  // Partial JSON preview states ("Show full" / "Collapse")
  const [isResponseHeadersFull, setIsResponseHeadersFull] = useState(false);
  const [isRequestHeadersFull, setIsRequestHeadersFull] = useState(false);
  const [isPayloadFull, setIsPayloadFull] = useState(false);
  const [isServerLogOpen, setIsServerLogOpen] = useState(false);
  const [isServerLogFull, setIsServerLogFull] = useState(false);

  const [copiedSection, setCopiedSection] = useState<string | null>(null);

  const copyToClipboard = (text: string, section: string) => {
    navigator.clipboard.writeText(text);
    setCopiedSection(section);
    setTimeout(() => setCopiedSection(null), 1500);
  };

  // Enterprise Real IP extraction: Prioritizes the exact IP recorded in the server-level error log
  const isLoopback = (ip?: string | null) =>
    !ip ||
    ip === "::1" ||
    ip === "127.0.0.1" ||
    ip === "localhost" ||
    ip.startsWith("127.") ||
    ip === "::ffff:127.0.0.1";

  const rawClientIp =
    responsePayload?.serverLog?.clientIp ||
    responseHeaders["x-zyka-real-ip"] ||
    requestHeaders["x-zyka-real-ip"] ||
    requestHeaders["x-zyka-client-public-ip"] ||
    null;

  // If server candidate is loopback, fallback to client-discovered public WAN IP if present
  const realClientIp =
    isLoopback(rawClientIp) &&
    requestHeaders["x-zyka-client-public-ip"] &&
    !isLoopback(requestHeaders["x-zyka-client-public-ip"])
      ? requestHeaders["x-zyka-client-public-ip"]
      : rawClientIp;

  const ipSource =
    responsePayload?.serverLog?.ipSource ||
    responseHeaders["x-zyka-ip-source"] ||
    (realClientIp && isLoopback(rawClientIp) ? "client-public-wan" : null);

  const resolvedUserId =
    responsePayload?.serverLog?.userId ||
    responseHeaders["x-zyka-user-id"] ||
    requestHeaders["x-zyka-user-id"] ||
    null;
  const serverLogData = responsePayload?.serverLog || null;
  const serverLogJson = serverLogData
    ? JSON.stringify(serverLogData, null, 2)
    : "";

  const hasData =
    Object.keys(requestHeaders).length > 0 ||
    Object.keys(responseHeaders).length > 0;
  const isError = statusCode && statusCode >= 400;

  const reqCount = Object.keys(requestHeaders).length;
  const resCount = Object.keys(responseHeaders).length;

  const reqJson = JSON.stringify(requestHeaders, null, 2);
  const resJson = JSON.stringify(responseHeaders, null, 2);
  const payloadJson = responsePayload
    ? JSON.stringify(responsePayload, null, 2)
    : "{}";

  return (
    <div className="w-full flex flex-col bg-white border border-slate-200/90 rounded-2xl shadow-sm overflow-hidden text-slate-800">
      {/* Top Header Bar */}
      <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <Terminal className="w-4 h-4 text-slate-600" />
          <span className="font-semibold text-xs text-slate-800 tracking-wide uppercase">
            Network & Error Inspector
          </span>
        </div>
        {statusCode !== null && statusCode !== undefined && (
          <span
            className={cn(
              "text-[11px] font-mono font-semibold px-2.5 py-0.5 rounded-full border",
              isError
                ? "bg-rose-50 text-rose-700 border-rose-200"
                : "bg-emerald-50 text-emerald-700 border-emerald-200"
            )}
          >
            HTTP {statusCode}
          </span>
        )}
      </div>

      <div className="p-4 space-y-4">
        {isLoading && (
          <div className="py-12 flex flex-col items-center justify-center space-y-2 text-slate-400">
            <div className="w-5 h-5 border-2 border-pink-600 border-t-transparent rounded-full animate-spin" />
            <p className="text-xs font-mono">Intercepting gateway telemetry...</p>
          </div>
        )}

        {!isLoading && !hasData && (
          <div className="py-14 text-center text-slate-400 space-y-1">
            <p className="text-xs font-medium text-slate-600">No request sent yet</p>
            <p className="text-[11px] text-slate-400 max-w-xs mx-auto">
              Submit a prompt to view the Request headers, Response headers, and full payload JSON.
            </p>
          </div>
        )}

        {!isLoading && hasData && (
          <>
            {/* Real IP & User Identity Telemetry Bar */}
            {realClientIp && (
              <div className="bg-slate-50 border border-slate-200/90 rounded-xl p-2.5 flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                  <span className="text-slate-500 font-semibold">Real IP:</span>
                  <span className="font-bold text-slate-800 bg-white px-2 py-0.5 rounded border border-slate-200">
                    {realClientIp}
                  </span>
                  {ipSource && (
                    <span className="text-[10px] text-slate-500 bg-slate-200/70 px-1.5 py-0.5 rounded">
                      {ipSource}
                    </span>
                  )}
                </div>
                {resolvedUserId && (
                  <div className="flex items-center gap-1.5 text-slate-600">
                    <span className="text-slate-500">User:</span>
                    <span className="font-semibold text-slate-800 bg-white px-2 py-0.5 rounded border border-slate-200">
                      {resolvedUserId}
                    </span>
                  </div>
                )}
              </div>
            )}

            {/* =========================================================================
                THE TWO ERROR COMPARISON LABELS (Highlighted when error occurs)
               ========================================================================= */}
            {isError && (
              <div className="space-y-3 pb-3 border-b border-slate-100">
                {/* LABEL 1: Without error handling */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-rose-700 flex items-center gap-1.5">
                      <ShieldAlert className="w-3.5 h-3.5 text-rose-600" />
                      Without the error handling then the error message:
                    </span>
                    <button
                      onClick={() =>
                        copyToClipboard(rawError?.technicalMessage || "", "raw")
                      }
                      className="text-[11px] text-slate-400 hover:text-slate-700 flex items-center gap-1 cursor-pointer"
                    >
                      {copiedSection === "raw" ? (
                        <Check className="w-3 h-3 text-emerald-600" />
                      ) : (
                        <Copy className="w-3 h-3" />
                      )}
                      <span>Copy</span>
                    </button>
                  </div>
                  <div className="bg-rose-50/70 border border-rose-200 rounded-xl p-3">
                    <pre className="text-xs font-mono text-rose-900 whitespace-pre-wrap leading-relaxed break-all">
                      {rawError?.technicalMessage || "No upstream fault detected."}
                    </pre>
                  </div>
                </div>

                {/* LABEL 2: With proper error handling */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-emerald-700 flex items-center gap-1.5">
                      <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
                      With proper error handling, the error message:
                    </span>
                    <button
                      onClick={() =>
                        copyToClipboard(sanitizedError?.userMessage || "", "clean")
                      }
                      className="text-[11px] text-slate-400 hover:text-slate-700 flex items-center gap-1 cursor-pointer"
                    >
                      {copiedSection === "clean" ? (
                        <Check className="w-3 h-3 text-emerald-600" />
                      ) : (
                        <Copy className="w-3 h-3" />
                      )}
                      <span>Copy</span>
                    </button>
                  </div>
                  <div className="bg-emerald-50/80 border border-emerald-200 rounded-xl p-3.5 space-y-2">
                    <p className="text-xs font-bold text-emerald-950 leading-snug">
                      &quot;{sanitizedError?.userMessage}&quot;
                    </p>

                    {/* Engaging Retention Tip */}
                    {sanitizedError?.actionableTip && (
                      <p className="text-xs text-emerald-800 leading-relaxed font-medium">
                        💡 {sanitizedError.actionableTip}
                      </p>
                    )}

                    {/* 1-Click Retention and Correction Actions */}
                    <div className="pt-1 flex flex-wrap items-center gap-2">
                      {sanitizedError?.suggestedService && onSwitchService && (
                        <button
                          type="button"
                          onClick={() =>
                            onSwitchService(sanitizedError.suggestedService!)
                          }
                          className="inline-flex items-center space-x-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold px-3 py-1.5 rounded-lg shadow-2xs transition-all cursor-pointer"
                        >
                          <span>{sanitizedError.actionLabel || "Switch Service"}</span>
                          <ArrowRight className="w-3 h-3" />
                        </button>
                      )}

                      {sanitizedError?.suggestedRatio && onSetRatio && (
                        <button
                          type="button"
                          onClick={() =>
                            onSetRatio(sanitizedError.suggestedRatio!)
                          }
                          className="inline-flex items-center space-x-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold px-3 py-1.5 rounded-lg shadow-2xs transition-all cursor-pointer"
                        >
                          <span>{sanitizedError.actionLabel || "Set Aspect Ratio"}</span>
                          <ArrowRight className="w-3 h-3" />
                        </button>
                      )}

                      {sanitizedError?.suggestedDuration && onSetDuration && (
                        <button
                          type="button"
                          onClick={() =>
                            onSetDuration(sanitizedError.suggestedDuration!)
                          }
                          className="inline-flex items-center space-x-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold px-3 py-1.5 rounded-lg shadow-2xs transition-all cursor-pointer"
                        >
                          <span>{sanitizedError.actionLabel || "Set Duration"}</span>
                          <ArrowRight className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* =========================================================================
                DEVTOOLS ACCORDION: RESPONSE HEADERS (Like Reference Image 2)
               ========================================================================= */}
            <div className="border border-slate-200 rounded-xl overflow-hidden bg-slate-900 text-slate-100">
              <button
                type="button"
                onClick={() => setIsResponseHeadersOpen(!isResponseHeadersOpen)}
                className="w-full px-3 py-2 bg-slate-800/90 hover:bg-slate-800 text-left flex items-center justify-between text-xs font-mono font-medium text-slate-200 transition-colors cursor-pointer"
              >
                <div className="flex items-center space-x-2">
                  {isResponseHeadersOpen ? (
                    <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
                  ) : (
                    <ChevronRight className="w-3.5 h-3.5 text-slate-400" />
                  )}
                  <span>Response headers ({resCount})</span>
                </div>
                <span className="text-[10px] text-slate-400">
                  {isResponseHeadersOpen ? "Collapse" : "Expand"}
                </span>
              </button>

              {isResponseHeadersOpen && (
                <div className="p-3 bg-slate-950/90 text-xs font-mono space-y-2 border-t border-slate-800">
                  <div className="flex justify-between items-center pb-1">
                    <span className="text-[11px] text-slate-400">JSON representation:</span>
                    <button
                      onClick={() => copyToClipboard(resJson, "res")}
                      className="text-[11px] text-slate-400 hover:text-white flex items-center gap-1 cursor-pointer"
                    >
                      {copiedSection === "res" ? (
                        <Check className="w-3 h-3 text-emerald-400" />
                      ) : (
                        <Copy className="w-3 h-3" />
                      )}
                      <span>Copy</span>
                    </button>
                  </div>
                  <pre
                    className={cn(
                      "text-sky-300 whitespace-pre overflow-x-auto leading-relaxed",
                      !isResponseHeadersFull && "max-h-36 overflow-y-hidden"
                    )}
                  >
                    {resJson}
                  </pre>
                  {resJson.split("\n").length > 8 && (
                    <button
                      type="button"
                      onClick={() => setIsResponseHeadersFull(!isResponseHeadersFull)}
                      className="text-[11px] text-blue-400 hover:text-blue-300 font-medium underline cursor-pointer"
                    >
                      {isResponseHeadersFull ? "Show less" : "Show full JSON"}
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* =========================================================================
                DEVTOOLS ACCORDION: REQUEST HEADERS (Like Reference Image 2)
               ========================================================================= */}
            <div className="border border-slate-200 rounded-xl overflow-hidden bg-slate-900 text-slate-100">
              <button
                type="button"
                onClick={() => setIsRequestHeadersOpen(!isRequestHeadersOpen)}
                className="w-full px-3 py-2 bg-slate-800/90 hover:bg-slate-800 text-left flex items-center justify-between text-xs font-mono font-medium text-slate-200 transition-colors cursor-pointer"
              >
                <div className="flex items-center space-x-2">
                  {isRequestHeadersOpen ? (
                    <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
                  ) : (
                    <ChevronRight className="w-3.5 h-3.5 text-slate-400" />
                  )}
                  <span>Request headers ({reqCount})</span>
                </div>
                <span className="text-[10px] text-slate-400">
                  {isRequestHeadersOpen ? "Collapse" : "Expand"}
                </span>
              </button>

              {isRequestHeadersOpen && (
                <div className="p-3 bg-slate-950/90 text-xs font-mono space-y-2 border-t border-slate-800">
                  <div className="flex justify-between items-center pb-1">
                    <span className="text-[11px] text-slate-400">JSON representation:</span>
                    <button
                      onClick={() => copyToClipboard(reqJson, "req")}
                      className="text-[11px] text-slate-400 hover:text-white flex items-center gap-1 cursor-pointer"
                    >
                      {copiedSection === "req" ? (
                        <Check className="w-3 h-3 text-emerald-400" />
                      ) : (
                        <Copy className="w-3 h-3" />
                      )}
                      <span>Copy</span>
                    </button>
                  </div>
                  <pre
                    className={cn(
                      "text-emerald-400 whitespace-pre overflow-x-auto leading-relaxed",
                      !isRequestHeadersFull && "max-h-36 overflow-y-hidden"
                    )}
                  >
                    {reqJson}
                  </pre>
                  {reqJson.split("\n").length > 8 && (
                    <button
                      type="button"
                      onClick={() => setIsRequestHeadersFull(!isRequestHeadersFull)}
                      className="text-[11px] text-blue-400 hover:text-blue-300 font-medium underline cursor-pointer"
                    >
                      {isRequestHeadersFull ? "Show less" : "Show full JSON"}
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* =========================================================================
                DEVTOOLS ACCORDION: COMPLETE RESPONSE PAYLOAD (FULL JSON)
               ========================================================================= */}
            <div className="border border-slate-200 rounded-xl overflow-hidden bg-slate-900 text-slate-100">
              <button
                type="button"
                onClick={() => setIsPayloadOpen(!isPayloadOpen)}
                className="w-full px-3 py-2 bg-slate-800/90 hover:bg-slate-800 text-left flex items-center justify-between text-xs font-mono font-medium text-slate-200 transition-colors cursor-pointer"
              >
                <div className="flex items-center space-x-2">
                  {isPayloadOpen ? (
                    <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
                  ) : (
                    <ChevronRight className="w-3.5 h-3.5 text-slate-400" />
                  )}
                  <span>Response payload (Complete JSON)</span>
                </div>
                <span className="text-[10px] text-slate-400">
                  {isPayloadOpen ? "Collapse" : "Expand"}
                </span>
              </button>

              {isPayloadOpen && (
                <div className="p-3 bg-slate-950/90 text-xs font-mono space-y-2 border-t border-slate-800">
                  <div className="flex justify-between items-center pb-1">
                    <span className="text-[11px] text-slate-400">JSON body response:</span>
                    <button
                      onClick={() => copyToClipboard(payloadJson, "payload")}
                      className="text-[11px] text-slate-400 hover:text-white flex items-center gap-1 cursor-pointer"
                    >
                      {copiedSection === "payload" ? (
                        <Check className="w-3 h-3 text-emerald-400" />
                      ) : (
                        <Copy className="w-3 h-3" />
                      )}
                      <span>Copy</span>
                    </button>
                  </div>
                  <pre
                    className={cn(
                      "text-amber-300 whitespace-pre overflow-x-auto leading-relaxed",
                      !isPayloadFull && "max-h-48 overflow-y-hidden"
                    )}
                  >
                    {payloadJson}
                  </pre>
                  {payloadJson.split("\n").length > 10 && (
                    <button
                      type="button"
                      onClick={() => setIsPayloadFull(!isPayloadFull)}
                      className="text-[11px] text-blue-400 hover:text-blue-300 font-medium underline cursor-pointer"
                    >
                      {isPayloadFull ? "Show less" : "Show full JSON"}
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* =========================================================================
                DEVTOOLS ACCORDION: SERVER ERROR LOG (REAL IP & USER-WISE AUDIT)
               ========================================================================= */}
            {serverLogData && (
              <div className="border border-purple-200/90 rounded-xl overflow-hidden bg-slate-900 text-slate-100 shadow-sm">
                <button
                  type="button"
                  onClick={() => setIsServerLogOpen(!isServerLogOpen)}
                  className="w-full px-3 py-2 bg-purple-950/70 hover:bg-purple-950 text-left flex items-center justify-between text-xs font-mono font-medium text-purple-200 transition-colors cursor-pointer"
                >
                  <div className="flex items-center space-x-2">
                    {isServerLogOpen ? (
                      <ChevronDown className="w-3.5 h-3.5 text-purple-300" />
                    ) : (
                      <ChevronRight className="w-3.5 h-3.5 text-purple-300" />
                    )}
                    <span className="text-purple-200 font-semibold">
                      Server error log (Real IP & User-wise audit)
                    </span>
                  </div>
                  <span className="text-[10px] text-purple-400 bg-purple-900/50 px-2 py-0.5 rounded border border-purple-700/50">
                    {isServerLogOpen ? "Collapse" : "Expand Audit"}
                  </span>
                </button>

                {isServerLogOpen && (
                  <div className="p-3 bg-slate-950/95 text-xs font-mono space-y-2 border-t border-purple-900/50">
                    <div className="flex justify-between items-center pb-1 text-[11px] text-purple-300">
                      <span>Persistent server audit record:</span>
                      <button
                        onClick={() => copyToClipboard(serverLogJson, "serverlog")}
                        className="text-[11px] text-purple-300 hover:text-white flex items-center gap-1 cursor-pointer"
                      >
                        {copiedSection === "serverlog" ? (
                          <Check className="w-3 h-3 text-emerald-400" />
                        ) : (
                          <Copy className="w-3 h-3" />
                        )}
                        <span>Copy Log</span>
                      </button>
                    </div>
                    <pre
                      className={cn(
                        "text-fuchsia-300 whitespace-pre overflow-x-auto leading-relaxed",
                        !isServerLogFull && "max-h-48 overflow-y-hidden"
                      )}
                    >
                      {serverLogJson}
                    </pre>
                    {serverLogJson.split("\n").length > 10 && (
                      <button
                        type="button"
                        onClick={() => setIsServerLogFull(!isServerLogFull)}
                        className="text-[11px] text-purple-400 hover:text-purple-300 font-medium underline cursor-pointer"
                      >
                        {isServerLogFull ? "Show less" : "Show full server log"}
                      </button>
                    )}
                    <div className="pt-2 border-t border-slate-800 text-[10px] text-slate-400 flex items-center justify-between">
                      <span>Persisted to: logs/server-errors.log & server-errors.jsonl</span>
                      <span className="text-emerald-400 flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                        Real-time synced
                      </span>
                    </div>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
