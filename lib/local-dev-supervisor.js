import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import {
  DEFAULT_STARTUP_TIMEOUT_MS,
  delay,
  paddleXArguments,
  paddleXExecutable,
  probeOcrHealth,
  resolveOcrConfiguration,
  waitForOcrHealth,
} from "./local-ocr.js";

export const OCR_RESTART_DELAYS_MS = [1_000, 2_000, 4_000];

function supervisorError(code, message) {
  return Object.assign(new Error(message), { code });
}

function describeExit(code, signal) {
  if (signal) return `signal ${signal}`;
  return `exit code ${code ?? "unknown"}`;
}

function prefixOutput(stream, prefix, write) {
  if (!stream?.on) return;

  let buffered = "";
  stream.setEncoding?.("utf8");
  stream.on("data", (chunk) => {
    buffered += String(chunk);
    const lines = buffered.split(/\r?\n/);
    buffered = lines.pop() || "";
    for (const line of lines) {
      if (line) write(`${prefix} ${line}`);
    }
  });
  stream.on("end", () => {
    if (buffered) write(`${prefix} ${buffered}`);
  });
}

export class LocalDevSupervisor {
  constructor({
    rootDirectory,
    environment = process.env,
    processObject = process,
    spawnProcess = spawn,
    pathExists = existsSync,
    probeHealth = probeOcrHealth,
    waitForHealth = waitForOcrHealth,
    sleep = delay,
    startupTimeoutMs = DEFAULT_STARTUP_TIMEOUT_MS,
    restartDelaysMs = OCR_RESTART_DELAYS_MS,
    stopTimeoutMs = 5_000,
    log = console.log,
    logError = console.error,
    onExit,
  }) {
    this.rootDirectory = rootDirectory;
    this.environment = environment;
    this.processObject = processObject;
    this.spawnProcess = spawnProcess;
    this.pathExists = pathExists;
    this.probeHealth = probeHealth;
    this.waitForHealth = waitForHealth;
    this.sleep = sleep;
    this.startupTimeoutMs = startupTimeoutMs;
    this.restartDelaysMs = [...restartDelaysMs];
    this.stopTimeoutMs = stopTimeoutMs;
    this.log = log;
    this.logError = logError;
    this.onExit = onExit || ((code) => (this.processObject.exitCode = code));

    this.configuration = resolveOcrConfiguration(environment);
    this.appChild = null;
    this.ocrChild = null;
    this.recoveryPromise = null;
    this.shutdownPromise = null;
    this.shuttingDown = false;
    this.abortController = new AbortController();
    this.signalHandlers = new Map();
  }

  async start() {
    if (!this.configuration.valid) {
      throw supervisorError(
        "OCR_CONFIGURATION_INVALID",
        `LOCAL_PADDLEOCR_URL is invalid: ${this.configuration.error}`,
      );
    }

    this.bindSignals();
    const currentHealth = await this.probeHealth(
      this.configuration.healthEndpoint,
    );

    if (currentHealth.healthy) {
      this.log(
        `[ocr] Reusing healthy service at ${this.configuration.endpoint}`,
      );
    } else if (this.configuration.isExternal) {
      throw supervisorError(
        "EXTERNAL_OCR_UNAVAILABLE",
        `The configured OCR service at ${this.configuration.endpoint} is not healthy. Custom OCR URLs are externally managed.`,
      );
    } else {
      try {
        await this.launchManagedOcr();
      } catch (error) {
        await this.retryManagedOcr(error);
      }
    }

    if (this.shuttingDown) return;
    this.launchApplication();
  }

  async launchManagedOcr() {
    const executable = paddleXExecutable(this.rootDirectory);
    if (!this.pathExists(executable)) {
      throw supervisorError(
        "OCR_SETUP_MISSING",
        `PaddleX is not installed at ${executable}. Follow LOCAL_OCR.md to create the local OCR environment.`,
      );
    }

    this.log("[ocr] Starting the local PaddleX OCR service...");
    const child = this.spawnProcess(executable, paddleXArguments(), {
      cwd: this.rootDirectory,
      env: this.environment,
      stdio: ["ignore", "pipe", "pipe"],
    });
    this.ocrChild = child;
    prefixOutput(child.stdout, "[ocr]", this.log);
    prefixOutput(child.stderr, "[ocr]", this.logError);

    const outcome = await this.waitForChildReadiness(child);
    if (outcome.kind === "ready") {
      if (this.shuttingDown) return;
      child.once("exit", (code, signal) =>
        this.handleManagedOcrExit(child, code, signal),
      );
      this.log(`[ocr] Ready at ${this.configuration.endpoint}`);
      return;
    }

    if (this.ocrChild === child) this.ocrChild = null;
    await this.stopChild(child);

    if (outcome.kind === "error") {
      throw supervisorError(
        "OCR_PROCESS_ERROR",
        `PaddleX could not be launched: ${outcome.error.message}`,
      );
    }
    if (outcome.kind === "exit") {
      throw supervisorError(
        "OCR_PROCESS_EXITED",
        `PaddleX stopped before it became healthy (${describeExit(outcome.code, outcome.signal)}).`,
      );
    }
    if (outcome.kind === "aborted") {
      throw supervisorError("OCR_START_ABORTED", "PaddleX startup was stopped.");
    }
    throw supervisorError(
      "OCR_START_TIMEOUT",
      `PaddleX did not become healthy within ${Math.round(this.startupTimeoutMs / 1_000)} seconds.`,
    );
  }

