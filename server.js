import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import listingLookup from "./api/listing-lookup.js";
import ocr from "./api/ocr.js";
import { loadLocalEnvironment } from "./lib/local-environment.js";

const rootDirectory = path.dirname(fileURLToPath(import.meta.url));
const staticDirectory = path.join(rootDirectory, "dist");
const MAX_BODY_BYTES = 10_000_000;
const routes = new Map([
  ["/api/ocr", ocr],
  ["/api/listing-lookup", listingLookup],
]);
const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json",
  ".webp": "image/webp",
};

function apiResponse(response) {
  return {
    setHeader(name, value) {
      response.setHeader(name, value);
    },
    status(code) {
      response.statusCode = code;
      return this;
    },
    json(value) {
      if (!response.hasHeader("Content-Type")) {
        response.setHeader("Content-Type", "application/json; charset=utf-8");
      }
      response.end(JSON.stringify(value));
      return this;
    },
  };
}

function allowLocalLiveServer(request, response) {
  const origin = request.headers.origin || "";
  if (/^http:\/\/(127\.0\.0\.1|localhost):5500$/.test(origin)) {
    response.setHeader("Access-Control-Allow-Origin", origin);
    response.setHeader("Vary", "Origin");
    response.setHeader("Access-Control-Allow-Headers", "Content-Type");
    response.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  }
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let size = 0;
    let tooLarge = false;
    const chunks = [];
    request.on("data", (chunk) => {
      if (tooLarge) return;
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        tooLarge = true;
        reject(
          Object.assign(new Error("Request body is too large"), {
            status: 413,
          }),
        );
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      if (tooLarge) return;
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(
          Object.assign(new Error("Request body must be JSON"), {
            status: 400,
          }),
        );
      }
    });
    request.on("error", reject);
  });
}

async function serveApi(request, response, handler) {
  try {
    request.body = request.method === "POST" ? await readJson(request) : {};
    await handler(request, apiResponse(response));
  } catch (error) {
    if (response.writableEnded) return;
    response.statusCode = error.status || 500;
    response.setHeader("Content-Type", "application/json; charset=utf-8");
    response.end(
      JSON.stringify({
        error:
          error.status === 413
            ? "Request body is too large"
            : error.status === 400
              ? "Request body must be JSON"
              : "Local server could not complete the request",
      }),
    );
  }
}

function serveStatic(request, response, pathname) {
  const decodedPath = decodeURIComponent(
    pathname === "/" ? "/index.html" : pathname,
  );
  const filePath = path.resolve(staticDirectory, `.${decodedPath}`);
  if (
    !filePath.startsWith(`${staticDirectory}${path.sep}`) ||
    !existsSync(filePath)
  ) {
    response.statusCode = 404;
    response.end("Not found");
    return;
  }

  const fileInfo = statSync(filePath);
  if (!fileInfo.isFile()) {
    response.statusCode = 404;
    response.end("Not found");
    return;
  }

  response.statusCode = 200;
  response.setHeader(
    "Content-Type",
    contentTypes[path.extname(filePath)] || "application/octet-stream",
  );
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  createReadStream(filePath).pipe(response);
}

loadLocalEnvironment(rootDirectory);

const server = createServer((request, response) => {
  const pathname = new URL(request.url, "http://localhost").pathname;
  const handler = routes.get(pathname);
  if (handler) {
    allowLocalLiveServer(request, response);
    if (request.method === "OPTIONS") {
      response.statusCode = 204;
      response.end();
      return;
    }
    return serveApi(request, response, handler);
  }
  return serveStatic(request, response, pathname);
});

const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || "127.0.0.1";
server.listen(port, host, () => {
  console.log(`NiyamLens is ready at http://${host}:${port}`);
});
