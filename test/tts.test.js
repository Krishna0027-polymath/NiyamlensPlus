import assert from "node:assert/strict";
import test from "node:test";
import { createTtsHandler } from "../api/tts.js";

function responseHarness() {
  return {
    headers: {},
    statusCode: 200,
    body: null,
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(value) {
      this.body = value;
      return this;
    },
    send(value) {
      this.body = value;
      return this;
    },
  };
}

test("rejects invalid methods and request data", async () => {
  const handler = createTtsHandler({ environment: {} });
  const methodResponse = responseHarness();
  const dataResponse = responseHarness();

  await handler({ method: "GET", body: {} }, methodResponse);
  await handler({ method: "POST", body: { text: "Hello", lang: "fr" } }, dataResponse);

  assert.equal(methodResponse.statusCode, 405);
  assert.equal(methodResponse.body.code, "METHOD_NOT_ALLOWED");
  assert.equal(dataResponse.statusCode, 400);
  assert.equal(dataResponse.body.code, "INVALID_TTS_REQUEST");
});

test("reports missing provider configuration without exposing credentials", async () => {
  const handler = createTtsHandler({ environment: {} });
  const englishResponse = responseHarness();
  const hindiResponse = responseHarness();

  await handler(
    { method: "POST", body: { text: "Health guidance", lang: "en" } },
    englishResponse,
  );
  await handler(
    { method: "POST", body: { text: "स्वास्थ्य मार्गदर्शन", lang: "hi" } },
    hindiResponse,
  );

  assert.equal(englishResponse.statusCode, 503);
  assert.equal(englishResponse.body.code, "TTS_NOT_CONFIGURED");
  assert.match(englishResponse.body.error, /Azure English/i);
  assert.equal(hindiResponse.statusCode, 503);
  assert.equal(hindiResponse.body.code, "TTS_NOT_CONFIGURED");
  assert.match(hindiResponse.body.error, /Bhashini Hindi/i);
});

test("returns MP3 bytes with Azure voice configuration and escaped SSML", async () => {
  let request;
  const handler = createTtsHandler({
    environment: {
      AZURE_SPEECH_KEY: "secret-key",
      AZURE_SPEECH_REGION: "centralindia",
      AZURE_SPEECH_EN_VOICE: "en-IN-AashiNeural",
    },
    fetchImplementation: async (url, options) => {
      request = { url, options };
      return {
        ok: true,
        status: 200,
        arrayBuffer: async () => Uint8Array.from([1, 2, 3]).buffer,
      };
    },
  });
  const response = responseHarness();

  await handler(
    { method: "POST", body: { text: "Fat < sugar & salt", lang: "en" } },
    response,
  );

  assert.equal(response.statusCode, 200);
  assert.equal(response.headers["content-type"], "audio/mpeg");
  assert.equal(response.headers["content-length"], "3");
  assert.deepEqual(response.body, Buffer.from([1, 2, 3]));
  assert.match(request.url, /^https:\/\/centralindia\.tts\.speech\.microsoft\.com/);
  assert.equal(request.options.headers["Ocp-Apim-Subscription-Key"], "secret-key");
  assert.match(request.options.body, /Fat &lt; sugar &amp; salt/);
  assert.doesNotMatch(request.options.body, /secret-key/);
});

test("returns Bhashini Hindi audio from its base64 pipeline response", async () => {
  let request;
  const handler = createTtsHandler({
    environment: {
      BHASHINI_INFERENCE_API_KEY: "bhashini-secret",
      BHASHINI_TTS_SERVICE_ID: "Bhashini/IITM/TTS",
      BHASHINI_TTS_GENDER: "female",
    },
    fetchImplementation: async (url, options) => {
      request = { url: String(url), options };
      return {
        ok: true,
        status: 200,
        json: async () => ({
          pipelineResponse: [
            {
              taskType: "tts",
              config: { audioFormat: "wav" },
              audio: [
                { audioContent: Buffer.from([82, 73, 70, 70]).toString("base64") },
              ],
            },
          ],
        }),
      };
    },
  });
  const response = responseHarness();

  await handler(
    { method: "POST", body: { text: "नमक अधिक है", lang: "hi" } },
    response,
  );

  assert.equal(response.statusCode, 200);
  assert.equal(response.headers["content-type"], "audio/wav");
  assert.deepEqual(response.body, Buffer.from([82, 73, 70, 70]));
  assert.equal(
    request.url,
    "https://dhruva-api.bhashini.gov.in/services/inference/pipeline",
  );
  assert.equal(request.options.headers.Authorization, "bhashini-secret");
  const payload = JSON.parse(request.options.body);
  assert.equal(payload.pipelineTasks[0].taskType, "tts");
  assert.equal(payload.pipelineTasks[0].config.language.sourceLanguage, "hi");
  assert.equal(payload.pipelineTasks[0].config.serviceId, "Bhashini/IITM/TTS");
  assert.equal(payload.inputData.input[0].source, "नमक अधिक है");
  assert.doesNotMatch(request.options.body, /bhashini-secret/);
});

test("maps Bhashini throttling to a stable fallback error", async () => {
  const handler = createTtsHandler({
    environment: {
      BHASHINI_INFERENCE_API_KEY: "bhashini-secret",
    },
    fetchImplementation: async () => ({ ok: false, status: 429 }),
  });
  const response = responseHarness();

  await handler({ method: "POST", body: { text: "नमस्ते", lang: "hi" } }, response);

  assert.equal(response.statusCode, 429);
  assert.equal(response.body.code, "TTS_QUOTA_EXCEEDED");
});

test("maps Azure English failures without leaking upstream content", async () => {
  const handler = createTtsHandler({
    environment: {
      AZURE_SPEECH_KEY: "secret-key",
      AZURE_SPEECH_REGION: "centralindia",
    },
    fetchImplementation: async () => ({ ok: false, status: 500 }),
  });
  const response = responseHarness();

  await handler({ method: "POST", body: { text: "Guidance", lang: "en" } }, response);

  assert.equal(response.statusCode, 502);
  assert.equal(response.body.code, "TTS_UPSTREAM_ERROR");
  assert.doesNotMatch(JSON.stringify(response.body), /secret-key/);
});
