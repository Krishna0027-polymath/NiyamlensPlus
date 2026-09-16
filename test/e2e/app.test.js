import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("application shell presents detection and review language instead of compliance PASS", async () => {
  const [html, script] = await Promise.all([
    readFile(new URL("../../dist/index.html", import.meta.url), "utf8"),
    readFile(new URL("../../dist/app.js", import.meta.url), "utf8"),
  ]);
  assert.match(html, /does not certify Legal\s+Metrology compliance/);
  assert.doesNotMatch(html, /Find retailer references/);
  assert.doesNotMatch(html, /Save case/);
  assert.doesNotMatch(script, /listing-lookup/);
  assert.doesNotMatch(script, /saveCase/);
  assert.doesNotMatch(html, />PASS</);
  assert.doesNotMatch(script, /status\s*=\s*["']pass["']/);
  assert.match(script, /DETECTED/);
  assert.match(script, /Browser OCR fallback/);
  assert.match(script, /workerBlobURL:\s*false/);
  assert.match(script, /default\?\.createWorker/);
  assert.match(script, /enhanceImageForBrowserOcr/);
  assert.match(script, /imageSmoothingQuality\s*=\s*["']high["']/);
  assert.match(html, /worker-src 'self'/);
  assert.match(html, /'wasm-unsafe-eval'/);
  await Promise.all([
    readFile(new URL("../../dist/vendor/tesseract.esm.min.js", import.meta.url)),
    readFile(new URL("../../dist/vendor/worker.min.js", import.meta.url)),
    readFile(new URL("../../dist/vendor/lang/eng.traineddata.gz", import.meta.url)),
  ]);
});
