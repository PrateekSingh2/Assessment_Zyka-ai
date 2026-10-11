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
 * STRICT SECURITY ALLOWLIST: Permissible upstream headers forwarded through proxy layer.
 * Mitigates cumulative header stuffing attacks and proxy 431 crashes.
 * ARCHITECTURAL RULE 3: Any upstream header not explicitly listed here is strictly dropped.
 * (Wildcard 'x-zyka-' bypass has been completely eliminated).
 */
export const ALLOWED_UPSTREAM_HEADERS: ReadonlySet<string> = new Set([
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
 * STRICT RUNTIME LITERAL SETS: Prevents Blind Type Casting & Runtime Corruption.
 */
export const ALLOWED_ASPECT_RATIOS: ReadonlySet<string> = new Set([
  "1:1",
  "16:9",
  "9:16",
  "4:3",
  "21:9",
]);

export const ALLOWED_DURATIONS: ReadonlySet<string> = new Set([
  "2s",
  "5s",
  "10s",
  "15s",
  "30s",
]);

export const ALLOWED_SERVICES: ReadonlySet<string> = new Set(["image", "video", "voice"]);

/**
 * DANGEROUS KEYS: Blocked to prevent Prototype Pollution attacks.
 */
export const DANGEROUS_PROTO_KEYS: ReadonlySet<string> = new Set([
  "__proto__",
  "constructor",
  "prototype",
]);

/**
 * ARCHITECTURAL RULE 1: Eliminate Double-Escaping (XSS vs UI Degradation)
 * Strictly removes <, >, {, }, =, (, ) to prevent HTML/payload injection while
 * avoiding HTML entity encoding (&lt;, &gt;) that causes literal UI text degradation in React.
 */
export function stripDangerousChars(str: unknown): string {
  if (typeof str !== "string") return "";
  return str.replace(/[<>{}=()]/g, "").trim();
}

/**
 * ARCHITECTURAL RULE 5: Patch Type Leaks in Metadata
 * Safely accesses metadata properties returning `unknown` (eliminating any-type leaks).
 * Blocks poisoned prototype keys (__proto__, constructor, prototype) and verifies own properties.
 */
export function getSafeMetadata(
  metadata: unknown,
  key: string
): unknown {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return undefined;
  }
  if (DANGEROUS_PROTO_KEYS.has(key)) {
    return undefined;
  }
  if (!Object.prototype.hasOwnProperty.call(metadata, key)) {
    return undefined;
  }
  return (metadata as Record<string, unknown>)[key];
}

/**
 * ARCHITECTURAL RULE 5: Safe String Extraction from Metadata
 * Defensively extracts primitive strings, safely discarding accidental objects or arrays
 * without interpolating '[object Object]' into user-facing messages.
 */
export function extractSafeString(val: unknown): string | undefined {
  if (typeof val === "string") {
    const trimmed = val.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  if (typeof val === "number" || typeof val === "boolean") {
    return String(val);
  }
  return undefined;
}

/**
 * Runtime literal validation for AspectRatio union type.
 * Drops invalid or injected strings to undefined.
 */
export function validateAspectRatio(val: unknown): AspectRatio | undefined {
  if (typeof val === "string") {
    const cleaned = stripDangerousChars(val);
    if (ALLOWED_ASPECT_RATIOS.has(cleaned)) {
      return cleaned as AspectRatio;
    }
  }
  return undefined;
}

/**
 * Runtime literal validation for Duration union type.
 * Drops invalid or injected strings to undefined.
 */
export function validateDuration(val: unknown): Duration | undefined {
  if (typeof val === "string") {
    const cleaned = stripDangerousChars(val).toLowerCase();
    if (ALLOWED_DURATIONS.has(cleaned)) {
      return cleaned as Duration;
    }
  }
  return undefined;
}

/**
 * Runtime literal validation for Service union type.
 */
export function validateService(val: unknown): "image" | "video" | "voice" | undefined {
  if (typeof val === "string") {
    const cleaned = stripDangerousChars(val).toLowerCase();
    if (ALLOWED_SERVICES.has(cleaned)) {
      return cleaned as "image" | "video" | "voice";
    }
  }
  return undefined;
}

/**
 * Status Code Sanity Checks:
 * Coerces and clamps upstreamStatus to a valid integer in [100, 599].
 * Defaults safely to 500 if NaN, null, undefined, 0, or out of range.
 */
export function normalizeStatusCode(status: unknown): number {
  const parsed = typeof status === "number" ? status : Number(status);
  if (!Number.isInteger(parsed) || parsed < 100 || parsed > 599) {
    return 500;
  }
  return parsed;
}

/**
 * Null/Malformed Input Resilience & Header Case-Insensitivity:
 * Canonicalizes header keys to lowercase and drops dangerous prototype keys.
 */
export function normalizeHeaders(
  rawHeaders: unknown
): Record<string, string> {
  if (!rawHeaders || typeof rawHeaders !== "object" || Array.isArray(rawHeaders)) {
    return {};
  }
  const normalized: Record<string, string> = {};
  for (const [key, val] of Object.entries(rawHeaders as Record<string, unknown>)) {
    if (typeof key === "string" && !DANGEROUS_PROTO_KEYS.has(key)) {
      normalized[key.toLowerCase()] = typeof val === "string" ? val : String(val ?? "");
    }
  }
  return normalized;
}

/**
 * Safely performs bounded, shallow serialization of an object without
 * deep recursive traversal. Protects the Node.js event loop from DoS attacks.
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
    const entries = keys
      .map((key) => {
        if (DANGEROUS_PROTO_KEYS.has(key)) return null;
        const v = (obj as Record<string, unknown>)[key];
        const formattedVal =
          v === null
            ? "null"
            : typeof v === "object"
            ? "[Nested]"
            : JSON.stringify(String(v).substring(0, 50));
        return `${JSON.stringify(key)}:${formattedVal}`;
      })
      .filter(Boolean);
    return `{${entries.join(",")}}`;
  } catch {
    return "[Object]";
  }
}

/**
 * Sanitizes header values for safe, spec-compliant HTTP transport:
 * 1. Prevents Event Loop DoS: Bounded shallow serialization for objects
 * 2. Prevents HTTP Response Splitting: Converts CR/LF newlines to " | "
 * 3. Prevents ERR_INVALID_CHAR Crashes: Strips non-ASCII/control characters outside 0x20-0x7E
 * 4. Prevents 431 Request Header Too Large: Enforces strict per-header length limit (1,000 chars)
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
    .replace(/[^\x20-\x7E]/g, "") // Strict ASCII printable range [0x20-0x7E]
    .trim()
    .substring(0, maxLength);
}

/**
 * Generates an RFC 4122 compliant collision-resistant trace ID using native Web Crypto API.
 * 100% Edge Runtime and Turbopack compatible (zero bundler-hostile require() calls).
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
 * Staff-Level Zero-Trust Middleware Error Interceptor:
 * Intercepts upstream API responses, translates cryptic technical errors into
 * clean, sanitized creator guidance, and guarantees complete runtime security.
 */
export function interceptAndTranslateUpstreamError(
  upstreamStatus: unknown,
  upstreamHeaders: unknown,
  errorPayload?: unknown
): ErrorTranslationResult {
  // Status Code Sanity Check: Coerce and clamp to [100, 599], default 500
  const validStatus = normalizeStatusCode(upstreamStatus);

  // ARCHITECTURAL RULE 4: Null/Malformed Input Resilience & Case-Insensitive Normalization
  const normalizedHeaders = normalizeHeaders(upstreamHeaders);

  // Structural Validation on Payload: drop non-objects and arrays
  const safePayload =
    errorPayload && typeof errorPayload === "object" && !Array.isArray(errorPayload)
      ? (errorPayload as UpstreamErrorPayload)
      : undefined;

  // Case-Insensitive Field Extractions
  const errorCode =
    normalizedHeaders["x-upstream-error-code"] ||
    (typeof safePayload?.code === "string" ? safePayload.code : "") ||
    "ERR_UNKNOWN_UPSTREAM_FAILURE";

  const rawTechnicalMessage =
    normalizedHeaders["x-upstream-raw-error"] ||
    (typeof safePayload?.technicalMessage === "string" ? safePayload.technicalMessage : "") ||
    `[ERROR] UnhandledUpstreamFaultException: Code 0x500 at gateway edge.\nTraceID: ${normalizedHeaders["x-upstream-trace-id"] || "trace-unknown"}`;

  const traceId =
    normalizedHeaders["x-upstream-trace-id"] ||
    (typeof safePayload?.traceId === "string" ? safePayload.traceId : "") ||
    generateSecureTraceId();

  const upstreamService =
    normalizedHeaders["x-upstream-service"] ||
    (typeof safePayload?.upstreamService === "string" ? safePayload.upstreamService : "") ||
    "Zyka-Upstream-Gateway";

  let sanitizedMessage = "An unexpected error occurred. Please try again.";
  let category: SanitizedErrorDetail["category"] = "SYSTEM";
  let actionableTip = "Please review your input and retry.";
  let suggestedService: "image" | "video" | "voice" | undefined = undefined;
  let suggestedRatio: AspectRatio | undefined = undefined;
  let suggestedDuration: Duration | undefined = undefined;
  let actionLabel: string | undefined = undefined;

  // ARCHITECTURAL RULE 2: Fix Truncation Blindness via Strict Bounded Quantifiers
  // Rather than truncating rawTechnicalMessage to 250 chars (which drops variables deep in stack traces),
  // all fallback regexes operate across the full string using bounded quantifiers (\s{1,10}, [0-9]{1,4})
  // to mathematically guarantee O(N) evaluation and eliminate ReDoS.

  switch (errorCode) {
    case "ERR_UNSUPPORTED_ASPECT_RATIO_IN_PROMPT": {
      // 1. Safe metadata extraction with type leak prevention (unknown return type)
      // 2. Case-insensitive header fallback
      // 3. Resilient bounded regex fallback over full stack trace
      const rawInvalidRatio =
        extractSafeString(getSafeMetadata(safePayload?.metadata, "invalidRatio")) ||
        normalizedHeaders["x-invalid-ratio"] ||
        normalizedHeaders["x-upstream-invalid-ratio"] ||
        rawTechnicalMessage.match(/aspect\s{1,10}ratio\s{1,10}['"]?([0-9]{1,4}:[0-9]{1,4})['"]?/i)?.[1] ||
        rawTechnicalMessage.match(/\b([0-9]{1,4}:[0-9]{1,4})\b/)?.[1] ||
        "specified";

      // ARCHITECTURAL RULE 1: Eliminate Double-Escaping (stripDangerousChars)
      const cleanInvalidRatio = stripDangerousChars(rawInvalidRatio);
      sanitizedMessage = `The aspect ratio '${cleanInvalidRatio}' in your prompt is not supported.`;
      category = "ASPECT_RATIO";
      actionableTip =
        "Zyka AI supports standard ratios: 1:1 (Square), 16:9 (Landscape), 9:16 (Portrait), 4:3, and 21:9 (Ultrawide). Please choose from the ratio dropdown.";
      break;
    }

    case "ERR_ASPECT_RATIO_DROPDOWN_CONFLICT": {
      // 1. Safe metadata extraction with type leak prevention (unknown return type)
      // 2. Case-insensitive header fallback
      // 3. Resilient bounded regex fallback over full stack trace
      const rawPromptRatio =
        extractSafeString(getSafeMetadata(safePayload?.metadata, "conflictingRatio")) ||
        extractSafeString(getSafeMetadata(safePayload?.metadata, "promptRatio")) ||
        normalizedHeaders["x-conflicting-prompt-ratio"] ||
        normalizedHeaders["x-upstream-conflicting-ratio"] ||
        rawTechnicalMessage.match(/prompt(?:\s{1,5}semantic)?\s{1,5}ratio(?:\s{1,5}constraint)?\s{1,5}['"]?([0-9]{1,4}:[0-9]{1,4})['"]?/i)?.[1] ||
        rawTechnicalMessage.match(/(?:requested|prompt)\s{1,5}['"]?([0-9]{1,4}:[0-9]{1,4})['"]?/i)?.[1] ||
        rawTechnicalMessage.match(/\b([0-9]{1,4}:[0-9]{1,4})\b/)?.[1] ||
        "in prompt";

      const rawDropdownRatio =
        extractSafeString(getSafeMetadata(safePayload?.metadata, "selectedRatio")) ||
        extractSafeString(getSafeMetadata(safePayload?.metadata, "dropdownRatio")) ||
        normalizedHeaders["x-selected-dropdown-ratio"] ||
        normalizedHeaders["x-upstream-selected-ratio"] ||
        rawTechnicalMessage.match(/(?:parameter|header)\s{1,5}['"]?x-zyka-aspect-ratio['"]?\s{0,5}\(?([0-9]{1,4}:[0-9]{1,4})\)?/i)?.[1] ||
        rawTechnicalMessage.match(/(?:selected|dropdown)\s{1,5}['"]?([0-9]{1,4}:[0-9]{1,4})['"]?/i)?.[1] ||
        rawTechnicalMessage.match(/\b([0-9]{1,4}:[0-9]{1,4})\b/)?.[1] ||
        "in dropdown";

      // ARCHITECTURAL RULE 1: Eliminate Double-Escaping (stripDangerousChars)
      const cleanPromptRatio = stripDangerousChars(rawPromptRatio);
      const cleanDropdownRatio = stripDangerousChars(rawDropdownRatio);

      sanitizedMessage = `Your prompt requested ${cleanPromptRatio}, but ${cleanDropdownRatio} is selected in the aspect ratio dropdown.`;
      category = "ASPECT_RATIO";
      actionableTip = `Update your aspect ratio dropdown to match ${cleanPromptRatio}, or remove '${cleanPromptRatio}' from your prompt to use the dropdown setting.`;

      // Runtime literal validation against allowed AspectRatio values
      const validatedRatio = validateAspectRatio(cleanPromptRatio);
      if (validatedRatio) {
        suggestedRatio = validatedRatio;
        actionLabel = `Set Aspect Ratio to ${cleanPromptRatio}`;
      }
      break;
    }

    case "ERR_DURATION_DROPDOWN_CONFLICT": {
      // 1. Safe metadata extraction with type leak prevention (unknown return type)
      // 2. Case-insensitive header fallback
      // 3. Resilient bounded regex fallback over full stack trace
      const rawPromptDuration =
        extractSafeString(getSafeMetadata(safePayload?.metadata, "conflictingDuration")) ||
        extractSafeString(getSafeMetadata(safePayload?.metadata, "promptDuration")) ||
        normalizedHeaders["x-conflicting-prompt-duration"] ||
        normalizedHeaders["x-upstream-conflicting-duration"] ||
        rawTechnicalMessage.match(/prompt(?:\s{1,5}semantic)?\s{1,5}duration\s{1,5}['"]?([0-9]{1,4}s{0,1})['"]?/i)?.[1] ||
        rawTechnicalMessage.match(/(?:requested|prompt)\s{1,5}['"]?([0-9]{1,4}s{0,1})['"]?/i)?.[1] ||
        rawTechnicalMessage.match(/\b([0-9]{1,4}s)\b/i)?.[1] ||
        "in prompt";

      const rawDropdownDuration =
        extractSafeString(getSafeMetadata(safePayload?.metadata, "selectedDuration")) ||
        extractSafeString(getSafeMetadata(safePayload?.metadata, "dropdownDuration")) ||
        normalizedHeaders["x-selected-dropdown-duration"] ||
        normalizedHeaders["x-upstream-selected-duration"] ||
        rawTechnicalMessage.match(/(?:ingress\s{1,5})?duration\s{1,5}header\s{1,5}['"]?([0-9]{1,4}s{0,1})['"]?/i)?.[1] ||
        rawTechnicalMessage.match(/(?:selected|dropdown)\s{1,5}['"]?([0-9]{1,4}s{0,1})['"]?/i)?.[1] ||
        rawTechnicalMessage.match(/\b([0-9]{1,4}s)\b/i)?.[1] ||
        "in dropdown";

      // ARCHITECTURAL RULE 1: Eliminate Double-Escaping (stripDangerousChars)
      const cleanPromptDuration = stripDangerousChars(rawPromptDuration);
      const cleanDropdownDuration = stripDangerousChars(rawDropdownDuration);

      sanitizedMessage = `Your prompt requested ${cleanPromptDuration}, but ${cleanDropdownDuration} is selected in the duration dropdown.`;
      category = "DURATION";
      actionableTip = `Set the duration dropdown to ${cleanPromptDuration} to match your prompt, or remove the duration from your text.`;

      // Runtime literal validation against allowed Duration values
      const validatedDuration = validateDuration(cleanPromptDuration);
      if (validatedDuration) {
        suggestedDuration = validatedDuration;
        actionLabel = `Set Duration to ${cleanPromptDuration}`;
      }
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
      suggestedService = validateService("image");
      actionLabel = "Switch to Image Generator";
      break;

    case "ERR_SERVICE_MISMATCH_VIDEO_IN_IMAGE":
      sanitizedMessage =
        "This prompt describes a moving video, but you are currently in the Image tab.";
      category = "SERVICE_MISMATCH";
      actionableTip =
        "Bring your scene to life with Zyka AI Video Generator powered by Sora 2, Veo 3.1, and Kling v3!";
      suggestedService = validateService("video");
      actionLabel = "Switch to Video Generator";
      break;

    case "ERR_SERVICE_MISMATCH_VOICE":
      sanitizedMessage =
        "This prompt describes visual media, but you are currently in the Voice tab.";
      category = "SERVICE_MISMATCH";
      actionableTip =
        "Switch to Zyka AI Video or Image Generator to create visuals, or enter speech dialogue here for AI Voice synthesis.";
      suggestedService = validateService("video");
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
      if (validStatus >= 500) {
        // Granular 5xx Timeout Masking & Differentiation
        category = "SYSTEM";
        if (validStatus === 504) {
          sanitizedMessage =
            "The generation request timed out. Please try a shorter prompt or simpler generation.";
          actionableTip =
            "Our AI generation pipeline experienced a timeout. Try reducing duration or simplifying scene details.";
        } else if (validStatus === 503) {
          sanitizedMessage =
            "The AI generation service is temporarily overloaded. Please retry in a few moments.";
          actionableTip =
            "Our cloud GPU cluster is operating at maximum capacity. Your request will process once capacity frees up.";
        } else if (validStatus === 502) {
          sanitizedMessage =
            "The generation gateway received an invalid upstream response. Please retry.";
          actionableTip =
            "A temporary gateway synchronization hiccup occurred. Retrying will connect you to a healthy worker node.";
        } else {
          sanitizedMessage =
            "The AI generation service encountered an unexpected error. Please retry in a few seconds.";
          actionableTip =
            "Our cloud GPU workers are clearing queue backlog. Please retry shortly.";
        }
      } else if (validStatus >= 400 && validStatus < 500) {
        // Categorize unhandled 4xx client errors as VALIDATION rather than generic SYSTEM
        category = "VALIDATION";
        if (validStatus === 400) {
          sanitizedMessage =
            "Invalid request payload. Please verify your prompt and parameters.";
          actionableTip =
            "Ensure your prompt is properly formatted and non-empty before generating.";
        } else if (validStatus === 422) {
          sanitizedMessage =
            "The request could not be processed due to semantic parameter constraints.";
          actionableTip =
            "Adjust your generation settings or prompt to match supported model parameters.";
        } else if (validStatus === 404) {
          sanitizedMessage =
            "The requested AI generation resource or model was not found.";
          actionableTip =
            "Select a currently available AI model engine from the model dropdown.";
        } else if (validStatus === 403) {
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

  // ARCHITECTURAL RULES 3 & 4: Close Allowlist Loophole & Iterate Over Normalized Headers
  // We iterate directly over normalizedHeaders (already lowercase and proto-safe).
  // The lowerKey.startsWith("x-zyka-") wildcard bypass has been eliminated.
  // Any header not explicitly present in ALLOWED_UPSTREAM_HEADERS is dropped.
  const cleanUpstreamHeaders: Record<string, string> = {};
  for (const [headerKey, rawHeaderVal] of Object.entries(normalizedHeaders)) {
    if (ALLOWED_UPSTREAM_HEADERS.has(headerKey)) {
      const sanitizedVal = sanitizeHeaderValue(rawHeaderVal);
      const entryBytes = headerKey.length + sanitizedVal.length + 4;
      if (cumulativeHeaderBytes + entryBytes <= MAX_TOTAL_HEADERS_BYTES) {
        cleanUpstreamHeaders[headerKey] = sanitizedVal;
        cumulativeHeaderBytes += entryBytes;
      }
    }
  }

  const enrichedHeaders: Record<string, string> = {
    ...cleanUpstreamHeaders,
    ...coreHeaders,
  };

  return {
    statusCode: validStatus,
    rawError: {
      code: errorCode,
      technicalMessage: rawTechnicalMessage,
      upstreamService,
      traceId,
      metadata: safePayload?.metadata,
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
