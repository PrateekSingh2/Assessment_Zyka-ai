"use client";

import { motion } from "framer-motion";
import {
  Download,
  AlertCircle,
  Volume2,
  Film,
  Sparkles,
  ExternalLink,
} from "lucide-react";
import { MediaType, AspectRatio, Duration } from "@/types";
import { toSafeMediaUrl } from "@/lib/safe-url";

interface GenerationResultProps {
  mediaUrl?: string | null;
  mediaType?: MediaType;
  duration?: Duration;
  aspectRatio?: AspectRatio;
  resolution?: string;
  error?: string | null;
  prompt?: string;
}

export function GenerationResult({
  mediaUrl,
  mediaType = "image",
  duration,
  aspectRatio,
  resolution,
  error,
  prompt,
}: GenerationResultProps) {
  if (error) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full p-4 bg-rose-50/80 border border-rose-200 rounded-xl flex items-start space-x-3 text-left"
      >
        <div className="w-8 h-8 rounded-lg bg-rose-100 flex items-center justify-center text-rose-600 flex-shrink-0 mt-0.5">
          <AlertCircle className="w-4 h-4" />
        </div>
        <div className="space-y-1">
          <h4 className="text-xs font-bold text-rose-900">Request Error Encountered</h4>
          <p className="text-xs text-rose-800 leading-relaxed font-medium">
            {error}
          </p>
          <p className="text-[11px] text-rose-600">
            See the API Inspector panel for raw upstream headers and full JSON payload.
          </p>
        </div>
      </motion.div>
    );
  }

  if (!mediaUrl) return null;

  // SECURITY: Validate URL against the CDN allow-list before rendering.
  // Prevents javascript: URLs and unauthorized external media sources.
  const safeUrl = toSafeMediaUrl(mediaUrl);
  if (!safeUrl) {
    return (
      <div className="p-4 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-700">
        Media URL failed security validation.
      </div>
    );
  }


  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="w-full rounded-2xl overflow-hidden border border-slate-200 bg-white shadow-xs"
    >
      {/* Top Metadata Bar */}
      <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2 text-xs">
        <div className="flex items-center space-x-2">
          <span className="font-semibold text-slate-700 capitalize flex items-center space-x-1.5">
            {mediaType === "video" && <Film className="w-3.5 h-3.5 text-blue-600" />}
            {(mediaType === "audio" || mediaType === "voice") && <Volume2 className="w-3.5 h-3.5 text-blue-600" />}
            {mediaType === "image" && <Sparkles className="w-3.5 h-3.5 text-blue-600" />}
            <span>{mediaType} Generated</span>
          </span>
          {resolution && (
            <span className="bg-slate-200/70 text-slate-700 px-2 py-0.5 rounded text-[11px] font-mono">
              {resolution}
            </span>
          )}
          {duration && (
            <span className="bg-slate-200/70 text-slate-700 px-2 py-0.5 rounded text-[11px] font-mono">
              {duration}
            </span>
          )}
          {aspectRatio && (
            <span className="bg-slate-200/70 text-slate-700 px-2 py-0.5 rounded text-[11px] font-mono">
              {aspectRatio}
            </span>
          )}
        </div>

        <button
          onClick={() => window.open(safeUrl, "_blank", "noopener,noreferrer")}
          className="flex items-center space-x-1 text-slate-500 hover:text-slate-800 transition-colors text-xs cursor-pointer"
        >
          <ExternalLink className="w-3 h-3" />
          <span>Open Full</span>
        </button>
      </div>

      {/* Media Player Container */}
      <div className="relative flex items-center justify-center bg-slate-900/5 min-h-[260px]">
        {mediaType === "video" && (
          <div className="w-full">
            <video
              src={safeUrl}
              controls
              autoPlay
              loop
              playsInline
              className="w-full max-h-[380px] object-contain"
            />
          </div>
        )}

        {(mediaType === "audio" || mediaType === "voice") && (
          <div className="w-full p-8 flex flex-col items-center justify-center space-y-5">
            {/* Audio Wave Visualizer */}
            <div className="flex items-center justify-center space-x-1.5 h-16 w-full max-w-sm">
              {[35, 70, 20, 85, 55, 30, 75, 95, 40, 60, 80, 25, 65, 90, 45, 30, 80, 55, 35].map(
                (height, i) => (
                  <motion.div
                    key={i}
                    animate={{
                      height: [`${height}%`, `${Math.max(15, 100 - height)}%`, `${height}%`],
                    }}
                    transition={{
                      repeat: Infinity,
                      duration: 1.2 + (i % 5) * 0.2,
                      ease: "easeInOut",
                    }}
                    className="w-1.5 bg-blue-600 rounded-full"
                  />
                )
              )}
            </div>

            <audio controls src={safeUrl} className="w-full max-w-md shadow-xs" />
          </div>
        )}

        {mediaType === "image" && (
          <div className="relative group w-full flex items-center justify-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={safeUrl}
              alt="Generated Media"
              className="w-full max-h-[420px] object-contain"
            />
            <div className="absolute inset-0 bg-slate-900/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center backdrop-blur-xs">
              <button
                onClick={() => window.open(safeUrl, "_blank", "noopener,noreferrer")}
                className="flex items-center space-x-1.5 bg-white text-slate-800 px-4 py-2 rounded-lg shadow-md font-medium text-xs hover:bg-slate-50 cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Download Media</span>
              </button>
            </div>
          </div>
        )}
      </div>

      {prompt && (
        <div className="px-4 py-2.5 bg-slate-50 border-t border-slate-200 text-xs text-slate-600">
          <span className="font-semibold text-slate-700">Prompt: </span>
          <span className="italic line-clamp-1">&quot;{prompt}&quot;</span>
        </div>
      )}
    </motion.div>
  );
}
