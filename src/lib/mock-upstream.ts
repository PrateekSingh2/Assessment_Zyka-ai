import type { MediaType, AspectRatio, Duration } from "../types/index.ts";

export interface MockUpstreamResult {
  status: number;
  headers: Record<string, string>;
  data?: {
    mediaType: MediaType;
    mediaUrl: string;
    duration?: Duration;
    aspectRatio?: AspectRatio;
    resolution?: string;
    model?: string;
    quality?: string;
    prompt: string;
  };
  error?: {
    code: string;
    technicalMessage: string;
    upstreamService: string;
    traceId: string;
    metadata?: Record<string, unknown>;
  };
}

export async function executeMockUpstreamAI(params: {
  prompt: string;
  mediaType: MediaType;
  duration?: Duration;
  aspectRatio?: AspectRatio;
  model?: string;
  quality?: string;
  requestHeaders: Record<string, string>;
}): Promise<MockUpstreamResult> {
  // Simulate realistic network latency
  await new Promise((resolve) => setTimeout(resolve, 700));

  const { prompt, mediaType, duration, aspectRatio, model, quality } = params;
  const traceId = `trace-${globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : Math.random().toString(36).substring(2, 10)}`;
  const trimmed = prompt.trim();
  const normalizedType = mediaType === "voice" || mediaType === "audio" ? "voice" : mediaType;

  // 1. Edge Case: Empty Prompt
  if (!trimmed) {
    return {
      status: 400,
      headers: {
        "x-upstream-error-code": "ERR_EMPTY_PROMPT",
        "x-upstream-raw-error": `[ERROR] InvalidPayloadException: Token buffer array contains null or whitespace sequence at offset 0.\nCode: 0x00A - Required field 'prompt' has 0 valid tokens.\nStack: at request_parser.cpp:45 in edge_ingest_worker_4\nTraceID: ${traceId}`,
        "x-upstream-service": "Zyka-Prompt-Ingest-Engine",
        "x-upstream-trace-id": traceId,
      },
      error: {
        code: "ERR_EMPTY_PROMPT",
        technicalMessage: `[ERROR] InvalidPayloadException: Token buffer array contains null or whitespace sequence at offset 0.\nCode: 0x00A - Required field 'prompt' has 0 valid tokens.\nStack: at request_parser.cpp:45 in edge_ingest_worker_4\nTraceID: ${traceId}`,
        upstreamService: "Zyka-Prompt-Ingest-Engine",
        traceId,
      },
    };
  }

  // 2. Edge Case: Word Count > 1000 words  (MUST be checked before safety to maintain priority order)
  const words = trimmed.split(/\s+/);
  const wordCount = words.length;
  if (wordCount > 1000) {
    return {
      status: 400,
      headers: {
        "x-upstream-error-code": "ERR_MAX_TOKEN_LIMIT_EXCEEDED",
        "x-upstream-raw-error": `[FATAL] UpstreamContextOverflowException: Tokenizer buffer allocation exceeded at tensor_core.cpp:812.\nCode: 0x8F92 - Upstream context window limit breached. Detected ${wordCount} words, exceeding maximum allocation of 1000 words.\nWorker: worker-gpu-node-us-east-1a [GPU-A100-SXM4]\nTraceID: ${traceId}`,
        "x-upstream-service": "Zyka-LLM-Transformer-Core-v4",
        "x-upstream-trace-id": traceId,
      },
      error: {
        code: "ERR_MAX_TOKEN_LIMIT_EXCEEDED",
        technicalMessage: `[FATAL] UpstreamContextOverflowException: Tokenizer buffer allocation exceeded at tensor_core.cpp:812.\nCode: 0x8F92 - Upstream context window limit breached. Detected ${wordCount} words, exceeding maximum allocation of 1000 words.\nWorker: worker-gpu-node-us-east-1a [GPU-A100-SXM4]\nTraceID: ${traceId}`,
        upstreamService: "Zyka-LLM-Transformer-Core-v4",
        traceId,
      },
    };
  }

  // 3. Edge Case: Safety / Policy Violation
  const safetyRegex = /\b(nsfw|nude|deepfake|bypass moderation|jailbreak)\b/i;
  if (safetyRegex.test(trimmed)) {
    return {
      status: 400,
      headers: {
        "x-upstream-error-code": "ERR_SAFETY_POLICY_VIOLATION",
        "x-upstream-raw-error": `[FATAL] SafetyGuardrailException: Prompt failed multi-class safety filter classifier at safety_worker.py:204.\nCode: 0x51A - RESTRICTED_CONTENT_DETECTED in creative input.\nTraceID: ${traceId}`,
        "x-upstream-service": "Zyka-Safety-Guardrail-Filter",
        "x-upstream-trace-id": traceId,
      },
      error: {
        code: "ERR_SAFETY_POLICY_VIOLATION",
        technicalMessage: `[FATAL] SafetyGuardrailException: Prompt failed multi-class safety filter classifier at safety_worker.py:204.\nCode: 0x51A - RESTRICTED_CONTENT_DETECTED in creative input.\nTraceID: ${traceId}`,
        upstreamService: "Zyka-Safety-Guardrail-Filter",
        traceId,
      },
    };
  }

  // 4. Edge Case: Service Mismatch (Still Image requested while in Video tab)
  // FIX: exclude "video game" compound noun from the video-keyword exclusion list
  const isAskingForStillImage =
    /\b(generate\s+(an?\s+)?(image|photo|picture|illustration|sketch|logo|portrait|avatar)|create\s+(an?\s+)?(image|still\s+image|photo|picture|wallpaper|drawing|illustration|sketch|logo|portrait|avatar)|still\s+(image|photo)|static\s+(image|photo)|high-res\s+wallpaper|photo\s+wallpaper)\b/i.test(
      trimmed
    ) &&
    !/\b(video(?!\s+game)\b|movie|animation|clip|motion|footage)\b/i.test(trimmed);

  if (normalizedType === "video" && isAskingForStillImage) {
    return {
      status: 422,
      headers: {
        "x-upstream-error-code": "ERR_SERVICE_MISMATCH_IMAGE_IN_VIDEO",
        "x-upstream-raw-error": `[ERROR] VideoRenderPipeline::InvalidModalityException: Static image prompt dispatched to temporal video synthesis pipeline.\nCode: 0x3F8 - Received 2D static frame prompt in Video Engine. Temporal attention requires dynamic motion vectors.\nWorker: node-video-sora-04\nTraceID: ${traceId}`,
        "x-upstream-service": "Zyka-Video-Diffusion-Gateway",
        "x-upstream-trace-id": traceId,
      },
      error: {
        code: "ERR_SERVICE_MISMATCH_IMAGE_IN_VIDEO",
        technicalMessage: `[ERROR] VideoRenderPipeline::InvalidModalityException: Static image prompt dispatched to temporal video synthesis pipeline.\nCode: 0x3F8 - Received 2D static frame prompt in Video Engine. Temporal attention requires dynamic motion vectors.\nWorker: node-video-sora-04\nTraceID: ${traceId}`,
        upstreamService: "Zyka-Video-Diffusion-Gateway",
        traceId,
      },
    };
  }

  // 5. Edge Case: Service Mismatch (Video requested while in Image tab)
  // FIX: exclude "video game" compound noun from triggering this check
  const isAskingForVideo =
    /\b((?:generate|make|create)\s+(?:an?\s+)?(?:\d+[\s-]*(?:second|sec|s)\s+)?video(?!\s+game)\b|\b(?:\d+[\s-]*(?:second|sec|s)\s+)?video(?!\s+game)\b|video clip|animated clip|movie scene|flying over|motion clip|drone footage|camera pan|moving video)\b/i.test(
      trimmed
    );

  if (normalizedType === "image" && isAskingForVideo) {
    return {
      status: 422,
      headers: {
        "x-upstream-error-code": "ERR_SERVICE_MISMATCH_VIDEO_IN_IMAGE",
        "x-upstream-raw-error": `[ERROR] RasterDiffusionException::TemporalMotionConstraintException: Dynamic sequence tokens detected in static 2D latent space.\nCode: 0x3F9 - Received video/motion prompt in 2D Image Generator. Motion dynamics cannot be encoded into static PNG.\nWorker: node-image-flux-01\nTraceID: ${traceId}`,
        "x-upstream-service": "Zyka-Image-Diffusion-Gateway",
        "x-upstream-trace-id": traceId,
      },
      error: {
        code: "ERR_SERVICE_MISMATCH_VIDEO_IN_IMAGE",
        technicalMessage: `[ERROR] RasterDiffusionException::TemporalMotionConstraintException: Dynamic sequence tokens detected in static 2D latent space.\nCode: 0x3F9 - Received video/motion prompt in 2D Image Generator. Motion dynamics cannot be encoded into static PNG.\nWorker: node-image-flux-01\nTraceID: ${traceId}`,
        upstreamService: "Zyka-Image-Diffusion-Gateway",
        traceId,
      },
    };
  }

  // 6. Edge Case: Service Mismatch in Voice tab (only if prompt directs visual generation)
  const isAskingForVisualInVoice =
    /\b(?:generate|create|render|make|draw|design)\s+(?:an?\s+)?(?:[a-z0-9_-]+\s+){0,3}(?:photo|picture|image|video|wallpaper|drawing|animation|sketch|portrait|illustration)\b/i.test(
      trimmed
    );
  if (normalizedType === "voice" && isAskingForVisualInVoice) {
    return {
      status: 422,
      headers: {
        "x-upstream-error-code": "ERR_SERVICE_MISMATCH_VOICE",
        "x-upstream-raw-error": `[ERROR] AcousticSpectralSynthesizerException: VisualPromptInAcousticPipeline: 2D spatial visual prompt sent to acoustic text-to-speech model.\nCode: 0x3FA - Acoustic vocoder requires spoken dialogue or voiceover script.\nTraceID: ${traceId}`,
        "x-upstream-service": "Zyka-Voice-Synthesis-Engine",
        "x-upstream-trace-id": traceId,
      },
      error: {
        code: "ERR_SERVICE_MISMATCH_VOICE",
        technicalMessage: `[ERROR] AcousticSpectralSynthesizerException: VisualPromptInAcousticPipeline: 2D spatial visual prompt sent to acoustic text-to-speech model.\nCode: 0x3FA - Acoustic vocoder requires spoken dialogue or voiceover script.\nTraceID: ${traceId}`,
        upstreamService: "Zyka-Voice-Synthesis-Engine",
        traceId,
      },
    };
  }

  // 7. Edge Case: Duration Limits & Dropdown Conflict (Video Only)
  // FIX (N4): Duration limits (max 30s) strictly apply ONLY to Video generation.
  // Image and Voice prompts (e.g. "5 minute photo", "80s synthwave", "ready in 5 minutes")
  // must never be rejected by video temporal bounds.
  if (normalizedType === "video") {
    // Exclude places ("24 hour diner") and decades ("80s", "90s")
    const isPlaceOrDecade = /\b(?:24\s*hours?\s*(?:diner|cafe|store|open|service|fitness|restaurant|market)|\d0s\b)/i.test(trimmed);

    if (!isPlaceOrDecade) {
      const allDurationMatches = [
        ...trimmed.matchAll(/(?<![\d:])(\d{1,3})[\s-]*(seconds?|secs?|s)\b/gi),
        ...trimmed.matchAll(/(?<![\d:])(\d{1,3})[\s-]*(minutes?|mins?|hours?|hrs?)\b/gi),
      ];

      for (const m of allDurationMatches) {
        const val = parseInt(m[1], 10);
        const unitRaw = (m[2] ?? "s").toLowerCase();
        const isMinuteOrHour =
          unitRaw.startsWith("min") ||
          unitRaw.startsWith("hr") ||
          unitRaw.startsWith("hour");
        const isSeconds = unitRaw.startsWith("sec") || unitRaw === "s";
        const isOver30s = isMinuteOrHour || (isSeconds && val > 30);

        if (isOver30s) {
          return {
            status: 422,
            headers: {
              "x-upstream-error-code": "ERR_DURATION_OUT_OF_BOUNDS",
              "x-upstream-service": "Zyka-Temporal-Diffusion-Renderer",
              "x-upstream-trace-id": traceId,
            },
            error: {
              code: "ERR_DURATION_OUT_OF_BOUNDS",
              technicalMessage: `[ERROR] VideoPipelineException: TemporalSequenceBoundsExceeded. Requested duration exceeds max 30s.\nTraceID: ${traceId}`,
              upstreamService: "Zyka-Temporal-Diffusion-Renderer",
              traceId,
            },
          };
        }

        // Subcase: Duration conflict with dropdown (e.g., prompt says 10s but dropdown is 5s)
        if (isSeconds) {
          const promptDuration = `${val}s` as Duration;
          if (
            ["2s", "5s", "10s", "15s", "30s"].includes(promptDuration) &&
            duration &&
            promptDuration !== duration
          ) {
            return {
              status: 422,
              headers: {
                "x-upstream-error-code": "ERR_DURATION_DROPDOWN_CONFLICT",
                "x-upstream-service": "Zyka-Temporal-Diffusion-Renderer",
                "x-upstream-trace-id": traceId,
                "x-conflicting-prompt-duration": promptDuration,
                "x-selected-dropdown-duration": duration,
              },
              error: {
                code: "ERR_DURATION_DROPDOWN_CONFLICT",
                technicalMessage: `[ERROR] TemporalBudgetMismatch: header '${duration}' vs prompt '${promptDuration}'.\nTraceID: ${traceId}`,
                upstreamService: "Zyka-Temporal-Diffusion-Renderer",
                traceId,
                metadata: {
                  conflictingDuration: promptDuration,
                  selectedDuration: duration,
                },
              },
            };
          }
        }
      }
    }
  }

  // 8. Edge Case: Generic Aspect Ratio Detection & Mismatch in Prompt
  const supportedRatios: AspectRatio[] = ["16:9", "9:16", "1:1", "4:3", "21:9"];

  // Match explicit aspect ratio context keywords prefix (e.g. "aspect ratio 9:16", "format 16:9", "ratio: 17:8")
  const RATIO_PREFIX_RE = /(?:aspect\s*ratio|ratio|format|widescreen|letterbox|portrait\s*mode|landscape\s*mode)\s*[:\-]?\s*(\d{1,4}:\d{1,4})/i;
  // Match postfix context (e.g. "17:8 aspect ratio", "16:9 ratio", "1:1 format")
  const RATIO_POSTFIX_RE = /(\d{1,4}:\d{1,4})\s*(?:aspect\s*ratio|ratio|format|frame|resolution)/i;
  // Match explicit visual ratio (e.g. "image 17:8", "image in 17:8", "100:100 square image")
  const EXPLICIT_VISUAL_RE = /(?:(?:image|photo|video|frame|render|canvas|resolution)\s+(?:in\s+)?(\d{1,4}:\d{1,4})|(\d{1,4}:\d{1,4})\s+(?:square|widescreen|portrait|landscape|cinematic))/i;
  // Match standard supported ratios mentioned standalone (e.g. "image in 16:9", "create a 9:16 vertical video")
  const STANDALONE_SUPPORTED_RE = /\b(16:9|9:16|1:1|4:3|21:9)\b/i;

  let extractedRatio: string | null = null;
  const prefixMatch = RATIO_PREFIX_RE.exec(trimmed);
  const postfixMatch = RATIO_POSTFIX_RE.exec(trimmed);
  const visualMatch = EXPLICIT_VISUAL_RE.exec(trimmed);

  if (prefixMatch) {
    extractedRatio = prefixMatch[1] ?? null;
  } else if (postfixMatch) {
    extractedRatio = postfixMatch[1] ?? null;
  } else if (visualMatch) {
    extractedRatio = visualMatch[1] || visualMatch[2] || null;
  } else {
    // Check if prompt specifies a supported ratio standalone without clock context
    const isClockTime = /\b(?:clock|time|showing|watch|timer|at)\s+\d{1,2}:\d{2}\b/i.test(trimmed) || /\b\d{1,2}:\d{2}\s*(?:am|pm)\b/i.test(trimmed);
    const supportedMatch = STANDALONE_SUPPORTED_RE.exec(trimmed);
    if (supportedMatch && !isClockTime) {
      extractedRatio = supportedMatch[1] ?? null;
    }
  }

  if (extractedRatio && normalizedType !== "voice") {

    // Subcase 8A: Ratio is completely unsupported by Zyka AI (like 17:8, 32:9, 2:1, 5:4)
    if (!supportedRatios.includes(extractedRatio as AspectRatio)) {
      return {
        status: 422,
        headers: {
          "x-upstream-error-code": "ERR_UNSUPPORTED_ASPECT_RATIO_IN_PROMPT",
          "x-upstream-raw-error": `[ERROR] GeometryMatrixException: SpatialTensorDimensionMismatch at spatial_rescaler.cpp:189.\nCode: 0x2B9 - Requested aspect ratio '${extractedRatio}' does not conform to supported tensor enum matrix [1:1, 16:9, 9:16, 4:3, 21:9]. Stride calculation failed at dimension offset 0.\nTraceID: ${traceId}`,
          "x-upstream-service": "Zyka-Spatial-Geometry-Rescaler",
          "x-upstream-trace-id": traceId,
          "x-invalid-ratio": extractedRatio,
        },
        error: {
          code: "ERR_UNSUPPORTED_ASPECT_RATIO_IN_PROMPT",
          technicalMessage: `[ERROR] GeometryMatrixException: SpatialTensorDimensionMismatch at spatial_rescaler.cpp:189.\nCode: 0x2B9 - Requested aspect ratio '${extractedRatio}' does not conform to supported tensor enum matrix [1:1, 16:9, 9:16, 4:3, 21:9]. Stride calculation failed at dimension offset 0.\nTraceID: ${traceId}`,
          upstreamService: "Zyka-Spatial-Geometry-Rescaler",
          traceId,
          metadata: {
            invalidRatio: extractedRatio,
          },
        },
      };
    }

    // Subcase 8B: Ratio is supported (e.g. 9:16), but conflicts with the dropdown selector (e.g. 16:9)
    if (aspectRatio && extractedRatio !== aspectRatio) {
      return {
        status: 422,
        headers: {
          "x-upstream-error-code": "ERR_ASPECT_RATIO_DROPDOWN_CONFLICT",
          "x-upstream-raw-error": `[ERROR] ParameterConflictException: Mismatch between ingress parameter 'x-zyka-aspect-ratio' (${aspectRatio}) and prompt semantic ratio constraint '${extractedRatio}'. Pipeline halted to prevent composition distortion.\nTraceID: ${traceId}`,
          "x-upstream-service": "Zyka-Parameter-Validator",
          "x-upstream-trace-id": traceId,
          "x-conflicting-prompt-ratio": extractedRatio,
          "x-selected-dropdown-ratio": aspectRatio,
        },
        error: {
          code: "ERR_ASPECT_RATIO_DROPDOWN_CONFLICT",
          technicalMessage: `[ERROR] ParameterConflictException: Mismatch between ingress parameter 'x-zyka-aspect-ratio' (${aspectRatio}) and prompt semantic ratio constraint '${extractedRatio}'. Pipeline halted to prevent composition distortion.\nTraceID: ${traceId}`,
          upstreamService: "Zyka-Parameter-Validator",
          traceId,
          metadata: {
            conflictingRatio: extractedRatio,
            selectedRatio: aspectRatio,
          },
        },
      };
    }
  }

  // 9. Edge Case: Unsupported Format (GIF, Vector SVG, 3D OBJ)
  const formatRegex = /\b(gif|animated gif|svg|vector|vector image|3d obj|3d model|fbx|blend|eps)\b/i;
  if (formatRegex.test(trimmed)) {
    const matchedFormat = trimmed.match(formatRegex)?.[0] || "unsupported";
    return {
      status: 415,
      headers: {
        "x-upstream-error-code": "ERR_UNSUPPORTED_MEDIA_TYPE",
        "x-upstream-raw-error": `[ERROR] CodecNegotiationFailedException in MediaTransmuxer::ValidateTargetFormat\nCode: 0x7E1 - Requested target artifact '${matchedFormat}' is unsupported by media synthesis driver.\nDriver supports only [image/png, video/mp4, audio/wav].\nTraceID: ${traceId}`,
        "x-upstream-service": "Zyka-Media-Codec-Gateway",
        "x-upstream-trace-id": traceId,
      },
      error: {
        code: "ERR_UNSUPPORTED_MEDIA_TYPE",
        technicalMessage: `[ERROR] CodecNegotiationFailedException in MediaTransmuxer::ValidateTargetFormat\nCode: 0x7E1 - Requested target artifact '${matchedFormat}' is unsupported by media synthesis driver.\nDriver supports only [image/png, video/mp4, audio/wav].\nTraceID: ${traceId}`,
        upstreamService: "Zyka-Media-Codec-Gateway",
        traceId,
      },
    };
  }

  // 10. Edge Case: Exorbitant Resolution Limit (8K / 16K)
  const resolutionRegex = /\b(8k|16k|32k|240fps|300dpi|10000x10000)\b/i;
  if (resolutionRegex.test(trimmed)) {
    const matchedRes = trimmed.match(resolutionRegex)?.[0] || "unsupported resolution";
    return {
      status: 422,
      headers: {
        "x-upstream-error-code": "ERR_RESOLUTION_LIMIT_EXCEEDED",
        "x-upstream-raw-error": `[ERROR] HardwareBudgetException: Requested resolution/framerate '${matchedRes}' exceeds maximum GPU framebuffer threshold (4K UHD max).\nWorker: node-gpu-renderer-09\nTraceID: ${traceId}`,
        "x-upstream-service": "Zyka-Render-Budget-Controller",
        "x-upstream-trace-id": traceId,
      },
      error: {
        code: "ERR_RESOLUTION_LIMIT_EXCEEDED",
        technicalMessage: `[ERROR] HardwareBudgetException: Requested resolution/framerate '${matchedRes}' exceeds maximum GPU framebuffer threshold (4K UHD max).\nWorker: node-gpu-renderer-09\nTraceID: ${traceId}`,
        upstreamService: "Zyka-Render-Budget-Controller",
        traceId,
      },
    };
  }

  // SUCCESS CASE: Generate Mock Media according to selected Zyka service
  let mockUrl = "";
  if (normalizedType === "video") {
    mockUrl = "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4";
  } else if (normalizedType === "voice") {
    mockUrl = "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3";
  } else {
    mockUrl = "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?q=80&w=1200&auto=format&fit=crop";
  }

  return {
    status: 200,
    headers: {
      "x-upstream-status": "200 OK",
      "x-upstream-service": `Zyka-${normalizedType.toUpperCase()}-Gateway`,
      "x-upstream-trace-id": traceId,
      "x-model-used": model || "Auto (Best model)",
      "x-quality-profile": quality || "High Quality",
    },
    data: {
      mediaType: normalizedType,
      mediaUrl: mockUrl,
      duration: normalizedType === "image" ? undefined : (duration || "5s"),
      aspectRatio: normalizedType === "voice" ? undefined : (aspectRatio || "16:9"),
      resolution: normalizedType === "voice" ? "Stereo 48kHz" : "1920x1080 (HD)",
      model: model || "Auto (Best model)",
      quality: quality || "High Quality",
      prompt: trimmed,
    },
  };
}
