import path from "node:path";
import { fileURLToPath } from "node:url";
import { LocalDevSupervisor } from "../lib/local-dev-supervisor.js";
import { loadLocalEnvironment } from "../lib/local-environment.js";

const rootDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
loadLocalEnvironment(rootDirectory);

const supervisor = new LocalDevSupervisor({ rootDirectory });
try {
  await supervisor.start();
} catch (error) {
  console.error(`[dev] ${error.message}`);
  await supervisor.shutdown(1);
}
