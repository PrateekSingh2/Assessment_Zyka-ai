export type MediaType = "image" | "video" | "voice";
export type AspectRatio = "1:1" | "16:9" | "9:16" | "4:3" | "21:9";
export type Duration = "2s" | "5s" | "10s" | "15s" | "30s";

export interface GenerationRequestPayload {
  prompt: string;
  mediaType: MediaType;
  duration?: Duration;
  aspectRatio?: AspectRatio;
  model?: string;
  quality?: string;
}

export interface UpstreamErrorDetail {
  code: string;
  technicalMessage: string;
  upstreamService: string;
  traceId: string;
  metadata?: Record<string, unknown>;
}

export interface SanitizedErrorDetail {
  userMessage: string;
  category:
    | "SERVICE_MISMATCH"
    | "WORD_LIMIT"
    | "DURATION"
    | "FORMAT"
    | "ASPECT_RATIO"
    | "RATE_LIMIT"
    | "VALIDATION"
    | "SAFETY"
    | "SYSTEM"
    | "TIMEOUT"
    | "AUTHENTICATION";
  actionableTip: string;
  suggestedService?: "image" | "video" | "voice";
  suggestedRatio?: AspectRatio;
  suggestedDuration?: Duration;
  actionLabel?: string;
}

export interface GenerationResponseSuccess {
  success: true;
  statusCode: 200;
  data: {
    mediaType: MediaType;
    mediaUrl: string;
    prompt: string;
    duration?: Duration;
    aspectRatio?: AspectRatio;
    resolution?: string;
    model?: string;
    quality?: string;
  };
  debug: {
    requestHeaders: Record<string, string>;
    responseHeaders: Record<string, string>;
  };
}

export interface GenerationResponseError {
  success: false;
  statusCode: number;
  traceId: string;
  sanitizedError: SanitizedErrorDetail;
}

export type GenerationResponse =
  | GenerationResponseSuccess
  | GenerationResponseError;

/**
 * Enterprise Server-Level Error Log Entry
 * Stores full server-side trace details per user with real IP extraction.
 */
export interface ServerErrorLogEntry {
  logId: string;
  timestamp: string; // ISO 8601
  epochMs: number;
  clientIp: string; // Extracted Real Client IP
  ipSource:
    | "cf-connecting-ip"
    | "true-client-ip"
    | "x-real-ip"
    | "x-forwarded-for"
    | "client-public-wan"
    | "system-lan-interface"
    | "remote-addr-fallback"
    | "socket";
  userId: string; // Authenticated user ID or deterministic client fingerprint
  userAgent: string;
  requestId: string;
  traceId: string;
  route: string;
  method: string;
  requestPayload: {
    mediaType?: string;
    duration?: string;
    aspectRatio?: string;
    model?: string;
    promptSnippet: string;
    promptWordCount: number;
  };
  error: {
    statusCode: number;
    code: string;
    category: string;
    rawTechnicalMessage: string;
    sanitizedUserMessage: string;
    actionableTip?: string;
    upstreamService?: string;
  };
  serverContext: {
    nodeEnv: string;
    host: string;
    runtime: string;
  };
}

/**
 * Universal Operational Log Entry for the Navbar Logs Drawer
 * Logs every user operation with real client IP, random username, and timestamp.
 */
export interface OperationLogEntry {
  id: string;
  timestamp: string; // ISO 8601
  formattedTime: string; // HH:mm:ss
  type:
    | "PROMPT_SUBMISSION"
    | "GENERATION_SUCCESS"
    | "ERROR_INTERCEPTED"
    | "SERVICE_SWITCH"
    | "RATE_LIMIT_ENGAGED"
    | "DROPDOWN_SYNC";
  status: "SUCCESS" | "ERROR" | "WARNING" | "INFO";
  statusCode?: number;
  realIp: string;
  ipType: string;
  username: string;
  mediaType?: MediaType;
  promptSnippet?: string;
  summary: string;
  technicalDetails?: string;
  sanitizedMessage?: string;
  actionableTip?: string;
}


