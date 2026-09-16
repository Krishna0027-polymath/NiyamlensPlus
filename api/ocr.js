import { DEFAULT_LOCAL_OCR_URL } from "../lib/local-ocr.js";
import { validateJpegBase64 } from "../lib/image-quality.js";
import { protectApi } from "../lib/request-security.js";

const MAX_IMAGES = 4;
// Keep Base64 JSON requests under Vercel Functions' 4.5 MB request-body limit.
const MAX_IMAGE_BYTES = 1_500_000;
const MAX_TOTAL_BYTES = 3_000_000;

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function polygonToBox(polygon) {
  if (!Array.isArray(polygon)) return { x0: 0, y0: 0, x1: 0, y1: 0 };

  const points = polygon
    .map((point) =>
      Array.isArray(point)
        ? { x: number(point[0]), y: number(point[1]) }
        : { x: number(point?.x), y: number(point?.y) },
    )
    .filter((point) => point.x !== null && point.y !== null);

  if (!points.length) return { x0: 0, y0: 0, x1: 0, y1: 0 };
  return {
    x0: Math.min(...points.map((point) => point.x)),
    y0: Math.min(...points.map((point) => point.y)),
    x1: Math.max(...points.map((point) => point.x)),
    y1: Math.max(...points.map((point) => point.y)),
  };
}

function rectangleToBox(rectangle) {
  if (!Array.isArray(rectangle) || rectangle.length < 4)
    return { x0: 0, y0: 0, x1: 0, y1: 0 };

  const [x0, y0, x1, y1] = rectangle.map(number);
  if ([x0, y0, x1, y1].some((value) => value === null))
    return { x0: 0, y0: 0, x1: 0, y1: 0 };

  return {
    x0: Math.min(x0, x1),
    y0: Math.min(y0, y1),
    x1: Math.max(x0, x1),
    y1: Math.max(y0, y1),
  };
}

function score(value) {
  const parsed = number(value);
  if (parsed === null) return null;
  return Math.max(
    0,
    Math.min(100, Math.round(parsed <= 1 ? parsed * 100 : parsed)),
  );
}

function normalizePage(page) {
  const result = page?.prunedResult;
  const texts = Array.isArray(result?.rec_texts) ? result.rec_texts : [];
  const scores = Array.isArray(result?.rec_scores) ? result.rec_scores : [];
  const polygons = Array.isArray(result?.rec_polys) ? result.rec_polys : [];
  const boxes = Array.isArray(result?.rec_boxes) ? result.rec_boxes : [];
  const words = texts
    .map((text, index) => {
      const content = String(text || "").trim();
      if (!content) return null;
      return {
        text: content,
        bbox: polygons[index]
          ? polygonToBox(polygons[index])
          : rectangleToBox(boxes[index]),
        confidence: score(scores[index]),
      };
    })
    .filter(Boolean);
  const knownScores = words
    .map((word) => word.confidence)
    .filter((value) => value !== null);

  return {
    text: words.map((word) => word.text).join("\n"),
    words,
    confidence: knownScores.length
      ? Math.round(
          knownScores.reduce((total, value) => total + value, 0) /
            knownScores.length,
        )
      : words.length
        ? 70
        : 0,
  };
}

function normalizeResponse(payload) {
  const pages = payload?.result?.ocrResults;
  if (!Array.isArray(pages)) return null;

  const normalizedPages = pages.map(normalizePage);
  const words = normalizedPages.flatMap((page) => page.words);
  const scores = words
    .map((word) => word.confidence)
    .filter((value) => value !== null);

  return {
    text: normalizedPages
      .map((page) => page.text)
      .filter(Boolean)
      .join("\n"),
    words,
    confidence: scores.length
      ? Math.round(
          scores.reduce((total, value) => total + value, 0) / scores.length,
        )
      : words.length
        ? 70
        : 0,
  };
}

function invalid(response, status, code, error) {
  return response.status(status).json({ code, error });
}

function serviceUrl(environment) {
  const value = environment.LOCAL_PADDLEOCR_URL || DEFAULT_LOCAL_OCR_URL;
  try {
    const url = new URL(value);
    if (!/^https?:$/.test(url.protocol))
      throw new Error("Unsupported protocol");
    return url.toString();
  } catch {
    return "";
  }
}

