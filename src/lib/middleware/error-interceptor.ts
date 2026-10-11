import { SanitizedErrorDetail, UpstreamErrorDetail, AspectRatio, Duration } from "@/types";

export interface ErrorTranslationResult {
  statusCode: number;
  rawError: UpstreamErrorDetail;
  sanitizedError: SanitizedErrorDetail;
  responseHeaders: Record<string, string>;
}

export function sanitizeHeaderValue(val: string): string {
  if (typeof val !== "string") return String(val);
  return val.replace(/[\r\n]+/g, " | ").trim();
}

/**
 * Enterprise Middleware Error Interceptor:
 * Intercepts upstream API response headers, translates cryptic multi-line
 * technical error codes into short, friendly messages, and generates
 * engaging platform retention tips and corrective action suggestions.
 */
export function interceptAndTranslateUpstreamError(
  upstreamStatus: number,
  upstreamHeaders: Record<string, string>,
  errorPayload?: {
    code?: string;
    technicalMessage?: string;
    upstreamService?: string;
    traceId?: string;
  }
): ErrorTranslationResult {
  const errorCode =
    upstreamHeaders["x-upstream-error-code"] ||
    errorPayload?.code ||
    "ERR_UNKNOWN_UPSTREAM_FAILURE";

  const rawTechnicalMessage =
    upstreamHeaders["x-upstream-raw-error"] ||
    errorPayload?.technicalMessage ||
    `[ERROR] UnhandledUpstreamFaultException: Code 0x500 at gateway edge.\nTraceID: ${upstreamHeaders["x-upstream-trace-id"] || "trace-unknown"}`;

  const traceId =
    upstreamHeaders["x-upstream-trace-id"] ||
    errorPayload?.traceId ||
    `trace-${Date.now()}`;

  const upstreamService =
    upstreamHeaders["x-upstream-service"] ||
    errorPayload?.upstreamService ||
    "Zyka-Upstream-Gateway";

  let sanitizedMessage = "An unexpected error occurred. Please try again.";
  let category: SanitizedErrorDetail["category"] = "SYSTEM";
  let actionableTip = "Please review your input and retry.";
  let suggestedService: "image" | "video" | "voice" | undefined = undefined;
  let suggestedRatio: AspectRatio | undefined = undefined;
  let suggestedDuration: Duration | undefined = undefined;
  let actionLabel: string | undefined = undefined;

  switch (errorCode) {
    case "ERR_UNSUPPORTED_ASPECT_RATIO_IN_PROMPT": {
      const invalidRatio =
        upstreamHeaders["x-invalid-ratio"] ||
        rawTechnicalMessage.match(/aspect ratio '([^']+)'/)?.[1] ||
        "specified";
      sanitizedMessage = `The aspect ratio '${invalidRatio}' in your prompt is not supported.`;
      category = "ASPECT_RATIO";
      actionableTip =
        "Zyka AI supports standard ratios: 1:1 (Square), 16:9 (Landscape), 9:16 (Portrait), 4:3, and 21:9 (Ultrawide). Please choose from the ratio dropdown.";
      break;
    }

    case "ERR_ASPECT_RATIO_DROPDOWN_CONFLICT": {
      const promptRatio =
        upstreamHeaders["x-conflicting-prompt-ratio"] ||
        rawTechnicalMessage.match(/prompt semantic ratio constraint '([^']+)'/)?.[1] ||
        "in prompt";
      const dropdownRatio =
        upstreamHeaders["x-selected-dropdown-ratio"] ||
        rawTechnicalMessage.match(/parameter 'x-zyka-aspect-ratio' \(([^)]+)\)/)?.[1] ||
        "in dropdown";
      sanitizedMessage = `Your prompt requested ${promptRatio}, but ${dropdownRatio} is selected in the aspect ratio dropdown.`;
      category = "ASPECT_RATIO";
      actionableTip = `Update your aspect ratio dropdown to match ${promptRatio}, or remove '${promptRatio}' from your prompt to use the dropdown setting.`;
      suggestedRatio = promptRatio as AspectRatio;
      actionLabel = `Set Aspect Ratio to ${promptRatio}`;
      break;
    }

    case "ERR_DURATION_DROPDOWN_CONFLICT": {
      const promptDuration =
        upstreamHeaders["x-conflicting-prompt-duration"] ||
        rawTechnicalMessage.match(/prompt semantic duration '([^']+)'/)?.[1] ||
        "in prompt";
      const dropdownDuration =
        upstreamHeaders["x-selected-dropdown-duration"] ||
        rawTechnicalMessage.match(/duration header '([^']+)'/)?.[1] ||
        "in dropdown";
      sanitizedMessage = `Your prompt requested ${promptDuration}, but ${dropdownDuration} is selected in the duration dropdown.`;
      category = "DURATION";
      actionableTip = `Set the duration dropdown to ${promptDuration} to match your prompt, or remove the duration from your text.`;
      suggestedDuration = promptDuration as Duration;
      actionLabel = `Set Duration to ${promptDuration}`;
      break;
    }

    case "ERR_RESOLUTION_LIMIT_EXCEEDED":
      sanitizedMessage =
        "Requested resolution (8K/16K) exceeds standard model generation limits.";
      category = "VALIDATION";
      actionableTip =
        "Zyka AI generates crystal-clear HD and 4K upscaled media. Use our 'High Quality' preset for best fidelity.";
      break;

    case "ERR_SAFETY_POLICY_VIOLATION":
      sanitizedMessage =
        "Your prompt triggered safety guidelines. Please modify your prompt.";
      category = "SAFETY";
      actionableTip =
        "Zyka AI enforces safe creative generation. Focus your prompt on artistic descriptions, styles, and concepts.";
      break;

    case "ERR_SERVICE_MISMATCH_IMAGE_IN_VIDEO":
      sanitizedMessage =
        "This prompt is for generating a still image, but you are currently in the Video tab.";
      category = "SERVICE_MISMATCH";
      actionableTip =
        "Switch to the Zyka AI Image Generator right here to create stunning photorealistic visuals with FLUX 2 and Zyka Helion.";
      suggestedService = "image";
      actionLabel = "Switch to Image Generator";
      break;

    case "ERR_SERVICE_MISMATCH_VIDEO_IN_IMAGE":
      sanitizedMessage =
        "This prompt describes a moving video, but you are currently in the Image tab.";
      category = "SERVICE_MISMATCH";
      actionableTip =
        "Bring your scene to life with Zyka AI Video Generator powered by Sora 2, Veo 3.1, and Kling v3!";
      suggestedService = "video";
      actionLabel = "Switch to Video Generator";
      break;

    case "ERR_SERVICE_MISMATCH_VOICE":
      sanitizedMessage =
        "This prompt describes visual media, but you are currently in the Voice tab.";
      category = "SERVICE_MISMATCH";
      actionableTip =
        "Switch to Zyka AI Video or Image Generator to create visuals, or enter speech dialogue here for AI Voice synthesis.";
      suggestedService = "video";
      actionLabel = "Switch to Video Generator";
      break;

    case "ERR_MAX_TOKEN_LIMIT_EXCEEDED":
      sanitizedMessage = "Word limit for the prompt is exceeded from 1000 words.";
      category = "WORD_LIMIT";
      actionableTip =
        "Shorten your prompt below 1,000 words for the highest fidelity synthesis on Zyka AI.";
      break;

    case "ERR_DURATION_OUT_OF_BOUNDS":
      sanitizedMessage =
        "Requested duration exceeds the maximum allowed limit of 30 seconds.";
      category = "DURATION";
      actionableTip =
        "Select up to 30 seconds per clip on Zyka AI, then easily extend or stitch clips together in our studio.";
      break;

    case "ERR_UNSUPPORTED_MEDIA_TYPE":
      sanitizedMessage =
        "Unsupported media format requested. Only Image, Video, and Voice generations are supported.";
      category = "FORMAT";
      actionableTip =
        "Zyka AI generates ultra-high-definition MP4 videos, PNG images, and studio-grade Voice audio. Try generating a standard video or image!";
      break;

    case "ERR_ASPECT_RATIO_MISMATCH":
      sanitizedMessage =
        "Requested aspect ratio is not supported. Supported ratios are: 1:1, 16:9, 9:16, 4:3, 21:9.";
      category = "ASPECT_RATIO";
      actionableTip =
        "Select one of our standard aspect ratios to guarantee optimal frame composition across all devices.";
      break;

    case "ERR_RATE_LIMIT_EXCEEDED":
      sanitizedMessage = "Too many requests. Please wait a moment before trying again.";
      category = "RATE_LIMIT";
      actionableTip =
        "Our sliding-window system ensures fast GPU allocation for all creators. Please wait a few seconds.";
      break;

    case "ERR_EMPTY_PROMPT":
      sanitizedMessage = "Prompt cannot be empty. Please enter your creative prompt.";
      category = "VALIDATION";
      actionableTip =
        "Describe any scene, character, motion, or speech to generate media with Zyka AI.";
      break;

    default:
      if (upstreamStatus >= 500) {
        sanitizedMessage =
          "The AI generation service is temporarily busy. Please retry in a few seconds.";
        category = "SYSTEM";
        actionableTip =
          "Our cloud GPU workers are clearing queue backlog. Please retry shortly.";
      }
      break;
  }

  // Sanitize all outgoing headers so none contain newlines
  const cleanUpstreamHeaders: Record<string, string> = {};
  for (const [k, v] of Object.entries(upstreamHeaders)) {
    cleanUpstreamHeaders[k] = sanitizeHeaderValue(v);
  }

  const enrichedHeaders: Record<string, string> = {
    ...cleanUpstreamHeaders,
    "x-raw-upstream-error": sanitizeHeaderValue(rawTechnicalMessage),
    "x-zyka-sanitized-error": sanitizeHeaderValue(sanitizedMessage),
    "x-zyka-error-code": sanitizeHeaderValue(errorCode),
    "x-zyka-middleware-processed": "true",
    "x-zyka-error-category": sanitizeHeaderValue(category),
  };

  return {
    statusCode: upstreamStatus,
    rawError: {
      code: errorCode,
      technicalMessage: rawTechnicalMessage,
      upstreamService,
      traceId,
    },
    sanitizedError: {
      userMessage: sanitizedMessage,
      category,
      actionableTip,
      suggestedService,
      suggestedRatio,
      suggestedDuration,
      actionLabel,
    },
    responseHeaders: enrichedHeaders,
  };
}
