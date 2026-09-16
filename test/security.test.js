import assert from "node:assert/strict";
import test from "node:test";
import { applySecurityHeaders, clearRateLimits, consumeRateLimit, isAuthorized } from "../lib/request-security.js";

test("optional HTTP authentication uses configured credentials", () => {
  const environment = { NIYAMLENS_AUTH_USER: "inspector", NIYAMLENS_AUTH_PASSWORD: "strong-password" };
  const authorization = `Basic ${Buffer.from("inspector:strong-password").toString("base64")}`;
  assert.equal(isAuthorized({ headers: { authorization } }, environment), true);
  assert.equal(isAuthorized({ headers: {} }, environment), false);
  assert.equal(isAuthorized({ headers: {} }, {}), true);
});

test("rate limits have stable windows and remaining counts", () => {
  clearRateLimits();
  assert.deepEqual(consumeRateLimit("ocr:test", 2, 1_000, 10), { allowed: true, remaining: 1, resetAt: 1010 });
  assert.equal(consumeRateLimit("ocr:test", 2, 1_000, 20).allowed, true);
  assert.equal(consumeRateLimit("ocr:test", 2, 1_000, 30).allowed, false);
  assert.equal(consumeRateLimit("ocr:test", 2, 1_000, 2_000).allowed, true);
});

test("security headers include content, frame and permissions policy", () => {
  const headers = {};
  const response = { setHeader: (name, value) => { headers[name] = value; } };
  applySecurityHeaders(response, "request-1");
  assert.equal(headers["X-Request-ID"], "request-1");
  assert.equal(headers["X-Frame-Options"], "DENY");
  assert.match(headers["Content-Security-Policy"], /frame-ancestors 'none'/);
  assert.match(headers["Content-Security-Policy"], /worker-src 'self'/);
  assert.match(headers["Content-Security-Policy"], /'wasm-unsafe-eval'/);
  assert.match(headers["Permissions-Policy"], /camera=\(self\)/);
});
