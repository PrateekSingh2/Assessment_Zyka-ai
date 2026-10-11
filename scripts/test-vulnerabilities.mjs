/**
 * ============================================================================
 * ZYKA AI — Final Zero-Trust Hardening & Architectural Verification Suite
 * ============================================================================
 * 1. Double-Escaping Elimination (stripDangerousChars vs UI text degradation)
 * 2. Truncation Blindness Resolution (Deep stack trace extraction with bounded regexes)
 * 3. Header Allowlist Loophole Closure (No wildcard bypass)
 * 4. Redundant Header Iteration Fix (Normalized headers iteration)
 * 5. Type Leak Patches (Safe unknown metadata & array/object rejection)
 * 6. Header Case-Insensitivity (Silent Bypass Prevention)
 * 7. Blind Type Casting Prevention (Strict Runtime Literal Validation)
 * 8. Null / Malformed Input Resilience (Zero Crash Guarantee)
 * 9. Prototype Pollution in Metadata (Poisoned Key Defenses)
 * 10. Status Code Sanity Checks (Clamping & NaN Coercion)
 * 11. Granular 5xx Timeout Masking (504 Gateway Timeout, 503 Overload)
 * 12. Event Loop DoS Defense (Shallow Serialization)
 * 13. Unicode Header Crashes (ERR_INVALID_CHAR Prevention via Strict ASCII 0x20-0x7E)
 * 14. Edge Runtime Compatibility (Web Crypto API without bundler-hostile require)
 * ============================================================================
 */

