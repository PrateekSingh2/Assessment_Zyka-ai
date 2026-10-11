export class ThirdPartyLLMError extends Error {
  code: number;
  details: string;

  constructor(message: string, code: number, details: string) {
    super(message);
    this.name = "ThirdPartyLLMError";
    this.code = code;
    this.details = details;
  }
}

export async function callMockThirdPartyLLM(prompt: string): Promise<string> {
  // Simulate network latency
  await new Promise(resolve => setTimeout(resolve, 2000));

  // Count words
  const wordCount = prompt.trim().split(/\s+/).length;

  if (wordCount > 1000) {
    // This is the cryptic error from the third party API
    throw new ThirdPartyLLMError(
      "ERR_MAX_TOKEN_LIMIT_EXCEEDED",
      400,
      `Trace ID: 0x8A7B6C. Internal context window constraint breached for token limit (1000 words equiv). Request rejected by upstream model worker at node-xyz-123.`
    );
  }

  // If successful, return a mock image URL
  return "https://images.unsplash.com/photo-1695653422715-991ec3a0db7a?q=80&w=1000&auto=format&fit=crop";
}
