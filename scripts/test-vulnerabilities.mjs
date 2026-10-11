/**
 * ============================================================================
 * ZYKA AI — Zero-Trust Security & Staff-Level Hardening Verification Suite
 * ============================================================================
 * Rigorous tests covering:
 * 1. Header Case-Insensitivity (Silent Bypass Prevention)
 * 2. Blind Type Casting (Runtime Corruption Prevention)
 * 3. Null / Malformed Input Resilience (Crash Prevention)
 * 4. XSS & Payload Injection via String Interpolation (HTML Entity Escaping)
 * 5. Prototype Pollution in Metadata (Poisoned Key Defenses)
 * 6. Status Code Sanity Checks (Clamping & NaN Coercion)
 * 7. Granular 5xx Timeout Masking (504 Gateway Timeout, 503 Overload)
 * 8. Synchronous Event Loop Blocking (DoS Vector Prevention via Shallow Serialization)
 * 9. Unicode Header Crashes (ERR_INVALID_CHAR Prevention via Strict ASCII 0x20-0x7E)
 * 10. Catastrophic Regex Backtracking (ReDoS Defense via 250-char window & bounded patterns)
 * 11. Cumulative Header Size Overflow (431 Bypass Defense via Allowlist & 4KB Budget)
 * 12. Edge Runtime Compatibility (Web Crypto API without bundler-hostile require)
 * ============================================================================
 */

