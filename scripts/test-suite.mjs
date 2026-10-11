// Automated QA Verification Suite for Zyka AI Middleware & Error Translation Engine
const PORT = process.env.PORT || process.argv[2] || "3000";
const BASE_URL = `http://localhost:${PORT}`;

let passedCount = 0;
let failedCount = 0;

async function runTestCase(testNum, title, payload, headers = {}, expectedStatus = 200) {
  console.log(`\n======================================================`);
  console.log(`RUNNING TEST ${testNum}: ${title}`);
  console.log(`Payload:`, JSON.stringify(payload));
  console.log(`Request Headers:`, headers);

  try {
    const clientIp = headers["x-forwarded-for"] || `10.0.0.${testNum}`;
    const res = await fetch(`${BASE_URL}/api/generate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-forwarded-for": clientIp,
        "x-zyka-client-timestamp": new Date().toISOString(),
        "x-zyka-request-id": `test-${testNum}-${Date.now()}`,
        ...headers,
      },
      body: JSON.stringify(payload),
    });

    const status = res.status;
    const resHeaders = {};
    res.headers.forEach((v, k) => (resHeaders[k] = v));

    let json = {};
    try {
      json = await res.json();
    } catch {
      json = { raw: "non-json" };
    }

    console.log(`Response HTTP Status: ${status} (expected ${expectedStatus})`);
    console.log(`Response Header x-zyka-sanitized-error: "${resHeaders["x-zyka-sanitized-error"] || "none"}"`);
    console.log(`Response Body Sanitized Message:`, json.sanitizedError?.userMessage || "none");

    const passed = status === expectedStatus;
    if (passed) {
      console.log(`  ✅ TEST ${testNum} PASSED`);
      passedCount++;
    } else {
      console.error(`  ❌ TEST ${testNum} FAILED: Expected ${expectedStatus}, received ${status}`);
      failedCount++;
    }

    return {
      testNum,
      title,
      status,
      headers: resHeaders,
      body: json,
      pass: passed,
    };
  } catch (err) {
    console.error(`TEST ${testNum} FAILED WITH EXCEPTION:`, err);
    failedCount++;
    return {
      testNum,
      title,
      error: err.message,
      pass: false,
    };
  }
}

async function main() {
  console.log(`=== STARTING ZYKA AI AUTOMATED SYSTEM QA SUITE ON ${BASE_URL} ===`);

  // TEST 1: Valid Video Generation (200 OK)
  await runTestCase(
    1,
    "Valid Video Generation (200 OK)",
    {
      prompt: "Cinematic drone footage sweeping over misty pine forests at golden hour sunrise.",
      mediaType: "video",
      duration: "5s",
      aspectRatio: "16:9",
    },
    {
      "x-zyka-media-type": "video",
      "x-zyka-duration": "5s",
      "x-zyka-aspect-ratio": "16:9",
    },
    200
  );

  // TEST 2: Word Limit Exceeded (> 1000 words) (400 Bad Request)
  const longPrompt = Array(1005).fill("future").join(" ");
  await runTestCase(
    2,
    "Prompt Exceeds 1000 Words Limit (400 Bad Request)",
    {
      prompt: longPrompt,
      mediaType: "image",
    },
    {
      "x-zyka-media-type": "image",
    },
    400
  );

  // TEST 3: Service Mismatch (Image prompt entered in Video tab) (422 Unprocessable)
  await runTestCase(
    3,
    "Service Mismatch: Still Image requested in Video tab (422 Unprocessable)",
    {
      prompt: "Generate a still photo wallpaper of a cybernetic samurai in Kyoto.",
      mediaType: "video",
    },
    {
      "x-zyka-media-type": "video",
    },
    422
  );

  // TEST 4: Service Mismatch (Video prompt entered in Image tab) (422 Unprocessable)
  await runTestCase(
    4,
    "Service Mismatch: Video motion requested in Image tab (422 Unprocessable)",
    {
      prompt: "Make a 10-second video of an astronaut floating through a space station.",
      mediaType: "image",
    },
    {
      "x-zyka-media-type": "image",
    },
    422
  );

  // TEST 5: Duration Limit Conflict (> 30s requested) (422 Unprocessable)
  await runTestCase(
    5,
    "Duration Exceeds Maximum 30s Limit (422 Unprocessable Entity)",
    {
      prompt: "Create an epic nature documentary video for 60 seconds duration.",
      mediaType: "video",
      duration: "30s",
      aspectRatio: "16:9",
    },
    {
      "x-zyka-media-type": "video",
      "x-zyka-duration": "30s",
      "x-zyka-aspect-ratio": "16:9",
    },
    422
  );

  // TEST 6: Unsupported Format (GIF / Vector) (415 Unsupported Media Type)
  await runTestCase(
    6,
    "Unsupported Format Requested (GIF / Vector) (415 Unsupported Media Type)",
    {
      prompt: "Create an animated gif loop of a neon retro car driving through city.",
      mediaType: "image",
    },
    {
      "x-zyka-media-type": "image",
    },
    415
  );

  // TEST 7: Unsupported Aspect Ratio in Prompt (17:8) (422 Unprocessable)
  await runTestCase(
    7,
    "Unsupported Aspect Ratio (17:8 from User prompt) (422 Unprocessable Entity)",
    {
      prompt: "Create an image 17:8 of sunset view",
      mediaType: "image",
      aspectRatio: "16:9",
    },
    {
      "x-zyka-media-type": "image",
      "x-zyka-aspect-ratio": "16:9",
    },
    422
  );

  // TEST 8: Aspect Ratio Conflict (Prompt 9:16 vs Dropdown 16:9) (422 Unprocessable)
  await runTestCase(
    8,
    "Aspect Ratio Conflict: Prompt specifies 9:16 but Dropdown is 16:9 (422 Unprocessable)",
    {
      prompt: "Create a 9:16 vertical portrait photo of a cyber city",
      mediaType: "image",
      aspectRatio: "16:9",
    },
    {
      "x-zyka-media-type": "image",
      "x-zyka-aspect-ratio": "16:9",
    },
    422
  );

  // TEST 9: Duration Conflict (Prompt 15s vs Dropdown 5s) (422 Unprocessable)
  await runTestCase(
    9,
    "Duration Conflict: Prompt specifies 15s but Dropdown is 5s (422 Unprocessable)",
    {
      prompt: "Generate a 15-second cinematic drone video of glacial waterfalls",
      mediaType: "video",
      duration: "5s",
      aspectRatio: "16:9",
    },
    {
      "x-zyka-media-type": "video",
      "x-zyka-duration": "5s",
      "x-zyka-aspect-ratio": "16:9",
    },
    422
  );

  // TEST 10: Resolution Limit Exceeded (8K Ultra HD) (422 Unprocessable)
  await runTestCase(
    10,
    "Resolution Limit Exceeded (8K prompt requested) (422 Unprocessable)",
    {
      prompt: "Render an 8K ultra high resolution architectural visualization",
      mediaType: "image",
      aspectRatio: "16:9",
    },
    {
      "x-zyka-media-type": "image",
      "x-zyka-aspect-ratio": "16:9",
    },
    422
  );

  // TEST 11: Empty Prompt Payload (400 Bad Request)
  await runTestCase(
    11,
    "Empty Prompt Payload (400 Bad Request)",
    {
      prompt: "   ",
      mediaType: "image",
    },
    {
      "x-zyka-media-type": "image",
    },
    400
  );

  // TEST 12: Sliding Window Rate Limit Verification (6 consecutive hits from same IP)
  console.log(`\n======================================================`);
  console.log(`RUNNING TEST 12: Edge Sliding Window Rate Limiting (5 req / 60s)`);
  const rateLimitIp = `192.168.200.${Math.floor(Math.random() * 200) + 1}`;
  let got429 = false;
  for (let i = 1; i <= 6; i++) {
    const res = await fetch(`${BASE_URL}/api/generate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-forwarded-for": rateLimitIp,
        "x-zyka-request-id": `ratelimit-probe-${i}`,
      },
      body: JSON.stringify({ prompt: "A beautiful cinematic sunrise", mediaType: "image" }),
    });
    console.log(`  Hit ${i}/6 -> HTTP ${res.status}`);
    if (res.status === 429) {
      got429 = true;
      const resH = {};
      res.headers.forEach((v, k) => (resH[k] = v));
      console.log(`  Received 429 as expected on request ${i}!`);
      console.log(`  Header x-zyka-sanitized-error: "${resH["x-zyka-sanitized-error"]}"`);
      break;
    }
  }

  if (got429) {
    console.log(`  ✅ TEST 12 PASSED: Rate limit engaged correctly.`);
    passedCount++;
  } else {
    console.error(`  ❌ TEST 12 FAILED: Expected 429 but did not receive one.`);
    failedCount++;
  }

  console.log(`\n========================================================================`);
  console.log(`  TEST SUITE SUMMARY: ${passedCount} Passed, ${failedCount} Failed`);
  console.log(`========================================================================\n`);

  if (failedCount > 0) {
    process.exit(1);
  }
}

main();
