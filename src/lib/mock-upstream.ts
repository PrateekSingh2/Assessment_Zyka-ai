import { MediaType, AspectRatio, Duration } from "@/types";

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
    metadata?: Record<string, any>;
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
  const isAskingForStillImage =
    /\b(generate\s+(an?\s+)?(image|photo|picture|illustration|sketch|logo|portrait|avatar)|create\s+(an?\s+)?(image|still\s+image|photo|picture|wallpaper|drawing|illustration|sketch|logo|portrait|avatar)|still\s+(image|photo)|static\s+(image|photo)|high-res\s+wallpaper|photo\s+wallpaper)\b/i.test(
      trimmed
    ) && !/\b(video|movie|animation|clip|motion|footage)\b/i.test(trimmed);

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
  const isAskingForVideo =
    /\b((?:generate|make|create)\s+(?:an?\s+)?(?:\d+[\s-]*(?:second|sec|s)\s+)?video|\b(?:\d+[\s-]*(?:second|sec|s)\s+)?video\b|video clip|animated clip|movie scene|flying over|motion clip|drone footage|camera pan|moving video)\b/i.test(
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

  // 6. Edge Case: Service Mismatch in Voice tab
  const isAskingForVisualInVoice =
    /\b(photo|picture|image|video|wallpaper|drawing|animation)\b/i.test(trimmed);
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

  // 7. Edge Case: Duration Limits & Dropdown Conflict (checked BEFORE aspect ratio to ensure correct error priority)
  const durationMatch = trimmed.match(
    /(\b\d+\b)[\s-]*(seconds?|secs?|minutes?|mins?|hours?|hrs?|s\b)/i
  );
  if (durationMatch) {
    const val = parseInt(durationMatch[1], 10);
    const unit = durationMatch[2].toLowerCase();
    const isOver30s =
      (unit.startsWith("sec") && val > 30) ||
      unit.startsWith("min") ||
      unit.startsWith("hr") ||
      (unit === "s" && val > 30);

    if (isOver30s) {
      return {
        status: 422,
        headers: {
          "x-upstream-error-code": "ERR_DURATION_OUT_OF_BOUNDS",
          "x-upstream-raw-error": `[ERROR] VideoPipelineException: TemporalSequenceBoundsExceeded at temporal_encoder.cu:314.\nCode: 0x4D2 - Requested temporal render length (${val} ${unit}) exceeds hard upper-bound threshold (max: 30s).\nEngine: cuda_temporal_attention_v3 on node-tensor-compute-02\nTraceID: ${traceId}`,
          "x-upstream-service": "Zyka-Temporal-Diffusion-Renderer",
          "x-upstream-trace-id": traceId,
        },
        error: {
          code: "ERR_DURATION_OUT_OF_BOUNDS",
          technicalMessage: `[ERROR] VideoPipelineException: TemporalSequenceBoundsExceeded at temporal_encoder.cu:314.\nCode: 0x4D2 - Requested temporal render length (${val} ${unit}) exceeds hard upper-bound threshold (max: 30s).\nEngine: cuda_temporal_attention_v3 on node-tensor-compute-02\nTraceID: ${traceId}`,
          upstreamService: "Zyka-Temporal-Diffusion-Renderer",
          traceId,
        },
      };
    }

    // Subcase: Duration conflict with dropdown (e.g., prompt says 10s, but dropdown is 5s)
    if (normalizedType === "video" && (unit.startsWith("sec") || unit === "s")) {
      const promptDuration = `${val}s` as Duration;
      if (["2s", "5s", "10s", "15s", "30s"].includes(promptDuration) && duration && promptDuration !== duration) {
        return {
          status: 422,
          headers: {
            "x-upstream-error-code": "ERR_DURATION_DROPDOWN_CONFLICT",
            "x-upstream-raw-error": `[ERROR] VideoPipelineException: TemporalBudgetMismatch: Ingress duration header '${duration}' does not match prompt semantic duration '${promptDuration}'. Frame sequence cannot resolve.\nTraceID: ${traceId}`,
            "x-upstream-service": "Zyka-Temporal-Diffusion-Renderer",
            "x-upstream-trace-id": traceId,
            "x-conflicting-prompt-duration": promptDuration,
            "x-selected-dropdown-duration": duration,
          },
          error: {
            code: "ERR_DURATION_DROPDOWN_CONFLICT",
            technicalMessage: `[ERROR] VideoPipelineException: TemporalBudgetMismatch: Ingress duration header '${duration}' does not match prompt semantic duration '${promptDuration}'. Frame sequence cannot resolve.\nTraceID: ${traceId}`,
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

  // 8. Edge Case: Generic Aspect Ratio Detection & Mismatch in Prompt (e.g. 17:8, 2:1, 32:9)
  const supportedRatios: AspectRatio[] = ["16:9", "9:16", "1:1", "4:3", "21:9"];
  const ratioMatch = trimmed.match(/\b(\d+:\d+)\b|circular ratio/i);

  if (ratioMatch && normalizedType !== "voice") {
    const extractedRatio = ratioMatch[1] || ratioMatch[0];

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
