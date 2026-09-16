import { protectApi } from "../lib/request-security.js";

const MAX_TEXT_LENGTH = 1_200;
const MAX_AUDIO_BYTES = 8_000_000;
const DEFAULT_AZURE_VOICE = "en-IN-AashiNeural";
const DEFAULT_BHASHINI_URL =
  "https://dhruva-api.bhashini.gov.in/services/inference/pipeline";
const DEFAULT_BHASHINI_SERVICE = "Bhashini/IITM/TTS";

function sendError(response, status, code, error) {
  response.setHeader("Cache-Control", "no-store");
  return response.status(status).json({ code, error });
}

function escapeXml(value) {
  return value.replace(/[<>&'\"]/g, (character) =>
    ({
      "<": "&lt;",
      ">": "&gt;",
      "&": "&amp;",
      "'": "&apos;",
      '\"': "&quot;",
    })[character],
  );
}

function sendAudio(response, audio, contentType) {
  response.setHeader("Content-Type", contentType);
  response.setHeader("Content-Length", String(audio.length));
  response.setHeader("Cache-Control", "no-store");
  return response.status(200).send(audio);
}

function decodeBase64Audio(value) {
  const encoded = String(value || "")
    .replace(/^data:audio\/[a-z0-9.+-]+;base64,/i, "")
    .replace(/\s+/g, "");
  if (
    !encoded ||
    encoded.length % 4 === 1 ||
    !/^[a-z0-9+/]+={0,2}$/i.test(encoded)
  ) {
    return null;
  }
  const audio = Buffer.from(encoded, "base64");
  return audio.length && audio.length <= MAX_AUDIO_BYTES ? audio : null;
}

async function bhashiniHindi({ text, response, fetchImplementation, environment, signal }) {
  const key = environment.BHASHINI_INFERENCE_API_KEY;
  if (!key) {
    return sendError(
      response,
      503,
      "TTS_NOT_CONFIGURED",
      "Bhashini Hindi speech is not configured. Browser speech can be used instead.",
    );
  }

  const endpoint = environment.BHASHINI_TTS_URL || DEFAULT_BHASHINI_URL;
  const authHeader = environment.BHASHINI_AUTH_HEADER || "Authorization";
  let endpointUrl;
  try {
    endpointUrl = new URL(endpoint);
  } catch {
    return sendError(response, 500, "TTS_BAD_CONFIGURATION", "Bhashini endpoint is invalid.");
  }
  if (endpointUrl.protocol !== "https:" || !/^[a-z0-9-]+$/i.test(authHeader)) {
    return sendError(response, 500, "TTS_BAD_CONFIGURATION", "Bhashini configuration is invalid.");
  }

  const gender = environment.BHASHINI_TTS_GENDER || "female";
  if (!['female', 'male'].includes(gender)) {
    return sendError(response, 500, "TTS_BAD_CONFIGURATION", "Bhashini voice gender is invalid.");
  }

  const upstream = await fetchImplementation(endpointUrl, {
    method: "POST",
    headers: {
      Accept: "application/json",
      [authHeader]: key,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      pipelineTasks: [
        {
          taskType: "tts",
          config: {
            serviceId:
              environment.BHASHINI_TTS_SERVICE_ID || DEFAULT_BHASHINI_SERVICE,
            language: { sourceLanguage: "hi" },
            gender,
            samplingRate: 8_000,
          },
        },
      ],
      inputData: { input: [{ source: text }] },
    }),
    signal,
  });

  if (!upstream.ok) {
    const throttled = upstream.status === 429;
    return sendError(
      response,
      throttled ? 429 : 502,
      throttled ? "TTS_QUOTA_EXCEEDED" : "TTS_UPSTREAM_ERROR",
      throttled
        ? "Bhashini is throttled or out of quota. Browser speech can be used instead."
        : "Bhashini could not generate Hindi audio. Browser speech can be used instead.",
    );
  }

  const payload = await upstream.json().catch(() => null);
  const ttsResult = payload?.pipelineResponse?.find(
    (item) => item?.taskType === "tts",
  );
  const audio = decodeBase64Audio(ttsResult?.audio?.[0]?.audioContent);
  if (!audio) {
    return sendError(
      response,
      502,
      "TTS_EMPTY_AUDIO",
      "Bhashini returned no playable Hindi audio. Browser speech can be used instead.",
    );
  }
  const format = String(ttsResult?.config?.audioFormat || "wav").toLowerCase();
  return sendAudio(response, audio, format === "mp3" ? "audio/mpeg" : "audio/wav");
}

