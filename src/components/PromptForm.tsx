"use client";

import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
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
  Check,
  Clock,
  Layers,
  Sparkle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  MediaType,
  AspectRatio,
  Duration,
  GenerationRequestPayload,
} from "@/types";

interface PromptFormProps {
  onSubmit: (payload: GenerationRequestPayload) => void;
  isLoading: boolean;
  cooldownSeconds?: number;
  selectedMediaType: MediaType;
  setSelectedMediaType: (type: MediaType) => void;
  aspectRatio: AspectRatio;
  setAspectRatio: (ratio: AspectRatio) => void;
  duration: Duration;
  setDuration: (duration: Duration) => void;
}

interface ModelOption {
  id: string;
  name: string;
  badge: string;
  description: string;
  isPopular?: boolean;
}

const MODEL_DATA: Record<MediaType, ModelOption[]> = {
  image: [
    {
      id: "Auto (Best model)",
      name: "Auto (Best model)",
      badge: "Smart Auto",
      description: "Dynamically picks the highest fidelity image diffusion engine",
      isPopular: true,
    },
    {
      id: "Flux 2 Dev",
      name: "Flux 2 Dev",
      badge: "Photoreal",
      description: "State-of-the-art detail, authentic skin textures & volumetric lighting",
      isPopular: true,
    },
    {
      id: "GPT Image v1.5",
      name: "GPT Image v1.5",
      badge: "Typography",
      description: "Superior prompt fidelity & crisp embedded text rendering",
    },
    {
      id: "Zyka Helion",
      name: "Zyka Helion",
      badge: "Zyka Flagship",
      description: "Proprietary rapid diffusion with studio color grading",
    },
    {
      id: "Nano Banana Pro",
      name: "Nano Banana Pro",
      badge: "Ultra Fast",
      description: "Low-latency generation for rapid iteration & sketches",
    },
    {
      id: "Stable Diffusion XL",
      name: "Stable Diffusion XL",
      badge: "Classic",
      description: "Versatile community weights for illustrations & concept art",
    },
  ],
  video: [
    {
      id: "Auto (Best model)",
      name: "Auto (Best model)",
      badge: "Smart Auto",
      description: "Automatically selects the best video diffusion model",
      isPopular: true,
    },
    {
      id: "Sora 2",
      name: "Sora 2",
      badge: "Cinematic",
      description: "Physically consistent physics, complex motion & realism",
      isPopular: true,
    },
    {
      id: "Veo 3.1",
      name: "Veo 3.1",
      badge: "DeepMind",
      description: "Fluid 1080p motion synthesis & cinematic pans",
    },
    {
      id: "Kling v3 Pro",
      name: "Kling v3 Pro",
      badge: "High Dynamic",
      description: "Complex character action, acrobatic moves & gestures",
    },
    {
      id: "Seedance 2.5",
      name: "Seedance 2.5",
      badge: "Fast Render",
      description: "High-cadence video diffusion with swift turnaround",
    },
    {
      id: "Kling 1.5",
      name: "Kling 1.5",
      badge: "Standard",
      description: "Reliable, lightweight motion generation",
    },
  ],
  voice: [
    {
      id: "Auto (Best model)",
      name: "Auto (Best model)",
      badge: "Smart Auto",
      description: "Optimizes voice timbre and pacing for prompt",
      isPopular: true,
    },
    {
      id: "Zyka Voice v2 (Studio)",
      name: "Zyka Voice v2",
      badge: "Studio HQ",
      description: "Expressive neural voice with emotion & pacing dynamics",
      isPopular: true,
    },
    {
      id: "ElevenLabs Multilingual",
      name: "ElevenLabs",
      badge: "30+ Langs",
      description: "World-class natural multilingual speech synthesis",
    },
    {
      id: "DeepVoice Neural",
      name: "DeepVoice Neural",
      badge: "Ultra Fast",
      description: "Conversational latency with natural inflection",
    },
  ],
};

interface AspectRatioOption {
  id: AspectRatio;
  label: string;
  name: string;
  useCase: string;
  width: number;
  height: number;
}

