import { randomUUID, timingSafeEqual } from "node:crypto";

const rateBuckets = new Map();

function header(request, name) {
  const headers = request?.headers || {};
  if (typeof headers.get === "function") return headers.get(name) || "";
  return headers[name] || headers[name.toLowerCase()] || "";
}

function sameSecret(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  return a.length === b.length && timingSafeEqual(a, b);
}

export function requestIdentity(request) {
  const forwarded = String(header(request, "x-forwarded-for")).split(",")[0].trim();
  return forwarded || request?.socket?.remoteAddress || "unknown";
}

export function isAuthorized(request, environment = process.env) {
  const expectedUser = environment.NIYAMLENS_AUTH_USER;
  const expectedPassword = environment.NIYAMLENS_AUTH_PASSWORD;
  if (!expectedUser || !expectedPassword) return true;

  const authorization = String(header(request, "authorization"));
  if (!authorization.startsWith("Basic ")) return false;
  try {
    const decoded = Buffer.from(authorization.slice(6), "base64").toString("utf8");
    const separator = decoded.indexOf(":");
    if (separator < 0) return false;
    return (
      sameSecret(decoded.slice(0, separator), expectedUser) &&
      sameSecret(decoded.slice(separator + 1), expectedPassword)
    );
  } catch {
    return false;
  }
}

export function applySecurityHeaders(response, requestId = randomUUID()) {
  response.setHeader("X-Request-ID", requestId);
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader("Permissions-Policy", "camera=(self), microphone=(), geolocation=()");
  response.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'; object-src 'none'; img-src 'self' blob: data:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; connect-src 'self'",
  );
  return requestId;
}

export function consumeRateLimit(key, limit, windowMs, now = Date.now()) {
  const current = rateBuckets.get(key);
  if (!current || current.resetAt <= now) {
    const next = { count: 1, resetAt: now + windowMs };
    rateBuckets.set(key, next);
    return { allowed: true, remaining: limit - 1, resetAt: next.resetAt };
  }
  current.count += 1;
  return {
    allowed: current.count <= limit,
    remaining: Math.max(0, limit - current.count),
    resetAt: current.resetAt,
  };
}

export function protectApi(
  request,
  response,
  { name, limit, windowMs = 10 * 60_000, environment = process.env } = {},
) {
  const requestId = applySecurityHeaders(response);
  request.requestId = requestId;

  if (!isAuthorized(request, environment)) {
    response.setHeader("WWW-Authenticate", 'Basic realm="NiyamLens+", charset="UTF-8"');
    response.status(401).json({ code: "AUTH_REQUIRED", error: "Authentication required" });
    return false;
  }

  const result = consumeRateLimit(
    `${name || "api"}:${requestIdentity(request)}`,
    limit || 60,
    windowMs,
  );
  response.setHeader("RateLimit-Limit", String(limit || 60));
  response.setHeader("RateLimit-Remaining", String(result.remaining));
  response.setHeader("RateLimit-Reset", String(Math.ceil(result.resetAt / 1_000)));
  if (!result.allowed) {
    response.setHeader("Retry-After", String(Math.max(1, Math.ceil((result.resetAt - Date.now()) / 1_000))));
    response.status(429).json({ code: "RATE_LIMITED", error: "Too many requests. Try again later." });
    return false;
  }
  return true;
}

export function clearRateLimits() {
  rateBuckets.clear();
}
