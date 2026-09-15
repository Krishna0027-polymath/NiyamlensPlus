import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { LocalDevSupervisor } from "../lib/local-dev-supervisor.js";
import {
  DEFAULT_LOCAL_OCR_URL,
  probeOcrHealth,
  resolveOcrConfiguration,
  waitForOcrHealth,
} from "../lib/local-ocr.js";

class FakeStream extends EventEmitter {
  setEncoding() {}
}

class FakeChild extends EventEmitter {
  constructor() {
    super();
    this.exitCode = null;
    this.signalCode = null;
    this.stdout = new FakeStream();
    this.stderr = new FakeStream();
    this.killedWith = [];
  }

  kill(signal) {
    this.killedWith.push(signal);
    this.signalCode = signal;
    this.emit("exit", null, signal);
    return true;
  }
}

class FakeProcess extends EventEmitter {
  constructor() {
    super();
    this.execPath = "/usr/bin/node";
    this.exitCode = undefined;
  }
}

function quietSupervisor(overrides = {}) {
  return new LocalDevSupervisor({
    rootDirectory: "/project",
    environment: {},
    processObject: new FakeProcess(),
    log() {},
    logError() {},
    stopTimeoutMs: 10,
    ...overrides,
  });
}

test("default OCR configuration is locally managed", () => {
  const configuration = resolveOcrConfiguration({});
  assert.equal(configuration.valid, true);
  assert.equal(configuration.endpoint, DEFAULT_LOCAL_OCR_URL);
  assert.equal(configuration.healthEndpoint, "http://127.0.0.1:8080/health");
  assert.equal(configuration.isManagedLocal, true);
});

test("custom and non-loopback OCR URLs are externally managed", () => {
  const customLocal = resolveOcrConfiguration({
    LOCAL_PADDLEOCR_URL: "http://127.0.0.1:9000/ocr",
  });
  const remote = resolveOcrConfiguration({
    LOCAL_PADDLEOCR_URL: "https://ocr.example.test/ocr",
  });

  assert.equal(customLocal.isExternal, true);
  assert.equal(remote.isExternal, true);
  assert.equal(remote.healthEndpoint, "https://ocr.example.test/health");
});

test("invalid OCR URLs are rejected", () => {
  const configuration = resolveOcrConfiguration({
    LOCAL_PADDLEOCR_URL: "file:///tmp/ocr",
  });
  assert.equal(configuration.valid, false);
  assert.match(configuration.error, /HTTP and HTTPS/);
});

test("health probe reports healthy and unreachable services", async () => {
  const healthy = await probeOcrHealth("http://ocr.test/health", {
    fetchImplementation: async () => ({ ok: true, status: 200 }),
  });
  const unreachable = await probeOcrHealth("http://ocr.test/health", {
    fetchImplementation: async () => {
      throw new Error("connection refused");
    },
  });

  assert.deepEqual(healthy, { healthy: true, status: 200 });
  assert.equal(unreachable.healthy, false);
  assert.match(unreachable.error.message, /connection refused/);
});

test("health wait polls until the service becomes ready", async () => {
  let probes = 0;
  let clock = 0;
  const result = await waitForOcrHealth("http://ocr.test/health", {
    timeoutMs: 5_000,
    intervalMs: 100,
    probe: async () => ({ healthy: ++probes === 3 }),
    sleep: async (duration) => {
      clock += duration;
    },
    now: () => clock,
  });

  assert.equal(result.healthy, true);
  assert.equal(probes, 3);
});

test("a single health-probe timeout does not end the startup wait", async () => {
  let probes = 0;
  let clock = 0;
  const result = await waitForOcrHealth("http://ocr.test/health", {
    timeoutMs: 5_000,
    intervalMs: 100,
    probe: async () =>
      ++probes === 1
        ? { healthy: false, timedOut: true }
        : { healthy: true, status: 200 },
    sleep: async (duration) => {
      clock += duration;
    },
    now: () => clock,
  });

  assert.equal(result.healthy, true);
  assert.equal(probes, 2);
});

test("a healthy existing OCR service is reused and never killed", async () => {
  const fakeProcess = new FakeProcess();
  const appChild = new FakeChild();
  const calls = [];
  const supervisor = quietSupervisor({
    processObject: fakeProcess,
    probeHealth: async () => ({ healthy: true }),
    spawnProcess(command, args) {
      calls.push({ command, args });
      return appChild;
    },
  });

  await supervisor.start();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, fakeProcess.execPath);

  fakeProcess.emit("SIGINT");
  await supervisor.shutdownPromise;
  assert.deepEqual(appChild.killedWith, ["SIGTERM"]);
  assert.equal(fakeProcess.listenerCount("SIGINT"), 0);
  assert.equal(fakeProcess.listenerCount("SIGTERM"), 0);
  assert.equal(fakeProcess.exitCode, 0);
});

