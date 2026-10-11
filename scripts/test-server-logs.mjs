/**
 * ============================================================================
 * ZYKA AI — SERVER-LEVEL REAL IP & ERROR AUDIT TEST SUITE
 * Verifies zero-trust real IP resolution, stripping of client spoofing headers,
 * protected /api/logs admin authorization, and persistent JSONL disk logging.
 * ============================================================================
 */

import fs from "fs";
import path from "path";

const PORT = process.env.PORT || process.argv[2] || "3000";
const BASE_URL = `http://localhost:${PORT}`;
const ADMIN_TOKEN = process.env.ADMIN_API_TOKEN || "zyka_enterprise_audit_token_test_32chars!";

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
  console.log(`  ZYKA AI — SERVER-LEVEL REAL IP & SECURITY AUDIT VERIFICATION`);
  console.log(`  Target: ${BASE_URL}`);
  console.log(`  Timestamp: ${new Date().toISOString()}`);
  console.log(`========================================================================\n`);

  // TEST 1: Zero-Trust Resolution & Stripping of Client Spoofing Headers
  console.log(`[TEST 1] Client Spoofing Header Stripping & Server Resolution`);
  const res1 = await fetch(`${BASE_URL}/api/generate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "cf-connecting-ip": "198.51.100.77",
      "x-zyka-user-id": "spoofed_admin_user",
      "x-zyka-real-ip": "1.2.3.4",
      "user-agent": "CreatorStudioPro/3.0",
      "x-zyka-request-id": "test-spoof-1",
    },
    body: JSON.stringify({
      prompt: "Create an image 17:8 of neon sunset",
      mediaType: "image",
      aspectRatio: "16:9",
    }),
  });

  const json1 = await res1.json();
  const h1 = Object.fromEntries(res1.headers.entries());

  assert(res1.status === 422, `Status is HTTP 422 Unprocessable Entity (got ${res1.status})`);
  assert(h1["x-zyka-real-ip"] === undefined, `Spoofed x-zyka-real-ip is stripped from client response headers`);
  assert(h1["x-zyka-resolved-ip"] !== undefined, `Authoritative x-zyka-resolved-ip header is present`);
  assert(h1["x-zyka-resolved-user-id"] !== "spoofed_admin_user", `Spoofed x-zyka-user-id is ignored and replaced by anonymous fingerprint`);
  assert(json1.serverLog === undefined, `Internal serverLog object is not leaked in client error JSON`);

  // TEST 2: Protected Admin Access Gate on /api/logs (Fail-Closed without Token)
  console.log(`\n[TEST 2] Protected Admin Access Gate: GET /api/logs without token`);
  const resUnauth = await fetch(`${BASE_URL}/api/logs`);
  assert(resUnauth.status === 404, `Unauthenticated GET /api/logs returns HTTP 404 (got ${resUnauth.status})`);

  // TEST 3: Method Protection on /api/logs (POST /api/logs returns 405 Method Not Allowed)
  console.log(`\n[TEST 3] Method Protection on /api/logs`);
  const resBadMethod = await fetch(`${BASE_URL}/api/logs`, { method: "POST" });
  assert(resBadMethod.status === 405, `POST /api/logs rejected with HTTP 405 Method Not Allowed (got ${resBadMethod.status})`);

  // TEST 4: Authorized Admin Access on /api/logs with Valid Bearer Token
  console.log(`\n[TEST 4] Authorized Admin Access: GET /api/logs with Bearer token`);
  const resAuth = await fetch(`${BASE_URL}/api/logs`, {
    headers: {
      Authorization: `Bearer ${ADMIN_TOKEN}`,
    },
  });
  const jsonAuth = await resAuth.json();

  assert(resAuth.status === 200, `GET /api/logs with valid token returns HTTP 200 OK (got ${resAuth.status})`);
  assert(jsonAuth.success === true, `API returns success: true`);
  assert(Array.isArray(jsonAuth.logs), `API returns array of server logs`);

  // TEST 5: Persistent File Verification on Disk
  console.log(`\n[TEST 5] Verifying Log Persistence on Local Server Filesystem`);
  const jsonlFilePath = path.join(process.cwd(), "logs", "server-errors.jsonl");
  const hasJsonlFile = fs.existsSync(jsonlFilePath);

  assert(hasJsonlFile, `Structured JSONL server log file exists at: logs/server-errors.jsonl`);

  if (hasJsonlFile) {
    const jsonlContent = fs.readFileSync(jsonlFilePath, "utf8");
    const lines = jsonlContent.trim().split("\n").filter(Boolean);
    assert(lines.length >= 1, `JSONL log contains at least 1 JSON record (got ${lines.length})`);
    if (lines.length > 0) {
      const parsedSample = JSON.parse(lines[lines.length - 1]);
      assert(parsedSample.clientIp !== undefined, `JSONL entry has valid clientIp field`);
      assert(parsedSample.userId !== undefined, `JSONL entry has valid userId field`);
      assert(parsedSample.error?.code !== undefined, `JSONL entry has valid error.code field`);
    }
  }

  // Summary
  console.log(`\n========================================================================`);
  console.log(`  SERVER ERROR LOGGING AUDIT SUMMARY`);
  console.log(`  Passed: ${passed} | Failed: ${failed}`);
  console.log(`  Success Rate: ${((passed / (passed + failed)) * 100).toFixed(1)}%`);
  console.log(`========================================================================\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Test execution exception:", err);
  process.exit(1);
});