import {
  interceptAndTranslateUpstreamError,
  sanitizeHeaderValue,
  generateSecureTraceId,
  escapeHtml,
  validateAspectRatio,
  validateDuration,
  validateService,
  normalizeStatusCode,
  normalizeHeaders,
  getSafeMetadata,
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
  console.log(`  ZYKA AI — ZERO-TRUST HARDENING & SECURITY AUDIT SUITE`);
  console.log(`  Timestamp: ${new Date().toISOString()}`);
  console.log(`========================================================================\n`);

  // --------------------------------------------------------------------------
  // TEST 1: Header Case-Insensitivity (Silent Bypass Prevention)
  // --------------------------------------------------------------------------
  console.log(`[OBJECTIVE 1] Header Case-Insensitivity (Silent Bypass Prevention)`);

  const caseMismatchedHeaders = {
    "X-UPSTREAM-ERROR-CODE": "ERR_ASPECT_RATIO_DROPDOWN_CONFLICT",
    "X-Upstream-Raw-Error": "Custom error with ratio conflict",
    "X-Upstream-Service": "Zyka-Core-Rescaler",
    "X-Upstream-Trace-Id": "trace-case-probe-99",
    "X-Conflicting-Prompt-Ratio": "4:3",
    "X-Selected-Dropdown-Ratio": "16:9",
  };

  const caseResult = interceptAndTranslateUpstreamError(422, caseMismatchedHeaders);

  assert(
    caseResult.rawError.code === "ERR_ASPECT_RATIO_DROPDOWN_CONFLICT",
    `Extracted error code case-insensitively from 'X-UPSTREAM-ERROR-CODE': ${caseResult.rawError.code}`
  );
  assert(
    caseResult.rawError.traceId === "trace-case-probe-99",
    `Extracted trace ID case-insensitively from 'X-Upstream-Trace-Id'`
  );
  assert(
    caseResult.sanitizedError.userMessage === "Your prompt requested 4:3, but 16:9 is selected in the aspect ratio dropdown.",
    `Sanitized message constructed accurately using case-insensitive ratios: "${caseResult.sanitizedError.userMessage}"`
  );
  assert(
    caseResult.sanitizedError.suggestedRatio === "4:3",
    `suggestedRatio correctly extracted as '4:3'`
  );

  // --------------------------------------------------------------------------
  // TEST 2: Blind Type Casting (Runtime Corruption Prevention)
  // --------------------------------------------------------------------------
  console.log(`\n[OBJECTIVE 2] Blind Type Casting Prevention & Runtime Literal Validation`);

  assert(
    validateAspectRatio("16:9") === "16:9" && validateAspectRatio("9:16") === "9:16",
    `validateAspectRatio accepts valid AspectRatio literals ('16:9', '9:16')`
  );
  assert(
    validateAspectRatio("<script>alert(1)</script>") === undefined,
    `validateAspectRatio drops XSS string to undefined`
  );
  assert(
    validateAspectRatio("32:9") === undefined && validateAspectRatio("custom-ratio") === undefined,
    `validateAspectRatio drops unsupported ratio to undefined`
  );

  assert(
    validateDuration("5s") === "5s" && validateDuration("30s") === "30s",
    `validateDuration accepts valid Duration literals ('5s', '30s')`
  );
  assert(
    validateDuration("9999s") === undefined && validateDuration("malicious_duration") === undefined,
    `validateDuration drops out-of-range duration to undefined`
  );

  // Attack payload: attempt to inject malicious string into AspectRatio
  const maliciousRatioResult = interceptAndTranslateUpstreamError(
    422,
    { "x-upstream-error-code": "ERR_ASPECT_RATIO_DROPDOWN_CONFLICT" },
    {
      code: "ERR_ASPECT_RATIO_DROPDOWN_CONFLICT",
      metadata: {
        conflictingRatio: "<img src=x onerror=alert(1)>",
        selectedRatio: "16:9",
      },
    }
  );

  assert(
    maliciousRatioResult.sanitizedError.suggestedRatio === undefined,
    `suggestedRatio safely dropped to undefined when given malicious value (got: ${maliciousRatioResult.sanitizedError.suggestedRatio})`
  );
  assert(
    maliciousRatioResult.sanitizedError.actionLabel === undefined,
    `actionLabel safely suppressed when ratio validation fails`
  );

  // --------------------------------------------------------------------------
  // TEST 3: Null / Malformed Input Resilience (Crash Prevention)
  // --------------------------------------------------------------------------
  console.log(`\n[OBJECTIVE 3] Null / Malformed Input Resilience (Zero Crash Guarantee)`);

  let nullHeadersResult, undefinedResult, arrayHeadersResult, primitiveResult;
  try {
    nullHeadersResult = interceptAndTranslateUpstreamError(500, null, null);
    undefinedResult = interceptAndTranslateUpstreamError(undefined, undefined, undefined);
    arrayHeadersResult = interceptAndTranslateUpstreamError(400, ["malformed", "array"], "invalid-payload");
    primitiveResult = interceptAndTranslateUpstreamError("not-a-number", 12345, true);
  } catch (err) {
    console.error("Null input crashed with exception:", err);
  }

  assert(
    nullHeadersResult !== undefined && nullHeadersResult.statusCode === 500,
    `Gracefully handles null status, null headers, and null payload without crashing`
  );
  assert(
    undefinedResult !== undefined && undefinedResult.statusCode === 500,
    `Gracefully handles undefined inputs (defaults status to 500)`
  );
  assert(
    arrayHeadersResult !== undefined && arrayHeadersResult.statusCode === 400,
    `Gracefully absorbs array passed as headers without Object.entries crash`
  );
  assert(
    primitiveResult !== undefined && primitiveResult.statusCode === 500,
    `Gracefully coerces invalid string/number status to 500`
  );

  // --------------------------------------------------------------------------
  // TEST 4: XSS & Payload Injection via String Interpolation
  // --------------------------------------------------------------------------
  console.log(`\n[OBJECTIVE 4] XSS & Payload Injection via String Interpolation`);

  const rawXssInput = "<script>alert('xss')</script> & \"injection\"";
  const escaped = escapeHtml(rawXssInput);

  assert(
    !escaped.includes("<") && !escaped.includes(">") && !escaped.includes("\"") && !escaped.includes("'"),
    `escapeHtml neutralizes all dangerous HTML characters (<, >, ", ')`
  );
  assert(
    escaped.includes("&lt;script&gt;") && escaped.includes("&amp;"),
    `escapeHtml correctly converts entities to &lt;script&gt; and &amp;`
  );

  // End-to-end XSS injection test in unsupported ratio
  const xssRatioResult = interceptAndTranslateUpstreamError(
    422,
    { "x-upstream-error-code": "ERR_UNSUPPORTED_ASPECT_RATIO_IN_PROMPT" },
    {
      code: "ERR_UNSUPPORTED_ASPECT_RATIO_IN_PROMPT",
      metadata: {
        invalidRatio: "<script>document.location='http://attacker.com'</script>",
      },
    }
  );

  assert(
    !xssRatioResult.sanitizedError.userMessage.includes("<script>"),
    `userMessage strictly escapes script tag: "${xssRatioResult.sanitizedError.userMessage}"`
  );
  assert(
    xssRatioResult.sanitizedError.userMessage.includes("&lt;script&gt;"),
    `userMessage includes safe HTML entity &lt;script&gt;`
  );

  // --------------------------------------------------------------------------
  // TEST 5: Prototype Pollution in Metadata
  // --------------------------------------------------------------------------
  console.log(`\n[OBJECTIVE 5] Prototype Pollution Defense in Metadata`);

  const poisonedMetadata = JSON.parse('{"__proto__":{"polluted":true},"constructor":{"polluted":true},"validKey":"safe_value"}');

  assert(
    getSafeMetadata(poisonedMetadata, "__proto__") === undefined,
    `getSafeMetadata blocks '__proto__' access`
  );
  assert(
    getSafeMetadata(poisonedMetadata, "constructor") === undefined,
    `getSafeMetadata blocks 'constructor' access`
  );
  assert(
    getSafeMetadata(poisonedMetadata, "prototype") === undefined,
    `getSafeMetadata blocks 'prototype' access`
  );
  assert(
    getSafeMetadata(poisonedMetadata, "validKey") === "safe_value",
    `getSafeMetadata allows legitimate own-properties`
  );

  const pollutionResult = interceptAndTranslateUpstreamError(
    422,
    { "x-upstream-error-code": "ERR_ASPECT_RATIO_DROPDOWN_CONFLICT" },
    {
      code: "ERR_ASPECT_RATIO_DROPDOWN_CONFLICT",
      metadata: poisonedMetadata,
    }
  );

  assert(
    pollutionResult.sanitizedError.category === "ASPECT_RATIO",
    `Interceptor executed safely without prototype corruption`
  );

  // --------------------------------------------------------------------------
  // TEST 6: Status Code Sanity Checks
  // --------------------------------------------------------------------------
  console.log(`\n[OBJECTIVE 6] Status Code Sanity Checks & Clamping`);

  assert(normalizeStatusCode(200) === 200, `Accepts 200`);
  assert(normalizeStatusCode(404) === 404, `Accepts 404`);
  assert(normalizeStatusCode(500) === 500, `Accepts 500`);
  assert(normalizeStatusCode(0) === 500, `Clamps 0 to 500`);
  assert(normalizeStatusCode(NaN) === 500, `Clamps NaN to 500`);
  assert(normalizeStatusCode(undefined) === 500, `Clamps undefined to 500`);
  assert(normalizeStatusCode(null) === 500, `Clamps null to 500`);
  assert(normalizeStatusCode(-200) === 500, `Clamps negative status to 500`);
  assert(normalizeStatusCode(999) === 500, `Clamps out-of-range status (> 599) to 500`);
  assert(normalizeStatusCode("422") === 422, `Parses valid string status "422" to 422`);

  // --------------------------------------------------------------------------
  // TEST 7: Granular 5xx Timeout Masking
  // --------------------------------------------------------------------------
  console.log(`\n[OBJECTIVE 7] Granular 5xx Timeout & Overload Masking`);

  // 504 Gateway Timeout
  const timeout504 = interceptAndTranslateUpstreamError(504, {
    "x-upstream-error-code": "ERR_GATEWAY_TIMEOUT",
  });
  assert(
    timeout504.sanitizedError.category === "SYSTEM",
    `504 categorized as SYSTEM`
  );
  assert(
    timeout504.sanitizedError.userMessage.toLowerCase().includes("timed out"),
    `504 message conveys timeout: "${timeout504.sanitizedError.userMessage}"`
  );
  assert(
    timeout504.sanitizedError.actionableTip.toLowerCase().includes("reducing duration") ||
      timeout504.sanitizedError.actionableTip.toLowerCase().includes("timeout"),
    `504 tip suggests reducing duration or prompt complexity`
  );

  // 503 Service Unavailable
  const overload503 = interceptAndTranslateUpstreamError(503, {
    "x-upstream-error-code": "ERR_SERVICE_OVERLOADED",
  });
  assert(
    overload503.sanitizedError.userMessage.toLowerCase().includes("overloaded"),
    `503 message communicates service overload: "${overload503.sanitizedError.userMessage}"`
  );
  assert(
    overload503.sanitizedError.actionableTip.toLowerCase().includes("capacity"),
    `503 tip communicates cluster capacity`
  );

  // 502 Bad Gateway
  const gateway502 = interceptAndTranslateUpstreamError(502, {
    "x-upstream-error-code": "ERR_BAD_GATEWAY",
  });
  assert(
    gateway502.sanitizedError.userMessage.toLowerCase().includes("gateway"),
    `502 message communicates gateway synchronization`
  );

  // 500 Internal Server Error
  const generic500 = interceptAndTranslateUpstreamError(500, {});
  assert(
    generic500.sanitizedError.userMessage.toLowerCase().includes("unexpected error"),
    `500 message communicates standard unexpected server error`
  );

  // --------------------------------------------------------------------------
  // TEST 8: Event Loop DoS Defense (20,000-key object shallow serialization)
  // --------------------------------------------------------------------------
  console.log(`\n[OBJECTIVE 8] Event Loop DoS Defense (Shallow Serialization)`);

  const massiveObject = {};
  for (let i = 0; i < 20000; i++) {
    massiveObject[`payload_key_${i}`] = { nested: "x".repeat(100) };
  }

  const startMs = Date.now();
  const serialized = sanitizeHeaderValue(massiveObject);
  const durationMs = Date.now() - startMs;

  assert(
    durationMs < 25,
    `Shallow serialization completed in ${durationMs}ms (< 25ms threshold, 0 event loop lag)`
  );
  assert(
    !serialized.includes("[object Object]"),
    `Header does not degrade to '[object Object]'`
  );

  // --------------------------------------------------------------------------
  // TEST 9: Strict ASCII Header Encoding (Node ERR_INVALID_CHAR Defense)
  // --------------------------------------------------------------------------
  console.log(`\n[OBJECTIVE 9] Strict ASCII Header Encoding (0x20-0x7E)`);

  const unicodeHeader = "Prompt with emojis 🐻 🚀, Cyrillic Привет, Chinese 艺术, and \x00\x07";
  const sanitizedAscii = sanitizeHeaderValue(unicodeHeader);

  let hasInvalidChar = false;
  for (let i = 0; i < sanitizedAscii.length; i++) {
    const code = sanitizedAscii.charCodeAt(i);
    if (code < 0x20 || code > 0x7E) {
      hasInvalidChar = true;
      break;
    }
  }

  assert(!hasInvalidChar, `All characters strictly in 0x20-0x7E range`);

  const h = new Headers();
  h.set("x-test-header", sanitizedAscii);
  assert(
    h.get("x-test-header") === sanitizedAscii,
    `Node.js Headers engine accepted sanitized ASCII header`
  );

  // --------------------------------------------------------------------------
  // TEST 10: ReDoS Defense (250-character window & bounded patterns)
  // --------------------------------------------------------------------------
  console.log(`\n[OBJECTIVE 10] ReDoS Defense`);

  const redosBomb = "prompt semantic ratio " + "   ".repeat(15000) + "x";
  const redosStart = Date.now();
  const redosResult = interceptAndTranslateUpstreamError(422, {
    "x-upstream-error-code": "ERR_ASPECT_RATIO_DROPDOWN_CONFLICT",
    "x-upstream-raw-error": redosBomb,
  });
  const redosDuration = Date.now() - redosStart;

  assert(redosDuration < 10, `ReDoS payload processed in ${redosDuration}ms (< 10ms threshold)`);
  assert(redosResult.sanitizedError.category === "ASPECT_RATIO", `ReDoS error category processed safely`);

  // --------------------------------------------------------------------------
  // TEST 11: Cumulative Header Size Overflow (4KB budget)
  // --------------------------------------------------------------------------
  console.log(`\n[OBJECTIVE 11] Cumulative Header Budget & Allowlist`);

  const junkUpstreamHeaders = {
    "x-upstream-error-code": "ERR_ASPECT_RATIO_MISMATCH",
    "x-upstream-service": "Zyka-Spatial-Engine",
  };
  for (let i = 0; i < 40; i++) {
    junkUpstreamHeaders[`x-untrusted-junk-header-${i}`] = "JUNK_DATA_".repeat(100);
  }

  const budgetResult = interceptAndTranslateUpstreamError(422, junkUpstreamHeaders);
  let totalHeaderBytes = 0;
  for (const [k, v] of Object.entries(budgetResult.responseHeaders)) {
    totalHeaderBytes += k.length + v.length + 4;
  }

  assert(
    totalHeaderBytes <= 4096,
    `Total response headers (${totalHeaderBytes} bytes) strictly within 4096-byte budget`
  );

  // --------------------------------------------------------------------------
  // TEST 12: Edge Runtime Web Crypto Trace ID
  // --------------------------------------------------------------------------
  console.log(`\n[OBJECTIVE 12] Edge Runtime Web Crypto Trace ID`);

  const traceId = generateSecureTraceId();
  const uuidRegex = /^trace-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  assert(uuidRegex.test(traceId), `Trace ID is valid RFC 4122 UUID: ${traceId}`);

  // --------------------------------------------------------------------------
  // SUMMARY
  // --------------------------------------------------------------------------
  console.log(`\n========================================================================`);
  console.log(`  ZERO-TRUST SECURITY AUDIT SUMMARY`);
  console.log(`  Passed: ${passed} | Failed: ${failed}`);
  console.log(`  Success Rate: ${((passed / (passed + failed)) * 100).toFixed(1)}%`);
  console.log(`========================================================================\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Zero-trust security audit failed with exception:", err);
  process.exit(1);
});
