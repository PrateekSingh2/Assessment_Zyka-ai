"use client";

import { useState, useEffect } from "react";
import { PromptForm } from "@/components/PromptForm";
import { GenerationResult } from "@/components/GenerationResult";
import { LoadingSteps } from "@/components/ui/LoadingSteps";
import { InternalsInspector } from "@/components/InternalsInspector";
import { LogsModal } from "@/components/LogsModal";
import {
  fetchRealClientIp,
  getStoredOrNewUsername,
  regenerateUsername,
} from "@/lib/client-identity";
import {
  recordOperationLog,
  getOperationLogs,
  clearOperationLogs,
  subscribeToLogs,
} from "@/lib/operations-store";
import { Sparkles, Activity, FileText, Globe, User } from "lucide-react";
import {
  GenerationRequestPayload,
  MediaType,
  Duration,
  AspectRatio,
  UpstreamErrorDetail,
  SanitizedErrorDetail,
  OperationLogEntry,
} from "@/types";

export default function Home() {
  const [isLoading, setIsLoading] = useState(false);
  const [selectedMediaType, setSelectedMediaType] = useState<MediaType>("image");
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>("16:9");
  const [duration, setDuration] = useState<Duration>("5s");

  // Client Identity & Real IP Discovery
  const [realIp, setRealIp] = useState<string>("127.0.0.1");
  const [ipSource, setIpSource] = useState<string>("Detecting...");
  const [username, setUsername] = useState<string>("Creator_Zenith_101");
  const [isLogsModalOpen, setIsLogsModalOpen] = useState(false);
  const [logs, setLogs] = useState<OperationLogEntry[]>([]);

  useEffect(() => {
    // 1. Subscribe to operational logs
    setLogs(getOperationLogs());
    const unsubscribe = subscribeToLogs(setLogs);

    // 2. Resolve random username from browser storage
    const storedUser = getStoredOrNewUsername();
    setUsername(storedUser);

    // 3. Resolve exact real IP address (even on localhost)
    fetchRealClientIp().then((res) => {
      setRealIp(res.ip);
      setIpSource(
        res.source === "public-api"
          ? "Public WAN"
          : res.source === "lan-network"
          ? "Local LAN"
          : "Loopback"
      );
    });

    return () => unsubscribe();
  }, []);

  const handleRegenerateUsername = () => {
    const next = regenerateUsername();
    setUsername(next);
    recordOperationLog({
      type: "DROPDOWN_SYNC",
      status: "INFO",
      realIp,
      ipType: ipSource,
      username: next,
      summary: `Regenerated user identity to @${next}`,
    });
  };

  const handleRefreshIp = async () => {
    setIpSource("Refreshing...");
    const res = await fetchRealClientIp();
    setRealIp(res.ip);
    setIpSource(
      res.source === "public-api"
        ? "Public WAN"
        : res.source === "lan-network"
        ? "Local LAN"
        : "Loopback"
    );
  };

  const [result, setResult] = useState<{
    mediaUrl?: string;
    mediaType?: MediaType;
    duration?: Duration;
    aspectRatio?: AspectRatio;
    resolution?: string;
    model?: string;
    quality?: string;
    prompt?: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Network & Header Telemetry
  const [requestHeaders, setRequestHeaders] = useState<Record<string, string>>({});
  const [responseHeaders, setResponseHeaders] = useState<Record<string, string>>({});
  const [responsePayload, setResponsePayload] = useState<any>(null);
  const [rawError, setRawError] = useState<UpstreamErrorDetail | null>(null);
  const [sanitizedError, setSanitizedError] = useState<SanitizedErrorDetail | null>(null);
  const [statusCode, setStatusCode] = useState<number | null>(null);

  const handleGenerate = async (payload: GenerationRequestPayload) => {
    // Prevent double execution if already loading
    if (isLoading) return;

    setIsLoading(true);
    setResult(null);
    setError(null);
    setRawError(null);
    setSanitizedError(null);
    setStatusCode(null);
    setResponsePayload(null);

    // 1. Construct Valid HTTP Request Headers for fetch()
    const requestId = `req-${Math.random().toString(36).substring(2, 9)}-${Date.now()}`;
    const outgoingHeaders: Record<string, string> = {
      "Content-Type": "application/json",
      "x-zyka-media-type": payload.mediaType,
      "x-zyka-duration": payload.duration || "none",
      "x-zyka-aspect-ratio": payload.aspectRatio || "none",
      "x-zyka-model": payload.model || "Auto (Best model)",
      "x-zyka-request-id": requestId,
      "x-zyka-client-timestamp": new Date().toISOString(),
      "x-zyka-client-public-ip": realIp,
      "x-zyka-real-ip": realIp,
      "x-zyka-user-id": username,
      "x-zyka-username": username,
    };

    // DevTools Inspector display representation (includes HTTP/2 pseudo-headers for telemetry)
    const telemetryDisplayHeaders: Record<string, string> = {
      ":authority": typeof window !== "undefined" ? window.location.host : "api.zyka.ai",
      ":method": "POST",
      ":path": "/api/generate",
      ":scheme": typeof window !== "undefined" ? window.location.protocol.replace(":", "") : "https",
      ...outgoingHeaders,
    };

    setRequestHeaders(telemetryDisplayHeaders);

    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: outgoingHeaders, // Valid RFC-compliant headers only
        body: JSON.stringify(payload),
      });

      // 2. Extract Response Headers
      const incomingHeaders: Record<string, string> = {};
      res.headers.forEach((val, key) => {
        incomingHeaders[key] = val;
      });
      setResponseHeaders(incomingHeaders);
      setStatusCode(res.status);

      const json = await res.json();
      setResponsePayload(json);

      // Extract authoritative IP recorded in the server-level error log or telemetry headers
      const serverReportedIp =
        incomingHeaders["x-zyka-real-ip"] ||
        json.serverLog?.clientIp;
      const isLoopbackVal = (val?: string) =>
        !val || val === "::1" || val === "127.0.0.1" || val.startsWith("127.");

      const activeRealIp =
        serverReportedIp && !isLoopbackVal(serverReportedIp)
          ? serverReportedIp
          : realIp;

      if (serverReportedIp && !isLoopbackVal(serverReportedIp) && serverReportedIp !== realIp) {
        setRealIp(serverReportedIp);
        const serverSource = incomingHeaders["x-zyka-ip-source"] || json.serverLog?.ipSource;
        if (serverSource) {
          setIpSource(
            serverSource === "client-public-wan"
              ? "Public WAN"
              : serverSource === "system-lan-interface"
              ? "Local LAN"
              : serverSource === "cf-connecting-ip"
              ? "Cloudflare CDN"
              : "Verified IP"
          );
        }
      }

      if (!res.ok || !json.success) {
        // Extract raw technical error from headers or JSON
        const rawTechnicalMsg =
          incomingHeaders["x-raw-upstream-error"]
            ? decodeURIComponent(incomingHeaders["x-raw-upstream-error"])
            : json.rawError?.technicalMessage || "Unknown upstream failure";

        const rawErr: UpstreamErrorDetail = {
          code:
            incomingHeaders["x-upstream-error-code"] ||
            json.rawError?.code ||
            "ERR_GENERIC",
          technicalMessage: rawTechnicalMsg,
          upstreamService:
            incomingHeaders["x-upstream-service"] ||
            json.rawError?.upstreamService ||
            "Upstream-Worker",
          traceId:
            incomingHeaders["x-upstream-trace-id"] ||
            json.rawError?.traceId ||
            requestId,
        };

        // Extract sanitized human-readable message from headers or JSON
        const sanitizedMsg =
          incomingHeaders["x-zyka-sanitized-error"] ||
          json.sanitizedError?.userMessage ||
          "An error occurred during generation.";

        const cleanErr: SanitizedErrorDetail = {
          userMessage: sanitizedMsg,
          category: json.sanitizedError?.category || "SYSTEM",
          actionableTip:
            json.sanitizedError?.actionableTip || "Please review your prompt.",
          suggestedService: json.sanitizedError?.suggestedService,
          suggestedRatio: json.sanitizedError?.suggestedRatio,
          suggestedDuration: json.sanitizedError?.suggestedDuration,
          actionLabel: json.sanitizedError?.actionLabel,
        };

        setRawError(rawErr);
        setSanitizedError(cleanErr);
        setError(cleanErr.userMessage);

        // Record error in operations log using exact server-recorded real IP
        recordOperationLog({
          type: res.status === 429 ? "RATE_LIMIT_ENGAGED" : "ERROR_INTERCEPTED",
          status: "ERROR",
          statusCode: res.status,
          realIp: activeRealIp,
          ipType: ipSource,
          username,
          mediaType: payload.mediaType,
          promptSnippet: payload.prompt,
          summary: cleanErr.userMessage,
          technicalDetails: rawErr.technicalMessage,
          sanitizedMessage: cleanErr.userMessage,
          actionableTip: cleanErr.actionableTip,
        });
      } else {
        setResult({
          mediaUrl: json.data.mediaUrl,
          mediaType: json.data.mediaType,
          duration: json.data.duration,
          aspectRatio: json.data.aspectRatio,
          resolution: json.data.resolution,
          model: json.data.model,
          quality: json.data.quality,
          prompt: payload.prompt,
        });

        // Record success in operations log using exact server-recorded real IP
        recordOperationLog({
          type: "GENERATION_SUCCESS",
          status: "SUCCESS",
          statusCode: 200,
          realIp: activeRealIp,
          ipType: ipSource,
          username,
          mediaType: payload.mediaType,
          promptSnippet: payload.prompt,
          summary: `Successfully synthesized ${payload.mediaType.toUpperCase()} artifact (200 OK)`,
        });
      }
    } catch (networkErr: any) {
      console.error("Network Fetch Error:", networkErr);
      const networkMsg = `[FATAL] NetworkTransportFailure: Failed to reach gateway.\nDetails: ${networkErr?.message || "ERR_CONNECTION_REFUSED"}`;

      const rawErr: UpstreamErrorDetail = {
        code: "ERR_NETWORK_DISCONNECTED",
        technicalMessage: networkMsg,
        upstreamService: "Client-Network-Layer",
        traceId: requestId,
      };

      const cleanErr: SanitizedErrorDetail = {
        userMessage: "Network connection lost. Please verify your connection.",
        category: "SYSTEM",
        actionableTip: "Check your local connection and retry.",
      };

      setRawError(rawErr);
      setSanitizedError(cleanErr);
      setError(cleanErr.userMessage);
      setStatusCode(0);

      recordOperationLog({
        type: "ERROR_INTERCEPTED",
        status: "ERROR",
        statusCode: 0,
        realIp,
        ipType: ipSource,
        username,
        mediaType: payload.mediaType,
        promptSnippet: payload.prompt,
        summary: cleanErr.userMessage,
        technicalDetails: rawErr.technicalMessage,
        sanitizedMessage: cleanErr.userMessage,
        actionableTip: cleanErr.actionableTip,
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-slate-50 text-slate-900 font-sans antialiased flex flex-col items-center py-8 px-4 sm:px-6 lg:px-8">
      <div className="w-full max-w-6xl space-y-6">
        {/* Clean Header Bar */}
        <header className="flex items-center justify-between pb-4 border-b border-slate-200">
          <div className="flex items-center space-x-2.5">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-[#db2777] to-[#e11d48] flex items-center justify-center text-white shadow-xs">
              <Sparkles className="w-4 h-4" />
            </div>
            <div>
              <h1 className="text-base font-bold text-slate-900 tracking-tight flex items-center gap-2">
                <span>Zyka.ai</span>
                <span className="text-[11px] font-medium font-mono bg-pink-100 text-pink-700 px-2 py-0.5 rounded-md border border-pink-200">
                  AI Video, Image & Voice
                </span>
              </h1>
              <p className="text-xs text-slate-500">
                Multi-modal creative platform with middleware error translation
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-2 text-xs font-mono">
            {/* Real IP Telemetry Pill */}
            <div className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-white border border-slate-200 text-slate-600 shadow-2xs">
              <Globe className="w-3 h-3 text-blue-500" />
              <span className="text-[11px] font-semibold text-slate-800">{realIp}</span>
              <span className="text-[9px] bg-slate-100 text-slate-500 px-1 py-0.2 rounded font-sans">
                {ipSource}
              </span>
            </div>

            {/* Random User Identity Pill */}
            <div className="hidden md:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-white border border-slate-200 text-slate-600 shadow-2xs">
              <User className="w-3 h-3 text-pink-500" />
              <span className="text-[11px] font-semibold text-pink-700">@{username}</span>
            </div>

            {/* Prominent Navbar System Logs Button */}
            <button
              type="button"
              onClick={() => setIsLogsModalOpen(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1 rounded-md bg-white hover:bg-slate-50 border border-slate-200 hover:border-pink-300 text-slate-800 font-sans font-medium shadow-2xs transition-all cursor-pointer group active:scale-98"
            >
              <FileText className="w-3.5 h-3.5 text-pink-600 group-hover:scale-110 transition-transform" />
              <span className="font-semibold text-xs">Logs</span>
              <span className="text-[10px] font-mono px-1.5 py-0.2 rounded-full bg-pink-100 text-pink-700 font-bold border border-pink-200">
                {logs.length}
              </span>
            </button>

            {/* Gateway Status Indicator */}
            <span className="hidden lg:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-white border border-slate-200 text-slate-600 shadow-2xs">
              <Activity className="w-3 h-3 text-emerald-500" />
              <span>Gateway: Online</span>
            </span>
          </div>
        </header>

        {/* 2-Column Balanced Layout */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Left Column: Prompting Studio (Col 7) */}
          <div className="lg:col-span-7 space-y-4">
            <div>
              <h2 className="text-xl font-bold text-slate-900 tracking-tight">
                Create with Zyka AI
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Switch between Image, Video, and Voice. Type your creative prompt below.
              </p>
            </div>

            {/* Reference-Styled Prompt Form */}
            <PromptForm
              onSubmit={handleGenerate}
              isLoading={isLoading}
              selectedMediaType={selectedMediaType}
              setSelectedMediaType={setSelectedMediaType}
              aspectRatio={aspectRatio}
              setAspectRatio={setAspectRatio}
              duration={duration}
              setDuration={setDuration}
            />

            {/* Results or Loading State */}
            <div className="pt-2">
              {isLoading && <LoadingSteps />}

              {!isLoading && (result || error) && (
                <GenerationResult
                  mediaUrl={result?.mediaUrl}
                  mediaType={result?.mediaType}
                  duration={result?.duration}
                  aspectRatio={result?.aspectRatio}
                  resolution={result?.resolution}
                  error={error}
                  prompt={result?.prompt}
                />
              )}

              {!isLoading && !result && !error && (
                <div className="p-8 border border-dashed border-slate-200 rounded-2xl bg-white/60 text-center space-y-1">
                  <p className="text-xs font-medium text-slate-600">Ready to synthesize</p>
                  <p className="text-[11px] text-slate-400">
                    Enter a prompt above and press Generate.
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Right Column: Telemetry & Error Comparison Inspector (Col 5) */}
          <div className="lg:col-span-5 sticky top-6">
            <InternalsInspector
              requestHeaders={requestHeaders}
              responseHeaders={responseHeaders}
              responsePayload={responsePayload}
              rawError={rawError}
              sanitizedError={sanitizedError}
              statusCode={statusCode}
              isLoading={isLoading}
              onSwitchService={(service) => {
                setSelectedMediaType(service);
                recordOperationLog({
                  type: "SERVICE_SWITCH",
                  status: "INFO",
                  realIp,
                  ipType: ipSource,
                  username,
                  mediaType: service,
                  summary: `User engaged 1-click switch to ${service.toUpperCase()} Generator`,
                });
              }}
              onSetRatio={(ratio) => {
                setAspectRatio(ratio);
                recordOperationLog({
                  type: "DROPDOWN_SYNC",
                  status: "INFO",
                  realIp,
                  ipType: ipSource,
                  username,
                  summary: `User synchronized aspect ratio to ${ratio}`,
                });
              }}
              onSetDuration={(dur) => {
                setDuration(dur);
                recordOperationLog({
                  type: "DROPDOWN_SYNC",
                  status: "INFO",
                  realIp,
                  ipType: ipSource,
                  username,
                  summary: `User synchronized duration to ${dur}`,
                });
              }}
            />
          </div>
        </div>
      </div>

      {/* Operations & System Audit Logs Modal */}
      <LogsModal
        isOpen={isLogsModalOpen}
        onClose={() => setIsLogsModalOpen(false)}
        logs={logs}
        onClearLogs={clearOperationLogs}
        realIp={realIp}
        ipSource={ipSource}
        username={username}
        onRegenerateUsername={handleRegenerateUsername}
        onRefreshIp={handleRefreshIp}
      />
    </main>
  );
}