test("the supervisor starts PaddleX before the app and cleans up both", async () => {
  const ocrChild = new FakeChild();
  const appChild = new FakeChild();
  const calls = [];
  const supervisor = quietSupervisor({
    probeHealth: async () => ({ healthy: false }),
    waitForHealth: async () => ({ healthy: true }),
    pathExists: () => true,
    spawnProcess(command, args) {
      calls.push({ command, args });
      return calls.length === 1 ? ocrChild : appChild;
    },
  });

  await supervisor.start();
  assert.equal(calls.length, 2);
  assert.match(calls[0].command, /\.paddle-env\/bin\/paddlex$/);
  assert.deepEqual(calls[0].args, [
    "--serve",
    "--pipeline",
    "OCR",
    "--host",
    "127.0.0.1",
    "--port",
    "8080",
  ]);
  assert.equal(calls[1].command, "/usr/bin/node");

  await supervisor.shutdown();
  assert.deepEqual(ocrChild.killedWith, ["SIGTERM"]);
  assert.deepEqual(appChild.killedWith, ["SIGTERM"]);
});

test("a managed PaddleX crash is restarted while the app stays running", async () => {
  const firstOcrChild = new FakeChild();
  const appChild = new FakeChild();
  const replacementOcrChild = new FakeChild();
  const children = [firstOcrChild, appChild, replacementOcrChild];
  const waits = [];
  let spawnIndex = 0;
  const supervisor = quietSupervisor({
    probeHealth: async () => ({ healthy: false }),
    waitForHealth: async () => ({ healthy: true }),
    pathExists: () => true,
    sleep: async (duration) => waits.push(duration),
    spawnProcess() {
      return children[spawnIndex++];
    },
  });

  await supervisor.start();
  firstOcrChild.exitCode = 1;
  firstOcrChild.emit("exit", 1, null);
  await supervisor.recoveryPromise;

  assert.equal(spawnIndex, 3);
  assert.deepEqual(waits, [1_000]);
  assert.equal(supervisor.appChild, appChild);
  assert.equal(supervisor.ocrChild, replacementOcrChild);
  await supervisor.shutdown();
});

test("a missing local PaddleX environment fails with setup guidance", async () => {
  const supervisor = quietSupervisor({
    probeHealth: async () => ({ healthy: false }),
    pathExists: () => false,
  });

  await assert.rejects(supervisor.start(), (error) => {
    assert.equal(error.code, "OCR_SETUP_MISSING");
    assert.match(error.message, /LOCAL_OCR\.md/);
    return true;
  });
  await supervisor.shutdown(1);
});

test("PaddleX launch failures use the capped 1/2/4-second retries", async () => {
  const waits = [];
  const children = [];
  let launches = 0;
  const supervisor = quietSupervisor({
    probeHealth: async () => ({ healthy: false }),
    pathExists: () => true,
    restartDelaysMs: [1_000, 2_000, 4_000],
    sleep: async (duration) => waits.push(duration),
    waitForHealth: async (_endpoint, { signal }) =>
      new Promise((resolve) =>
        signal.addEventListener(
          "abort",
          () => resolve({ healthy: false, aborted: true }),
          { once: true },
        ),
      ),
    spawnProcess() {
      launches += 1;
      const child = new FakeChild();
      children.push(child);
      queueMicrotask(() => child.emit("error", new Error("spawn failed")));
      return child;
    },
  });

  await assert.rejects(supervisor.start(), (error) => {
    assert.equal(error.code, "OCR_RESTART_LIMIT");
    assert.match(error.message, /after 3 retries/);
    return true;
  });
  assert.equal(launches, 4);
  assert.deepEqual(waits, [1_000, 2_000, 4_000]);
  assert.equal(children.every((child) => child.killedWith.length === 1), true);
  await supervisor.shutdown(1);
});

test("an unhealthy custom OCR URL is not started locally", async () => {
  let spawned = false;
  const supervisor = quietSupervisor({
    environment: {
      LOCAL_PADDLEOCR_URL: "https://ocr.example.test/ocr",
    },
    probeHealth: async () => ({ healthy: false }),
    spawnProcess() {
      spawned = true;
      return new FakeChild();
    },
  });

  await assert.rejects(supervisor.start(), (error) => {
    assert.equal(error.code, "EXTERNAL_OCR_UNAVAILABLE");
    assert.match(error.message, /externally managed/);
    return true;
  });
  assert.equal(spawned, false);
  await supervisor.shutdown(1);
});
