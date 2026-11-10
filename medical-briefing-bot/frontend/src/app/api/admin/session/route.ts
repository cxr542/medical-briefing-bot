import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const runtime = "nodejs";

// 관리자 세션 API.
//   POST   /api/admin/session  { password }  → 로그인 (세션 쿠키 발급)
//   GET    /api/admin/session                → 현재 세션 유효 여부
//   DELETE /api/admin/session                → 로그아웃 (세션 쿠키 삭제)
//
// 비밀번호는 서버 환경 변수 ADMIN_PASSWORD 에만 존재하며 클라이언트 번들에 포함되지 않는다.
// 세션 쿠키는 ADMIN_PASSWORD 에서 파생한 키로 서명하므로, 비밀번호를 바꾸면 기존 세션이 모두 무효가 된다.

const COOKIE_NAME = "admin_session";
const COOKIE_PATH = "/api/admin";
const SESSION_TTL_SECONDS = 8 * 60 * 60;
const MIN_PASSWORD_LENGTH = 12;
const MAX_BODY_BYTES = 1024;
const ALLOWED_METHODS = "GET, POST, DELETE";

const NO_STORE = { "Cache-Control": "no-store" } as const;

function json(body: unknown, status: number, headers: Record<string, string> = {}): Response {
  return Response.json(body, { status, headers: { ...NO_STORE, ...headers } });
}

function configuredPassword(): string | null {
  const password = process.env.ADMIN_PASSWORD;
  if (password === undefined || password.length < MIN_PASSWORD_LENGTH) {
    return null;
  }
  return password;
}

function sha256(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

function signingKey(password: string): Buffer {
  return sha256(`admin-session-key:${password}`);
}

function sign(expiresAtMs: number, password: string): string {
  return createHmac("sha256", signingKey(password)).update(String(expiresAtMs)).digest("base64url");
}

function createToken(password: string, nowMs: number): string {
  const expiresAtMs = nowMs + SESSION_TTL_SECONDS * 1000;
  return `${expiresAtMs}.${sign(expiresAtMs, password)}`;
}

function isValidToken(token: string, password: string, nowMs: number): boolean {
  const separator = token.indexOf(".");
  if (separator <= 0) {
    return false;
  }
  const expiresAtText = token.slice(0, separator);
  if (!/^\d{1,16}$/.test(expiresAtText)) {
    return false;
  }
  const expiresAtMs = Number(expiresAtText);
  if (expiresAtMs <= nowMs) {
    return false;
  }
  const supplied = Buffer.from(token.slice(separator + 1), "utf8");
  const expected = Buffer.from(sign(expiresAtMs, password), "utf8");
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

function readSessionCookie(request: Request): string | null {
  const header = request.headers.get("cookie");
  if (header === null) {
    return null;
  }
  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === COOKIE_NAME) {
      return rest.join("=");
    }
  }
  return null;
}

function cookieAttributes(maxAgeSeconds: number): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `Path=${COOKIE_PATH}; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSeconds}${secure}`;
}

function isAuthenticated(request: Request, password: string): boolean {
  const token = readSessionCookie(request);
  return token !== null && isValidToken(token, password, Date.now());
}

export async function POST(request: Request): Promise<Response> {
  const password = configuredPassword();
  if (password === null) {
    return json({ error: "admin_not_configured" }, 503);
  }

  let supplied: unknown;
  try {
    const text = await request.text();
    if (Buffer.byteLength(text, "utf8") > MAX_BODY_BYTES) {
      return json({ error: "invalid_request" }, 400);
    }
    supplied = (JSON.parse(text) as { password?: unknown }).password;
  } catch {
    return json({ error: "invalid_request" }, 400);
  }
  if (typeof supplied !== "string") {
    return json({ error: "invalid_request" }, 400);
  }

  // 길이 차이로 인한 타이밍 노출을 피하려고 해시끼리 비교한다.
  if (!timingSafeEqual(sha256(supplied), sha256(password))) {
    return json({ error: "unauthorized" }, 401);
  }

  const token = createToken(password, Date.now());
  return json({ authenticated: true }, 200, {
    "Set-Cookie": `${COOKIE_NAME}=${token}; ${cookieAttributes(SESSION_TTL_SECONDS)}`,
  });
}

export function GET(request: Request): Response {
  const password = configuredPassword();
  if (password === null) {
    return json({ authenticated: false, configured: false }, 200);
  }
  return json({ authenticated: isAuthenticated(request, password), configured: true }, 200);
}

export function DELETE(): Response {
  return json({ authenticated: false }, 200, {
    "Set-Cookie": `${COOKIE_NAME}=; ${cookieAttributes(0)}`,
  });
}

function methodNotAllowed(): Response {
  return json({ error: "method_not_allowed" }, 405, { Allow: ALLOWED_METHODS });
}

export function PUT(): Response {
  return methodNotAllowed();
}

export function PATCH(): Response {
  return methodNotAllowed();
}