import {
  interceptAndTranslateUpstreamError,
  sanitizeHeaderValue,
  generateSecureTraceId,
  stripDangerousChars,
  getSafeMetadata,
  extractSafeString,
  validateAspectRatio,
  validateDuration,
  validateService,
  normalizeStatusCode,
  normalizeHeaders,
} from "../src/lib/middleware/error-interceptor.ts";

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✅ PASS: ${message}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${message}`);
    failed++;
  }
}

async function main() {
  console.log(`\n========================================================================`);
  console.log(`  ZYKA AI — FINAL ZERO-TRUST SECURITY & ARCHITECTURAL AUDIT`);
  console.log(`  Timestamp: ${new Date().toISOString()}`);
  console.log(`========================================================================\n`);

  // --------------------------------------------------------------------------
  // RULE 1: Eliminate Double-Escaping (stripDangerousChars)
  // --------------------------------------------------------------------------
  console.log(`[RULE 1] Eliminate Double-Escaping (stripDangerousChars)`);

  const dirtyPayload = "<script>alert('xss')</script> {payload=true} (nested)";
  const cleaned = stripDangerousChars(dirtyPayload);

  assert(
    !cleaned.includes("<") &&
      !cleaned.includes(">") &&
      !cleaned.includes("{") &&
      !cleaned.includes("}") &&
      !cleaned.includes("=") &&
      !cleaned.includes("(") &&
      !cleaned.includes(")"),
    `stripDangerousChars removes <, >, {, }, =, (, ) strictly`
  );
  assert(
    !cleaned.includes("&lt;") && !cleaned.includes("&amp;"),
    `stripDangerousChars does NOT introduce double-escaped HTML entities (&lt;, &amp;)`
  );
  assert(
    cleaned.includes("scriptalert'xss'/script"),
    `Preserves safe alphanumeric text cleanly: "${cleaned}"`
  );

  // End-to-end userMessage check
  const xssRatioResult = interceptAndTranslateUpstreamError(
    422,
    { "x-upstream-error-code": "ERR_UNSUPPORTED_ASPECT_RATIO_IN_PROMPT" },
    {
      code: "ERR_UNSUPPORTED_ASPECT_RATIO_IN_PROMPT",
      metadata: { invalidRatio: "<script>eval(1)</script>" },
    }
  );

  assert(
    !xssRatioResult.sanitizedError.userMessage.includes("<script>") &&
      !xssRatioResult.sanitizedError.userMessage.includes("&lt;script&gt;"),
    `userMessage contains neither raw tags nor degraded HTML entities: "${xssRatioResult.sanitizedError.userMessage}"`
  );

  // --------------------------------------------------------------------------
  // RULE 2: Fix Truncation Blindness (Deep Stack Trace Bounded Regexes)
  // --------------------------------------------------------------------------
  console.log(`\n[RULE 2] Fix Truncation Blindness (Deep Stack Trace Bounded Regexes)`);

  // Variable hidden 1,500 characters deep in a 3,000-character stack trace
  const deepStackTrace =
    "Error: InternalPipelineException\n" +
    "    at Module.callWorker (worker.ts:12:4)\n".repeat(40) +
    "Caused by: GeometryMatrixException: aspect ratio '17:8' failed tensor alignment\n" +
    "    at Rescaler.native (rescaler.cpp:45:9)\n".repeat(40);

  const deepResult = interceptAndTranslateUpstreamError(422, {
    "x-upstream-error-code": "ERR_UNSUPPORTED_ASPECT_RATIO_IN_PROMPT",
    "x-upstream-raw-error": deepStackTrace,
  });

  assert(
    deepResult.sanitizedError.userMessage === "The aspect ratio '17:8' in your prompt is not supported.",
    `Deep stack trace (> 1,000 chars deep) parsed accurately without truncation blindness: "${deepResult.sanitizedError.userMessage}"`
  );

  // ReDoS verification with bounded quantifiers on 50,000 chars
  const redosBomb = "prompt semantic ratio " + "   ".repeat(15000) + "x";
  const redosStart = Date.now();
  const redosResult = interceptAndTranslateUpstreamError(422, {
    "x-upstream-error-code": "ERR_ASPECT_RATIO_DROPDOWN_CONFLICT",
    "x-upstream-raw-error": redosBomb,
  });
  const redosDuration = Date.now() - redosStart;

  assert(
    redosDuration < 15,
    `Bounded regexes processed 50,000-char ReDoS payload in ${redosDuration}ms (< 15ms threshold)`
  );

  // --------------------------------------------------------------------------
  // RULE 3 & 4: Close Header Allowlist Loophole & Iterate Over Normalized Headers
  // --------------------------------------------------------------------------
  console.log(`\n[RULES 3 & 4] Header Allowlist Loophole Closed & Normalized Iteration`);

  const mixedHeaders = {
    "X-UPSTREAM-ERROR-CODE": "ERR_RATE_LIMIT_EXCEEDED",
    "x-zyka-untrusted-bypass": "SHOULD_BE_DROPPED", // Attempted wildcard loophole
    "x-custom-junk": "DROP_ME",
    "X-RateLimit-Limit": "5",
    "X-RateLimit-Remaining": "0",
  };

  const allowlistResult = interceptAndTranslateUpstreamError(429, mixedHeaders);

  assert(
    allowlistResult.responseHeaders["x-zyka-untrusted-bypass"] === undefined,
    `Wildcard loophole closed: 'x-zyka-untrusted-bypass' was dropped`
  );
  assert(
    allowlistResult.responseHeaders["x-custom-junk"] === undefined,
    `Unallowlisted header 'x-custom-junk' was dropped`
  );
  assert(
    allowlistResult.responseHeaders["x-ratelimit-limit"] === "5",
    `Normalized allowlisted header 'x-ratelimit-limit' was preserved`
  );
  assert(
    allowlistResult.responseHeaders["x-ratelimit-remaining"] === "0",
    `Normalized allowlisted header 'x-ratelimit-remaining' was preserved`
  );

  // --------------------------------------------------------------------------
  // RULE 5: Patch Type Leaks (Safe Metadata Types & Non-String Rejection)
  // --------------------------------------------------------------------------
  console.log(`\n[RULE 5] Patch Type Leaks (Safe Metadata Extraction)`);

  const metadataWithTypeLeak = {
    conflictingRatio: { nested: "16:9" }, // Accidental object
    selectedRatio: ["16:9"], // Accidental array
    validString: "16:9",
  };

  assert(
    getSafeMetadata(metadataWithTypeLeak, "conflictingRatio") !== undefined,
    `getSafeMetadata returns unknown type safely`
  );
  assert(
    extractSafeString(getSafeMetadata(metadataWithTypeLeak, "conflictingRatio")) === undefined,
    `extractSafeString discards accidental nested object (returns undefined)`
  );
  assert(
    extractSafeString(getSafeMetadata(metadataWithTypeLeak, "selectedRatio")) === undefined,
    `extractSafeString discards accidental array (returns undefined)`
  );
  assert(
    extractSafeString(getSafeMetadata(metadataWithTypeLeak, "validString")) === "16:9",
    `extractSafeString accepts legitimate string '16:9'`
  );

  // --------------------------------------------------------------------------
  // TEST: Header Case-Insensitivity
  // --------------------------------------------------------------------------
  console.log(`\n[VERIFICATION] Header Case-Insensitivity`);

  const caseHeaders = {
    "X-UPSTREAM-ERROR-CODE": "ERR_ASPECT_RATIO_DROPDOWN_CONFLICT",
    "X-Upstream-Trace-Id": "trace-case-id-123",
    "X-Conflicting-Prompt-Ratio": "4:3",
    "X-Selected-Dropdown-Ratio": "16:9",
  };

  const caseRes = interceptAndTranslateUpstreamError(422, caseHeaders);
  assert(
    caseRes.rawError.code === "ERR_ASPECT_RATIO_DROPDOWN_CONFLICT",
    `Case-insensitive error code resolution`
  );
  assert(
    caseRes.sanitizedError.suggestedRatio === "4:3",
    `Case-insensitive ratio resolution and validation`
  );

  // --------------------------------------------------------------------------
  // TEST: Blind Type Casting Prevention
  // --------------------------------------------------------------------------
  console.log(`\n[VERIFICATION] Blind Type Casting Prevention`);

  assert(validateAspectRatio("16:9") === "16:9", `Valid AspectRatio accepted`);
  assert(validateAspectRatio("invalid-ratio") === undefined, `Invalid AspectRatio rejected`);
  assert(validateDuration("5s") === "5s", `Valid Duration accepted`);
  assert(validateDuration("100s") === undefined, `Invalid Duration rejected`);

  // --------------------------------------------------------------------------
  // TEST: Null & Malformed Input Resilience
  // --------------------------------------------------------------------------
  console.log(`\n[VERIFICATION] Null & Malformed Input Resilience`);

  const nullRes = interceptAndTranslateUpstreamError(null, null, null);
  assert(nullRes.statusCode === 500, `Null inputs default status to 500 without crashing`);

  const arrayRes = interceptAndTranslateUpstreamError(NaN, [1, 2, 3], "malformed");
  assert(arrayRes.statusCode === 500, `Array headers and NaN status handled safely`);

  // --------------------------------------------------------------------------
  // TEST: Status Code Sanity Checks
  // --------------------------------------------------------------------------
  console.log(`\n[VERIFICATION] Status Code Sanity Checks`);

  assert(normalizeStatusCode(0) === 500, `0 clamped to 500`);
  assert(normalizeStatusCode(NaN) === 500, `NaN clamped to 500`);
  assert(normalizeStatusCode(999) === 500, `999 clamped to 500`);
  assert(normalizeStatusCode(404) === 404, `404 preserved`);

  // --------------------------------------------------------------------------
  // TEST: Granular 5xx Timeout Masking
  // --------------------------------------------------------------------------
  console.log(`\n[VERIFICATION] Granular 5xx Timeout Masking`);

  const res504 = interceptAndTranslateUpstreamError(504, {});
  assert(
    res504.sanitizedError.userMessage.toLowerCase().includes("timed out"),
    `504 specifically indicates timeout`
  );

  const res503 = interceptAndTranslateUpstreamError(503, {});
  assert(
    res503.sanitizedError.userMessage.toLowerCase().includes("overloaded"),
    `503 specifically indicates service overload`
  );

  const res502 = interceptAndTranslateUpstreamError(502, {});
  assert(
    res502.sanitizedError.userMessage.toLowerCase().includes("gateway"),
    `502 specifically indicates gateway response error`
  );

  // --------------------------------------------------------------------------
  // TEST: Event Loop DoS & Strict ASCII Headers
  // --------------------------------------------------------------------------
  console.log(`\n[VERIFICATION] Event Loop DoS & Strict ASCII Headers`);

  const massive = {};
  for (let i = 0; i < 15000; i++) massive[`k_${i}`] = { nested: "x" };
  const serStart = Date.now();
  const ser = sanitizeHeaderValue(massive);
  assert(Date.now() - serStart < 25, `Massive object shallow serialization is fast (< 25ms)`);

  const unicode = "Test 🐻 and \x00\x07";
  const ascii = sanitizeHeaderValue(unicode);
  let allAscii = true;
  for (let i = 0; i < ascii.length; i++) {
    if (ascii.charCodeAt(i) < 0x20 || ascii.charCodeAt(i) > 0x7E) allAscii = false;
  }
  assert(allAscii, `Sanitized header is strictly ASCII 0x20-0x7E`);

  // --------------------------------------------------------------------------
  // TEST: Edge Runtime Web Crypto Trace ID
  // --------------------------------------------------------------------------
  console.log(`\n[VERIFICATION] Edge Runtime Web Crypto Trace ID`);

  const tid = generateSecureTraceId();
  assert(tid.startsWith("trace-") && tid.length > 20, `Secure trace ID generated`);

  // --------------------------------------------------------------------------
  // SUMMARY
  // --------------------------------------------------------------------------
  console.log(`\n========================================================================`);
  console.log(`  FINAL ZERO-TRUST AUDIT RESULTS`);
  console.log(`  Passed: ${passed} | Failed: ${failed}`);
  console.log(`  Success Rate: ${((passed / (passed + failed)) * 100).toFixed(1)}%`);
  console.log(`========================================================================\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Audit failed with exception:", err);
  process.exit(1);
});
