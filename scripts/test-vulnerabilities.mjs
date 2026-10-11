/**
 * ============================================================================
 * ZYKA AI — Targeted Vulnerability Hardening Test Suite
 * Verifies fixes for the 5 structural & runtime vulnerabilities in error-interceptor.ts:
 * 1. Structured metadata priority (resilience against regex breakage)
 * 2. Uncapped header size limits (431 truncation <= 1000 chars)
 * 3. Blind object coercion safe serialization (no "[object Object]")
 * 4. High-collision trace IDs (RFC 4122 UUID uniqueness under concurrent load)
 * 5. Catch-all for unhandled 4xx errors (categorized as VALIDATION)
 * ============================================================================
 */

import {
  interceptAndTranslateUpstreamError,
  sanitizeHeaderValue,
  generateSecureTraceId,
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
  console.log(`  ZYKA AI — ERROR INTERCEPTOR VULNERABILITY VERIFICATION`);
  console.log(`  Timestamp: ${new Date().toISOString()}`);
  console.log(`========================================================================\n`);

  // --------------------------------------------------------------------------
  // FIX 1: Structured Metadata Priority (Resilient to Upstream String Drift)
  // --------------------------------------------------------------------------
  console.log(`[VULN 1] Resilient Metadata Parsing Over Fragile String Scraping`);

  // Upstream changes message completely to something unmatchable by the old regex:
  const strangeUpstreamMsg = "Anomalous tensor divergence occurred in downstream pipeline cluster-9.";

  const ratioResult = interceptAndTranslateUpstreamError(
    422,
    { "x-upstream-error-code": "ERR_ASPECT_RATIO_DROPDOWN_CONFLICT" },
    {
      code: "ERR_ASPECT_RATIO_DROPDOWN_CONFLICT",
      technicalMessage: strangeUpstreamMsg,
      metadata: {
        conflictingRatio: "4:3",
        selectedRatio: "16:9",
      },
    }
  );

  assert(
    ratioResult.sanitizedError.userMessage === "Your prompt requested 4:3, but 16:9 is selected in the aspect ratio dropdown.",
    `Aspect ratio conflict uses structured metadata even with completely altered upstream string: "${ratioResult.sanitizedError.userMessage}"`
  );
  assert(
    ratioResult.sanitizedError.suggestedRatio === "4:3",
    `suggestedRatio correctly extracted as '4:3'`
  );

  const durationResult = interceptAndTranslateUpstreamError(
    422,
    { "x-upstream-error-code": "ERR_DURATION_DROPDOWN_CONFLICT" },
    {
      code: "ERR_DURATION_DROPDOWN_CONFLICT",
      technicalMessage: strangeUpstreamMsg,
      metadata: {
        conflictingDuration: "12s",
        selectedDuration: "5s",
      },
    }
  );

  assert(
    durationResult.sanitizedError.userMessage === "Your prompt requested 12s, but 5s is selected in the duration dropdown.",
    `Duration conflict uses structured metadata: "${durationResult.sanitizedError.userMessage}"`
  );

  const unsupportedRatioResult = interceptAndTranslateUpstreamError(
    422,
    { "x-upstream-error-code": "ERR_UNSUPPORTED_ASPECT_RATIO_IN_PROMPT" },
    {
      code: "ERR_UNSUPPORTED_ASPECT_RATIO_IN_PROMPT",
      technicalMessage: strangeUpstreamMsg,
      metadata: {
        invalidRatio: "3:1",
      },
    }
  );

  assert(
    unsupportedRatioResult.sanitizedError.userMessage === "The aspect ratio '3:1' in your prompt is not supported.",
    `Unsupported ratio uses structured metadata: "${unsupportedRatioResult.sanitizedError.userMessage}"`
  );

  // --------------------------------------------------------------------------
  // FIX 2: Uncapped Header Size Limits (Prevent HTTP 431 Proxy Crashes)
  // --------------------------------------------------------------------------
  console.log(`\n[VULN 2] Header Size Limits (Truncation to <= 1000 Chars)`);

  // Massive 25KB stack trace
  const massiveStackTrace = "java.lang.NullPointerException: Service fault\n" + "at com.zyka.gpu.Worker.process(Worker.java:42)\n".repeat(500);

  const headerSanitized = sanitizeHeaderValue(massiveStackTrace);
  assert(
    headerSanitized.length <= 1000,
    `sanitizeHeaderValue truncates 25KB string to <= 1000 chars (actual: ${headerSanitized.length})`
  );
  assert(
    !headerSanitized.includes("\n") && !headerSanitized.includes("\r"),
    `Header sanitization strips carriage returns and newlines`
  );

  const massiveResult = interceptAndTranslateUpstreamError(
    500,
    {
      "x-upstream-error-code": "ERR_INTERNAL_FAULT",
      "x-upstream-raw-error": massiveStackTrace,
      "x-custom-giant-header": "A".repeat(5000),
    }
  );

  for (const [key, val] of Object.entries(massiveResult.responseHeaders)) {
    assert(
      val.length <= 1000,
      `Header '${key}' length (${val.length}) is strictly <= 1000 chars`
    );
  }

  // --------------------------------------------------------------------------
  // FIX 3: Blind Object Coercion in Headers (No "[object Object]")
  // --------------------------------------------------------------------------
  console.log(`\n[VULN 3] Safe Object Serialization (No '[object Object]')`);

  const complexObject = {
    errorCode: "GPU_OOM_0x42",
    details: { allocatedBytes: 24000000000, freeBytes: 12000 },
  };

  const objectSanitized = sanitizeHeaderValue(complexObject);
  assert(
    !objectSanitized.includes("[object Object]"),
    `Object header is NOT coerced to '[object Object]' (actual: "${objectSanitized}")`
  );
  assert(
    objectSanitized.includes("GPU_OOM_0x42"),
    `Object header contains valid JSON serialized properties`
  );

  const arraySanitized = sanitizeHeaderValue(["ratio_1", "ratio_2"]);
  assert(
    !arraySanitized.includes("[object Object]"),
    `Array header is cleanly serialized: "${arraySanitized}"`
  );

  // --------------------------------------------------------------------------
  // FIX 4: High-Collision Trace IDs (crypto.randomUUID() under High Concurrency)
  // --------------------------------------------------------------------------
  console.log(`\n[VULN 4] Collision-Free Trace IDs Under High Concurrency`);

  const CONCURRENT_COUNT = 500;
  const traceIds = new Set();
  const uuidRegex = /^trace-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  for (let i = 0; i < CONCURRENT_COUNT; i++) {
    const tid = generateSecureTraceId();
    traceIds.add(tid);
  }

  assert(
    traceIds.size === CONCURRENT_COUNT,
    `Zero collisions generated across ${CONCURRENT_COUNT} rapid trace ID calls (${traceIds.size}/${CONCURRENT_COUNT} unique)`
  );

  const sampleTraceId = generateSecureTraceId();
  assert(
    uuidRegex.test(sampleTraceId),
    `Trace ID follows RFC 4122 UUID format: ${sampleTraceId}`
  );

  // --------------------------------------------------------------------------
  // FIX 5: Incomplete Catch-All for 4xx Errors (Categorized as VALIDATION)
  // --------------------------------------------------------------------------
  console.log(`\n[VULN 5] Catch-All for Unhandled 4xx Errors`);

  // Unhandled 400 Bad Request
  const unhandled400 = interceptAndTranslateUpstreamError(400, {
    "x-upstream-error-code": "ERR_UNKNOWN_CLIENT_FIELD",
  });
  assert(
    unhandled400.sanitizedError.category === "VALIDATION",
    `Unhandled 400 categorized as VALIDATION (got: ${unhandled400.sanitizedError.category})`
  );
  assert(
    unhandled400.sanitizedError.userMessage !== "An unexpected error occurred. Please try again.",
    `Unhandled 400 has contextual client message: "${unhandled400.sanitizedError.userMessage}"`
  );

  // Unhandled 422 Unprocessable Entity
  const unhandled422 = interceptAndTranslateUpstreamError(422, {
    "x-upstream-error-code": "ERR_DOWNSTREAM_SEMANTIC_INVALID",
  });
  assert(
    unhandled422.sanitizedError.category === "VALIDATION",
    `Unhandled 422 categorized as VALIDATION (got: ${unhandled422.sanitizedError.category})`
  );

  // Unhandled 404 Not Found
  const unhandled404 = interceptAndTranslateUpstreamError(404, {
    "x-upstream-error-code": "ERR_MODEL_NOT_FOUND",
  });
  assert(
    unhandled404.sanitizedError.category === "VALIDATION",
    `Unhandled 404 categorized as VALIDATION`
  );

  // 500 still correctly categorized as SYSTEM
  const unhandled500 = interceptAndTranslateUpstreamError(500, {
    "x-upstream-error-code": "ERR_UNKNOWN_BACKEND_CRASH",
  });
  assert(
    unhandled500.sanitizedError.category === "SYSTEM",
    `500 error remains categorized as SYSTEM`
  );

  // --------------------------------------------------------------------------
  // SUMMARY
  // --------------------------------------------------------------------------
  console.log(`\n========================================================================`);
  console.log(`  VULNERABILITY VERIFICATION RESULTS`);
  console.log(`  Passed: ${passed} | Failed: ${failed}`);
  console.log(`  Success Rate: ${((passed / (passed + failed)) * 100).toFixed(1)}%`);
  console.log(`========================================================================\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Vulnerability verification failed with exception:", err);
  process.exit(1);
});
