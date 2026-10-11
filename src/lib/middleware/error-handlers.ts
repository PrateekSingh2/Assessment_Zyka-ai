import type { SanitizedErrorDetail } from "@/types";
import {
  type UpstreamErrorPayload,
  stripDangerousChars,
  getSafeMetadata,
  extractSafeString,
  validateAspectRatio,
  validateDuration,
  validateService,
} from "./error-utils.ts";

/**
 * Standard Handler Signature for Strategy Pattern (Dispatch Table)
 * Eliminates procedural switch statements and enforces Open-Closed Principle (SOLID).
 */
export type ErrorHandlerFn = (
  payload: UpstreamErrorPayload | undefined,
  headers: Record<string, string>,
  regexTarget: string
) => Partial<SanitizedErrorDetail>;

/**
 * Dedicated fallback status code handler for unhandled 4xx and 5xx errors.
 * Replaces procedural if/else chains with direct constant-time dictionary lookups.
 */
export function handleFallbackStatusCodes(
  status: number
): Partial<SanitizedErrorDetail> {
  if (status >= 500) {
    const fiveXxStrategies: Record<number, Partial<SanitizedErrorDetail>> = {
      504: {
        userMessage:
          "The generation request timed out. Please try a shorter prompt or simpler generation.",
        category: "SYSTEM",
        actionableTip:
          "Our AI generation pipeline experienced a timeout. Try reducing duration or simplifying scene details.",
      },
      503: {
        userMessage:
          "The AI generation service is temporarily overloaded. Please retry in a few moments.",
        category: "SYSTEM",
        actionableTip:
          "Our cloud GPU cluster is operating at maximum capacity. Your request will process once capacity frees up.",
      },
      502: {
        userMessage:
          "The generation gateway received an invalid upstream response. Please retry.",
        category: "SYSTEM",
        actionableTip:
          "A temporary gateway synchronization hiccup occurred. Retrying will connect you to a healthy worker node.",
      },
    };

    return (
      fiveXxStrategies[status] || {
        userMessage:
          "The AI generation service encountered an unexpected error. Please retry in a few seconds.",
        category: "SYSTEM",
        actionableTip:
          "Our cloud GPU workers are clearing queue backlog. Please retry shortly.",
      }
    );
  }

  if (status >= 400 && status < 500) {
    const fourXxStrategies: Record<number, Partial<SanitizedErrorDetail>> = {
      400: {
        userMessage:
          "Invalid request payload. Please verify your prompt and parameters.",
        category: "VALIDATION",
        actionableTip:
          "Ensure your prompt is properly formatted and non-empty before generating.",
      },
      401: {
        userMessage:
          "Authentication required to access this service.",
        category: "AUTHENTICATION",
        actionableTip:
          "Please provide valid authentication credentials or an API token.",
      },
      403: {
        userMessage:
          "Access to the requested generation capability is restricted.",
        category: "VALIDATION",
        actionableTip:
          "Verify your account permissions or choose a standard generation model.",
      },
      404: {
        userMessage:
          "The requested AI generation resource or model was not found.",
        category: "VALIDATION",
        actionableTip:
          "Select a currently available AI model engine from the model dropdown.",
      },
      405: {
        userMessage:
          "Method Not Allowed. The requested HTTP method is not supported for this route.",
        category: "SYSTEM",
        actionableTip:
          "Ensure your request uses the correct HTTP method (e.g. POST for generation, GET for logs).",
      },
      408: {
        userMessage:
          "Request timed out while waiting for a response.",
        category: "TIMEOUT",
        actionableTip:
          "The connection took too long to complete. Please check your connection and retry.",
      },
      413: {
        userMessage:
          "Your request is too large. Please shorten your prompt or reduce input size.",
        category: "VALIDATION",
        actionableTip:
          "Keep request body size under 32 KB.",
      },
      415: {
        userMessage:
          "Unsupported media format requested. Only Image, Video, and Voice generations are supported.",
        category: "FORMAT",
        actionableTip:
          "Select a supported media type: Image, Video, or Voice.",
      },
      422: {
        userMessage:
          "The request could not be processed due to semantic parameter constraints.",
        category: "VALIDATION",
        actionableTip:
          "Adjust your generation settings or prompt to match supported model parameters.",
      },
      429: {
        userMessage:
          "Too many requests. Please wait a moment before trying again.",
        category: "RATE_LIMIT",
        actionableTip:
          "You have exceeded the request rate limit. Please wait a moment before submitting another request.",
      },
      451: {
        userMessage:
          "Generation request blocked due to legal or policy restrictions.",
        category: "SAFETY",
        actionableTip:
          "Ensure your creative prompt complies with our content guidelines and terms of service.",
      },
    };

    return (
      fourXxStrategies[status] || {
        userMessage:
          "Client request validation failed. Please check your generation settings.",
        category: "VALIDATION",
        actionableTip:
          "Review your prompt text, model selection, and aspect ratio before submitting.",
      }
    );
  }

  return {
    userMessage: "An unexpected error occurred. Please try again.",
    category: "SYSTEM",
    actionableTip: "Please review your input and retry.",
  };
}