const ASPECT_RATIO_DATA: AspectRatioOption[] = [
  {
    id: "16:9",
    label: "16:9",
    name: "Landscape",
    useCase: "YouTube, Desktop, Cinema",
    width: 22,
    height: 12,
  },
  {
    id: "9:16",
    label: "9:16",
    name: "Portrait",
    useCase: "TikTok, Reels, Shorts",
    width: 12,
    height: 22,
  },
  {
    id: "1:1",
    label: "1:1",
    name: "Square",
    useCase: "Instagram, Avatars, Posts",
    width: 16,
    height: 16,
  },
  {
    id: "4:3",
    label: "4:3",
    name: "Standard",
    useCase: "Classic TV, Photography",
    width: 18,
    height: 14,
  },
  {
    id: "21:9",
    label: "21:9",
    name: "Ultrawide",
    useCase: "Cinematic Panoramic",
    width: 24,
    height: 10,
  },
];

interface DurationOption {
  id: Duration;
  label: string;
  badge: string;
  description: string;
}

const DURATION_DATA: DurationOption[] = [
  {
    id: "2s",
    label: "2 Seconds",
    badge: "Fast Preview",
    description: "Rapid motion draft & quick preview",
  },
  {
    id: "5s",
    label: "5 Seconds",
    badge: "Standard",
    description: "Optimal balance of motion & render time",
  },
  {
    id: "10s",
    label: "10 Seconds",
    badge: "Extended",
    description: "Continuous fluid scene sequence",
  },
  {
    id: "15s",
    label: "15 Seconds",
    badge: "Cinematic",
    description: "Full dramatic camera progression",
  },
  {
    id: "30s",
    label: "30 Seconds",
    badge: "Max Studio",
    description: "Maximum single-clip limit allowed on Zyka AI",
  },
];

interface QualityOption {
  id: string;
  label: string;
  badge: string;
  description: string;
}

const QUALITY_DATA: QualityOption[] = [
  {
    id: "High Quality",
    label: "High Quality",
    badge: "Recommended",
    description: "Crisp 4K textures with balanced render speed",
  },
  {
    id: "Ultra Photoreal",
    label: "Ultra Photoreal",
    badge: "Studio Pro",
    description: "Maximum 8K micro-details & ray-traced lighting",
  },
  {
    id: "Standard",
    label: "Standard",
    badge: "Fast Render",
    description: "Optimized generation speed for prompt brainstorming",
  },
];

