import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadLocalEnvironment } from "../lib/local-environment.js";
import {
  paddleXExecutable,
  probeOcrHealth,
  resolveOcrConfiguration,
} from "../lib/local-ocr.js";

const rootDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
loadLocalEnvironment(rootDirectory);

const configuration = resolveOcrConfiguration();
const executable = paddleXExecutable(rootDirectory);

if (!configuration.valid) {
  console.error(`OCR configuration: invalid (${configuration.error})`);
  process.exitCode = 1;
} else {
  const health = await probeOcrHealth(configuration.healthEndpoint);
  console.log(`OCR endpoint: ${configuration.endpoint}`);
  console.log(
    `OCR management: ${configuration.isManagedLocal ? "managed by npm run dev" : "external"}`,
  );
  console.log(
    `PaddleX executable: ${existsSync(executable) ? "available" : "missing"}`,
  );
  console.log(`OCR health: ${health.healthy ? "healthy" : "unreachable"}`);
  if (!health.healthy) process.exitCode = 1;
}
