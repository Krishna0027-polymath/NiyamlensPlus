import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

export class CaseRepository {
  constructor({ directory = process.env.NIYAMLENS_DATA_DIR || path.join(projectRoot, ".niyamlens-data") } = {}) {
    this.directory = directory;
    this.file = path.join(directory, "cases.json");
  }

  async readAll() {
    try {
      const parsed = JSON.parse(await readFile(this.file, "utf8"));
      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      if (error.code === "ENOENT") return [];
      throw error;
    }
  }

  async writeAll(cases) {
    await mkdir(this.directory, { recursive: true });
    const temporary = `${this.file}.${process.pid}.tmp`;
    await writeFile(temporary, JSON.stringify(cases, null, 2), { mode: 0o600 });
    await rename(temporary, this.file);
  }

  async create(input) {
    const cases = await this.readAll();
    const now = new Date().toISOString();
    const record = {
      id: `case_${randomUUID()}`,
      createdAt: now,
      updatedAt: now,
      status: "review_required",
      reviewer: String(input.reviewer || "Local reviewer").slice(0, 100),
      scan: input.scan,
    };
    cases.push(record);
    await this.writeAll(cases);
    return record;
  }

  async get(id) {
    return (await this.readAll()).find((record) => record.id === id) || null;
  }

  async list() {
    return (await this.readAll()).map(({ scan, ...summary }) => ({
      ...summary,
      ocrConfidence: scan?.confidence || 0,
    }));
  }
}