async function azureEnglish({ text, response, fetchImplementation, environment, signal }) {
  const key = environment.AZURE_SPEECH_KEY;
  const region = environment.AZURE_SPEECH_REGION;
  if (!key || !region) {
    return sendError(
      response,
      503,
      "TTS_NOT_CONFIGURED",
      "Azure English speech is not configured. Browser speech can be used instead.",
    );
  }
  if (!/^[a-z0-9-]+$/i.test(region)) {
    return sendError(response, 500, "TTS_BAD_CONFIGURATION", "Azure Speech region is invalid.");
  }

  const voice = environment.AZURE_SPEECH_EN_VOICE || DEFAULT_AZURE_VOICE;
  const ssml = `<speak version="1.0" xml:lang="en-IN"><voice name="${escapeXml(voice)}">${escapeXml(text)}</voice></speak>`;
  const upstream = await fetchImplementation(
    `https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`,
    {
      method: "POST",
      headers: {
        "Ocp-Apim-Subscription-Key": key,
        "Content-Type": "application/ssml+xml",
        "X-Microsoft-OutputFormat": "audio-24khz-48kbitrate-mono-mp3",
        "User-Agent": "NiyamLensPlus",
      },
      body: ssml,
      signal,
    },
  );

  if (!upstream.ok) {
    const throttled = upstream.status === 429;
    return sendError(
      response,
      throttled ? 429 : 502,
      throttled ? "TTS_QUOTA_EXCEEDED" : "TTS_UPSTREAM_ERROR",
      throttled
        ? "Azure Speech is throttled or out of quota. Browser speech can be used instead."
        : "Azure Speech could not generate English audio. Browser speech can be used instead.",
    );
  }

  const audio = Buffer.from(await upstream.arrayBuffer());
  if (!audio.length || audio.length > MAX_AUDIO_BYTES) {
    return sendError(
      response,
      502,
      "TTS_EMPTY_AUDIO",
      "Azure Speech returned no playable audio. Browser speech can be used instead.",
    );
  }
  return sendAudio(response, audio, "audio/mpeg");
}

export function createTtsHandler({
  fetchImplementation = globalThis.fetch,
  environment = process.env,
} = {}) {
  return async function tts(request, response) {
    if (!protectApi(request, response, { name: "tts", limit: 30, environment })) return;
    if (request.method !== "POST") {
      response.setHeader("Allow", "POST");
      return sendError(response, 405, "METHOD_NOT_ALLOWED", "Use POST for speech generation.");
    }

    const text = typeof request.body?.text === "string" ? request.body.text.trim() : "";
    const lang = request.body?.lang;
    if (!text || text.length > MAX_TEXT_LENGTH || !["en", "hi"].includes(lang)) {
      return sendError(
        response,
        400,
        "INVALID_TTS_REQUEST",
        `Provide text between 1 and ${MAX_TEXT_LENGTH} characters and lang as en or hi.`,
      );
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 18_000);

    try {
      return lang === "hi"
        ? await bhashiniHindi({ text, response, fetchImplementation, environment, signal: controller.signal })
        : await azureEnglish({ text, response, fetchImplementation, environment, signal: controller.signal });
    } catch (error) {
      const timeoutError = error?.name === "AbortError";
      const provider = lang === "hi" ? "Bhashini" : "Azure Speech";
      return sendError(
        response,
        timeoutError ? 504 : 502,
        timeoutError ? "TTS_TIMEOUT" : "TTS_UNAVAILABLE",
        timeoutError
          ? `${provider} timed out. Browser speech can be used instead.`
          : `${provider} is unavailable. Browser speech can be used instead.`,
      );
    } finally {
      clearTimeout(timeout);
    }
  };
}

export default createTtsHandler();