function serviceError(code, message) {
  return Object.assign(new Error(message), { code });
}

async function scanPanel(endpoint, content, quality, fetchImplementation) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120_000);
  try {
    const result = await fetchImplementation(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        file: content,
        fileType: 1,
        useDocOrientationClassify: true,
        useDocUnwarping: true,
        useTextlineOrientation: true,
        textDetLimitSideLen: 2400,
        textDetLimitType: "max",
        textRecScoreThresh: 0,
        visualize: false,
      }),
      signal: controller.signal,
    });
    const payload = await result.json().catch(() => null);
    if (!result.ok) {
      throw serviceError(
        "LOCAL_OCR_UNAVAILABLE",
        payload?.errorMsg || "Local PaddleOCR could not process this request",
      );
    }

    const normalized = normalizeResponse(payload);
    if (!normalized) {
      throw serviceError(
        "LOCAL_OCR_BAD_RESPONSE",
        "Local PaddleOCR returned an unexpected response",
      );
    }
    return { ...normalized, quality };
  } catch (error) {
    if (error?.name === "AbortError") {
      throw serviceError("LOCAL_OCR_TIMEOUT", "Local PaddleOCR took too long");
    }
    if (error?.code) throw error;
    throw serviceError(
      "LOCAL_OCR_UNAVAILABLE",
      "Local PaddleOCR is not reachable",
    );
  } finally {
    clearTimeout(timeout);
  }
}

export function createOcrHandler({
  fetchImplementation = globalThis.fetch,
  environment = process.env,
} = {}) {
  return async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store");

  if (!protectApi(request, response, { name: "ocr", limit: 20, environment })) return;

  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    return invalid(response, 405, "METHOD_NOT_ALLOWED", "Method not allowed");
  }

  const images = request.body?.images;
  if (!Array.isArray(images) || !images.length || images.length > MAX_IMAGES) {
    return invalid(
      response,
      400,
      "INVALID_IMAGES",
      "Provide between 1 and 4 label images",
    );
  }

  let totalBytes = 0;
  const preparedImages = [];
  for (const image of images) {
    if (
      !image ||
      image.mimeType !== "image/jpeg" ||
      typeof image.content !== "string"
    ) {
      return invalid(
        response,
        400,
        "INVALID_IMAGE",
        "Image data must be a compressed JPEG",
      );
    }

    const validated = validateJpegBase64(image.content);
    if (!validated) {
      return invalid(
        response,
        400,
        "INVALID_IMAGE",
        "Image data is not a valid JPEG file",
      );
    }
    const byteLength = validated.buffer.length;
    if (!byteLength || byteLength > MAX_IMAGE_BYTES) {
      return invalid(
        response,
        413,
        "IMAGE_TOO_LARGE",
        "Each prepared image must be below 1.5 MB",
      );
    }
    totalBytes += byteLength;
    preparedImages.push({ content: image.content, quality: validated.quality });
  }

  if (totalBytes > MAX_TOTAL_BYTES) {
    return invalid(
      response,
      413,
      "PAYLOAD_TOO_LARGE",
      "Combined image size is too large",
    );
  }

  const endpoint = serviceUrl(environment);
  if (!endpoint) {
    return invalid(
      response,
      503,
      "LOCAL_OCR_NOT_CONFIGURED",
      "Local PaddleOCR URL is invalid",
    );
  }

  try {
    const results = [];
    for (const image of preparedImages) {
      results.push(
        await scanPanel(endpoint, image.content, image.quality, fetchImplementation),
      );
    }

    if (!results.some((result) => result.text.trim())) {
      return invalid(response, 422, "NO_TEXT", "No readable text was found");
    }
    return response.status(200).json({ results });
  } catch (error) {
    console.error("Local PaddleOCR request failed", { code: error?.code });
    const code = error?.code || "LOCAL_OCR_UNAVAILABLE";
    const status = code === "LOCAL_OCR_TIMEOUT" ? 504 : 503;
    const safeMessage =
      code === "LOCAL_OCR_TIMEOUT"
        ? "Local PaddleOCR took too long"
        : code === "LOCAL_OCR_BAD_RESPONSE"
          ? "Local PaddleOCR returned an unexpected response"
          : "Local PaddleOCR could not process this request";
    return invalid(response, status, code, safeMessage);
  }
  };
}

export default createOcrHandler();
