import assert from "node:assert/strict";
import test from "node:test";
import ocr, { createOcrHandler } from "../api/ocr.js";
import { clearRateLimits } from "../lib/request-security.js";

function responseHarness() {
  return {
    headers: {}, statusCode: 200, body: null,
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; },
    send(value) { this.body = value; return this; },
  };
}

function jpeg(width, height) {
  return Buffer.from([
    0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08,
    (height >> 8) & 0xff, height & 0xff,
    (width >> 8) & 0xff, width & 0xff,
    0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x00, 0x03, 0x11, 0x00,
    0xff, 0xd9,
  ]);
}

test("OCR rejects base64 that is not a real JPEG before contacting PaddleX", async () => {
  clearRateLimits();
  const response = responseHarness();
  await ocr(
    {
      method: "POST",
      headers: { "x-forwarded-for": "ocr-invalid-test" },
      body: { images: [{ mimeType: "image/jpeg", content: Buffer.from("hello").toString("base64") }] },
    },
    response,
  );
  assert.equal(response.statusCode, 400);
  assert.equal(response.body.code, "INVALID_IMAGE");
  assert.match(response.body.error, /valid JPEG/);
});

test("OCR enables unwarping and returns per-image quality metadata", async () => {
  clearRateLimits();
  let upstreamRequest;
  const handler = createOcrHandler({
    environment: { LOCAL_PADDLEOCR_URL: "http://ocr.test/ocr" },
    fetchImplementation: async (url, options) => {
      upstreamRequest = { url, options };
      return {
        ok: true,
        json: async () => ({
          result: {
            ocrResults: [{
              prunedResult: {
                rec_texts: ["Net Quantity 250 g"],
                rec_scores: [0.94],
                rec_boxes: [[10, 20, 180, 50]],
              },
            }],
          },
        }),
      };
    },
  });
  const response = responseHarness();
  await handler(
    {
      method: "POST",
      headers: { "x-forwarded-for": "ocr-success-test" },
      body: { images: [{ mimeType: "image/jpeg", content: jpeg(1200, 800).toString("base64") }] },
    },
    response,
  );
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.results[0].text, "Net Quantity 250 g");
  assert.equal(response.body.results[0].confidence, 94);
  assert.equal(response.body.results[0].quality.width, 1200);
  assert.equal(JSON.parse(upstreamRequest.options.body).useDocUnwarping, true);
});
