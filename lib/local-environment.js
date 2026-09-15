import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

function valueFromEnvironmentLine(rawValue) {
  const value = rawValue.trim();
  if (
    (value.startsWith("'") && value.endsWith("'")) ||
    (value.startsWith('"') && value.endsWith('"'))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

export function loadLocalEnvironment(rootDirectory, environment = process.env) {
  const environmentPath = path.join(rootDirectory, ".env.local");
  if (!existsSync(environmentPath)) return environment;

  for (const line of readFileSync(environmentPath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match || environment[match[1]] !== undefined) continue;

    const [, key, rawValue] = match;
    environment[key] = valueFromEnvironmentLine(rawValue);
  }

  return environment;
}