  waitForChildReadiness(child) {
    return new Promise((resolve) => {
      let settled = false;
      const readinessController = new AbortController();
      const stopWaiting = () => readinessController.abort();
      const settle = (outcome) => {
        if (settled) return;
        settled = true;
        child.off?.("error", onError);
        child.off?.("exit", onExit);
        this.abortController.signal.removeEventListener("abort", stopWaiting);
        readinessController.abort();
        resolve(outcome);
      };
      const onError = (error) => settle({ kind: "error", error });
      const onExit = (code, signal) =>
        settle({ kind: "exit", code, signal });

      child.once("error", onError);
      child.once("exit", onExit);
      this.abortController.signal.addEventListener("abort", stopWaiting, {
        once: true,
      });

      this.waitForHealth(this.configuration.healthEndpoint, {
        timeoutMs: this.startupTimeoutMs,
        signal: readinessController.signal,
      })
        .then((health) => {
          if (
            health.healthy &&
            child.exitCode === null &&
            !child.signalCode
          )
            settle({ kind: "ready" });
          else if (child.exitCode !== null || child.signalCode)
            settle({
              kind: "exit",
              code: child.exitCode,
              signal: child.signalCode,
            });
          else if (this.shuttingDown || health.aborted)
            settle({ kind: "aborted" });
          else settle({ kind: "timeout" });
        })
        .catch((error) => settle({ kind: "error", error }));
    });
  }

  async retryManagedOcr(initialError) {
    if (initialError?.code === "OCR_SETUP_MISSING") throw initialError;

    let lastError = initialError;
    for (let index = 0; index < this.restartDelaysMs.length; index += 1) {
      if (this.shuttingDown) throw lastError;

      const waitMs = this.restartDelaysMs[index];
      this.logError(
        `[ocr] ${lastError.message} Retrying in ${waitMs / 1_000}s (${index + 1}/${this.restartDelaysMs.length})...`,
      );
      await this.sleep(waitMs, this.abortController.signal);
      if (this.shuttingDown) throw lastError;

      try {
        await this.launchManagedOcr();
        return;
      } catch (error) {
        if (error?.code === "OCR_SETUP_MISSING") throw error;
        lastError = error;
      }
    }

    throw supervisorError(
      "OCR_RESTART_LIMIT",
      `PaddleX could not recover after ${this.restartDelaysMs.length} retries. ${lastError.message}`,
    );
  }

  handleManagedOcrExit(child, code, signal) {
    if (this.shuttingDown || this.ocrChild !== child) return;
    this.ocrChild = null;
    const failure = supervisorError(
      "OCR_PROCESS_EXITED",
      `PaddleX stopped unexpectedly (${describeExit(code, signal)}).`,
    );

    const recovery = this.retryManagedOcr(failure)
      .catch(async (error) => {
        if (this.shuttingDown) return;
        this.logError(`[ocr] ${error.message}`);
        await this.shutdown(1);
      });
    const trackedRecovery = recovery.finally(() => {
      if (this.recoveryPromise === trackedRecovery) {
        this.recoveryPromise = null;
      }
    });
    this.recoveryPromise = trackedRecovery;
  }

  launchApplication() {
    const serverPath = path.join(this.rootDirectory, "server.js");
    this.log("[app] Starting NiyamLens...");
    const child = this.spawnProcess(this.processObject.execPath, [serverPath], {
      cwd: this.rootDirectory,
      env: this.environment,
      stdio: ["ignore", "pipe", "pipe"],
    });
    this.appChild = child;
    prefixOutput(child.stdout, "[app]", this.log);
    prefixOutput(child.stderr, "[app]", this.logError);
    child.once("error", (error) => {
      if (this.shuttingDown) return;
      this.logError(`[app] Could not launch NiyamLens: ${error.message}`);
      void this.shutdown(1);
    });
    child.once("exit", (code, signal) => {
      if (this.shuttingDown || this.appChild !== child) return;
      this.appChild = null;
      this.logError(
        `[app] NiyamLens stopped (${describeExit(code, signal)}).`,
      );
      void this.shutdown(code === 0 ? 0 : 1);
    });
  }

  bindSignals() {
    for (const signal of ["SIGINT", "SIGTERM"]) {
      const handler = () => {
        this.log(`[dev] ${signal} received; stopping local services...`);
        void this.shutdown(0);
      };
      this.signalHandlers.set(signal, handler);
      this.processObject.once(signal, handler);
    }
  }

  removeSignalHandlers() {
    for (const [signal, handler] of this.signalHandlers) {
      this.processObject.off(signal, handler);
    }
    this.signalHandlers.clear();
  }

  async stopChild(child) {
    if (!child || child.exitCode !== null || child.signalCode) return;

    await new Promise((resolve) => {
      let finished = false;
      const done = () => {
        if (finished) return;
        finished = true;
        clearTimeout(forceTimer);
        child.off?.("exit", done);
        resolve();
      };
      const forceTimer = setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch {
          // The child already ended.
        }
        done();
      }, this.stopTimeoutMs);

      child.once("exit", done);
      try {
        child.kill("SIGTERM");
      } catch {
        done();
      }
    });
  }

  shutdown(code = 0) {
    if (this.shutdownPromise) return this.shutdownPromise;

    this.shutdownPromise = (async () => {
      this.shuttingDown = true;
      this.abortController.abort();
      this.removeSignalHandlers();

      const appChild = this.appChild;
      const ocrChild = this.ocrChild;
      this.appChild = null;
      this.ocrChild = null;
      await Promise.all([this.stopChild(appChild), this.stopChild(ocrChild)]);
      this.onExit(code);
    })();

    return this.shutdownPromise;
  }
}
