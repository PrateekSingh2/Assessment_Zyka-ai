import type { SanitizedErrorDetail, UpstreamErrorDetail, AspectRatio, Duration } from "@/types";

export interface ErrorTranslationResult {
  statusCode: number;
  rawError: UpstreamErrorDetail;
  sanitizedError: SanitizedErrorDetail;
  responseHeaders: Record<string, string>;
}

export interface UpstreamErrorPayload {
  code?: string;
  technicalMessage?: string;
  upstreamService?: string;
  traceId?: string;
  metadata?: {
    conflictingRatio?: string;
    selectedRatio?: string;
    promptRatio?: string;
    dropdownRatio?: string;
    conflictingDuration?: string;
    selectedDuration?: string;
    promptDuration?: string;
    dropdownDuration?: string;
    invalidRatio?: string;
    requestedDuration?: string;
    maxDuration?: string;
    maxWordLimit?: number;
    detectedWordCount?: number;
    unsupportedFormat?: string;
    [key: string]: any;
  };
}

const MAX_HEADER_VALUE_LENGTH = 1000;
const MAX_TOTAL_HEADERS_BYTES = 4096;

/**
 * Allowlist of permissible upstream headers forwarded through the proxy layer.
 * Prevents upstream header stuffing attacks and cumulative 431 proxy crashes.
 */
const ALLOWED_UPSTREAM_HEADERS = new Set([
  "x-upstream-error-code",
  "x-upstream-service",
  "x-upstream-trace-id",
  "x-ratelimit-limit",
  "x-ratelimit-remaining",
  "x-ratelimit-reset",
  "retry-after",
  "x-invalid-ratio",
  "x-upstream-invalid-ratio",
  "x-conflicting-prompt-ratio",
  "x-upstream-conflicting-ratio",
  "x-selected-dropdown-ratio",
  "x-upstream-selected-ratio",
  "x-conflicting-prompt-duration",
  "x-upstream-conflicting-duration",
  "x-selected-dropdown-duration",
  "x-upstream-selected-duration",
]);

/**
 * Safely performs bounded, shallow serialization of an object without
 * deep recursive traversal. Protects the Node.js event loop from DoS attacks
 * involving massive (50MB+) or circular upstream payloads.
 */
function safeShallowSerialize(obj: object): string {
  try {
    if (Array.isArray(obj)) {
      const items = obj.slice(0, 10).map((item) => {
        if (item === null) return "null";
        if (typeof item === "object") return "[Nested]";
        return String(item).substring(0, 50);
      });
      return `[${items.join(",")}]`;
    }
    const keys = Object.keys(obj).slice(0, 10);
    const entries = keys.map((key) => {
      const v = (obj as Record<string, unknown>)[key];
      const formattedVal =
        v === null
          ? "null"
          : typeof v === "object"
          ? "[Nested]"
          : JSON.stringify(String(v).substring(0, 50));
      return `${JSON.stringify(key)}:${formattedVal}`;
    });
    return `{${entries.join(",")}}`;
  } catch {
    return "[Object]";
  }
}

/**
 * Sanitizes header values for safe, spec-compliant HTTP transport:
 * 1. Prevents Event Loop DoS: Bounded shallow serialization for objects (never deep JSON.stringify)
 * 2. Prevents HTTP Response Splitting: Converts CR/LF newlines to " | "
 * 3. Prevents ERR_INVALID_CHAR Crashes: Strips non-ASCII/control characters outside latin1/printable ASCII (0x20-0x7E)
 * 4. Prevents 431 Request Header Too Large: Enforces strict per-header length limit (default 1,000 chars)
 */
export function sanitizeHeaderValue(
  val: unknown,
  maxLength: number = MAX_HEADER_VALUE_LENGTH
): string {
  if (val === null || val === undefined) return "";

  let rawString: string;
  if (typeof val === "object") {
    rawString = safeShallowSerialize(val);
  } else {
    rawString = String(val);
  }

  return rawString
    .replace(/[\r\n]+/g, " | ")
    .replace(/[^\x20-\x7E]/g, "") // Enforce strict 7-bit ASCII (0x20-0x7E) to prevent Node ERR_INVALID_CHAR crashes
    .trim()
    .substring(0, maxLength);
}

/**
 * Generates an RFC 4122 compliant collision-resistant trace ID.
 * Uses Web Crypto API (crypto.randomUUID()) natively supported across
 * both Node.js (v18+) and Next.js Edge runtimes without dynamic require() calls.
 */
