import assert from "node:assert/strict";
import test from "node:test";
import { assessCompliance } from "../lib/compliance-engine.js";

const scan = {
  createdAt: "2026-09-16T00:00:00.000Z",
  confidence: 88,
  fields: {
    quantity: { key: "quantity", label: "Net quantity", value: "250 g", status: "detected", detail: "Detected", changes: [] },
    mrp: { key: "mrp", label: "MRP", value: "Not found", status: "missing", detail: "Missing", changes: [] },
  },
  auditTrail: [],
};

test("compliance assessment never turns OCR detection into legal certification", () => {
  const assessment = assessCompliance(scan, {
    rules: [
      { id: "Q", field: "quantity", title: "Quantity", source: "https://example.test", applicability: "review" },
      { id: "M", field: "mrp", title: "MRP", source: "https://example.test", applicability: "review" },
    ],
  });
  assert.equal(assessment.legalConclusion, false);
  assert.equal(assessment.overall, "incomplete");
  assert.equal(assessment.findings[0].status, "needs_review");
  assert.equal(assessment.findings[1].status, "missing");
});
