import assert from "node:assert/strict";
import test from "node:test";
import { createCasesHandler } from "../api/cases.js";
import { createListingLookupHandler } from "../api/listing-lookup.js";
import { clearRateLimits } from "../lib/request-security.js";

function responseHarness() {
  return {
    headers: {}, statusCode: 200, body: null,
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; },
    send(value) { this.body = value; return this; },
  };
}

const scan = {
  createdAt: "2026-09-16T00:00:00.000Z",
  confidence: 88,
  fields: {
    quantity: { key: "quantity", label: "Net quantity", value: "250 g", status: "detected", detail: "Detected", changes: [] },
  },
  auditTrail: [],
};

test("case API creates and lists local review cases", async () => {
  clearRateLimits();
  const records = [];
  const repository = {
    create: async ({ scan: storedScan, reviewer }) => {
      const value = { id: "case_1", reviewer, scan: storedScan };
      records.push(value);
      return value;
    },
    list: async () => records,
    get: async (id) => records.find((record) => record.id === id) || null,
  };
  const handler = createCasesHandler({ caseRepository: repository, environment: {} });
  const createResponse = responseHarness();
  await handler({ method: "POST", url: "/api/cases", headers: { "x-forwarded-for": "case-create" }, body: { scan, reviewer: "Inspector" } }, createResponse);
  assert.equal(createResponse.statusCode, 201);
  assert.equal(createResponse.body.id, "case_1");

  const listResponse = responseHarness();
  await handler({ method: "GET", url: "/api/cases", headers: { "x-forwarded-for": "case-list" }, body: {} }, listResponse);
  assert.equal(listResponse.body.cases.length, 1);
});

test("retailer lookup returns unverified links and never parses snippet prices", async () => {
  clearRateLimits();
  const handler = createListingLookupHandler({
    environment: { TAVILY_API_KEY: "test-key" },
    fetchImplementation: async () => ({
      ok: true,
      json: async () => ({ results: [{ title: "Shop listing MRP ₹999", url: "https://shop.test/item", content: "Only ₹499 today" }] }),
    }),
  });
  const response = responseHarness();
  await handler({ method: "POST", headers: { "x-forwarded-for": "listing-test" }, body: { productName: "Millet bites" } }, response);
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.references[0].url, "https://shop.test/item");
  assert.equal("price" in response.body, false);
  assert.match(response.body.disclaimer, /not evidence/i);
});
