/**
 * Request body schema and bounded JSON reader.
 *
 * ALL body parsing MUST go through readBoundedJson() + GenerateBody.safeParse().
 * This is the only entry point for untrusted client data.
 */

import { z } from "zod";

// Centralized limits (E5)
export const MAX_BODY_BYTES = 32_768; // 32 KB hard byte cap
export const MAX_PROMPT_CHARS = 8_000;
export const MAX_WORDS = 1_000;
export const READ_TIMEOUT_MS = 5_000; // 5 seconds bounded stream timeout (E2)

export const VALID_MEDIA_TYPES = ["image", "video", "voice"] as const;
export const VALID_DURATIONS = ["2s", "5s", "10s", "15s", "30s"] as const;
export const VALID_ASPECT_RATIOS = ["1:1", "16:9", "9:16", "4:3", "21:9"] as const;

export const GenerateBody = z
  .object({
    prompt: z
      .string()
      .trim()
      .min(1, "Prompt cannot be empty. Please enter your creative prompt.")
      .max(MAX_PROMPT_CHARS, `Prompt exceeds maximum length of ${MAX_PROMPT_CHARS.toLocaleString()} characters.`)
      .refine((s) => s.split(/\s+/).filter(Boolean).length <= MAX_WORDS, {
        message: `Word limit for the prompt is exceeded from ${MAX_WORDS} words.`,
      }),
    mediaType: z.enum(VALID_MEDIA_TYPES).default("image"),
    duration: z.enum(VALID_DURATIONS).optional(),
    aspectRatio: z.enum(VALID_ASPECT_RATIOS).optional(),
    model: z
      .string()
      .max(64)
      .regex(/^[\w .()'\-]+$/, "Model contains invalid characters")
      .default("Auto (Best model)"),
    quality: z
      .string()
      .max(32)
      .regex(/^[\w .\-]+$/, "Quality contains invalid characters")
      .default("High Quality"),
  })
  .strict();

export type GenerateBodyInput = z.infer<typeof GenerateBody>;

export class PayloadTooLargeError extends Error {
  constructor() {
    super("Request body exceeds maximum allowed size");
    this.name = "PayloadTooLargeError";
  }
}

export class MalformedJsonError extends Error {
  constructor(cause?: unknown) {
    super("Request body is not valid JSON");
    this.name = "MalformedJsonError";
    if (cause instanceof Error) this.cause = cause;
  }
}

export class RequestTimeoutError extends Error {
  constructor() {
    super("Request body read timed out");
    this.name = "RequestTimeoutError";
  }
}

export const FIELD_LABELS: Record<string, string> = {
  prompt: "Prompt",
  mediaType: "Media type",
  duration: "Duration",
  aspectRatio: "Aspect ratio",
  model: "Model",
  quality: "Quality",
};

/**
 * Maps Zod validation issues to user-friendly messages without leaking library phrasing (E4).
 */
export function toUserMessage(issue: z.ZodIssue | undefined): string {
  if (!issue) return "Invalid request parameters.";
  const key = String(issue.path?.[0] ?? "");
  const label = FIELD_LABELS[key] ?? key ?? "Request";
  const code = String(issue.code);

  if (code === "unrecognized_keys" || code === "invalid_key") {
    const keys = (issue as { keys?: string[] }).keys;
    if (keys && keys.length > 0) {
      return `Unknown field: ${keys.join(", ")}. Please check your field names.`;
    }
    return "Request contains unrecognized parameters. Please check your field names.";
  }
  if (key === "" || issue.path.length === 0) return "Send a JSON object with a prompt field.";
  if (key === "prompt") {
    if (code === "too_small" || code === "invalid_type") {
      return "Prompt cannot be empty.";
    }
    if (code === "too_big") {
      return `Prompt exceeds maximum length of ${MAX_PROMPT_CHARS.toLocaleString()} characters.`;
    }
  }
  if (code === "too_big") return `${label} is too long.`;
  if (code === "too_small") return `${label} cannot be empty.`;
  if (code === "invalid_enum_value" || code === "invalid_value") {
    return `${label} has an unsupported value. Please pick one from the dropdown.`;
  }
  if (code === "invalid_type") {
    return `${label} has an invalid type.`;
  }
  return issue.message && !issue.message.startsWith("Invalid")
    ? issue.message
    : `${label} has an invalid value.`;
}

/**
 * Reads the request body with a hard byte cap and timeout to prevent event-loop stalls.
 * Throws PayloadTooLargeError if body meets or exceeds MAX_BODY_BYTES.
 * Throws RequestTimeoutError if read takes longer than READ_TIMEOUT_MS.
 * Throws MalformedJsonError if JSON.parse fails.
 */
export async function readBoundedJson(req: Request): Promise<unknown> {
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared >= MAX_BODY_BYTES) {
    throw new PayloadTooLargeError();
  }

  const reader = req.body?.getReader();
  if (!reader) {
    return {};
  }

  const chunks: Uint8Array[] = [];
  let total = 0;
  let timer: NodeJS.Timeout | null = null;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      void reader.cancel().catch(() => {});
      reject(new RequestTimeoutError());
    }, READ_TIMEOUT_MS);
  });

  try {
    const readAll = async (): Promise<void> => {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total >= MAX_BODY_BYTES) {
          await reader.cancel().catch(() => {});
          throw new PayloadTooLargeError();
        }
        chunks.push(value);
      }
    };

    await Promise.race([readAll(), timeoutPromise]);
  } finally {
    if (timer) clearTimeout(timer);
    try {
      reader.releaseLock();
    } catch {}
  }

  const text = Buffer.concat(chunks).toString("utf8");

  try {
    return JSON.parse(text);
  } catch (cause) {
    throw new MalformedJsonError(cause);
  }
}
