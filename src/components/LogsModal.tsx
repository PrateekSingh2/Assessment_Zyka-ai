"use client";

import { useState, useMemo } from "react";
import {
  X,
  RefreshCw,
  Trash2,
  Download,
  Search,
  Terminal,
  ShieldAlert,
  ShieldCheck,
  Globe,
  User,
  Clock,
  ChevronDown,
  ChevronRight,
  Copy,
  Check,
  Filter,
} from "lucide-react";
import { OperationLogEntry } from "@/types";
import { cn } from "@/lib/utils";

interface LogsModalProps {
  isOpen: boolean;
  onClose: () => void;
  logs: OperationLogEntry[];
  onClearLogs: () => void;
  realIp: string;
  ipSource: string;
  username: string;
  onRegenerateUsername: () => void;
  onRefreshIp: () => void;
}

export function LogsModal({
  isOpen,
  onClose,
  logs,
  onClearLogs,
  realIp,
  ipSource,
  username,
  onRegenerateUsername,
  onRefreshIp,
}: LogsModalProps) {
  const [filterType, setFilterType] = useState<"ALL" | "SUCCESS" | "ERROR" | "RATE_LIMIT">("ALL");
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedLogId, setExpandedLogId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const filteredLogs = useMemo(() => {
    return logs.filter((log) => {
      // Type filter
      if (filterType === "SUCCESS" && log.status !== "SUCCESS") return false;
      if (filterType === "ERROR" && log.status !== "ERROR") return false;
      if (filterType === "RATE_LIMIT" && log.type !== "RATE_LIMIT_ENGAGED") return false;

      // Search query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesIp = log.realIp.toLowerCase().includes(q);
        const matchesUser = log.username.toLowerCase().includes(q);
        const matchesSummary = log.summary.toLowerCase().includes(q);
        const matchesPrompt = (log.promptSnippet || "").toLowerCase().includes(q);
        const matchesType = log.type.toLowerCase().includes(q);
        return matchesIp || matchesUser || matchesSummary || matchesPrompt || matchesType;
      }

      return true;
    });
  }, [logs, filterType, searchQuery]);

  const copyLogJson = (log: OperationLogEntry) => {
    navigator.clipboard.writeText(JSON.stringify(log, null, 2));
    setCopiedId(log.id);
    setTimeout(() => setCopiedId(null), 1500);
  };

  const downloadLogsJson = () => {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(logs, null, 2));
    const downloadAnchor = document.createElement("a");
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", `zyka-operations-log-${Date.now()}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-slate-900/60 backdrop-blur-xs transition-opacity animate-in fade-in">
      <div className="relative w-full max-w-4xl max-h-[90vh] bg-white rounded-2xl shadow-2xl border border-slate-200 flex flex-col overflow-hidden text-slate-800">
        {/* Modal Top Header */}
        <div className="px-5 py-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
          <div className="flex items-center space-x-2.5">
            <div className="w-8 h-8 rounded-lg bg-pink-100 text-pink-700 flex items-center justify-center">
              <Terminal className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold text-slate-900 tracking-tight">
                  System & Operations Audit Logs
                </h3>
                <span className="text-[10px] font-mono font-medium px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-200 flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  Live Audit
                </span>
              </div>
              <p className="text-[11px] text-slate-500">
                Real-time tracking of all operations with exact real IP and random user identity
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <button
              type="button"
              onClick={downloadLogsJson}
              disabled={logs.length === 0}
              className="px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-white hover:bg-slate-100 border border-slate-200 rounded-lg flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-40"
              title="Download JSON audit log"
            >
              <Download className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Export JSON</span>
            </button>
            <button
              type="button"
              onClick={onClearLogs}
              disabled={logs.length === 0}
              className="px-2.5 py-1.5 text-xs font-medium text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-lg flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-40"
              title="Clear operational logs"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Clear</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
              title="Close modal"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* User Identity & Real IP Discovery Strip */}
        <div className="px-5 py-3 bg-gradient-to-r from-slate-50 via-pink-50/40 to-slate-50 border-b border-slate-200 grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
          {/* Real IP Badge */}
          <div className="flex items-center justify-between p-2.5 rounded-xl bg-white border border-slate-200 shadow-2xs">
            <div className="flex items-center space-x-2">
              <div className="w-7 h-7 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center">
                <Globe className="w-3.5 h-3.5" />
              </div>
              <div>
                <div className="text-[10px] text-slate-400 uppercase font-semibold">User Real IP (Even Localhost)</div>
                <div className="font-mono font-bold text-slate-900 flex items-center gap-1.5">
                  <span>{realIp || "127.0.0.1"}</span>
                  <span className="text-[9px] font-sans px-1.5 py-0.2 rounded bg-blue-100 text-blue-700 font-medium">
                    {ipSource}
                  </span>
                </div>
              </div>
            </div>
            <button
              onClick={onRefreshIp}
              className="p-1.5 text-slate-400 hover:text-blue-600 rounded-md hover:bg-slate-50 transition-colors cursor-pointer"
              title="Re-detect real IP"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Random Username Badge */}
          <div className="flex items-center justify-between p-2.5 rounded-xl bg-white border border-slate-200 shadow-2xs">
            <div className="flex items-center space-x-2">
              <div className="w-7 h-7 rounded-lg bg-pink-50 text-pink-600 flex items-center justify-center">
                <User className="w-3.5 h-3.5" />
              </div>
              <div>
                <div className="text-[10px] text-slate-400 uppercase font-semibold">Assigned Random Username</div>
                <div className="font-mono font-bold text-pink-700">@{username}</div>
              </div>
            </div>
            <button
              onClick={onRegenerateUsername}
              className="text-[11px] font-medium text-pink-600 hover:text-pink-800 bg-pink-50 hover:bg-pink-100 px-2 py-1 rounded-md border border-pink-200 transition-colors cursor-pointer"
              title="Roll a new random username"
            >
              Roll New
            </button>
          </div>
        </div>

        {/* Filters & Search Row */}
        <div className="px-5 py-2.5 bg-white border-b border-slate-200 flex flex-wrap items-center justify-between gap-2.5 text-xs">
          {/* Tab Filter Pills */}
          <div className="flex items-center space-x-1">
            <button
              type="button"
              onClick={() => setFilterType("ALL")}
              className={cn(
                "px-2.5 py-1 rounded-lg font-medium transition-colors cursor-pointer",
                filterType === "ALL"
                  ? "bg-slate-900 text-white"
                  : "text-slate-600 hover:bg-slate-100"
              )}
            >
              All ({logs.length})
            </button>
            <button
              type="button"
              onClick={() => setFilterType("SUCCESS")}
              className={cn(
                "px-2.5 py-1 rounded-lg font-medium transition-colors cursor-pointer",
                filterType === "SUCCESS"
                  ? "bg-emerald-600 text-white"
                  : "text-slate-600 hover:bg-slate-100"
              )}
            >
              Success ({logs.filter((l) => l.status === "SUCCESS").length})
            </button>
            <button
              type="button"
              onClick={() => setFilterType("ERROR")}
              className={cn(
                "px-2.5 py-1 rounded-lg font-medium transition-colors cursor-pointer",
                filterType === "ERROR"
                  ? "bg-rose-600 text-white"
                  : "text-slate-600 hover:bg-slate-100"
              )}
            >
              Errors ({logs.filter((l) => l.status === "ERROR").length})
            </button>
            <button
              type="button"
              onClick={() => setFilterType("RATE_LIMIT")}
              className={cn(
                "px-2.5 py-1 rounded-lg font-medium transition-colors cursor-pointer",
                filterType === "RATE_LIMIT"
                  ? "bg-amber-600 text-white"
                  : "text-slate-600 hover:bg-slate-100"
              )}
            >
              Rate Limits ({logs.filter((l) => l.type === "RATE_LIMIT_ENGAGED").length})
            </button>
          </div>

          {/* Search Field */}
          <div className="relative min-w-[200px] flex-1 sm:flex-initial">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by IP, username, message..."
              className="w-full pl-8 pr-3 py-1 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-hidden focus:ring-1 focus:ring-pink-500 focus:bg-white text-slate-800 placeholder-slate-400"
            />
          </div>
        </div>

        {/* Scrollable Logs List Area */}
        <div className="flex-1 overflow-y-auto p-5 space-y-2.5 max-h-[55vh]">
          {filteredLogs.length === 0 ? (
            <div className="py-14 text-center text-slate-400 space-y-1">
              <Filter className="w-8 h-8 mx-auto text-slate-300" />
              <p className="text-xs font-semibold text-slate-600">No operational logs match filter</p>
              <p className="text-[11px] text-slate-400">
                Trigger an image, video, or voice generation to record live operations.
              </p>
            </div>
          ) : (
            filteredLogs.map((log) => {
              const isExpanded = expandedLogId === log.id;
              const isError = log.status === "ERROR";
              const isRateLimit = log.type === "RATE_LIMIT_ENGAGED";

              return (
                <div
                  key={log.id}
                  className={cn(
                    "border rounded-xl transition-all overflow-hidden",
                    isError
                      ? "border-rose-200 bg-rose-50/20 hover:border-rose-300"
                      : isRateLimit
                      ? "border-amber-200 bg-amber-50/20 hover:border-amber-300"
                      : "border-slate-200 bg-white hover:border-slate-300"
                  )}
                >
                  {/* Log Header Row */}
                  <div
                    onClick={() => setExpandedLogId(isExpanded ? null : log.id)}
                    className="p-3 flex items-start justify-between gap-3 cursor-pointer select-none"
                  >
                    <div className="flex items-start space-x-2.5 min-w-0">
                      <button className="text-slate-400 mt-0.5">
                        {isExpanded ? (
                          <ChevronDown className="w-4 h-4" />
                        ) : (
                          <ChevronRight className="w-4 h-4" />
                        )}
                      </button>

                      <div className="space-y-1 min-w-0">
                        {/* Meta Tags */}
                        <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-mono">
                          {/* Time */}
                          <span className="flex items-center gap-1 text-slate-500">
                            <Clock className="w-3 h-3 text-slate-400" />
                            {log.formattedTime}
                          </span>

                          {/* HTTP status pill */}
                          {log.statusCode && (
                            <span
                              className={cn(
                                "px-1.5 py-0.2 rounded font-semibold",
                                log.statusCode >= 400
                                  ? "bg-rose-100 text-rose-800"
                                  : "bg-emerald-100 text-emerald-800"
                              )}
                            >
                              HTTP {log.statusCode}
                            </span>
                          )}

                          {/* Type */}
                          <span className="px-1.5 py-0.2 rounded bg-slate-100 text-slate-700 font-medium">
                            {log.type}
                          </span>

                          {/* Real IP */}
                          <span className="px-1.5 py-0.2 rounded bg-blue-50 text-blue-700 border border-blue-200 flex items-center gap-1">
                            <Globe className="w-2.5 h-2.5" />
                            {log.realIp}
                          </span>

                          {/* Username */}
                          <span className="px-1.5 py-0.2 rounded bg-pink-50 text-pink-700 border border-pink-200 font-semibold flex items-center gap-1">
                            <User className="w-2.5 h-2.5" />
                            @{log.username}
                          </span>
                        </div>

                        {/* Summary Message */}
                        <div className="text-xs font-medium text-slate-800 truncate">
                          {log.summary}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          copyLogJson(log);
                        }}
                        className="p-1 text-slate-400 hover:text-slate-700 rounded-md hover:bg-slate-100"
                        title="Copy log entry JSON"
                      >
                        {copiedId === log.id ? (
                          <Check className="w-3.5 h-3.5 text-emerald-600" />
                        ) : (
                          <Copy className="w-3.5 h-3.5" />
                        )}
                      </button>
                    </div>
                  </div>

                  {/* Expanded Details Pane */}
                  {isExpanded && (
                    <div className="p-3 bg-slate-900 text-slate-100 text-xs font-mono space-y-2 border-t border-slate-200/80">
                      {log.promptSnippet && (
                        <div>
                          <span className="text-slate-400 text-[10px] uppercase">User Prompt:</span>
                          <div className="p-2 rounded bg-slate-950 text-pink-300 whitespace-pre-wrap mt-0.5">
                            {log.promptSnippet}
                          </div>
                        </div>
                      )}

                      {log.technicalDetails && (
                        <div>
                          <span className="text-slate-400 text-[10px] uppercase flex items-center gap-1 text-rose-400">
                            <ShieldAlert className="w-3 h-3 text-rose-400" />
                            Raw Upstream Error (Without Handling):
                          </span>
                          <div className="p-2 rounded bg-slate-950 text-rose-300 whitespace-pre-wrap mt-0.5 leading-relaxed">
                            {log.technicalDetails}
                          </div>
                        </div>
                      )}

                      {log.sanitizedMessage && (
                        <div>
                          <span className="text-slate-400 text-[10px] uppercase flex items-center gap-1 text-emerald-400">
                            <ShieldCheck className="w-3 h-3 text-emerald-400" />
                            Sanitized User Message (With Handling):
                          </span>
                          <div className="p-2 rounded bg-slate-950 text-emerald-300 whitespace-pre-wrap mt-0.5">
                            {log.sanitizedMessage}
                          </div>
                        </div>
                      )}

                      {log.actionableTip && (
                        <div>
                          <span className="text-slate-400 text-[10px] uppercase text-cyan-400">
                            Retention Tip:
                          </span>
                          <div className="p-2 rounded bg-slate-950 text-cyan-200 mt-0.5">
                            {log.actionableTip}
                          </div>
                        </div>
                      )}

                      <div className="pt-2 border-t border-slate-800 text-[10px] text-slate-400 flex items-center justify-between">
                        <span>Log ID: {log.id}</span>
                        <span>ISO: {log.timestamp}</span>
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Modal Bottom Footer */}
        <div className="px-5 py-3 bg-slate-50 border-t border-slate-200 flex items-center justify-between text-xs text-slate-500">
          <div className="flex items-center space-x-2">
            <span>Audit storage: <strong>Local & Server Synced</strong></span>
            <span>•</span>
            <span>Files: <code>logs/server-errors.log</code></span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-white font-medium rounded-lg transition-colors cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
