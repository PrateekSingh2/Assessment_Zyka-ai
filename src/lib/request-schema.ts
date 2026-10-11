/**
 * Request body schema and bounded JSON reader.
 *
 * ALL body parsing MUST go through readBoundedJson() + GenerateBody.safeParse().
 * This is the only entry point for untrusted client data.
 */

import { z } from "zod";

// Hard byte cap enforced BEFORE JSON.parse allocates memory.
// 8,000 chars ≈ 1,000 words @ avg 8 chars/word, with margin.
export const MAX_BODY_BYTES = 16_384; // 16 KB

export const VALID_MEDIA_TYPES = ["image", "video", "audio", "voice"] as const;
export const VALID_DURATIONS = ["2s", "5s", "10s", "15s", "30s"] as const;
export const VALID_ASPECT_RATIOS = ["1:1", "16:9", "9:16", "4:3", "21:9"] as const;

export const GenerateBody = z
  .object({
    prompt: z
      .string()
      .min(1, "prompt cannot be empty")
      .max(8_000, "prompt exceeds maximum length of 8,000 characters"),
    mediaType: z.enum(VALID_MEDIA_TYPES).default("image"),
    duration: z.enum(VALID_DURATIONS).optional(),
    aspectRatio: z.enum(VALID_ASPECT_RATIOS).optional(),
    // Strict regex: no injection characters, reasonable length
    model: z
      .string()
      .max(64)
      .regex(/^[\w .()'\-]+$/, "model contains invalid characters")
      .default("Auto (Best model)"),
    quality: z
      .string()
      .max(32)
      .regex(/^[\w .\-]+$/, "quality contains invalid characters")
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

/**
 * Reads the request body with a hard byte cap to prevent event-loop stalls.
 * Returns raw `unknown` — callers MUST validate with GenerateBody.safeParse().
 *
 * Throws PayloadTooLargeError if body exceeds MAX_BODY_BYTES.
 * Throws MalformedJsonError if JSON.parse fails.
 */
export async function readBoundedJson(req: Request): Promise<unknown> {
  // Fast-reject on declared Content-Length before reading a single byte
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > MAX_BODY_BYTES) {
    throw new PayloadTooLargeError();
  }

  const reader = req.body?.getReader();
  if (!reader) {
    // Empty body — return empty object; schema will validate required fields
    return {};
  }

  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BODY_BYTES) {
        await reader.cancel();
        throw new PayloadTooLargeError();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const text = Buffer.concat(chunks).toString("utf8");

  try {
    return JSON.parse(text);
  } catch (cause) {
    throw new MalformedJsonError(cause);
  }
}
