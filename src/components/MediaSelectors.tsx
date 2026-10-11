"use client";

import { MediaType, AspectRatio, Duration } from "@/types";
import { Image, Video, Music, Clock, Ratio } from "lucide-react";
import { cn } from "@/lib/utils";

interface MediaSelectorsProps {
  mediaType: MediaType;
  setMediaType: (type: MediaType) => void;
  duration: Duration;
  setDuration: (duration: Duration) => void;
  aspectRatio: AspectRatio;
  setAspectRatio: (ratio: AspectRatio) => void;
  disabled: boolean;
}

export function MediaSelectors({
  mediaType,
  setMediaType,
  duration,
  setDuration,
  aspectRatio,
  setAspectRatio,
  disabled,
}: MediaSelectorsProps) {
  const mediaTypes: { type: MediaType; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
    { type: "image", label: "Image", icon: Image },
    { type: "video", label: "Video", icon: Video },
    { type: "voice", label: "Voice", icon: Music },
  ];

  const durations: Duration[] = ["2s", "5s", "10s", "15s", "30s"];
  const aspectRatios: AspectRatio[] = ["16:9", "9:16", "1:1", "4:3", "21:9"];

  return (
    <div className="flex flex-wrap items-center gap-3 w-full bg-white border border-slate-200/90 p-2.5 rounded-xl shadow-xs">
      {/* Media Type Tabs */}
      <div className="flex items-center bg-slate-100/90 p-1 rounded-lg border border-slate-200/60">
        {mediaTypes.map(({ type, label, icon: Icon }) => {
          const isActive = mediaType === type;
          return (
            <button
              key={type}
              type="button"
              disabled={disabled}
              onClick={() => setMediaType(type)}
              className={cn(
                "flex items-center space-x-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-all cursor-pointer",
                isActive
                  ? "bg-white text-slate-900 shadow-xs font-semibold"
                  : "text-slate-500 hover:text-slate-800 hover:bg-slate-200/50"
              )}
            >
              <Icon className={cn("w-3.5 h-3.5", isActive ? "text-blue-600" : "text-slate-400")} />
              <span>{label}</span>
            </button>
          );
        })}
      </div>

      {/* Duration Selector */}
      <div
        className={cn(
          "flex items-center space-x-1.5 bg-slate-50 px-3 py-1.5 rounded-lg border border-slate-200 text-xs transition-opacity",
          mediaType === "image" ? "opacity-30 pointer-events-none" : "opacity-100"
        )}
      >
        <Clock className="w-3.5 h-3.5 text-slate-400" />
        <span className="text-slate-500 font-medium">Duration:</span>
        <select
          value={duration}
          disabled={disabled || mediaType === "image"}
          onChange={(e) => setDuration(e.target.value as Duration)}
          aria-label="Duration"
          className="bg-transparent font-medium text-slate-800 focus:outline-none cursor-pointer"
        >
          {durations.map((d) => (
            <option key={d} value={d}>
              {d} {d === "30s" ? "(Max)" : ""}
            </option>
          ))}
        </select>
      </div>

      {/* Aspect Ratio Selector */}
      <div
        className={cn(
          "flex items-center space-x-1.5 bg-slate-50 px-3 py-1.5 rounded-lg border border-slate-200 text-xs transition-opacity",
          mediaType === "voice" ? "opacity-30 pointer-events-none" : "opacity-100"
        )}
      >
        <Ratio className="w-3.5 h-3.5 text-slate-400" />
        <span className="text-slate-500 font-medium">Ratio:</span>
        <select
          value={aspectRatio}
          disabled={disabled || mediaType === "voice"}
          onChange={(e) => setAspectRatio(e.target.value as AspectRatio)}
          aria-label="Aspect Ratio"
          className="bg-transparent font-medium text-slate-800 focus:outline-none cursor-pointer"
        >
          {aspectRatios.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      </div>

      {/* Subtle indicator */}
      <div className="ml-auto hidden sm:flex items-center text-[11px] text-slate-400 font-mono">
        <span>Max 1,000 words limit</span>
      </div>
    </div>
  );
}
