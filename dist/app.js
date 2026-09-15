import { parseLabel } from "./label-parser.js?v=local-ocr-5";

const MAX_OCR_IMAGE_BYTES = 1_500_000,
  // 3 MB of JPEG data becomes roughly 4 MB in the Base64 JSON request, safely
  // below Vercel Functions' 4.5 MB request-body limit.
  MAX_OCR_TOTAL_BYTES = 3_000_000,
  MAX_OCR_DIMENSION = 2400,
  $ = (s) => document.querySelector(s),
  $$ = (s) => [...document.querySelectorAll(s)],
  app = { images: [], scan: null, active: null, lang: "en" };
function note(m) {
  $("#toast").textContent = m;
  $("#toast").classList.add("show");
  clearTimeout(note.t);
  note.t = setTimeout(() => $("#toast").classList.remove("show"), 3400);
}
function esc(s = "") {
  return String(s).replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c],
  );
}
function listingOnline() {
  if (!navigator.onLine) {
    note("An internet connection is required to check retailer listings.");
    return false;
  }
  return true;
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
  let a = [...files].filter((f) => f.type.startsWith("image/"));
  if (!a.length) return note("Choose a package-label photo.");
  if (!append) app.images = [];
  a.forEach((file) =>
    app.images.push({ file, url: URL.createObjectURL(file) }),
  );
  $("#confirmImage").src = app.images[0].url;
  $("#imageCount").textContent =
    app.images.length + " label photo" + (app.images.length === 1 ? "" : "s");
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
    scale = Math.min(
      1,
      MAX_OCR_DIMENSION / Math.max(image.naturalWidth, image.naturalHeight),
    ),
    quality = 0.9,
    blob;
  for (let attempt = 0; attempt < 5; attempt++) {
    let canvas = document.createElement("canvas");
    canvas.width = Math.round(image.naturalWidth * scale);
    canvas.height = Math.round(image.naturalHeight * scale);
    canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
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
  $("#bar").style.width = "100%";
  $("#scanRecover").textContent = retryable ? "Try again" : "Back to images";
  $("#scanRecover").onclick = retryable ? scan : () => page("confirm");
  $("#scanRecover").classList.remove("hidden");
  note(message);
}
async function scan() {
  if (!app.images.length) return;
  page("scanning");
  $("#bar").style.width = "8%";
  $("#scanRecover").classList.add("hidden");
  $("#scanTitle").textContent = "Preparing label images";
  $("#scanCopy").textContent = "Compressing photos for local OCR.";
  try {
    let images = [],
      total = 0;
    for (let i = 0; i < app.images.length; i++) {
      $("#scanProgress").textContent =
        "Preparing panel " + (i + 1) + " of " + app.images.length;
      $("#bar").style.width = 12 + i * 20 + "%";
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
    $("#bar").style.width = "52%";
    const endpoint = apiEndpoint("/api/ocr");
    let response;
    try {
      response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ images }),
      });
    } catch (error) {
      throw Object.assign(error, { code: "LOCAL_API_UNAVAILABLE" });
    }
    const responseText = await response.text();
    let data = {};
    try {
      data = responseText ? JSON.parse(responseText) : {};
    } catch {
      data = {};
    }
    if (!response.ok)
      throw Object.assign(
        Error(
          data.error ||
            `The local scan API at ${new URL(endpoint, location.href).origin} returned ${response.status}.`,
        ),
        {
          code: data.code || "LOCAL_OCR_UNAVAILABLE",
        },
      );
    $("#bar").style.width = "86%";
    $("#scanProgress").textContent = "Building evidence review";
    let text = "",
      words = [],
      confidence = 0;
    data.results.forEach((result, index) => {
      text += "\\n" + result.text;
      confidence += result.confidence || 0;
      words.push(
        ...result.words.map((word) =>
          Object.assign({}, word, { imageIndex: index }),
        ),
      );
    });
    if (!text.trim())
      throw Object.assign(Error("No readable text"), { code: "NO_TEXT" });
    try {
      app.scan = parseLabel(text, words, confidence / data.results.length);
    } catch (cause) {
      throw Object.assign(Error("Failed to process the OCR result", { cause }), {
        code: "OCR_RESULT_PROCESSING_FAILED",
      });
    }
    $("#bar").style.width = "100%";
    render();
    setTimeout(() => page("review"), 180);
  } catch (error) {
    console.error(error);
    ocrFailure(error);
  }
}
function render() {
  let f = Object.values(app.scan.fields),
    passed = f.filter((x) => x.status === "pass").length;
  $("#summary").innerHTML =
    '<div class="stat"><b>' +
    passed +
    '</b><span>verified</span></div><div class="stat"><b>' +
    (f.length - passed) +
    '</b><span>needs review</span></div><div class="stat"><b>' +
    app.scan.confidence +
    "%</b><span>OCR confidence</span></div>";
  $("#results").innerHTML = f
    .map(
      (x) =>
        '<button class="result" data-key="' +
        x.key +
        '"><i class="signal ' +
        (x.status === "review" ? "review" : "") +
        '"></i><span><span class="field">' +
        esc(x.label) +
        '</span><span class="detail">' +
        esc(x.value) +
        " · " +
        esc(x.detail) +
        '</span></span><span class="tag ' +
        (x.status === "review" ? "review" : "") +
        '">' +
        (x.status === "pass" ? "PASS" : "REVIEW") +
        "</span></button>",
    )
    .join("");
  $$(".result").forEach((x) => (x.onclick = () => openField(x.dataset.key)));
  $("#reviewImage").src = app.images[0].url;
  $("#reviewCount").textContent =
    app.images.length +
    " evidence image" +
    (app.images.length === 1 ? "" : "s");
  $("#ocrChip").textContent = app.scan.confidence + "% OCR";
  $("#actions").classList.remove("hidden");
  saathi();
}
function val(k) {
  let f = app.scan.fields[k];
  return f && f.value !== "Not found" ? f.value : "";
}
function saathi() {
  let hi = app.lang === "hi",
    t = hi
      ? [
          "इस पैकेट पर क्या लिखा है",
          "ये बातें फोटो खींचे गए लेबल से ली गई हैं। समीक्षा वाले बिंदुओं को इस्तेमाल से पहले जांचें।",
          "एलर्जी की जानकारी",
          "पैकेट की मात्रा",
          "पोषण जानकारी",
          "तारीख की जानकारी",
          "सामग्री",
        ]
      : [
          "What this packet says",
          "These points come from the photographed label. Check any item marked for review before relying on it.",
          "Contains allergens",
          "Package quantity",
          "Nutrition information",
          "Date declaration",
          "Ingredients",
        ];
  $("#saathiTitle").textContent = t[0];
  $("#saathiIntro").textContent = t[1];
  let cards = [
    [
      t[2],
      val("allergens") ||
        "No clear allergen statement was read. Check the ingredients panel.",
    ],
    [
      t[3],
      val("quantity")
        ? val("quantity") +
          " is the declared package quantity. Serving size may be different."
        : "Package quantity needs review.",
    ],
    [t[4], val("nutrition") || "Nutrition information needs review."],
    [
      t[5],
      val("dates")
        ? "Date read from label: " + val("dates")
        : "Packed/best-before date needs review.",
    ],
    [t[6], val("ingredients") || "Ingredients were not read clearly."],
  ];
  $("#meaning").innerHTML = cards
    .map(
      (x) =>
        '<div class="meaning"><strong>' +
        esc(x[0]) +
        "</strong><p>" +
        esc(x[1]) +
        "</p></div>",
    )
    .join("");
  $$(".lang button").forEach((x) =>
    x.classList.toggle("on", x.dataset.lang === app.lang),
  );
}
function openField(k) {
  let f = app.scan.fields[k];
  app.active = k;
  $("#sheetTitle").textContent = f.label;
  $("#sheetDetail").textContent = f.detail + " Original OCR: " + f.original;
  $("#edit").value = f.value === "Not found" ? "" : f.value;
  $("#sheet").classList.add("show");
  showBox(f);
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
    v = $("#edit").value.trim();
  if (!v) return note("Enter a verified value, or cancel.");
  f.value = v;
  f.status = "pass";
  f.detail = "Verified manually by reviewer.";
  $("#sheet").classList.remove("show");
  render();
  note(f.label + " marked verified.");
}
async function listing() {
  if (!listingOnline() || !app.scan) return;
  let b = $("#listing");
  b.disabled = true;
  b.textContent = "Looking up…";
  try {
    let r = await fetch(apiEndpoint("/api/listing-lookup"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productName: (val("manufacturer") + " " + val("ingredients")).trim(),
          barcode: "",
        }),
      }),
      d = await r.json();
    if (!r.ok) throw Error(d.error);
    app.scan.listing = d;
    note(
      d.price
        ? "Reference listing: ₹" + d.price + " — compare with package MRP"
        : "No reliable listing price found.",
    );
  } catch (e) {
    app.scan.listing = {
      error: "Live price lookup unavailable",
      checkedAt: new Date().toISOString(),
    };
    note("Listing lookup unavailable; marked for review.");
  } finally {
    b.disabled = false;
    b.textContent = "Check listing MRP";
  }
}
function report() {
  if (!app.scan) return;
  let p = window.open("", "_blank"),
    f = Object.values(app.scan.fields),
    l = app.scan.listing;
  if (!p) return note("Allow pop-ups to open the report.");
  p.document.write(
    "<!doctype html><title>NiyamLens+ evidence report</title><style>body{font:14px Arial;color:#162c47;max-width:760px;margin:30px auto;padding:0 18px}small,p{color:#62748c}table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:10px;border-bottom:1px solid #d4deeb;vertical-align:top}th{font-size:11px;color:#62748c}img{max-width:100%;max-height:420px;border-radius:10px}button{padding:10px;border:0;border-radius:7px;background:#2b67f6;color:white}@media print{button{display:none}}</style><h1>NiyamLens+ evidence report</h1><p>Created " +
      esc(new Date(app.scan.createdAt).toLocaleString()) +
      " · OCR confidence " +
      app.scan.confidence +
      '% · Human decision required for review items.</p><button onclick="print()">Print / Save as PDF</button><h2>Captured label</h2><img src="' +
      app.images[0].url +
      '"><h2>Extracted declarations</h2><table><tr><th>Field</th><th>Value</th><th>Evidence</th><th>Status</th></tr>' +
      f
        .map(
          (x) =>
            "<tr><td>" +
            esc(x.label) +
            "</td><td>" +
            esc(x.value) +
            "</td><td>" +
            esc(x.detail) +
            "<br><small>Original: " +
            esc(x.original) +
            "</small></td><td>" +
            esc(x.status.toUpperCase()) +
            "</td></tr>",
        )
        .join("") +
      "</table><h2>Retailer reference</h2><p>" +
      esc(
        l
          ? l.error ||
              (l.title || "Listing") +
                " · ₹" +
                (l.price || "not found") +
                " · " +
                (l.source || "Tavily Search")
          : "Not checked.",
      ) +
      "</p><h2>OCR text</h2><p>" +
      esc(app.scan.raw).replace(/\n/g, "<br>") +
      "</p>",
  );
  p.document.close();
}
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
  app.images = [];
  page("capture");
};
$("#addSide").onclick = () => {
  $("#input").setAttribute("capture", "environment");
  $("#input").click();
};
$("#readLabel").onclick = scan;
$("#closeSheet").onclick = () => $("#sheet").classList.remove("show");
$("#sheet").onclick = (e) => {
  if (e.target === $("#sheet")) $("#sheet").classList.remove("show");
};
$("#save").onclick = save;
$("#listing").onclick = listing;
$("#report").onclick = report;
$("#newScan").onclick = () => {
  app.images = [];
  app.scan = null;
  $("#actions").classList.add("hidden");
  page("capture");
};
$$(".mode").forEach(
  (x) =>
    (x.onclick = () => {
      let s = x.dataset.mode === "saathi";
      $$(".mode").forEach((y) => y.classList.remove("active"));
      x.classList.add("active");
      $("#inspector").classList.toggle("show", !s);
      $("#saathi").classList.toggle("show", s);
    }),
);
$$(".lang button").forEach(
  (x) =>
    (x.onclick = () => {
      app.lang = x.dataset.lang;
      saathi();
    }),
);
$("#listen").onclick = () => {
  if (!("speechSynthesis" in window))
    return note("Audio is not supported in this browser.");
  let u = new SpeechSynthesisUtterance(
    $("#saathiTitle").textContent +
      ". " +
      $("#saathiIntro").textContent +
      ". " +
      [...$("#meaning").querySelectorAll("p")]
        .map((x) => x.textContent)
        .join(". "),
  );
  u.lang = app.lang === "hi" ? "hi-IN" : "en-IN";
  speechSynthesis.cancel();
  speechSynthesis.speak(u);
  note("Playing a label-based explanation.");
};
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
