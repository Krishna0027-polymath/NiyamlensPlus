import { parseLabel, validateField } from "./label-parser.js?v=label-format-1";
import { assessLabelHealth } from "./health-assessment.js?v=label-format-1";

const MAX_IMAGES = 4,
  MAX_OCR_IMAGE_BYTES = 1_500_000,
  // 3 MB of JPEG data becomes roughly 4 MB in the Base64 JSON request, safely
  // below Vercel Functions' 4.5 MB request-body limit.
  MAX_OCR_TOTAL_BYTES = 3_000_000,
  MAX_OCR_DIMENSION = 2400,
  $ = (s) => document.querySelector(s),
  $$ = (s) => [...document.querySelectorAll(s)],
  app = { images: [], scan: null, health: null, active: null, lang: "en" },
  speech = {
    audio: new Audio(),
    cache: new Map(),
    cloudDisabled: false,
    mode: null,
    state: "idle",
    utterance: null,
  };
function releaseImages() {
  app.images.forEach((image) => URL.revokeObjectURL(image.url));
  app.images = [];
}
function note(m) {
  $("#toast").textContent = m;
  $("#toast").classList.add("show");
  clearTimeout(note.t);
  note.t = setTimeout(() => $("#toast").classList.remove("show"), 3400);
}
function setProgress(value) {
  const bounded = Math.max(0, Math.min(100, Number(value) || 0));
  $("#bar").style.width = `${bounded}%`;
  $(".progress").setAttribute("aria-valuenow", String(Math.round(bounded)));
}
function esc(s = "") {
  return String(s).replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c],
  );
}
function apiEndpoint(path) {
  const localLiveServer =
    ["127.0.0.1", "localhost"].includes(location.hostname) &&
    location.port === "5500";
  return localLiveServer ? `http://127.0.0.1:3000${path}` : path;
}
function page(id) {
  $$(".screen").forEach((x) => x.classList.toggle("active", x.id === id));
  let n = id === "capture" ? 0 : id === "review" ? 2 : 1;
  $$("#steps span").forEach((x, i) => x.classList.toggle("live", i === n));
  scrollTo({ top: 0, behavior: "smooth" });
}
function load(files, append) {
  let a = [...files].filter((f) =>
    ["image/jpeg", "image/png", "image/webp"].includes(f.type),
  );
  if (!a.length) return note("Choose a package-label photo.");
  if (!append) {
    stopNarration(true);
    releaseImages();
  }
  const available = MAX_IMAGES - app.images.length;
  if (available <= 0) return note("A scan can contain up to four label photos.");
  if (a.length > available) {
    a = a.slice(0, available);
    note("Only the first four label photos were added.");
  }
  a.forEach((file) =>
    app.images.push({ file, url: URL.createObjectURL(file) }),
  );
  $("#confirmImage").src = app.images[0].url;
  $("#imageCount").textContent =
    app.images.length + " label photo" + (app.images.length === 1 ? "" : "s");
  $("#addSide").disabled = app.images.length >= MAX_IMAGES;
  page("confirm");
}
async function prepareImage(file) {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type))
    throw Object.assign(Error("Unsupported image type"), {
      code: "UNSUPPORTED_TYPE",
    });
  let image = await new Promise((resolve, reject) => {
      let x = new Image();
      x.onload = () => resolve(x);
      x.onerror = reject;
      x.src = URL.createObjectURL(file);
    }),
    longestSide = Math.max(image.naturalWidth, image.naturalHeight),
    detailScale = longestSide < 1200 ? Math.min(3, 1600 / longestSide) : 1,
    scale = Math.min(detailScale, MAX_OCR_DIMENSION / longestSide),
    quality = 0.9,
    blob;
  for (let attempt = 0; attempt < 5; attempt++) {
    let canvas = document.createElement("canvas");
    canvas.width = Math.round(image.naturalWidth * scale);
    canvas.height = Math.round(image.naturalHeight * scale);
    const context = canvas.getContext("2d");
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    blob = await new Promise((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", quality),
    );
    if (blob && blob.size <= MAX_OCR_IMAGE_BYTES) break;
    scale *= 0.82;
    quality = Math.max(0.62, quality - 0.08);
  }
  if (!blob || blob.size > MAX_OCR_IMAGE_BYTES)
    throw Object.assign(Error("Image is too large"), {
      code: "IMAGE_TOO_LARGE",
    });
  let content = await new Promise((resolve, reject) => {
    let reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
  return { content, mimeType: "image/jpeg", bytes: blob.size };
}

async function enhanceImageForBrowserOcr(imageData) {
  const source = await new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = `data:${imageData.mimeType};base64,${imageData.content}`;
  });
  const scale = Math.max(
    1,
    Math.min(
      2.5,
      MAX_OCR_DIMENSION / Math.max(source.naturalWidth, source.naturalHeight),
    ),
  );
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(source.naturalWidth * scale);
  canvas.height = Math.round(source.naturalHeight * scale);
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(source, 0, 0, canvas.width, canvas.height);

  const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
  for (let index = 0; index < pixels.data.length; index += 4) {
    const luminance =
      0.299 * pixels.data[index] +
      0.587 * pixels.data[index + 1] +
      0.114 * pixels.data[index + 2];
    const enhanced = Math.max(
      0,
      Math.min(255, (luminance - 128) * 1.8 + 128),
    );
    pixels.data[index] = enhanced;
    pixels.data[index + 1] = enhanced;
    pixels.data[index + 2] = enhanced;
  }
  context.putImageData(pixels, 0, 0);
  return canvas;
}

