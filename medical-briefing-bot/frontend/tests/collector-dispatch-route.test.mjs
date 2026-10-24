import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import {
  DELETE,
  GET,
  HEAD,
  OPTIONS,
  PATCH,
  POST,
  PUT,
} from "../src/app/api/cron/collector-dispatch/route.ts";

const cronSecret = "test-cron-secret-never-log";
const githubToken = "test-github-token-never-log";
const originalCronSecret = process.env.CRON_SECRET;
const originalGithubToken = process.env.GITHUB_DISPATCH_TOKEN;
const originalFetch = globalThis.fetch;
const originalAbortSignalTimeout = AbortSignal.timeout;

afterEach(() => {
  if (originalCronSecret === undefined) {
    delete process.env.CRON_SECRET;
  } else {
    process.env.CRON_SECRET = originalCronSecret;
  }

  if (originalGithubToken === undefined) {
    delete process.env.GITHUB_DISPATCH_TOKEN;
  } else {
    process.env.GITHUB_DISPATCH_TOKEN = originalGithubToken;
  }

  globalThis.fetch = originalFetch;
  AbortSignal.timeout = originalAbortSignalTimeout;
});

function authorizedRequest() {
  return new Request("https://example.test/api/cron/collector-dispatch", {
    method: "POST",
    headers: { Authorization: `Bearer ${cronSecret}` },
  });
}

test("POST dispatches fixed workflow and ref without recovery_slot", async () => {
  process.env.CRON_SECRET = cronSecret;
  process.env.GITHUB_DISPATCH_TOKEN = githubToken;
  let capturedUrl = "";
  let capturedInit;
  globalThis.fetch = async (input, init) => {
    capturedUrl = String(input);
    capturedInit = init;
    return new Response(null, { status: 204 });
  };

  const response = await POST(authorizedRequest());

  assert.equal(response.status, 202);
  assert.deepEqual(await response.json(), { status: "accepted" });
  assert.equal(
    capturedUrl,
    "https://api.github.com/repos/cxr542/medical-briefing-bot/actions/workflows/daily_collector.yml/dispatches",
  );
  assert.equal(capturedInit?.method, "POST");
  assert.deepEqual(JSON.parse(String(capturedInit?.body)), { ref: "main" });
  assert.equal(
    new Headers(capturedInit?.headers).get("authorization"),
    `Bearer ${githubToken}`,
  );
});

test("invalid bearer token returns 401 without calling GitHub", async () => {
  process.env.CRON_SECRET = cronSecret;
  process.env.GITHUB_DISPATCH_TOKEN = githubToken;
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    return new Response(null, { status: 204 });
  };

  const response = await POST(
    new Request("https://example.test/api/cron/collector-dispatch", {
      method: "POST",
      headers: { Authorization: "Bearer incorrect-secret" },
    }),
  );

  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: "unauthorized" });
  assert.equal(called, false);
});

test("missing relay configuration fails closed", async () => {
  delete process.env.CRON_SECRET;
  process.env.GITHUB_DISPATCH_TOKEN = githubToken;

  const response = await POST(authorizedRequest());

  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: "relay_not_configured" });
});

test("non-POST methods return 405 and do not dispatch", async () => {
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    return new Response(null, { status: 204 });
  };
  const handlers = [GET, HEAD, PUT, PATCH, DELETE, OPTIONS];

  for (const handler of handlers) {
    const response = handler();
    assert.equal(response.status, 405);
    assert.equal(response.headers.get("allow"), "POST");
  }

  assert.equal(called, false);
});

test("GitHub API failure returns a generic response without secret leakage", async () => {
  process.env.CRON_SECRET = cronSecret;
  process.env.GITHUB_DISPATCH_TOKEN = githubToken;
  const logged = [];
  const originalConsoleError = console.error;
  const originalConsoleLog = console.log;
  const originalConsoleWarn = console.warn;
  console.error = (...values) => logged.push(values.join(" "));
  console.log = (...values) => logged.push(values.join(" "));
  console.warn = (...values) => logged.push(values.join(" "));
  globalThis.fetch = async () =>
    Response.json({ message: githubToken, authorization: cronSecret }, { status: 403 });

  try {
    const response = await POST(authorizedRequest());
    const responseText = await response.text();

    assert.equal(response.status, 502);
    assert.equal(responseText, JSON.stringify({ error: "dispatch_failed" }));
    assert.equal(responseText.includes(cronSecret), false);
    assert.equal(responseText.includes(githubToken), false);
    assert.deepEqual(logged, []);
  } finally {
    console.error = originalConsoleError;
    console.log = originalConsoleLog;
    console.warn = originalConsoleWarn;
  }
});

test("GitHub network failure returns a generic non-2xx response", async () => {
  process.env.CRON_SECRET = cronSecret;
  process.env.GITHUB_DISPATCH_TOKEN = githubToken;
  globalThis.fetch = async () => {
    throw new Error(`network failure ${githubToken}`);
  };

  const response = await POST(authorizedRequest());

  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), { error: "dispatch_failed" });
});

test("GitHub request timeout returns a generic 502 response", async () => {
  process.env.CRON_SECRET = cronSecret;
  process.env.GITHUB_DISPATCH_TOKEN = githubToken;
  let timeoutMilliseconds = 0;
  let capturedInit;
  AbortSignal.timeout = (milliseconds) => {
    timeoutMilliseconds = milliseconds;
    return AbortSignal.abort(new DOMException("The operation was aborted", "TimeoutError"));
  };
  globalThis.fetch = async (_input, init) => {
    capturedInit = init;
    if (init?.signal?.aborted) {
      throw init.signal.reason;
    }
    return new Response(null, { status: 204 });
  };

  const response = await POST(authorizedRequest());
  const responseText = await response.text();

  assert.equal(response.status, 502);
  assert.equal(responseText, JSON.stringify({ error: "dispatch_failed" }));
  assert.equal(timeoutMilliseconds, 10_000);
  assert.equal(capturedInit?.signal?.aborted, true);
});
