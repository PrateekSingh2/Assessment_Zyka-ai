/**
 * ============================================================================
 * ZYKA AI — SERVER-LEVEL REAL IP & USER-WISE ERROR AUDIT TEST SUITE
 * Verifies real IP resolution (Cloudflare, Nginx, XFF), user-wise tracing,
 * persistent disk logging (logs/server-errors.log & server-errors.jsonl),
 * and the /api/logs audit query endpoint.
 * ============================================================================
 */

import fs from "fs";
import path from "path";

const PORT = process.env.PORT || process.argv[2] || "3000";
const BASE_URL = `http://localhost:${PORT}`;

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
  console.log(`  ZYKA AI — SERVER-LEVEL REAL IP & USER-WISE AUDIT VERIFICATION`);
  console.log(`  Target: ${BASE_URL}`);
  console.log(`  Timestamp: ${new Date().toISOString()}`);
  console.log(`========================================================================\n`);

  // TEST 1: X-Forwarded-For Multi-Hop Real IP Resolution
  console.log(`[TEST 1] Multi-hop X-Forwarded-For Header (203.0.113.195, 10.0.0.1)`);
  const res1 = await fetch(`${BASE_URL}/api/generate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-forwarded-for": "203.0.113.195, 10.0.0.1, 172.16.0.5",
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) CreatorStudio/1.0",
      "x-zyka-request-id": "test-xff-1",
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
  assert(h1["x-zyka-real-ip"] === "203.0.113.195", `Header x-zyka-real-ip is '203.0.113.195' (got ${h1["x-zyka-real-ip"]})`);
  assert(h1["x-zyka-ip-source"] === "x-forwarded-for", `Header x-zyka-ip-source is 'x-forwarded-for' (got ${h1["x-zyka-ip-source"]})`);
  assert(json1.serverLog?.clientIp === "203.0.113.195", `serverLog.clientIp matches real IP 203.0.113.195`);
  assert(json1.serverLog?.ipSource === "x-forwarded-for", `serverLog.ipSource recorded as x-forwarded-for`);
  assert(json1.serverLog?.userId.startsWith("usr_anon_"), `Anonymous user fingerprint created: ${json1.serverLog?.userId}`);

  // TEST 2: Cloudflare Connecting IP Priority
  console.log(`\n[TEST 2] Cloudflare Connecting IP Header (cf-connecting-ip: 198.51.100.77)`);
  const res2 = await fetch(`${BASE_URL}/api/generate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "cf-connecting-ip": "198.51.100.77",
      "x-forwarded-for": "10.0.0.99", // CF header must take precedence over XFF proxy hop
      "user-agent": "ZykaAI-Client/2.4",
      "x-zyka-request-id": "test-cf-2",
    },
    body: JSON.stringify({
      prompt: "Make a 60-second video of flying cars",
      mediaType: "video",
      duration: "5s",
    }),
  });

  const json2 = await res2.json();
  const h2 = Object.fromEntries(res2.headers.entries());

  assert(res2.status === 422, `Status is HTTP 422 (duration boundary error)`);
  assert(h2["x-zyka-real-ip"] === "198.51.100.77", `Cloudflare IP takes precedence: ${h2["x-zyka-real-ip"]}`);
  assert(h2["x-zyka-ip-source"] === "cf-connecting-ip", `IP source recorded as cf-connecting-ip`);
  assert(json2.serverLog?.clientIp === "198.51.100.77", `serverLog.clientIp is 198.51.100.77`);

  // TEST 3: User-Wise Tracing with Authenticated Creator ID
  console.log(`\n[TEST 3] User-Wise Tracking (x-zyka-user-id: usr_creator_pro_alex)`);
  const res3 = await fetch(`${BASE_URL}/api/generate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-forwarded-for": "192.0.2.42",
      "x-zyka-user-id": "usr_creator_pro_alex",
      "user-agent": "CreatorStudioPro/3.0",
      "x-zyka-request-id": "test-user-3",
    },
    body: JSON.stringify({
      prompt: "Generate a still photo wallpaper of neon Kyoto",
      mediaType: "video",
    }),
  });

  const json3 = await res3.json();
  const h3 = Object.fromEntries(res3.headers.entries());

  assert(res3.status === 422, `Status is HTTP 422 (service mismatch)`);
  assert(h3["x-zyka-user-id"] === "usr_creator_pro_alex", `Header preserves authenticated user ID`);
  assert(json3.serverLog?.userId === "usr_creator_pro_alex", `serverLog.userId explicitly matches usr_creator_pro_alex`);
  assert(json3.serverLog?.error.code === "ERR_SERVICE_MISMATCH_IMAGE_IN_VIDEO", `Recorded error code matches service mismatch`);

  // TEST 4: Querying Server Error Logs via GET /api/logs
  console.log(`\n[TEST 4] Querying Server Error Audit Endpoint: GET /api/logs`);
  const resLogs = await fetch(`${BASE_URL}/api/logs`);
  const jsonLogs = await resLogs.json();

  assert(resLogs.status === 200, `GET /api/logs returns HTTP 200 OK`);
  assert(jsonLogs.success === true, `API returns success: true`);
  assert(Array.isArray(jsonLogs.logs), `API returns array of server logs`);
  assert(jsonLogs.count >= 3, `Recorded at least 3 server error logs (got ${jsonLogs.count})`);

  // TEST 5: Filter by Real IP: GET /api/logs?ip=203.0.113.195
  console.log(`\n[TEST 5] Filter Server Logs by Real IP: GET /api/logs?ip=203.0.113.195`);
  const resFilterIp = await fetch(`${BASE_URL}/api/logs?ip=203.0.113.195`);
  const jsonFilterIp = await resFilterIp.json();

  assert(jsonFilterIp.logs.length > 0, `Filtered logs returned entries`);
  assert(
    jsonFilterIp.logs.every((l) => l.clientIp === "203.0.113.195"),
    `Every returned log entry belongs to client IP 203.0.113.195`
  );

  // TEST 6: Filter by User ID: GET /api/logs?userId=usr_creator_pro_alex
  console.log(`\n[TEST 6] Filter Server Logs by User ID: GET /api/logs?userId=usr_creator_pro_alex`);
  const resFilterUser = await fetch(`${BASE_URL}/api/logs?userId=usr_creator_pro_alex`);
  const jsonFilterUser = await resFilterUser.json();

  assert(jsonFilterUser.logs.length > 0, `Filtered logs for user found`);
  assert(
    jsonFilterUser.logs.every((l) => l.userId === "usr_creator_pro_alex"),
    `Every returned log entry belongs to user usr_creator_pro_alex`
  );

  // TEST 7: Persistent File Verification on Disk
  console.log(`\n[TEST 7] Verifying Log Persistence on Local Server Filesystem`);
  const logFilePath = path.join(process.cwd(), "logs", "server-errors.log");
  const jsonlFilePath = path.join(process.cwd(), "logs", "server-errors.jsonl");

  const hasLogFile = fs.existsSync(logFilePath);
  const hasJsonlFile = fs.existsSync(jsonlFilePath);

  assert(hasLogFile, `Formatted server log file exists at: logs/server-errors.log`);
  assert(hasJsonlFile, `Structured JSONL server log file exists at: logs/server-errors.jsonl`);

  if (hasLogFile) {
    const logContent = fs.readFileSync(logFilePath, "utf8");
    assert(
      logContent.includes("203.0.113.195"),
      `Formatted log file contains recorded IP 203.0.113.195`
    );
    assert(
      logContent.includes("usr_creator_pro_alex"),
      `Formatted log file contains recorded user usr_creator_pro_alex`
    );
  }

  if (hasJsonlFile) {
    const jsonlContent = fs.readFileSync(jsonlFilePath, "utf8");
    const lines = jsonlContent.trim().split("\n").filter(Boolean);
    assert(lines.length >= 3, `JSONL log contains at least 3 JSON records (got ${lines.length})`);
    const parsedSample = JSON.parse(lines[lines.length - 1]);
    assert(parsedSample.clientIp !== undefined, `JSONL entry has valid clientIp field`);
    assert(parsedSample.userId !== undefined, `JSONL entry has valid userId field`);
    assert(parsedSample.error?.code !== undefined, `JSONL entry has valid error.code field`);
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