async function browserOcr(images) {
  let worker;
  try {
    const tesseractModule = await import("./vendor/tesseract.esm.min.js");
    const createWorker = tesseractModule.default?.createWorker || tesseractModule.createWorker;

    if (typeof createWorker !== "function") {
      throw new Error("Browser OCR module is unavailable");
    }
    let activePanel = 0;
    worker = await createWorker("eng", 1, {
      workerPath: new URL("./vendor/worker.min.js", import.meta.url).href,
      corePath: new URL("./vendor/core", import.meta.url).href,
      langPath: new URL("./vendor/lang", import.meta.url).href,
      workerBlobURL: false,
      logger(message) {
        if (!Number.isFinite(message?.progress)) return;
        const progress = (activePanel + message.progress) / images.length;
        setProgress(55 + progress * 28);
      },
    });

    const results = [];
    for (let index = 0; index < images.length; index++) {
      activePanel = index;
      $("#scanProgress").textContent =
        `Reading panel ${index + 1} of ${images.length} on this device`;
      const enhancedImage = await enhanceImageForBrowserOcr(images[index]);
      const { data } = await worker.recognize(enhancedImage);
      results.push({
        text: String(data?.text || ""),
        words: [],
        confidence: Number(data?.confidence) || 0,
        quality: null,
      });
    }
    return { results };
  } catch (error) {
    throw Object.assign(error, { code: "BROWSER_OCR_FAILED" });
  } finally {
    await worker?.terminate().catch(() => {});
  }
}

function canUseBrowserOcr(error) {
  return (
    [404, 405, 500, 502, 503, 504].includes(error?.status) ||
    [
      "LOCAL_API_UNAVAILABLE",
      "LOCAL_OCR_UNAVAILABLE",
      "LOCAL_OCR_TIMEOUT",
      "LOCAL_OCR_BAD_RESPONSE",
      "LOCAL_OCR_NOT_CONFIGURED",
    ].includes(error?.code)
  );
}

async function requestOcr(images) {
  const endpoint = apiEndpoint("/api/ocr");
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ images }),
    });
    const responseText = await response.text();
    let data = {};
    try {
      data = responseText ? JSON.parse(responseText) : {};
    } catch {
      data = {};
    }
    if (!response.ok) {
      throw Object.assign(
        Error(
          data.error ||
            `The scan API at ${new URL(endpoint, location.href).origin} returned ${response.status}.`,
        ),
        {
          code: data.code || "LOCAL_OCR_UNAVAILABLE",
          status: response.status,
        },
      );
    }
    return { data, actor: "Local PaddleX OCR" };
  } catch (error) {
    const normalized = error?.code
      ? error
      : Object.assign(error, { code: "LOCAL_API_UNAVAILABLE" });
    if (!canUseBrowserOcr(normalized)) throw normalized;
    $("#scanCopy").textContent =
      "The server OCR is unavailable, so this scan is running privately in your browser.";
    $("#scanProgress").textContent = "Loading the on-device OCR model";
    setProgress(55);
    return { data: await browserOcr(images), actor: "Browser OCR fallback" };
  }
}

