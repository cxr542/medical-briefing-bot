import { timingSafeEqual } from "node:crypto";

export const runtime = "nodejs";

const GITHUB_DISPATCH_URL =
  "https://api.github.com/repos/cxr542/medical-briefing-bot/actions/workflows/daily_collector.yml/dispatches";
const ALLOWED_METHODS = "POST";
const GITHUB_REQUEST_TIMEOUT_MS = 10_000;

function methodNotAllowed(): Response {
  return Response.json(
    { error: "method_not_allowed" },
    {
      status: 405,
      headers: {
        Allow: ALLOWED_METHODS,
        "Cache-Control": "no-store",
      },
    },
  );
}

function jsonError(error: string, status: number): Response {
  return Response.json(
    { error },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

function hasValidBearerToken(request: Request, configuredSecret: string): boolean {
  const authorization = request.headers.get("authorization");
  if (authorization === null || !authorization.startsWith("Bearer ")) {
    return false;
  }

  const suppliedSecret = authorization.slice("Bearer ".length);
  const suppliedBytes = Buffer.from(suppliedSecret, "utf8");
  const configuredBytes = Buffer.from(configuredSecret, "utf8");

  return (
    suppliedBytes.length === configuredBytes.length &&
    timingSafeEqual(suppliedBytes, configuredBytes)
  );
}

export async function POST(request: Request): Promise<Response> {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret === undefined || cronSecret.length === 0) {
    return jsonError("relay_not_configured", 503);
  }

  if (!hasValidBearerToken(request, cronSecret)) {
    return jsonError("unauthorized", 401);
  }

  const githubToken = process.env.GITHUB_DISPATCH_TOKEN;
  if (githubToken === undefined || githubToken.length === 0) {
    return jsonError("relay_not_configured", 503);
  }

  try {
    const githubResponse = await fetch(GITHUB_DISPATCH_URL, {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${githubToken}`,
        "Content-Type": "application/json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body: JSON.stringify({ ref: "main" }),
      cache: "no-store",
      signal: AbortSignal.timeout(GITHUB_REQUEST_TIMEOUT_MS),
    });

    if (!githubResponse.ok) {
      return jsonError("dispatch_failed", 502);
    }

    return Response.json(
      { status: "accepted" },
      { status: 202, headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return jsonError("dispatch_failed", 502);
  }
}

export function GET(): Response {
  return methodNotAllowed();
}

export function HEAD(): Response {
  return methodNotAllowed();
}

export function PUT(): Response {
  return methodNotAllowed();
}

export function PATCH(): Response {
  return methodNotAllowed();
}

export function DELETE(): Response {
  return methodNotAllowed();
}

export function OPTIONS(): Response {
  return methodNotAllowed();
}