export function generateSecureTraceId(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return `trace-${crypto.randomUUID()}`;
    }
  } catch {}
  return `trace-${Date.now()}-${Math.random().toString(36).substring(2, 10)}`;
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
  errorPayload?: UpstreamErrorPayload
): ErrorTranslationResult {
  const errorCode =
    upstreamHeaders["x-upstream-error-code"] ||
    errorPayload?.code ||
    "ERR_UNKNOWN_UPSTREAM_FAILURE";

  const rawTechnicalMessage =
    upstreamHeaders["x-upstream-raw-error"] ||
    errorPayload?.technicalMessage ||
    `[ERROR] UnhandledUpstreamFaultException: Code 0x500 at gateway edge.\nTraceID: ${upstreamHeaders["x-upstream-trace-id"] || "trace-unknown"}`;

  // Unique collision-resistant trace ID using crypto.randomUUID
  const traceId =
    upstreamHeaders["x-upstream-trace-id"] ||
    errorPayload?.traceId ||
    generateSecureTraceId();

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

  // Truncate raw message to 250 characters before running fallback regexes.
  // Prevents Catastrophic Regex Backtracking (ReDoS) against unbounded attacker payloads.
  const safeRegexTarget = rawTechnicalMessage.substring(0, 250);

  switch (errorCode) {
    case "ERR_UNSUPPORTED_ASPECT_RATIO_IN_PROMPT": {
      // 1. Structured metadata priority
      // 2. Structured header fallback
      // 3. Resilient bounded regex fallback (on safe 250-char window)
      const invalidRatio =
        errorPayload?.metadata?.invalidRatio ||
        upstreamHeaders["x-invalid-ratio"] ||
        upstreamHeaders["x-upstream-invalid-ratio"] ||
        safeRegexTarget.match(/aspect\s+ratio\s+['"]?([0-9]+:[0-9]+)['"]?/i)?.[1] ||
        safeRegexTarget.match(/\b([0-9]+:[0-9]+)\b/)?.[1] ||
        "specified";
      sanitizedMessage = `The aspect ratio '${invalidRatio}' in your prompt is not supported.`;
      category = "ASPECT_RATIO";
      actionableTip =
        "Zyka AI supports standard ratios: 1:1 (Square), 16:9 (Landscape), 9:16 (Portrait), 4:3, and 21:9 (Ultrawide). Please choose from the ratio dropdown.";
      break;
    }

    case "ERR_ASPECT_RATIO_DROPDOWN_CONFLICT": {
      // 1. Structured metadata priority (eliminates fragile regex scraping)
      // 2. Structured header fallback
      // 3. Resilient bounded regex fallback (on safe 250-char window)
      const promptRatio =
        errorPayload?.metadata?.conflictingRatio ||
        errorPayload?.metadata?.promptRatio ||
        upstreamHeaders["x-conflicting-prompt-ratio"] ||
        upstreamHeaders["x-upstream-conflicting-ratio"] ||
        safeRegexTarget.match(/prompt\s+(?:semantic\s+)?ratio(?:\s+constraint)?\s+['"]?([0-9]+:[0-9]+)['"]?/i)?.[1] ||
        safeRegexTarget.match(/(?:requested|prompt)\s+['"]?([0-9]+:[0-9]+)['"]?/i)?.[1] ||
        safeRegexTarget.match(/\b([0-9]+:[0-9]+)\b/)?.[1] ||
        "in prompt";

      const dropdownRatio =
        errorPayload?.metadata?.selectedRatio ||
        errorPayload?.metadata?.dropdownRatio ||
        upstreamHeaders["x-selected-dropdown-ratio"] ||
        upstreamHeaders["x-upstream-selected-ratio"] ||
        safeRegexTarget.match(/(?:parameter|header)\s+['"]?x-zyka-aspect-ratio['"]?\s*\(?([0-9]+:[0-9]+)\)?/i)?.[1] ||
        safeRegexTarget.match(/(?:selected|dropdown)\s+['"]?([0-9]+:[0-9]+)['"]?/i)?.[1] ||
        safeRegexTarget.match(/\b([0-9]+:[0-9]+)\b/)?.[1] ||
        "in dropdown";

      sanitizedMessage = `Your prompt requested ${promptRatio}, but ${dropdownRatio} is selected in the aspect ratio dropdown.`;
      category = "ASPECT_RATIO";
      actionableTip = `Update your aspect ratio dropdown to match ${promptRatio}, or remove '${promptRatio}' from your prompt to use the dropdown setting.`;
      suggestedRatio = promptRatio as AspectRatio;
      actionLabel = `Set Aspect Ratio to ${promptRatio}`;
      break;
    }

    case "ERR_DURATION_DROPDOWN_CONFLICT": {
      // 1. Structured metadata priority (eliminates fragile regex scraping)
      // 2. Structured header fallback
      // 3. Resilient bounded regex fallback (on safe 250-char window)
      const promptDuration =
        errorPayload?.metadata?.conflictingDuration ||
        errorPayload?.metadata?.promptDuration ||
        upstreamHeaders["x-conflicting-prompt-duration"] ||
        upstreamHeaders["x-upstream-conflicting-duration"] ||
        safeRegexTarget.match(/prompt\s+(?:semantic\s+)?duration\s+['"]?([0-9]+s?)['"]?/i)?.[1] ||
        safeRegexTarget.match(/(?:requested|prompt)\s+['"]?([0-9]+s?)['"]?/i)?.[1] ||
        safeRegexTarget.match(/\b([0-9]+s)\b/i)?.[1] ||
        "in prompt";

      const dropdownDuration =
        errorPayload?.metadata?.selectedDuration ||
        errorPayload?.metadata?.dropdownDuration ||
        upstreamHeaders["x-selected-dropdown-duration"] ||
        upstreamHeaders["x-upstream-selected-duration"] ||
        safeRegexTarget.match(/(?:ingress\s+)?duration\s+header\s+['"]?([0-9]+s?)['"]?/i)?.[1] ||
        safeRegexTarget.match(/(?:selected|dropdown)\s+['"]?([0-9]+s?)['"]?/i)?.[1] ||
        safeRegexTarget.match(/\b([0-9]+s)\b/i)?.[1] ||
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
      } else if (upstreamStatus >= 400 && upstreamStatus < 500) {
        // Categorize unhandled 4xx client errors as VALIDATION rather than generic SYSTEM
        category = "VALIDATION";
        if (upstreamStatus === 400) {
          sanitizedMessage =
            "Invalid request payload. Please verify your prompt and parameters.";
          actionableTip =
            "Ensure your prompt is properly formatted and non-empty before generating.";
        } else if (upstreamStatus === 422) {
          sanitizedMessage =
            "The request could not be processed due to semantic parameter constraints.";
          actionableTip =
            "Adjust your generation settings or prompt to match supported model parameters.";
        } else if (upstreamStatus === 404) {
          sanitizedMessage =
            "The requested AI generation resource or model was not found.";
          actionableTip =
            "Select a currently available AI model engine from the model dropdown.";
        } else if (upstreamStatus === 403) {
          sanitizedMessage =
            "Access to the requested generation capability is restricted.";
          actionableTip =
            "Verify your account permissions or choose a standard generation model.";
        } else {
          sanitizedMessage =
            "Client request validation failed. Please check your generation settings.";
          actionableTip =
            "Review your prompt text, model selection, and aspect ratio before submitting.";
        }
      }
      break;
  }

  // 1. Guaranteed Core Interceptor Response Headers (strictly sanitised & ASCII safe)
  const coreHeaders: Record<string, string> = {
    "x-zyka-sanitized-error": sanitizeHeaderValue(sanitizedMessage),
    "x-zyka-error-code": sanitizeHeaderValue(errorCode),
    "x-zyka-middleware-processed": "true",
    "x-zyka-error-category": sanitizeHeaderValue(category),
    "x-raw-upstream-error": sanitizeHeaderValue(rawTechnicalMessage),
  };

  // 2. Calculate baseline byte consumption from core telemetry headers
  let cumulativeHeaderBytes = 0;
  for (const [k, v] of Object.entries(coreHeaders)) {
    cumulativeHeaderBytes += k.length + v.length + 4; // key + ": " + val + "\r\n"
  }

  // 3. Selectively forward allowlisted upstream headers under strict cumulative 4KB budget
  // Prevents header flooding attacks, junk upstream header leaks, and proxy 431 errors
  const cleanUpstreamHeaders: Record<string, string> = {};
  for (const [k, v] of Object.entries(upstreamHeaders)) {
    const lowerKey = k.toLowerCase();
    if (
      ALLOWED_UPSTREAM_HEADERS.has(lowerKey) ||
      lowerKey.startsWith("x-zyka-")
    ) {
      const sanitizedVal = sanitizeHeaderValue(v);
      const entryBytes = k.length + sanitizedVal.length + 4;
      if (cumulativeHeaderBytes + entryBytes <= MAX_TOTAL_HEADERS_BYTES) {
        cleanUpstreamHeaders[k] = sanitizedVal;
        cumulativeHeaderBytes += entryBytes;
      }
    }
  }

  const enrichedHeaders: Record<string, string> = {
    ...cleanUpstreamHeaders,
    ...coreHeaders,
  };

  return {
    statusCode: upstreamStatus,
    rawError: {
      code: errorCode,
      technicalMessage: rawTechnicalMessage,
      upstreamService,
      traceId,
      metadata: errorPayload?.metadata,
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