function ocrFailure(error) {
  let code = error.code || "",
    retryable = [
      "LOCAL_OCR_UNAVAILABLE",
      "LOCAL_OCR_TIMEOUT",
      "LOCAL_OCR_BAD_RESPONSE",
      "LOCAL_API_UNAVAILABLE",
    ].includes(code),
    message =
      code === "LOCAL_OCR_NOT_CONFIGURED"
        ? "The local PaddleOCR address is invalid. Check LOCAL_PADDLEOCR_URL."
        : code === "LOCAL_OCR_UNAVAILABLE"
          ? "Local OCR is starting or recovering. Wait a few seconds, then try again."
          : code === "LOCAL_OCR_TIMEOUT"
            ? "Local OCR took too long. The first scan can take longer while PaddleX loads; wait a moment and try again."
            : code === "LOCAL_OCR_BAD_RESPONSE"
              ? "Local OCR returned an unexpected result. Wait a few seconds and try again."
              : code === "LOCAL_API_UNAVAILABLE"
                ? "The local scan connection was interrupted. Wait a few seconds, then try again."
              : code === "BROWSER_OCR_FAILED"
                ? "Both server OCR and the private browser fallback failed. Check your connection, then try again."
              : code === "OCR_RESULT_PROCESSING_FAILED"
                ? "OCR finished, but NiyamLens could not process the returned label data. Your photos are preserved; refresh the app and try again."
              : code === "NO_TEXT"
                ? "No readable text found. Retake the panel or add another side."
                : code === "PAYLOAD_TOO_LARGE" || code === "IMAGE_TOO_LARGE"
                  ? "The images are still too large. Retake a closer panel or scan fewer sides."
                  : code === "UNSUPPORTED_TYPE"
                    ? "Use a JPEG, PNG or WebP package image."
                    : "Local OCR is unavailable right now. Keep npm run dev open and try again.";
  $("#scanTitle").textContent =
    code === "NO_TEXT"
      ? "No readable text"
      : code === "OCR_RESULT_PROCESSING_FAILED"
        ? "OCR result could not be processed"
      : code === "PAYLOAD_TOO_LARGE" || code === "IMAGE_TOO_LARGE"
        ? "Image needs a closer capture"
        : retryable
          ? "Local OCR needs a moment"
          : "We could not finish OCR";
  $("#scanCopy").textContent = message;
  $("#scanProgress").textContent = "Your selected photos are still available.";
  setProgress(100);
  $("#scanRecover").textContent = retryable ? "Try again" : "Back to images";
  $("#scanRecover").onclick = retryable ? scan : () => page("confirm");
  $("#scanRecover").classList.remove("hidden");
  note(message);
}
async function scan() {
  if (!app.images.length) return;
  stopNarration(true);
  page("scanning");
  setProgress(8);
  $("#scanRecover").classList.add("hidden");
  $("#scanTitle").textContent = "Preparing label images";
  $("#scanCopy").textContent = "Compressing photos for local OCR.";
  try {
    let images = [],
      total = 0;
    for (let i = 0; i < app.images.length; i++) {
      $("#scanProgress").textContent =
        "Preparing panel " + (i + 1) + " of " + app.images.length;
      setProgress(12 + i * 20);
      let item = await prepareImage(app.images[i].file);
      total += item.bytes;
      if (total > MAX_OCR_TOTAL_BYTES)
        throw Object.assign(Error("Request too large"), {
          code: "PAYLOAD_TOO_LARGE",
        });
      images.push(item);
    }
    $("#scanTitle").textContent = "Reading your label";
    $("#scanCopy").textContent =
      "Your local PaddleOCR service is finding text and evidence regions.";
    $("#scanProgress").textContent = "Sending to the local OCR service";
    setProgress(52);
    const { data, actor } = await requestOcr(images);
    setProgress(86);
    $("#scanProgress").textContent = "Building evidence review";
    let text = "",
      words = [];
    data.results.forEach((result, index) => {
      text += "\\n" + result.text;
      words.push(
        ...(result.words || []).map((word) =>
          Object.assign({}, word, { imageIndex: index }),
        ),
      );
    });
    if (!text.trim())
      throw Object.assign(Error("No readable text"), { code: "NO_TEXT" });
    try {
      const wordScores = words
        .map((word) => Number(word.confidence))
        .filter(Number.isFinite);
      const confidence = wordScores.length
        ? wordScores.reduce((sum, value) => sum + value, 0) / wordScores.length
        : data.results.reduce((sum, result) => sum + (result.confidence || 0), 0) /
          data.results.length;
      app.scan = parseLabel(text, words, confidence);
      app.scan.panels = data.results.map((result, index) => ({
        index,
        confidence: result.confidence || 0,
        text: result.text || "",
        quality: result.quality || null,
      }));
      app.scan.auditTrail.push({
        action: "scan_created",
        at: app.scan.createdAt,
        actor,
        panelCount: data.results.length,
      });
    } catch (cause) {
      throw Object.assign(Error("Failed to process the OCR result", { cause }), {
        code: "OCR_RESULT_PROCESSING_FAILED",
      });
    }
    setProgress(100);
    render();
    setTimeout(() => page("review"), 180);
  } catch (error) {
    console.error(error);
    ocrFailure(error);
  }
}
function render() {
  let f = Object.values(app.scan.fields),
    detectedFields = f.filter((x) => x.value !== "Not found"),
    missingFields = f.filter((x) => x.value === "Not found"),
    found = detectedFields.length,
    missing = missingFields.length;
  $("#summary").innerHTML =
    '<div class="stat"><b>' +
    found +
    '</b><span>fields found</span></div><div class="stat"><b>' +
    missing +
    '</b><span>not printed or not found</span></div><div class="stat"><b>' +
    app.scan.confidence +
    "%</b><span>OCR confidence</span></div>";
  const fieldRow = (x) =>
        '<button class="result" data-key="' +
        x.key +
        '"><i class="signal ' +
        esc(x.status) +
        '"></i><span><span class="field">' +
        esc(x.label) +
        '</span><span class="detail">' +
        esc(x.value) +
        " · " +
        esc(x.detail) +
        '</span></span><span class="tag ' +
        esc(x.status) +
        '">' +
        esc(
          ({
            detected: "DETECTED",
            reviewed: "REVIEWED",
            invalid: "INVALID",
            missing: "MISSING",
            review: "REVIEW",
          })[x.status] || "REVIEW",
        ) +
        "</span></button>";
  $("#results").innerHTML =
    '<div class="result-heading"><strong>Detected on this label</strong><span>Review the captured facts below.</span></div>' +
    (detectedFields.length
      ? detectedFields.map(fieldRow).join("")
      : '<p class="empty-results">No reliable fields were detected. Try a closer, sharper photo.</p>') +
    '<details class="missing-results"><summary><strong>' +
    missing +
    ' declarations not found</strong><span>They may be absent, outside this photo, or unreadable.</span></summary>' +
    missingFields.map(fieldRow).join("") +
    "</details>";
  $$(".result").forEach((x) => (x.onclick = () => openField(x.dataset.key)));
  $("#reviewImage").src = app.images[0].url;
  $("#reviewCount").textContent =
    app.images.length +
    " evidence image" +
    (app.images.length === 1 ? "" : "s");
  $("#ocrChip").textContent = app.scan.confidence + "% OCR";
  const qualityFindings = (app.scan.panels || []).flatMap((panel) =>
    (panel.quality?.findings || []).map(
      (finding) => `Panel ${panel.index + 1}: ${finding}`,
    ),
  );
  $("#caption").textContent = qualityFindings.length
    ? qualityFindings.join(" ")
    : "No basic resolution or compression warnings were detected. Review glare, blur and completeness visually.";
  $("#actions").classList.remove("hidden");
  saathi();
}
function val(k) {
  let f = app.scan.fields[k];
  return f && f.value !== "Not found" ? f.value : "";
}
function saathi() {
  app.health = assessLabelHealth(app.scan);
  const health = app.health;
  const text = health.text[app.lang];
  const levels = {
    en: {
      low: "LOW CONCERN",
      medium: "MODERATE CONCERN",
      high: "HIGH CONCERN",
      unavailable: "ASSESSMENT UNAVAILABLE",
      summary: "Overall assessment",
    },
    hi: {
      low: "कम चिंता",
      medium: "मध्यम चिंता",
      high: "अधिक चिंता",
      unavailable: "आकलन उपलब्ध नहीं",
      summary: "समग्र आकलन",
    },
  }[app.lang];
  $("#saathi").dataset.level = health.overall;
  $("#saathiTitle").textContent = text.title;
  $("#saathiIntro").textContent = text.summary;
  $("#concernBadge").textContent = levels[health.overall];
  $("#saathiDisclaimer").textContent = text.disclaimer;
  let cards = health.findings.map((finding) => ({
    level: finding.level,
    ...finding.text[app.lang],
  }));
  if (["low", "unavailable"].includes(health.overall)) {
    cards.unshift({
      level: health.overall,
      title: levels.summary,
      message: text.summary,
    });
  }
  $("#meaning").innerHTML = cards
    .map(
      (x) =>
        '<div class="meaning risk-' +
        esc(x.level) +
        '"><strong>' +
        esc(x.title) +
        "</strong><p>" +
        esc(x.message) +
        "</p></div>",
    )
    .join("");
  $$(".lang button").forEach((x) =>
    (x.classList.toggle("on", x.dataset.lang === app.lang),
    x.setAttribute("aria-pressed", String(x.dataset.lang === app.lang))),
  );
  document.documentElement.lang = app.lang === "hi" ? "hi" : "en";
  setVoiceState("idle");
}
function openField(k) {
  let f = app.scan.fields[k];
  app.active = k;
  $("#sheetTitle").textContent = f.label;
  $("#sheetDetail").textContent = f.detail + " Original OCR: " + f.original;
  $("#edit").value = f.value === "Not found" ? "" : f.value;
  $("#reviewer").value = f.reviewedBy || "Local reviewer";
  $("#reviewReason").value = "";
  $("#sheet").classList.add("show");
  app.lastFocus = document.activeElement;
  setTimeout(() => $("#edit").focus(), 0);
  showBox(f);
}
function closeSheet() {
  $("#sheet").classList.remove("show");
  app.lastFocus?.focus?.();
}
function showBox(f) {
  let b = $("#evidence"),
    l = $("#evidenceLabel"),
    img = $("#reviewImage"),
    target = app.images[f.imageIndex || 0],
    q = f.bbox;
  if (target && img.src !== target.url) {
    img.src = target.url;
    return;
  }
  if (!q || !img.naturalWidth) {
    b.classList.remove("show");
    l.classList.remove("show");
    $("#caption").textContent =
      f.label + ": no precise OCR region was found; review the image.";
    return;
  }
  let x = img.clientWidth / img.naturalWidth,
    y = img.clientHeight / img.naturalHeight,
    left = 14 + q.x0 * x,
    top = 14 + q.y0 * y;
  b.style.left = left + "px";
  b.style.top = top + "px";
  b.style.width = Math.max(30, (q.x1 - q.x0) * x) + "px";
  b.style.height = Math.max(22, (q.y1 - q.y0) * y) + "px";
  l.style.left = left + "px";
  l.style.top = Math.max(18, top - 21) + "px";
  l.textContent = f.label;
  b.classList.add("show");
  l.classList.add("show");
  $("#caption").textContent =
    f.label + " is highlighted from the OCR source region.";
}
function save() {
  let f = app.scan.fields[app.active],
    v = $("#edit").value.trim(),
    reviewer = $("#reviewer").value.trim(),
    reason = $("#reviewReason").value.trim();
  if (!v) return note("Enter a value, or cancel.");
  if (!reviewer || !reason) return note("Add the reviewer name and correction reason.");
  const validation = validateField(f.key, v);
  const at = new Date().toISOString();
  const change = {
    from: f.value,
    to: validation.normalized,
    actor: reviewer,
    reason,
    at,
    validFormat: validation.valid,
  };
  stopNarration();
  f.value = validation.normalized;
  f.status = validation.valid ? "reviewed" : "invalid";
  f.detail = validation.valid
    ? "Reviewer confirmed the text format; legal compliance still requires rule review."
    : validation.reason;
  f.reviewedAt = at;
  f.reviewedBy = reviewer;
  f.changes.push(change);
  app.scan.auditTrail.push({ action: "field_corrected", field: f.key, ...change });
  closeSheet();
  render();
  note(validation.valid ? f.label + " reviewed." : f.label + " needs a valid format.");
}
function setVoiceState(state, status = "") {
  speech.state = state;
  const listen = $("#listen");
  const pause = $("#pause");
  const labels =
    app.lang === "hi"
      ? {
          idle: "▶ स्वास्थ्य मार्गदर्शन सुनें",
          loading: "आवाज़ तैयार हो रही है…",
          paused: "▶ फिर से चलाएं",
        }
      : {
          idle: "▶ Listen to health guidance",
          loading: "Preparing voice…",
          paused: "▶ Resume",
        };
  listen.textContent = labels[state] || labels.idle;
  listen.disabled = state === "loading";
  listen.classList.toggle("hidden", state === "playing");
  pause.classList.toggle("hidden", state !== "playing");
  pause.disabled = state !== "playing";
  $("#voiceStatus").textContent = status;
}
function stopNarration(clearCache = false) {
  speech.mode = null;
  speech.audio.pause();
  speech.audio.removeAttribute("src");
  speech.audio.load();
  if ("speechSynthesis" in window) speechSynthesis.cancel();
  speech.utterance = null;
  if (clearCache) {
    for (const url of speech.cache.values()) URL.revokeObjectURL(url);
    speech.cache.clear();
  }
  if ($("#listen")) setVoiceState("idle");
}
function browserNarration(text) {
  if (!("speechSynthesis" in window)) {
    setVoiceState("idle");
    return note("Voice playback is not supported in this browser.");
  }
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = app.lang === "hi" ? "hi-IN" : "en-IN";
  utterance.onend = () => {
    if (speech.utterance === utterance) {
      speech.mode = null;
      speech.utterance = null;
      setVoiceState("idle");
    }
  };
  utterance.onerror = () => {
    if (speech.utterance === utterance) {
      speech.mode = null;
      speech.utterance = null;
      setVoiceState("idle", "Voice playback could not start.");
    }
  };
  speech.mode = "browser";
  speech.utterance = utterance;
  setVoiceState(
    "playing",
    app.lang === "hi" ? "ब्राउज़र की मुफ़्त आवाज़ चल रही है।" : "Playing with free browser speech.",
  );
  speechSynthesis.cancel();
  speechSynthesis.speak(utterance);
}
async function playCloudAudio(url) {
  speech.mode = "cloud";
  speech.audio.src = url;
  speech.audio.currentTime = 0;
  setVoiceState(
    "playing",
    app.lang === "hi" ? "भाषिणी की हिंदी आवाज़ चल रही है।" : "Playing Azure Speech audio.",
  );
  try {
    await speech.audio.play();
  } catch (error) {
    speech.mode = null;
    setVoiceState(
      "idle",
      error?.name === "NotAllowedError"
        ? "Voice is ready. Tap Listen again to play it."
        : "Voice playback could not start.",
    );
  }
}
async function listenNarration() {
  if (!app.scan || !app.health) return;
  if (speech.state === "paused") {
    if (speech.mode === "cloud") {
      setVoiceState("playing", $("#voiceStatus").textContent);
      try {
        await speech.audio.play();
      } catch {
        setVoiceState("paused", "Tap Resume again to continue.");
      }
    } else if (speech.mode === "browser") {
      speechSynthesis.resume();
      setVoiceState(
        "playing",
        app.lang === "hi" ? "ब्राउज़र की मुफ़्त आवाज़ चल रही है।" : "Playing with free browser speech.",
      );
    }
    return;
  }

  const text = app.health.text[app.lang].narration;
  speech.text = text;
  const cacheKey = `${app.scan.createdAt}:${app.lang}`;
  const cached = speech.cache.get(cacheKey);
  if (cached) return playCloudAudio(cached);
  if (speech.cloudDisabled || !navigator.onLine) return browserNarration(text);

  setVoiceState("loading");
  try {
    const response = await fetch(apiEndpoint("/api/tts"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, lang: app.lang }),
    });
    if (!response.ok) {
      const failure = await response.json().catch(() => ({}));
      if (failure.code === "TTS_NOT_CONFIGURED") speech.cloudDisabled = true;
      throw Error(failure.code || "TTS_UNAVAILABLE");
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    speech.cache.set(cacheKey, url);
    await playCloudAudio(url);
  } catch {
    browserNarration(text);
  }
}
function pauseNarration() {
  if (speech.state !== "playing") return;
  if (speech.mode === "cloud") speech.audio.pause();
  if (speech.mode === "browser") speechSynthesis.pause();
  setVoiceState(
    "paused",
    app.lang === "hi" ? "आवाज़ रुकी हुई है।" : "Voice paused at the current position.",
  );
}
speech.audio.onended = () => {
  speech.mode = null;
  setVoiceState("idle");
};
speech.audio.onerror = () => {
  if (speech.mode === "cloud") {
    speech.mode = null;
    for (const [key, url] of speech.cache.entries()) {
      if (url === speech.audio.src) {
        URL.revokeObjectURL(url);
        speech.cache.delete(key);
      }
    }
    browserNarration(speech.text || app.health?.text[app.lang]?.narration || "");
  }
};
$("#camera").onclick = () => {
  $("#input").setAttribute("capture", "environment");
  $("#input").click();
};
$("#gallery").onclick = () => {
  $("#input").removeAttribute("capture");
  $("#input").click();
};
$("#input").onchange = (e) => {
  load(e.target.files, app.images.length > 0);
  e.target.value = "";
};
$("#retake").onclick = () => {
  stopNarration(true);
  releaseImages();
  page("capture");
};
$("#addSide").onclick = () => {
  $("#input").setAttribute("capture", "environment");
  $("#input").click();
};
$("#readLabel").onclick = scan;
$("#closeSheet").onclick = closeSheet;
$("#sheet").onclick = (e) => {
  if (e.target === $("#sheet")) closeSheet();
};
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && $("#sheet").classList.contains("show")) closeSheet();
});
$("#save").onclick = save;
$("#newScan").onclick = () => {
  stopNarration(true);
  releaseImages();
  app.scan = null;
  app.health = null;
  $("#actions").classList.add("hidden");
  page("capture");
};
$$(".mode").forEach(
  (x) =>
    (x.onclick = () => {
      let s = x.dataset.mode === "saathi";
      $$(".mode").forEach((y) => {
        y.classList.remove("active");
        y.setAttribute("aria-pressed", "false");
      });
      x.classList.add("active");
      x.setAttribute("aria-pressed", "true");
      $("#inspector").classList.toggle("show", !s);
      $("#saathi").classList.toggle("show", s);
    }),
);
$$(".lang button").forEach(
  (x) =>
    (x.onclick = () => {
      stopNarration();
      app.lang = x.dataset.lang;
      saathi();
    }),
);
$("#listen").onclick = listenNarration;
$("#pause").onclick = pauseNarration;
$("#reviewImage").onload = () => {
  if (app.active) showBox(app.scan.fields[app.active]);
};
function net() {
  $("#network").textContent = navigator.onLine
    ? "LOCAL OCR"
    : "OFFLINE · LOCAL OCR";
  $("#network").style.color = navigator.onLine ? "" : "#ffbd78";
}
addEventListener("online", net);
addEventListener("offline", net);
net();
if ("serviceWorker" in navigator)
  addEventListener("load", () =>
    navigator.serviceWorker.register("sw.js").catch(console.warn),
  );

let installEvent;
addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  installEvent = event;
  document.querySelector("#install").style.display = "block";
});
document.querySelector("#install").onclick = async () => {
  if (!installEvent) return;
  installEvent.prompt();
  await installEvent.userChoice;
  installEvent = null;
  document.querySelector("#install").style.display = "none";
};
addEventListener("appinstalled", () => {
  document.querySelector("#install").style.display = "none";
});
