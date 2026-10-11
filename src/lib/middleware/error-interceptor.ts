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
 */
const ALLOWED_UPSTREAM_HEADERS: ReadonlySet<string> = new Set([
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
const ALLOWED_ASPECT_RATIOS: ReadonlySet<string> = new Set([
  "1:1",
  "16:9",
  "9:16",
  "4:3",
  "21:9",
]);

const ALLOWED_DURATIONS: ReadonlySet<string> = new Set([
  "2s",
  "5s",
  "10s",
  "15s",
  "30s",
]);

const ALLOWED_SERVICES: ReadonlySet<string> = new Set(["image", "video", "voice"]);

/**
 * DANGEROUS KEYS: Blocked to prevent Prototype Pollution attacks.
 */
const DANGEROUS_PROTO_KEYS: ReadonlySet<string> = new Set([
  "__proto__",
  "constructor",
  "prototype",
]);

/**
 * MITIGATION 4: XSS & Payload Injection via String Interpolation.
 * Encodes HTML entities (<, >, ", ', &) from dynamically extracted or user-controlled
 * variables before concatenating them into user-facing messages or retention tips.
 */
export function escapeHtml(str: unknown): string {
  if (typeof str !== "string") return "";
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * MITIGATION 5: Prototype Pollution in Metadata.
 * Safely accesses metadata properties without traversing prototype chains.
 * Blocks poisoned keys (__proto__, constructor, prototype) and verifies own properties.
 */
export function getSafeMetadata(
  metadata: unknown,
  key: string
): any {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return undefined;
  }
  if (DANGEROUS_PROTO_KEYS.has(key)) {
    return undefined;
  }
  if (!Object.prototype.hasOwnProperty.call(metadata, key)) {
    return undefined;
  }
  return (metadata as Record<string, any>)[key];
}

/**
 * MITIGATION 2: Blind Type Casting (Runtime Corruption).
 * Validates untrusted dynamic strings against strict allowed AspectRatio literals.
 * Drops invalid or injected strings (<script>alert(1)</script>) to undefined.
 */
export function validateAspectRatio(val: unknown): AspectRatio | undefined {
  if (typeof val === "string" && ALLOWED_ASPECT_RATIOS.has(val.trim())) {
    return val.trim() as AspectRatio;
  }
  return undefined;
}

/**
 * MITIGATION 2: Blind Type Casting (Runtime Corruption).
 * Validates untrusted dynamic strings against strict allowed Duration literals.
 * Drops invalid or injected strings to undefined.
 */
export function validateDuration(val: unknown): Duration | undefined {
  if (typeof val === "string") {
    const normalized = val.trim().toLowerCase();
    if (ALLOWED_DURATIONS.has(normalized)) {
      return normalized as Duration;
    }
  }
  return undefined;
}

/**
 * MITIGATION 2: Blind Type Casting (Runtime Corruption).
 * Validates untrusted dynamic strings against strict allowed Service literals.
 */
export function validateService(val: unknown): "image" | "video" | "voice" | undefined {
  if (typeof val === "string") {
    const normalized = val.trim().toLowerCase();
    if (ALLOWED_SERVICES.has(normalized)) {
      return normalized as "image" | "video" | "voice";
    }
  }
  return undefined;
}

/**
 * MITIGATION 6: Status Code Sanity Checks.
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
 * MITIGATION 1 & 3: Null/Malformed Input Resilience & Header Case-Insensitivity.
 * Safely defaults malformed inputs (null, undefined, arrays, primitives) to a safe object,
 * and canonicalizes all header keys to lowercase to eliminate case-mismatch bypasses.
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
 * PREVIOUSLY PATCHED (Preserved):
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
      if (DANGEROUS_PROTO_KEYS.has(key)) return null;
      const v = (obj as Record<string, unknown>)[key];
      const formattedVal =
        v === null
          ? "null"
          : typeof v === "object"
          ? "[Nested]"
          : JSON.stringify(String(v).substring(0, 50));
      return `${JSON.stringify(key)}:${formattedVal}`;
    }).filter(Boolean);
    return `{${entries.join(",")}}`;
  } catch {
    return "[Object]";
  }
}

/**
 * PREVIOUSLY PATCHED (Preserved):
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
 * PREVIOUSLY PATCHED (Preserved):
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
 * Intercepts upstream API responses, provides end-to-end resilience against
 * untrusted, corrupted, or malicious upstream data, and translates cryptic errors
 * into secure, sanitized, user-friendly guidance.
 */
export function interceptAndTranslateUpstreamError(
  upstreamStatus: unknown,
  upstreamHeaders: unknown,
  errorPayload?: unknown
): ErrorTranslationResult {
  // MITIGATION 6: Status Code Sanity Checks (Coerce, clamp 100-599, fallback to 500)
  const validStatus = normalizeStatusCode(upstreamStatus);

  // MITIGATION 1 & 3: Null/Malformed Input Resilience & Case-Insensitive Normalization
  const safeRawHeaders: Record<string, string> =
    upstreamHeaders && typeof upstreamHeaders === "object" && !Array.isArray(upstreamHeaders)
      ? (upstreamHeaders as Record<string, string>)
      : {};
  const normalizedHeaders = normalizeHeaders(safeRawHeaders);

  // MITIGATION 3: Safe Payload Structural Validation
  const safePayload =
    errorPayload && typeof errorPayload === "object" && !Array.isArray(errorPayload)
      ? (errorPayload as UpstreamErrorPayload)
      : undefined;

  // Case-insensitive code extraction
  const errorCode =
    normalizedHeaders["x-upstream-error-code"] ||
    (typeof safePayload?.code === "string" ? safePayload.code : "") ||
    "ERR_UNKNOWN_UPSTREAM_FAILURE";

  // Case-insensitive raw error extraction
  const rawTechnicalMessage =
    normalizedHeaders["x-upstream-raw-error"] ||
    (typeof safePayload?.technicalMessage === "string" ? safePayload.technicalMessage : "") ||
    `[ERROR] UnhandledUpstreamFaultException: Code 0x500 at gateway edge.\nTraceID: ${normalizedHeaders["x-upstream-trace-id"] || "trace-unknown"}`;

  // Case-insensitive trace ID extraction
  const traceId =
    normalizedHeaders["x-upstream-trace-id"] ||
    (typeof safePayload?.traceId === "string" ? safePayload.traceId : "") ||
    generateSecureTraceId();

  // Case-insensitive upstream service extraction
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

  // PREVIOUSLY PATCHED (Preserved):
  // Truncate raw message to 250 characters before running fallback regexes.
  // Prevents Catastrophic Regex Backtracking (ReDoS) against unbounded attacker payloads.
  const safeRegexTarget = rawTechnicalMessage.substring(0, 250);

  switch (errorCode) {
    case "ERR_UNSUPPORTED_ASPECT_RATIO_IN_PROMPT": {
      // MITIGATION 5: Prototype Pollution in Metadata (getSafeMetadata)
      // MITIGATION 1: Case-Insensitive Header Extraction (normalizedHeaders)
      const rawInvalidRatio =
        getSafeMetadata(safePayload?.metadata, "invalidRatio") ||
        normalizedHeaders["x-invalid-ratio"] ||
        normalizedHeaders["x-upstream-invalid-ratio"] ||
        safeRegexTarget.match(/aspect\s+ratio\s+['"]?([0-9]+:[0-9]+)['"]?/i)?.[1] ||
        safeRegexTarget.match(/\b([0-9]+:[0-9]+)\b/)?.[1] ||
        "specified";

      // MITIGATION 4: XSS & Payload Injection via String Interpolation
      const cleanInvalidRatio = escapeHtml(String(rawInvalidRatio).trim());
      sanitizedMessage = `The aspect ratio '${cleanInvalidRatio}' in your prompt is not supported.`;
      category = "ASPECT_RATIO";
      actionableTip =
        "Zyka AI supports standard ratios: 1:1 (Square), 16:9 (Landscape), 9:16 (Portrait), 4:3, and 21:9 (Ultrawide). Please choose from the ratio dropdown.";
      break;
    }

    case "ERR_ASPECT_RATIO_DROPDOWN_CONFLICT": {
      // MITIGATION 5: Prototype Pollution in Metadata (getSafeMetadata)
      // MITIGATION 1: Case-Insensitive Header Extraction (normalizedHeaders)
      const rawPromptRatio =
        getSafeMetadata(safePayload?.metadata, "conflictingRatio") ||
        getSafeMetadata(safePayload?.metadata, "promptRatio") ||
        normalizedHeaders["x-conflicting-prompt-ratio"] ||
        normalizedHeaders["x-upstream-conflicting-ratio"] ||
        safeRegexTarget.match(/prompt\s+(?:semantic\s+)?ratio(?:\s+constraint)?\s+['"]?([0-9]+:[0-9]+)['"]?/i)?.[1] ||
        safeRegexTarget.match(/(?:requested|prompt)\s+['"]?([0-9]+:[0-9]+)['"]?/i)?.[1] ||
        safeRegexTarget.match(/\b([0-9]+:[0-9]+)\b/)?.[1] ||
        "in prompt";

      const rawDropdownRatio =
        getSafeMetadata(safePayload?.metadata, "selectedRatio") ||
        getSafeMetadata(safePayload?.metadata, "dropdownRatio") ||
        normalizedHeaders["x-selected-dropdown-ratio"] ||
        normalizedHeaders["x-upstream-selected-ratio"] ||
        safeRegexTarget.match(/(?:parameter|header)\s+['"]?x-zyka-aspect-ratio['"]?\s*\(?([0-9]+:[0-9]+)\)?/i)?.[1] ||
        safeRegexTarget.match(/(?:selected|dropdown)\s+['"]?([0-9]+:[0-9]+)['"]?/i)?.[1] ||
        safeRegexTarget.match(/\b([0-9]+:[0-9]+)\b/)?.[1] ||
        "in dropdown";

      // MITIGATION 4: XSS & Payload Injection via String Interpolation
      const cleanPromptRatio = escapeHtml(String(rawPromptRatio).trim());
      const cleanDropdownRatio = escapeHtml(String(rawDropdownRatio).trim());

      sanitizedMessage = `Your prompt requested ${cleanPromptRatio}, but ${cleanDropdownRatio} is selected in the aspect ratio dropdown.`;
      category = "ASPECT_RATIO";
      actionableTip = `Update your aspect ratio dropdown to match ${cleanPromptRatio}, or remove '${cleanPromptRatio}' from your prompt to use the dropdown setting.`;

      // MITIGATION 2: Blind Type Casting (Runtime Corruption)
      // Validate untrusted ratio against strict allowed literals before assigning
      const validatedRatio = validateAspectRatio(rawPromptRatio);
      if (validatedRatio) {
        suggestedRatio = validatedRatio;
        actionLabel = `Set Aspect Ratio to ${cleanPromptRatio}`;
      }
      break;
    }

    case "ERR_DURATION_DROPDOWN_CONFLICT": {
      // MITIGATION 5: Prototype Pollution in Metadata (getSafeMetadata)
      // MITIGATION 1: Case-Insensitive Header Extraction (normalizedHeaders)
      const rawPromptDuration =
        getSafeMetadata(safePayload?.metadata, "conflictingDuration") ||
        getSafeMetadata(safePayload?.metadata, "promptDuration") ||
        normalizedHeaders["x-conflicting-prompt-duration"] ||
        normalizedHeaders["x-upstream-conflicting-duration"] ||
        safeRegexTarget.match(/prompt\s+(?:semantic\s+)?duration\s+['"]?([0-9]+s?)['"]?/i)?.[1] ||
        safeRegexTarget.match(/(?:requested|prompt)\s+['"]?([0-9]+s?)['"]?/i)?.[1] ||
        safeRegexTarget.match(/\b([0-9]+s)\b/i)?.[1] ||
        "in prompt";

      const rawDropdownDuration =
        getSafeMetadata(safePayload?.metadata, "selectedDuration") ||
        getSafeMetadata(safePayload?.metadata, "dropdownDuration") ||
        normalizedHeaders["x-selected-dropdown-duration"] ||
        normalizedHeaders["x-upstream-selected-duration"] ||
        safeRegexTarget.match(/(?:ingress\s+)?duration\s+header\s+['"]?([0-9]+s?)['"]?/i)?.[1] ||
        safeRegexTarget.match(/(?:selected|dropdown)\s+['"]?([0-9]+s?)['"]?/i)?.[1] ||
        safeRegexTarget.match(/\b([0-9]+s)\b/i)?.[1] ||
        "in dropdown";

      // MITIGATION 4: XSS & Payload Injection via String Interpolation
      const cleanPromptDuration = escapeHtml(String(rawPromptDuration).trim());
      const cleanDropdownDuration = escapeHtml(String(rawDropdownDuration).trim());

      sanitizedMessage = `Your prompt requested ${cleanPromptDuration}, but ${cleanDropdownDuration} is selected in the duration dropdown.`;
      category = "DURATION";
      actionableTip = `Set the duration dropdown to ${cleanPromptDuration} to match your prompt, or remove the duration from your text.`;

      // MITIGATION 2: Blind Type Casting (Runtime Corruption)
      // Validate untrusted duration against strict allowed literals before assigning
      const validatedDuration = validateDuration(rawPromptDuration);
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
        // MITIGATION 7: Granular 5xx Timeout Masking & Differentiation
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

  // 3. Forward allowlisted upstream headers under strict cumulative 4KB budget
  // MITIGATION 1: Normalized lowercase keys ensure canonical standards and avoid case duplication
  const cleanUpstreamHeaders: Record<string, string> = {};
  for (const [k, v] of Object.entries(safeRawHeaders)) {
    const lowerKey = k.toLowerCase();
    if (
      ALLOWED_UPSTREAM_HEADERS.has(lowerKey) ||
      lowerKey.startsWith("x-zyka-")
    ) {
      const sanitizedVal = sanitizeHeaderValue(v);
      const entryBytes = lowerKey.length + sanitizedVal.length + 4;
      if (cumulativeHeaderBytes + entryBytes <= MAX_TOTAL_HEADERS_BYTES) {
        cleanUpstreamHeaders[lowerKey] = sanitizedVal;
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