/**
 * Strategy Pattern Dispatch Table: ErrorHandlers
 * Maps specific error codes to isolated, pure handler functions.
 * O(1) execution lookup, fully open for extension and closed for modification.
 */
export const ErrorHandlers: Record<string, ErrorHandlerFn> = {
  ERR_UNSUPPORTED_ASPECT_RATIO_IN_PROMPT: (payload, headers, regexTarget) => {
    // 1. Safe metadata extraction with type leak prevention (unknown return type)
    // 2. Case-insensitive header fallback
    // 3. Resilient bounded regex fallback over full stack trace (no blind truncation)
    const rawInvalidRatio =
      extractSafeString(getSafeMetadata(payload?.metadata, "invalidRatio")) ||
      headers["x-invalid-ratio"] ||
      headers["x-upstream-invalid-ratio"] ||
      regexTarget.match(/aspect\s{1,10}ratio\s{1,10}['"]?([0-9]{1,4}:[0-9]{1,4})['"]?/i)?.[1] ||
      regexTarget.match(/\b([0-9]{1,4}:[0-9]{1,4})\b/)?.[1] ||
      "specified";

    const cleanInvalidRatio = stripDangerousChars(rawInvalidRatio);
    return {
      userMessage: `The aspect ratio '${cleanInvalidRatio}' in your prompt is not supported.`,
      category: "ASPECT_RATIO",
      actionableTip:
        "Zyka AI supports standard ratios: 1:1 (Square), 16:9 (Landscape), 9:16 (Portrait), 4:3, and 21:9 (Ultrawide). Please choose from the ratio dropdown.",
    };
  },

  ERR_ASPECT_RATIO_DROPDOWN_CONFLICT: (payload, headers, regexTarget) => {
    const rawPromptRatio =
      extractSafeString(getSafeMetadata(payload?.metadata, "conflictingRatio")) ||
      extractSafeString(getSafeMetadata(payload?.metadata, "promptRatio")) ||
      headers["x-conflicting-prompt-ratio"] ||
      headers["x-upstream-conflicting-ratio"] ||
      regexTarget.match(/prompt(?:\s{1,5}semantic)?\s{1,5}ratio(?:\s{1,5}constraint)?\s{1,5}['"]?([0-9]{1,4}:[0-9]{1,4})['"]?/i)?.[1] ||
      regexTarget.match(/(?:requested|prompt)\s{1,5}['"]?([0-9]{1,4}:[0-9]{1,4})['"]?/i)?.[1] ||
      regexTarget.match(/\b([0-9]{1,4}:[0-9]{1,4})\b/)?.[1] ||
      "in prompt";

    const rawDropdownRatio =
      extractSafeString(getSafeMetadata(payload?.metadata, "selectedRatio")) ||
      extractSafeString(getSafeMetadata(payload?.metadata, "dropdownRatio")) ||
      headers["x-selected-dropdown-ratio"] ||
      headers["x-upstream-selected-ratio"] ||
      regexTarget.match(/(?:parameter|header)\s{1,5}['"]?x-zyka-aspect-ratio['"]?\s{0,5}\(?([0-9]{1,4}:[0-9]{1,4})\)?/i)?.[1] ||
      regexTarget.match(/(?:selected|dropdown)\s{1,5}['"]?([0-9]{1,4}:[0-9]{1,4})['"]?/i)?.[1] ||
      regexTarget.match(/\b([0-9]{1,4}:[0-9]{1,4})\b/)?.[1] ||
      "in dropdown";

    const cleanPromptRatio = stripDangerousChars(rawPromptRatio);
    const cleanDropdownRatio = stripDangerousChars(rawDropdownRatio);

    const validatedRatio = validateAspectRatio(cleanPromptRatio);

    return {
      userMessage: `Your prompt requested ${cleanPromptRatio}, but ${cleanDropdownRatio} is selected in the aspect ratio dropdown.`,
      category: "ASPECT_RATIO",
      actionableTip: `Update your aspect ratio dropdown to match ${cleanPromptRatio}, or remove '${cleanPromptRatio}' from your prompt to use the dropdown setting.`,
      suggestedRatio: validatedRatio,
      actionLabel: validatedRatio ? `Set Aspect Ratio to ${cleanPromptRatio}` : undefined,
    };
  },

  ERR_DURATION_DROPDOWN_CONFLICT: (payload, headers, regexTarget) => {
    const rawPromptDuration =
      extractSafeString(getSafeMetadata(payload?.metadata, "conflictingDuration")) ||
      extractSafeString(getSafeMetadata(payload?.metadata, "promptDuration")) ||
      headers["x-conflicting-prompt-duration"] ||
      headers["x-upstream-conflicting-duration"] ||
      regexTarget.match(/prompt(?:\s{1,5}semantic)?\s{1,5}duration\s{1,5}['"]?([0-9]{1,4}s{0,1})['"]?/i)?.[1] ||
      regexTarget.match(/(?:requested|prompt)\s{1,5}['"]?([0-9]{1,4}s{0,1})['"]?/i)?.[1] ||
      regexTarget.match(/\b([0-9]{1,4}s)\b/i)?.[1] ||
      "in prompt";

    const rawDropdownDuration =
      extractSafeString(getSafeMetadata(payload?.metadata, "selectedDuration")) ||
      extractSafeString(getSafeMetadata(payload?.metadata, "dropdownDuration")) ||
      headers["x-selected-dropdown-duration"] ||
      headers["x-upstream-selected-duration"] ||
      regexTarget.match(/(?:ingress\s{1,5})?duration\s{1,5}header\s{1,5}['"]?([0-9]{1,4}s{0,1})['"]?/i)?.[1] ||
      regexTarget.match(/(?:selected|dropdown)\s{1,5}['"]?([0-9]{1,4}s{0,1})['"]?/i)?.[1] ||
      regexTarget.match(/\b([0-9]{1,4}s)\b/i)?.[1] ||
      "in dropdown";

    const cleanPromptDuration = stripDangerousChars(rawPromptDuration);
    const cleanDropdownDuration = stripDangerousChars(rawDropdownDuration);

    const validatedDuration = validateDuration(cleanPromptDuration);

    return {
      userMessage: `Your prompt requested ${cleanPromptDuration}, but ${cleanDropdownDuration} is selected in the duration dropdown.`,
      category: "DURATION",
      actionableTip: `Set the duration dropdown to ${cleanPromptDuration} to match your prompt, or remove the duration from your text.`,
      suggestedDuration: validatedDuration,
      actionLabel: validatedDuration ? `Set Duration to ${cleanPromptDuration}` : undefined,
    };
  },

  ERR_RESOLUTION_LIMIT_EXCEEDED: () => ({
    userMessage:
      "Requested resolution (8K/16K) exceeds standard model generation limits.",
    category: "VALIDATION",
    actionableTip:
      "Zyka AI generates crystal-clear HD and 4K upscaled media. Use our 'High Quality' preset for best fidelity.",
  }),

  ERR_SAFETY_POLICY_VIOLATION: () => ({
    userMessage:
      "Your prompt triggered safety guidelines. Please modify your prompt.",
    category: "SAFETY",
    actionableTip:
      "Zyka AI enforces safe creative generation. Focus your prompt on artistic descriptions, styles, and concepts.",
  }),

  ERR_SERVICE_MISMATCH_IMAGE_IN_VIDEO: () => ({
    userMessage:
      "This prompt is for generating a still image, but you are currently in the Video tab.",
    category: "SERVICE_MISMATCH",
    actionableTip:
      "Switch to the Zyka AI Image Generator right here to create stunning photorealistic visuals with FLUX 2 and Zyka Helion.",
    suggestedService: validateService("image"),
    actionLabel: "Switch to Image Generator",
  }),

  ERR_SERVICE_MISMATCH_VIDEO_IN_IMAGE: () => ({
    userMessage:
      "This prompt describes a moving video, but you are currently in the Image tab.",
    category: "SERVICE_MISMATCH",
    actionableTip:
      "Bring your scene to life with Zyka AI Video Generator powered by Sora 2, Veo 3.1, and Kling v3!",
    suggestedService: validateService("video"),
    actionLabel: "Switch to Video Generator",
  }),

  ERR_SERVICE_MISMATCH_VOICE: () => ({
    userMessage:
      "This prompt describes visual media, but you are currently in the Voice tab.",
    category: "SERVICE_MISMATCH",
    actionableTip:
      "Switch to Zyka AI Video or Image Generator to create visuals, or enter speech dialogue here for AI Voice synthesis.",
    suggestedService: validateService("video"),
    actionLabel: "Switch to Video Generator",
  }),

  ERR_MAX_TOKEN_LIMIT_EXCEEDED: () => ({
    userMessage: "Word limit for the prompt is exceeded from 1000 words.",
    category: "WORD_LIMIT",
    actionableTip:
      "Shorten your prompt below 1,000 words for the highest fidelity synthesis on Zyka AI.",
  }),

  ERR_DURATION_OUT_OF_BOUNDS: () => ({
    userMessage:
      "Requested duration exceeds the maximum allowed limit of 30 seconds.",
    category: "DURATION",
    actionableTip:
      "Select up to 30 seconds per clip on Zyka AI, then easily extend or stitch clips together in our studio.",
  }),

  ERR_UNSUPPORTED_MEDIA_TYPE: () => ({
    userMessage:
      "Unsupported media format requested. Only Image, Video, and Voice generations are supported.",
    category: "FORMAT",
    actionableTip:
      "Zyka AI generates ultra-high-definition MP4 videos, PNG images, and studio-grade Voice audio. Try generating a standard video or image!",
  }),

  ERR_ASPECT_RATIO_MISMATCH: () => ({
    userMessage:
      "Requested aspect ratio is not supported. Supported ratios are: 1:1, 16:9, 9:16, 4:3, 21:9.",
    category: "ASPECT_RATIO",
    actionableTip:
      "Select one of our standard aspect ratios to guarantee optimal frame composition across all devices.",
  }),

  ERR_RATE_LIMIT_EXCEEDED: () => ({
    userMessage: "Too many requests. Please wait a moment before trying again.",
    category: "RATE_LIMIT",
    actionableTip:
      "Our sliding-window system ensures fast GPU allocation for all creators. Please wait a few seconds.",
  }),

  ERR_EMPTY_PROMPT: () => ({
    userMessage: "Prompt cannot be empty. Please enter your creative prompt.",
    category: "VALIDATION",
    actionableTip:
      "Describe any scene, character, motion, or speech to generate media with Zyka AI.",
  }),
};
