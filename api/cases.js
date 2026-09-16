import { CaseRepository } from "../lib/case-repository.js";
import { protectApi } from "../lib/request-security.js";

let defaultRepository;
const localRepository = () => (defaultRepository ||= new CaseRepository());

export function createCasesHandler({ caseRepository = null, environment = process.env } = {}) {
  return async function cases(request, response) {
    response.setHeader("Cache-Control", "no-store");
    if (!protectApi(request, response, { name: "cases", limit: 60, environment })) return;

    const repository = caseRepository || localRepository();
    if (request.method === "GET") {
      const url = new URL(request.url || "/api/cases", "http://localhost");
      const id = url.searchParams.get("id");
      if (id) {
        const record = await repository.get(id);
        return record
          ? response.status(200).json(record)
          : response.status(404).json({ code: "CASE_NOT_FOUND", error: "Case not found" });
      }
      return response.status(200).json({ cases: await repository.list() });
    }

    if (request.method === "POST") {
      if (!request.body?.scan?.fields || typeof request.body.scan.fields !== "object") {
        return response.status(400).json({ code: "INVALID_CASE", error: "A parsed scan is required" });
      }
      const record = await repository.create({
        scan: request.body.scan,
        reviewer: request.body.reviewer,
      });
      return response.status(201).json(record);
    }

    response.setHeader("Allow", "GET, POST");
    return response.status(405).json({ code: "METHOD_NOT_ALLOWED", error: "Use GET or POST" });
  };
}

export default createCasesHandler();
