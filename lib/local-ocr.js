import path from "node:path";

export const DEFAULT_LOCAL_OCR_URL = "http://127.0.0.1:8080/ocr";
export const DEFAULT_HEALTH_TIMEOUT_MS = 3_000;
export const DEFAULT_STARTUP_TIMEOUT_MS = 120_000;
export const DEFAULT_HEALTH_POLL_MS = 1_000;

export function resolveOcrConfiguration(environment = process.env) {
  const configuredUrl =
    environment.LOCAL_PADDLEOCR_URL || DEFAULT_LOCAL_OCR_URL;

  try {
    const endpoint = new URL(configuredUrl);
    if (!/^https?:$/.test(endpoint.protocol)) {
      throw new Error("Only HTTP and HTTPS OCR endpoints are supported");
    }

    const endpointPath = endpoint.pathname.replace(/\/+$/, "") || "/";
    const endpointPort =
      endpoint.port || (endpoint.protocol === "https:" ? "443" : "80");
    const isManagedLocal =
      endpoint.protocol === "http:" &&
      endpoint.hostname === "127.0.0.1" &&
      endpointPort === "8080" &&
      endpointPath === "/ocr";

    return {
      valid: true,
      endpoint: endpoint.toString(),
      healthEndpoint: new URL("/health", endpoint.origin).toString(),
      isManagedLocal,
      isExternal: !isManagedLocal,
    };
  } catch (error) {
    return {
      valid: false,
      configuredUrl,
      error: error.message,
    };
  }
}

export function paddleXExecutable(rootDirectory) {
  return path.join(rootDirectory, ".paddle-env", "bin", "paddlex");
}

export function paddleXArguments() {
  return [
    "--serve",
    "--pipeline",
    "OCR",
    "--host",
    "127.0.0.1",
    "--port",
    "8080",
  ];
}

export function delay(duration, signal) {
  if (signal?.aborted) return Promise.resolve();

  return new Promise((resolve) => {
    const timer = setTimeout(done, duration);
    signal?.addEventListener("abort", done, { once: true });

    function done() {
      clearTimeout(timer);
      signal?.removeEventListener("abort", done);
      resolve();
    }
  });
}

export async function probeOcrHealth(
  healthEndpoint,
  {
    fetchImplementation = globalThis.fetch,
    timeoutMs = DEFAULT_HEALTH_TIMEOUT_MS,
    signal,
  } = {},
) {
  if (signal?.aborted) return { healthy: false, aborted: true };

  const controller = new AbortController();
  let timedOut = false;
  const abortForTimeout = () => {
    timedOut = true;
    controller.abort();
  };
  const abortFromParent = () => controller.abort();
  const timeout = setTimeout(abortForTimeout, timeoutMs);
  signal?.addEventListener("abort", abortFromParent, { once: true });

  try {
    const response = await fetchImplementation(healthEndpoint, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    return { healthy: response.ok, status: response.status };
  } catch (error) {
    return {
      healthy: false,
      aborted: Boolean(signal?.aborted),
      timedOut,
      error,
    };
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", abortFromParent);
  }
}

export async function waitForOcrHealth(
  healthEndpoint,
  {
    timeoutMs = DEFAULT_STARTUP_TIMEOUT_MS,
    intervalMs = DEFAULT_HEALTH_POLL_MS,
    probe = probeOcrHealth,
    probeTimeoutMs = DEFAULT_HEALTH_TIMEOUT_MS,
    sleep = delay,
    now = Date.now,
    signal,
  } = {},
) {
  const deadline = now() + timeoutMs;
  let lastProbe = null;

  while (!signal?.aborted) {
    lastProbe = await probe(healthEndpoint, {
      timeoutMs: probeTimeoutMs,
      signal,
    });
    if (lastProbe.healthy || lastProbe.aborted) {
      return { ...lastProbe, lastProbe };
    }

    const remaining = deadline - now();
    if (remaining <= 0) break;
    await sleep(Math.min(intervalMs, remaining), signal);
  }

  return {
    healthy: false,
    aborted: Boolean(signal?.aborted),
    lastProbe,
  };
}
