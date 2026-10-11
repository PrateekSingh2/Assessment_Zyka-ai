"use client";

import { useState, useRef } from "react";
import {
  Image as ImageIcon,
  Video as VideoIcon,
  Mic,
  SlidersHorizontal,
  Ratio,
  Star,
  Sparkles,
  ArrowRight,
  ChevronDown,
  AlertCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { MediaType, AspectRatio, Duration, GenerationRequestPayload } from "@/types";

interface PromptFormProps {
  onSubmit: (payload: GenerationRequestPayload) => void;
  isLoading: boolean;
  selectedMediaType: MediaType;
  setSelectedMediaType: (type: MediaType) => void;
  aspectRatio: AspectRatio;
  setAspectRatio: (ratio: AspectRatio) => void;
  duration: Duration;
  setDuration: (duration: Duration) => void;
}

export function PromptForm({
  onSubmit,
  isLoading,
  selectedMediaType,
  setSelectedMediaType,
  aspectRatio,
  setAspectRatio,
  duration,
  setDuration,
}: PromptFormProps) {
  const [prompt, setPrompt] = useState("");
  const [model, setModel] = useState("Auto (Best model)");
  const [quality, setQuality] = useState("High Quality");
  const lastSubmitRef = useRef(0);

  const trimmed = prompt.trim();
  const wordCount = trimmed ? trimmed.split(/\s+/).length : 0;
  const isOverLimit = wordCount > 1000;

  const handleSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const now = Date.now();
    // Prevent double submissions: block calls within 800ms
    if (!trimmed || isLoading || now - lastSubmitRef.current < 800) return;
    lastSubmitRef.current = now;

    onSubmit({
      prompt,
      mediaType: selectedMediaType,
      duration: selectedMediaType === "video" ? duration : undefined,
      aspectRatio: selectedMediaType === "voice" ? undefined : aspectRatio,
      model,
      quality,
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  // Model options based on selected service
  const getModelOptions = () => {
    if (selectedMediaType === "video") {
      return [
        "Auto (Best model)",
        "Sora 2",
        "Veo 3.1",
        "Kling v3 Pro",
        "Seedance 2.5",
        "Kling 1.5",
      ];
    }
    if (selectedMediaType === "voice") {
      return [
        "Auto (Best model)",
        "Zyka Voice v2 (Studio)",
        "ElevenLabs Multilingual",
        "DeepVoice Neural",
      ];
    }
    return [
      "Auto (Best model)",
      "Flux 2 Dev",
      "GPT Image v1.5",
      "Zyka Helion",
      "Nano Banana Pro",
      "Stable Diffusion XL",
    ];
  };

  return (
    <form onSubmit={handleSubmit} className="w-full">
      {/* Container matching user's reference mockup */}
      <div className="bg-white border border-slate-200/90 rounded-[28px] p-4 sm:p-5 shadow-md shadow-slate-200/50 transition-all">
        {/* Top Row: Service Mode Tabs (Image, Video, Voice) */}
        <div className="flex items-center space-x-2 pb-3 border-b border-slate-100/80">
          <button
            type="button"
            disabled={isLoading}
            onClick={() => setSelectedMediaType("image")}
            className={cn(
              "flex items-center space-x-1.5 text-xs font-semibold px-3.5 py-1.5 rounded-full transition-all cursor-pointer",
              selectedMediaType === "image"
                ? "bg-[#fce7f3] text-[#db2777] border border-[#fbcfe8]"
                : "text-slate-600 hover:text-slate-900 hover:bg-slate-100/70"
            )}
          >
            <ImageIcon className="w-3.5 h-3.5" />
            <span>Image</span>
          </button>

          <button
            type="button"
            disabled={isLoading}
            onClick={() => setSelectedMediaType("video")}
            className={cn(
              "flex items-center space-x-1.5 text-xs font-semibold px-3.5 py-1.5 rounded-full transition-all cursor-pointer",
              selectedMediaType === "video"
                ? "bg-[#fce7f3] text-[#db2777] border border-[#fbcfe8]"
                : "text-slate-600 hover:text-slate-900 hover:bg-slate-100/70"
            )}
          >
            <VideoIcon className="w-3.5 h-3.5" />
            <span>Video</span>
          </button>

          <button
            type="button"
            disabled={isLoading}
            onClick={() => setSelectedMediaType("voice")}
            className={cn(
              "flex items-center space-x-1.5 text-xs font-semibold px-3.5 py-1.5 rounded-full transition-all cursor-pointer",
              selectedMediaType === "voice"
                ? "bg-[#fce7f3] text-[#db2777] border border-[#fbcfe8]"
                : "text-slate-600 hover:text-slate-900 hover:bg-slate-100/70"
            )}
          >
            <Mic className="w-3.5 h-3.5" />
            <span>Voice</span>
          </button>

          {/* Right Word Count Tag */}
          <div className="ml-auto flex items-center space-x-1.5 text-[11px] font-mono">
            <span
              className={cn(
                "px-2 py-0.5 rounded-md",
                isOverLimit
                  ? "bg-rose-100 text-rose-700 font-bold"
                  : "text-slate-400"
              )}
            >
              {wordCount} / 1,000 words
            </span>
          </div>
        </div>

        {/* Middle Row: Textarea */}
        <div className="py-2.5">
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              selectedMediaType === "video"
                ? "Cinematic shot of a dragon flying over neon Tokyo at midnight"
                : selectedMediaType === "voice"
                ? "Welcome to Zyka AI, the next-generation multi-modal creative platform."
                : "Photorealistic portrait of an astronaut on Mars during sunset"
            }
            rows={3}
            disabled={isLoading}
            className="w-full bg-transparent border-none focus:outline-none focus:ring-0 text-slate-800 placeholder-slate-400 resize-none text-base leading-relaxed"
          />
        </div>

        {/* Word limit warning bar */}
        {isOverLimit && (
          <div className="flex items-center text-rose-600 text-xs font-medium pb-2">
            <AlertCircle className="w-3.5 h-3.5 mr-1" />
            Word count ({wordCount} words) exceeds maximum limit of 1,000 words.
          </div>
        )}

        {/* Bottom Row: Selector Pills + Generate Button */}
        <div className="flex flex-wrap items-center justify-between gap-2.5 pt-2">
          {/* Left Pill Dropdowns */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Model Selector Pill */}
            <div className="relative inline-flex items-center bg-white border border-slate-200 hover:border-slate-300 rounded-full px-3 py-1.5 text-xs text-slate-700 font-medium shadow-2xs transition-colors cursor-pointer">
              <SlidersHorizontal className="w-3.5 h-3.5 mr-1.5 text-slate-500" />
              <select
                value={model}
                disabled={isLoading}
                onChange={(e) => setModel(e.target.value)}
                className="bg-transparent text-slate-700 font-medium focus:outline-none appearance-none pr-4 cursor-pointer"
              >
                {getModelOptions().map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
              <ChevronDown className="w-3 h-3 text-slate-400 absolute right-2.5 pointer-events-none" />
            </div>

            {/* Aspect Ratio Pill (Hidden for Voice) */}
            {selectedMediaType !== "voice" && (
              <div className="relative inline-flex items-center bg-white border border-slate-200 hover:border-slate-300 rounded-full px-3 py-1.5 text-xs text-slate-700 font-medium shadow-2xs transition-colors cursor-pointer">
                <Ratio className="w-3.5 h-3.5 mr-1.5 text-slate-500" />
                <select
                  value={aspectRatio}
                  disabled={isLoading}
                  onChange={(e) => setAspectRatio(e.target.value as AspectRatio)}
                  className="bg-transparent text-slate-700 font-medium focus:outline-none appearance-none pr-4 cursor-pointer"
                >
                  <option value="16:9">16:9</option>
                  <option value="9:16">9:16</option>
                  <option value="1:1">1:1</option>
                  <option value="4:3">4:3</option>
                  <option value="21:9">21:9</option>
                </select>
                <ChevronDown className="w-3 h-3 text-slate-400 absolute right-2.5 pointer-events-none" />
              </div>
            )}

            {/* Quality / Duration Pill */}
            <div className="relative inline-flex items-center bg-white border border-slate-200 hover:border-slate-300 rounded-full px-3 py-1.5 text-xs text-slate-700 font-medium shadow-2xs transition-colors cursor-pointer">
              <Star className="w-3.5 h-3.5 mr-1.5 text-slate-500" />
              {selectedMediaType === "video" ? (
                <select
                  value={duration}
                  disabled={isLoading}
                  onChange={(e) => setDuration(e.target.value as Duration)}
                  className="bg-transparent text-slate-700 font-medium focus:outline-none appearance-none pr-4 cursor-pointer"
                >
                  <option value="2s">2s Duration</option>
                  <option value="5s">5s Duration</option>
                  <option value="10s">10s Duration</option>
                  <option value="15s">15s Duration</option>
                  <option value="30s">30s (Max)</option>
                </select>
              ) : (
                <select
                  value={quality}
                  disabled={isLoading}
                  onChange={(e) => setQuality(e.target.value)}
                  className="bg-transparent text-slate-700 font-medium focus:outline-none appearance-none pr-4 cursor-pointer"
                >
                  <option value="High Quality">High Quality</option>
                  <option value="Standard">Standard</option>
                  <option value="Ultra Photoreal">Ultra Photoreal</option>
                </select>
              )}
              <ChevronDown className="w-3 h-3 text-slate-400 absolute right-2.5 pointer-events-none" />
            </div>
          </div>

          {/* Right Action Button: Pink/Fuchsia Pill matching mockup */}
          <button
            type="submit"
            disabled={isLoading || !trimmed}
            className={cn(
              "flex items-center space-x-1.5 px-6 py-2.5 rounded-full text-xs sm:text-sm font-semibold transition-all cursor-pointer shadow-md",
              isLoading || !trimmed
                ? "bg-slate-200 text-slate-400 cursor-not-allowed shadow-none"
                : "bg-gradient-to-r from-[#db2777] to-[#e11d48] hover:from-[#be185d] hover:to-[#be123c] text-white shadow-pink-500/25 active:scale-98"
            )}
          >
            <Sparkles className="w-4 h-4" />
            <span>{isLoading ? "Generating..." : "Generate"}</span>
            <ArrowRight className="w-4 h-4 ml-0.5" />
          </button>
        </div>
      </div>
    </form>
  );
}
