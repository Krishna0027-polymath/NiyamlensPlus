import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { CaseRepository } from "../lib/case-repository.js";

test("local case repository persists scans with restrictive file permissions", async (context) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "niyamlens-cases-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const repository = new CaseRepository({ directory });
  const saved = await repository.create({ reviewer: "Inspector A", scan: { confidence: 91, fields: {} } });
  const loaded = await repository.get(saved.id);
  const summaries = await repository.list();
  assert.equal(loaded.reviewer, "Inspector A");
  assert.equal(summaries[0].ocrConfidence, 91);
  assert.doesNotMatch(await readFile(path.join(directory, "cases.json"), "utf8"), /undefined/);
});
