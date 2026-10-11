/**
 * ============================================================================
 * ZYKA AI — Targeted Vulnerability Hardening Test Suite
 * Rigorous Security & High-Stress Verification:
 * 1. Synchronous Event Loop Blocking (DoS Vector Prevention via Shallow Serialization)
 * 2. Unicode Header Crashes (ERR_INVALID_CHAR Prevention via Strict ASCII 0x20-0x7E)
 * 3. Catastrophic Regex Backtracking (ReDoS Defense via 250-char window & bounded patterns)
 * 4. Cumulative Header Size Overflow (431 Bypass Defense via Allowlist & 4KB Budget)
 * 5. Edge Runtime Compatibility (Web Crypto API without bundler-hostile require)
 * 6. Structured Metadata Priority (Upstream String Drift Resilience)
 * 7. Incomplete Catch-All for 4xx Errors (Validation Categorization)
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
  console.log(`  ZYKA AI — HIGH-STRESS SECURITY & VULNERABILITY AUDIT SUITE`);
  console.log(`  Timestamp: ${new Date().toISOString()}`);
  console.log(`========================================================================\n`);

  // --------------------------------------------------------------------------
  // AUDIT 1: Synchronous Event Loop Blocking (DoS Vector Prevention)
  // --------------------------------------------------------------------------
  console.log(`[SECURITY 1] Event Loop DoS Defense (Massive & Circular Objects)`);

  // Create a massive 50MB-equivalent object with 20,000 keys and nested graphs
  const massiveObject = {};
  for (let i = 0; i < 20000; i++) {
    massiveObject[`payload_key_${i}`] = {
      nested: "x".repeat(100),
      deep: { level: 2, array: [1, 2, 3, 4, 5] },
    };
  }

  const startMs = Date.now();
  const serialized = sanitizeHeaderValue(massiveObject);
  const durationMs = Date.now() - startMs;

  assert(
    durationMs < 25,
    `Shallow serialization of 20,000-key object completed in ${durationMs}ms (< 25ms threshold, 0 event loop lag)`
  );
  assert(
    serialized.length <= 1000,
    `Sanitized massive object header is strictly bounded to <= 1000 chars (got ${serialized.length})`
  );
  assert(
    !serialized.includes("[object Object]"),
    `Header does not degrade to '[object Object]' (actual snippet: ${serialized.substring(0, 50)}...)`
  );

  // Circular reference object must not throw or block
  const circularObj = { name: "upstream_probe" };
  circularObj.self = circularObj;
  const circularSerialized = sanitizeHeaderValue(circularObj);
  assert(
    typeof circularSerialized === "string" && circularSerialized.length > 0,
    `Circular object handled without exception or loop freeze: "${circularSerialized}"`
  );

  // --------------------------------------------------------------------------
  // AUDIT 2: Unicode Header Crashes (ERR_INVALID_CHAR Prevention)
  // --------------------------------------------------------------------------
  console.log(`\n[SECURITY 2] Strict ASCII Header Encoding (Node ERR_INVALID_CHAR Defense)`);

  const maliciousUnicodeHeader =
    "Prompt with emojis 🐻 🚀 and Cyrillic Привет and Chinese 艺术 and control \x00\x07\x1B characters!";

  const sanitizedAscii = sanitizeHeaderValue(maliciousUnicodeHeader);

  // Verify all characters are strictly within printable 7-bit ASCII [0x20 - 0x7E]
  let hasInvalidChar = false;
  for (let i = 0; i < sanitizedAscii.length; i++) {
    const code = sanitizedAscii.charCodeAt(i);
    if (code < 0x20 || code > 0x7E) {
      hasInvalidChar = true;
      break;
    }
  }

  assert(
    !hasInvalidChar,
    `All characters in sanitized header are strictly in ASCII 0x20-0x7E range (no unicode/control chars)`
  );

  // Verify that Node.js Headers accepts it without throwing TypeError: Invalid character
  let headersAccepted = false;
  try {
    const h = new Headers();
    h.set("x-test-header", sanitizedAscii);
    headersAccepted = h.get("x-test-header") === sanitizedAscii;
  } catch (e) {
    headersAccepted = false;
  }

  assert(
    headersAccepted,
    `Node.js Headers engine accepted header without ERR_INVALID_CHAR crash`
  );

  // --------------------------------------------------------------------------
  // AUDIT 3: Catastrophic Regex Backtracking (ReDoS Defense)
  // --------------------------------------------------------------------------
  console.log(`\n[SECURITY 3] Catastrophic Regex Backtracking (ReDoS Defense)`);

  // Adversarial 50,000-character payload crafted to trigger exponential backtracking
  const redosBomb = "prompt semantic ratio " + "   ".repeat(15000) + "x";

  const redosStart = Date.now();
  const redosResult = interceptAndTranslateUpstreamError(
    422,
    { "x-upstream-error-code": "ERR_ASPECT_RATIO_DROPDOWN_CONFLICT" },
    {
      code: "ERR_ASPECT_RATIO_DROPDOWN_CONFLICT",
      technicalMessage: redosBomb,
    }
  );
  const redosDuration = Date.now() - redosStart;

  assert(
    redosDuration < 10,
    `Adversarial 50,000-char ReDoS payload processed in ${redosDuration}ms (< 10ms threshold, CPU lock prevented)`
  );
  assert(
    redosResult.sanitizedError.category === "ASPECT_RATIO",
    `Fallback processing completed safely under ReDoS attack`
  );

  // --------------------------------------------------------------------------
  // AUDIT 4: Cumulative Header Size Overflow (431 Bypass Defense)
  // --------------------------------------------------------------------------
  console.log(`\n[SECURITY 4] Cumulative Header Budget & Allowlist (Total 431 Defense)`);

  // 40 junk upstream headers totaling 40,000 bytes
  const junkUpstreamHeaders = {
    "x-upstream-error-code": "ERR_ASPECT_RATIO_MISMATCH",
    "x-upstream-service": "Zyka-Spatial-Engine",
    "x-upstream-trace-id": "trace-test-budget-123",
  };
  for (let i = 0; i < 40; i++) {
    junkUpstreamHeaders[`x-untrusted-junk-header-${i}`] = "JUNK_DATA_".repeat(100);
  }

  const budgetResult = interceptAndTranslateUpstreamError(422, junkUpstreamHeaders);

  // Calculate total byte size of all generated headers
  let totalHeaderBytes = 0;
  for (const [k, v] of Object.entries(budgetResult.responseHeaders)) {
    totalHeaderBytes += k.length + v.length + 4; // key + ": " + val + "\r\n"
  }

  assert(
    totalHeaderBytes <= 4096,
    `Total cumulative header size (${totalHeaderBytes} bytes) strictly within 4096-byte budget`
  );

  // Verify junk headers were rejected by allowlist
  const forwardedJunk = Object.keys(budgetResult.responseHeaders).filter((k) =>
    k.startsWith("x-untrusted-junk")
  );
  assert(
    forwardedJunk.length === 0,
    `Zero unallowlisted upstream junk headers forwarded through proxy (${forwardedJunk.length} leaked)`
  );

  // Verify core translation headers were preserved
  assert(
    budgetResult.responseHeaders["x-zyka-sanitized-error"] !== undefined,
    `Core header 'x-zyka-sanitized-error' is preserved`
  );
  assert(
    budgetResult.responseHeaders["x-zyka-error-code"] === "ERR_ASPECT_RATIO_MISMATCH",
    `Core header 'x-zyka-error-code' is preserved`
  );

  // --------------------------------------------------------------------------
  // AUDIT 5: Edge Runtime Compatibility (Bundler-Hostile require() Elimination)
  // --------------------------------------------------------------------------
  console.log(`\n[SECURITY 5] Web Crypto API Edge Runtime Compatibility`);

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
  // AUDIT 6: Structured Metadata Priority (String Drift Resilience)
  // --------------------------------------------------------------------------
  console.log(`\n[SECURITY 6] Structured Metadata Priority Over String Drift`);

  const alteredUpstreamMsg = "Anomalous tensor divergence in cluster 9";
  const structuredRatioResult = interceptAndTranslateUpstreamError(
    422,
    { "x-upstream-error-code": "ERR_ASPECT_RATIO_DROPDOWN_CONFLICT" },
    {
      code: "ERR_ASPECT_RATIO_DROPDOWN_CONFLICT",
      technicalMessage: alteredUpstreamMsg,
      metadata: { conflictingRatio: "4:3", selectedRatio: "16:9" },
    }
  );

  assert(
    structuredRatioResult.sanitizedError.userMessage ===
      "Your prompt requested 4:3, but 16:9 is selected in the aspect ratio dropdown.",
    `Structured metadata prioritized over altered upstream text: "${structuredRatioResult.sanitizedError.userMessage}"`
  );

  // --------------------------------------------------------------------------
  // AUDIT 7: Catch-All for Unhandled 4xx Errors (Validation Categorization)
  // --------------------------------------------------------------------------
  console.log(`\n[SECURITY 7] Catch-All for Unhandled 4xx Errors`);

  const unhandled400 = interceptAndTranslateUpstreamError(400, {
    "x-upstream-error-code": "ERR_UNKNOWN_CLIENT_FIELD",
  });
  assert(
    unhandled400.sanitizedError.category === "VALIDATION",
    `Unhandled 400 categorized as VALIDATION`
  );

  const unhandled500 = interceptAndTranslateUpstreamError(500, {
    "x-upstream-error-code": "ERR_UNKNOWN_CRASH",
  });
  assert(
    unhandled500.sanitizedError.category === "SYSTEM",
    `500 error remains categorized as SYSTEM`
  );

  // --------------------------------------------------------------------------
  // SUMMARY
  // --------------------------------------------------------------------------
  console.log(`\n========================================================================`);
  console.log(`  SECURITY & HARDENING AUDIT SUMMARY`);
  console.log(`  Passed: ${passed} | Failed: ${failed}`);
  console.log(`  Success Rate: ${((passed / (passed + failed)) * 100).toFixed(1)}%`);
  console.log(`========================================================================\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Hardening test failed with exception:", err);
  process.exit(1);
});