export function PromptForm({
  onSubmit,
  isLoading,
  cooldownSeconds = 0,
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
  const [openDropdown, setOpenDropdown] = useState<"model" | "ratio" | "quality" | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const lastSubmitRef = useRef(0);

  const trimmed = prompt.trim();
  const wordCount = trimmed ? trimmed.split(/\s+/).length : 0;
  const isOverLimit = wordCount > 1000;

  // Click outside and Escape key handler
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpenDropdown(null);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpenDropdown(null);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  const handleMediaTypeChange = (type: MediaType) => {
    setSelectedMediaType(type);
    setOpenDropdown(null);
    setModel("Auto (Best model)");
  };

  const handleSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const now = Date.now();
    // Prevent double submissions: block calls within 800ms
    if (!trimmed || isLoading || now - lastSubmitRef.current < 800) return;
    lastSubmitRef.current = now;
    setOpenDropdown(null);

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

  const currentModelOptions = MODEL_DATA[selectedMediaType] || MODEL_DATA.image;

  return (
    <form onSubmit={handleSubmit} className="w-full">
      {/* Container matching user's reference mockup */}
      <div
        ref={containerRef}
        className="relative bg-white border border-slate-200/90 rounded-[28px] p-4 sm:p-5 shadow-md shadow-slate-200/50 transition-all"
      >
        {/* Top Row: Service Mode Tabs (Image, Video, Voice) */}
        <div className="flex items-center space-x-2 pb-3 border-b border-slate-100/80">
          <button
            type="button"
            disabled={isLoading}
            onClick={() => handleMediaTypeChange("image")}
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
            onClick={() => handleMediaTypeChange("video")}
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
            onClick={() => handleMediaTypeChange("voice")}
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
            {/* 1. MODEL SELECTOR PILL */}
            <div className="relative">
              <button
                type="button"
                disabled={isLoading}
                onClick={() =>
                  setOpenDropdown(openDropdown === "model" ? null : "model")
                }
                className={cn(
                  "inline-flex items-center rounded-full px-3.5 py-1.5 text-xs font-medium transition-all cursor-pointer group shadow-2xs",
                  openDropdown === "model"
                    ? "bg-pink-50/80 border border-pink-400 text-pink-900 ring-2 ring-pink-500/20"
                    : "bg-white border border-slate-200 hover:border-slate-300 text-slate-700 hover:bg-slate-50/60"
                )}
              >
                <SlidersHorizontal
                  className={cn(
                    "w-3.5 h-3.5 mr-1.5 transition-colors",
                    openDropdown === "model"
                      ? "text-pink-600"
                      : "text-slate-500 group-hover:text-slate-700"
                  )}
                />
                <span className="font-semibold">{model}</span>
                <ChevronDown
                  className={cn(
                    "w-3 h-3 ml-1.5 transition-transform duration-200",
                    openDropdown === "model"
                      ? "rotate-180 text-pink-600"
                      : "text-slate-400 group-hover:text-slate-600"
                  )}
                />
              </button>

              {/* Model Selector Dropdown Popover */}
              <AnimatePresence>
                {openDropdown === "model" && (
                  <motion.div
                    initial={{ opacity: 0, y: 8, scale: 0.98 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 4, scale: 0.98 }}
                    transition={{ duration: 0.16, ease: "easeOut" }}
                    className="absolute top-full mt-2 left-0 z-50 w-76 sm:w-84 max-w-[calc(100vw-2rem)] bg-white/98 backdrop-blur-md border border-slate-200/90 rounded-2xl shadow-xl shadow-slate-900/10 p-2 text-slate-800"
                  >
                    <div className="px-2.5 py-1.5 border-b border-slate-100 flex items-center justify-between text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                      <span className="flex items-center gap-1.5 text-slate-600">
                        <Layers className="w-3.5 h-3.5 text-pink-600" />
                        AI Generation Engine
                      </span>
                      <span className="text-[10px] font-mono text-pink-600 font-bold bg-pink-50 px-1.5 py-0.2 rounded">
                        {selectedMediaType.toUpperCase()}
                      </span>
                    </div>

                    <div className="mt-1.5 max-h-72 overflow-y-auto space-y-1 pr-0.5">
                      {currentModelOptions.map((opt) => {
                        const isSelected = model === opt.id;
                        return (
                          <button
                            key={opt.id}
                            type="button"
                            onClick={() => {
                              setModel(opt.id);
                              setOpenDropdown(null);
                            }}
                            className={cn(
                              "w-full text-left p-2.5 rounded-xl transition-all flex items-start justify-between gap-3 group cursor-pointer",
                              isSelected
                                ? "bg-pink-50/90 text-pink-950 border border-pink-200/80 shadow-2xs"
                                : "hover:bg-slate-50 text-slate-700 border border-transparent"
                            )}
                          >
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <span
                                  className={cn(
                                    "text-xs font-semibold truncate",
                                    isSelected ? "text-pink-950" : "text-slate-800"
                                  )}
                                >
                                  {opt.name}
                                </span>
                                <span
                                  className={cn(
                                    "text-[10px] font-medium px-1.5 py-0.5 rounded-md shrink-0",
                                    isSelected
                                      ? "bg-pink-200/70 text-pink-800 font-bold"
                                      : opt.isPopular
                                      ? "bg-pink-50 text-pink-700 border border-pink-200/60 font-semibold"
                                      : "bg-slate-100 text-slate-500"
                                  )}
                                >
                                  {opt.badge}
                                </span>
                              </div>
                              <p className="text-[11px] text-slate-500 mt-0.5 leading-snug line-clamp-1">
                                {opt.description}
                              </p>
                            </div>
                            {isSelected && (
                              <Check className="w-4 h-4 text-pink-600 shrink-0 mt-0.5" />
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* 2. ASPECT RATIO SELECTOR PILL (Hidden for Voice) */}
            {selectedMediaType !== "voice" && (
              <div className="relative">
                <button
                  type="button"
                  disabled={isLoading}
                  onClick={() =>
                    setOpenDropdown(openDropdown === "ratio" ? null : "ratio")
                  }
                  className={cn(
                    "inline-flex items-center rounded-full px-3.5 py-1.5 text-xs font-medium transition-all cursor-pointer group shadow-2xs",
                    openDropdown === "ratio"
                      ? "bg-pink-50/80 border border-pink-400 text-pink-900 ring-2 ring-pink-500/20"
                      : "bg-white border border-slate-200 hover:border-slate-300 text-slate-700 hover:bg-slate-50/60"
                  )}
                >
                  <Ratio
                    className={cn(
                      "w-3.5 h-3.5 mr-1.5 transition-colors",
                      openDropdown === "ratio"
                        ? "text-pink-600"
                        : "text-slate-500 group-hover:text-slate-700"
                    )}
                  />
                  <span className="font-semibold font-mono">{aspectRatio}</span>
                  <ChevronDown
                    className={cn(
                      "w-3 h-3 ml-1.5 transition-transform duration-200",
                      openDropdown === "ratio"
                        ? "rotate-180 text-pink-600"
                        : "text-slate-400 group-hover:text-slate-600"
                    )}
                  />
                </button>

                {/* Aspect Ratio Dropdown Popover */}
                <AnimatePresence>
                  {openDropdown === "ratio" && (
                    <motion.div
                      initial={{ opacity: 0, y: 8, scale: 0.98 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: 4, scale: 0.98 }}
                      transition={{ duration: 0.16, ease: "easeOut" }}
                      className="absolute top-full mt-2 left-0 z-50 w-72 sm:w-80 max-w-[calc(100vw-2rem)] bg-white/98 backdrop-blur-md border border-slate-200/90 rounded-2xl shadow-xl shadow-slate-900/10 p-2 text-slate-800"
                    >
                      <div className="px-2.5 py-1.5 border-b border-slate-100 flex items-center justify-between text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                        <span className="flex items-center gap-1.5 text-slate-600">
                          <Ratio className="w-3.5 h-3.5 text-pink-600" />
                          Canvas Aspect Ratio
                        </span>
                        <span className="text-[10px] font-mono text-slate-500">
                          Standard Formats
                        </span>
                      </div>

                      <div className="mt-1.5 space-y-1">
                        {ASPECT_RATIO_DATA.map((opt) => {
                          const isSelected = aspectRatio === opt.id;
                          return (
                            <button
                              key={opt.id}
                              type="button"
                              onClick={() => {
                                setAspectRatio(opt.id);
                                setOpenDropdown(null);
                              }}
                              className={cn(
                                "w-full text-left p-2.5 rounded-xl transition-all flex items-center justify-between gap-3 group cursor-pointer",
                                isSelected
                                  ? "bg-pink-50/90 text-pink-950 border border-pink-200/80 shadow-2xs"
                                  : "hover:bg-slate-50 text-slate-700 border border-transparent"
                              )}
                            >
                              <div className="flex items-center gap-3">
                                <div className="w-8 h-8 rounded-lg bg-slate-100/90 flex items-center justify-center shrink-0 border border-slate-200/60">
                                  <div
                                    style={{
                                      width: `${opt.width}px`,
                                      height: `${opt.height}px`,
                                    }}
                                    className={cn(
                                      "rounded-[2px] border-2 transition-all shrink-0",
                                      isSelected
                                        ? "border-pink-600 bg-pink-100/70"
                                        : "border-slate-400 bg-slate-200/60 group-hover:border-slate-600"
                                    )}
                                  />
                                </div>
                                <div>
                                  <div className="flex items-center gap-2">
                                    <span
                                      className={cn(
                                        "text-xs font-bold font-mono",
                                        isSelected ? "text-pink-950" : "text-slate-800"
                                      )}
                                    >
                                      {opt.label}
                                    </span>
                                    <span className="text-xs text-slate-600 font-medium">
                                      {opt.name}
                                    </span>
                                  </div>
                                  <p className="text-[10px] text-slate-400 mt-0.5">
                                    {opt.useCase}
                                  </p>
                                </div>
                              </div>
                              {isSelected && (
                                <Check className="w-4 h-4 text-pink-600 shrink-0" />
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            )}

            {/* 3. DURATION / QUALITY SELECTOR PILL */}
            <div className="relative">
              <button
                type="button"
                disabled={isLoading}
                onClick={() =>
                  setOpenDropdown(openDropdown === "quality" ? null : "quality")
                }
                className={cn(
                  "inline-flex items-center rounded-full px-3.5 py-1.5 text-xs font-medium transition-all cursor-pointer group shadow-2xs",
                  openDropdown === "quality"
                    ? "bg-pink-50/80 border border-pink-400 text-pink-900 ring-2 ring-pink-500/20"
                    : "bg-white border border-slate-200 hover:border-slate-300 text-slate-700 hover:bg-slate-50/60"
                )}
              >
                {selectedMediaType === "video" ? (
                  <Clock
                    className={cn(
                      "w-3.5 h-3.5 mr-1.5 transition-colors",
                      openDropdown === "quality"
                        ? "text-pink-600"
                        : "text-slate-500 group-hover:text-slate-700"
                    )}
                  />
                ) : (
                  <Star
                    className={cn(
                      "w-3.5 h-3.5 mr-1.5 transition-colors",
                      openDropdown === "quality"
                        ? "text-pink-600"
                        : "text-slate-500 group-hover:text-slate-700"
                    )}
                  />
                )}
                <span className="font-semibold">
                  {selectedMediaType === "video" ? `${duration} Duration` : quality}
                </span>
                <ChevronDown
                  className={cn(
                    "w-3 h-3 ml-1.5 transition-transform duration-200",
                    openDropdown === "quality"
                      ? "rotate-180 text-pink-600"
                      : "text-slate-400 group-hover:text-slate-600"
                  )}
                />
              </button>

              {/* Quality / Duration Dropdown Popover */}
              <AnimatePresence>
                {openDropdown === "quality" && (
                  <motion.div
                    initial={{ opacity: 0, y: 8, scale: 0.98 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 4, scale: 0.98 }}
                    transition={{ duration: 0.16, ease: "easeOut" }}
                    className="absolute top-full mt-2 left-0 sm:left-auto sm:right-0 z-50 w-72 sm:w-80 max-w-[calc(100vw-2rem)] bg-white/98 backdrop-blur-md border border-slate-200/90 rounded-2xl shadow-xl shadow-slate-900/10 p-2 text-slate-800"
                  >
                    {selectedMediaType === "video" ? (
                      <>
                        <div className="px-2.5 py-1.5 border-b border-slate-100 flex items-center justify-between text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                          <span className="flex items-center gap-1.5 text-slate-600">
                            <Clock className="w-3.5 h-3.5 text-pink-600" />
                            Video Clip Duration
                          </span>
                          <span className="text-[10px] font-mono text-pink-600 font-bold bg-pink-50 px-1.5 py-0.2 rounded">
                            MAX 30S
                          </span>
                        </div>

                        <div className="mt-1.5 space-y-1">
                          {DURATION_DATA.map((opt) => {
                            const isSelected = duration === opt.id;
                            return (
                              <button
                                key={opt.id}
                                type="button"
                                onClick={() => {
                                  setDuration(opt.id);
                                  setOpenDropdown(null);
                                }}
                                className={cn(
                                  "w-full text-left p-2.5 rounded-xl transition-all flex items-center justify-between gap-3 group cursor-pointer",
                                  isSelected
                                    ? "bg-pink-50/90 text-pink-950 border border-pink-200/80 shadow-2xs"
                                    : "hover:bg-slate-50 text-slate-700 border border-transparent"
                                )}
                              >
                                <div className="flex items-center gap-3">
                                  <div
                                    className={cn(
                                      "w-8 h-8 rounded-lg flex items-center justify-center font-mono font-bold text-xs shrink-0 border",
                                      isSelected
                                        ? "bg-pink-200/90 text-pink-900 border-pink-300"
                                        : "bg-slate-100 text-slate-700 border-slate-200/60"
                                    )}
                                  >
                                    {opt.id}
                                  </div>
                                  <div>
                                    <div className="flex items-center gap-2">
                                      <span
                                        className={cn(
                                          "text-xs font-semibold",
                                          isSelected ? "text-pink-950" : "text-slate-800"
                                        )}
                                      >
                                        {opt.label}
                                      </span>
                                      <span
                                        className={cn(
                                          "text-[10px] font-medium px-1.5 py-0.5 rounded-md",
                                          isSelected
                                            ? "bg-pink-200/70 text-pink-800 font-bold"
                                            : "bg-slate-100 text-slate-500"
                                        )}
                                      >
                                        {opt.badge}
                                      </span>
                                    </div>
                                    <p className="text-[11px] text-slate-500 mt-0.5">
                                      {opt.description}
                                    </p>
                                  </div>
                                </div>
                                {isSelected && (
                                  <Check className="w-4 h-4 text-pink-600 shrink-0" />
                                )}
                              </button>
                            );
                          })}
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="px-2.5 py-1.5 border-b border-slate-100 flex items-center justify-between text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                          <span className="flex items-center gap-1.5 text-slate-600">
                            <Star className="w-3.5 h-3.5 text-pink-600" />
                            Rendering Quality Preset
                          </span>
                          <span className="text-[10px] font-mono text-slate-500">
                            Resolution
                          </span>
                        </div>

                        <div className="mt-1.5 space-y-1">
                          {QUALITY_DATA.map((opt) => {
                            const isSelected = quality === opt.id;
                            return (
                              <button
                                key={opt.id}
                                type="button"
                                onClick={() => {
                                  setQuality(opt.id);
                                  setOpenDropdown(null);
                                }}
                                className={cn(
                                  "w-full text-left p-2.5 rounded-xl transition-all flex items-center justify-between gap-3 group cursor-pointer",
                                  isSelected
                                    ? "bg-pink-50/90 text-pink-950 border border-pink-200/80 shadow-2xs"
                                    : "hover:bg-slate-50 text-slate-700 border border-transparent"
                                )}
                              >
                                <div>
                                  <div className="flex items-center gap-2">
                                    <span
                                      className={cn(
                                        "text-xs font-semibold",
                                        isSelected ? "text-pink-950" : "text-slate-800"
                                      )}
                                    >
                                      {opt.label}
                                    </span>
                                    <span
                                      className={cn(
                                        "text-[10px] font-medium px-1.5 py-0.5 rounded-md",
                                        isSelected
                                          ? "bg-pink-200/70 text-pink-800 font-bold"
                                          : "bg-slate-100 text-slate-500"
                                      )}
                                    >
                                      {opt.badge}
                                    </span>
                                  </div>
                                  <p className="text-[11px] text-slate-500 mt-0.5">
                                    {opt.description}
                                  </p>
                                </div>
                                {isSelected && (
                                  <Check className="w-4 h-4 text-pink-600 shrink-0" />
                                )}
                              </button>
                            );
                          })}
                        </div>
                      </>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>

          {/* Right Action Button: Pink/Fuchsia Pill matching mockup */}
          <button
            type="submit"
            disabled={isLoading || !trimmed || cooldownSeconds > 0}
            className={cn(
              "flex items-center space-x-1.5 px-6 py-2.5 rounded-full text-xs sm:text-sm font-semibold transition-all shadow-md",
              isLoading || !trimmed || cooldownSeconds > 0
                ? "bg-slate-200 text-slate-400 cursor-not-allowed shadow-none"
                : "bg-gradient-to-r from-[#db2777] to-[#e11d48] hover:from-[#be185d] hover:to-[#be123c] text-white shadow-pink-500/25 active:scale-98 cursor-pointer"
            )}
          >
            <Sparkles className="w-4 h-4" />
            <span>
              {isLoading
                ? "Generating..."
                : cooldownSeconds > 0
                ? `Wait ${cooldownSeconds}s`
                : "Generate"}
            </span>
            <ArrowRight className="w-4 h-4 ml-0.5" />
          </button>
        </div>
      </div>
    </form>
  );
}
