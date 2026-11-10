import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { DELETE, GET, PATCH, POST, PUT } from "../src/app/api/admin/session/route.ts";

const adminPassword = "test-admin-password-never-log";
const originalAdminPassword = process.env.ADMIN_PASSWORD;
const originalNodeEnv = process.env.NODE_ENV;
const originalDateNow = Date.now;
const url = "https://example.test/api/admin/session";

afterEach(() => {
  if (originalAdminPassword === undefined) {
    delete process.env.ADMIN_PASSWORD;
  } else {
    process.env.ADMIN_PASSWORD = originalAdminPassword;
  }
  if (originalNodeEnv === undefined) {
    delete process.env.NODE_ENV;
  } else {
    process.env.NODE_ENV = originalNodeEnv;
  }
  Date.now = originalDateNow;
});

function loginRequest(password) {
  return new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });
}

function sessionRequest(cookie) {
  return new Request(url, { headers: cookie ? { Cookie: cookie } : {} });
}

function cookiePair(response) {
  const setCookie = response.headers.get("set-cookie");
  assert.ok(setCookie, "Set-Cookie header expected");
  return setCookie.split(";")[0];
}

test("POST returns 503 when ADMIN_PASSWORD is missing", async () => {
  delete process.env.ADMIN_PASSWORD;
  const response = await POST(loginRequest("anything"));
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("set-cookie"), null);
});

test("POST returns 503 when ADMIN_PASSWORD is too short", async () => {
  process.env.ADMIN_PASSWORD = "short1234";
  const response = await POST(loginRequest("short1234"));
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("set-cookie"), null);
});

test("POST rejects a wrong password without setting a cookie", async () => {
  process.env.ADMIN_PASSWORD = adminPassword;
  const response = await POST(loginRequest("wrong-password"));
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: "unauthorized" });
  assert.equal(response.headers.get("set-cookie"), null);
});

test("POST rejects the previously hardcoded passwords", async () => {
  process.env.ADMIN_PASSWORD = adminPassword;
  for (const legacy of ["admin1234", "admin1234!"]) {
    const response = await POST(loginRequest(legacy));
    assert.equal(response.status, 401);
  }
});

test("POST rejects malformed bodies", async () => {
  process.env.ADMIN_PASSWORD = adminPassword;
  const notJson = await POST(new Request(url, { method: "POST", body: "not-json" }));
  assert.equal(notJson.status, 400);
  const notString = await POST(loginRequest(12345));
  assert.equal(notString.status, 400);
  const tooLarge = await POST(loginRequest("x".repeat(5000)));
  assert.equal(tooLarge.status, 400);
});

test("POST sets an HttpOnly session cookie that GET accepts", async () => {
  process.env.ADMIN_PASSWORD = adminPassword;
  process.env.NODE_ENV = "production";
  const login = await POST(loginRequest(adminPassword));
  assert.equal(login.status, 200);
  assert.equal(login.headers.get("cache-control"), "no-store");

  const setCookie = login.headers.get("set-cookie");
  assert.match(setCookie, /^admin_session=/);
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /SameSite=Strict/);
  assert.match(setCookie, /Secure/);
  assert.match(setCookie, /Path=\/api\/admin/);
  assert.ok(!setCookie.includes(adminPassword), "cookie must not contain the password");

  const session = await GET(sessionRequest(cookiePair(login)));
  assert.deepEqual(await session.json(), { authenticated: true, configured: true });
});

test("GET reports unauthenticated without or with a forged cookie", async () => {
  process.env.ADMIN_PASSWORD = adminPassword;
  const none = await GET(sessionRequest());
  assert.deepEqual(await none.json(), { authenticated: false, configured: true });

  const farFuture = Date.now() + 60_000;
  const forged = await GET(sessionRequest(`admin_session=${farFuture}.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`));
  assert.deepEqual(await forged.json(), { authenticated: false, configured: true });

  const garbage = await GET(sessionRequest("admin_session=garbage"));
  assert.deepEqual(await garbage.json(), { authenticated: false, configured: true });
});

test("session expires after the TTL", async () => {
  process.env.ADMIN_PASSWORD = adminPassword;
  const login = await POST(loginRequest(adminPassword));
  const cookie = cookiePair(login);

  const realNow = originalDateNow();
  Date.now = () => realNow + 8 * 60 * 60 * 1000 + 1000;
  const session = await GET(sessionRequest(cookie));
  assert.deepEqual(await session.json(), { authenticated: false, configured: true });
});

test("changing ADMIN_PASSWORD invalidates existing sessions", async () => {
  process.env.ADMIN_PASSWORD = adminPassword;
  const login = await POST(loginRequest(adminPassword));
  const cookie = cookiePair(login);

  process.env.ADMIN_PASSWORD = "another-admin-password-never-log";
  const session = await GET(sessionRequest(cookie));
  assert.deepEqual(await session.json(), { authenticated: false, configured: true });
});

test("GET reports not configured when ADMIN_PASSWORD is missing", async () => {
  delete process.env.ADMIN_PASSWORD;
  const session = await GET(sessionRequest());
  assert.deepEqual(await session.json(), { authenticated: false, configured: false });
});

test("DELETE clears the session cookie", async () => {
  const response = DELETE();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("set-cookie"), /^admin_session=;/);
  assert.match(response.headers.get("set-cookie"), /Max-Age=0/);
});

test("unsupported methods return 405", () => {
  for (const handler of [PUT, PATCH]) {
    const response = handler();
    assert.equal(response.status, 405);
    assert.equal(response.headers.get("allow"), "GET, POST, DELETE");
  }
});
