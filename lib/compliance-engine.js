import { LEGAL_REVIEW_RULES, RULESET_VERSION } from "./legal-rules/index.js";

export function assessCompliance(scan, { rules = LEGAL_REVIEW_RULES } = {}) {
  const fields = scan?.fields || {};
  const findings = rules.map((rule) => {
    const field = fields[rule.field];
    const extractionStatus = field?.status || "missing";
    const status =
      extractionStatus === "missing"
        ? rule.required === false
          ? "applicability_review"
          : "missing"
        : extractionStatus === "invalid"
          ? "invalid"
          : "needs_review";
    return {
      ...rule,
      status,
      value: field?.value || "Not found",
      evidence: field?.bbox
        ? { bbox: field.bbox, imageIndex: field.imageIndex || 0 }
        : null,
      explanation:
        status === "missing"
          ? "The declaration was not reliably detected. Applicability and the original package must be reviewed."
          : status === "applicability_review"
            ? "This declaration is conditional. A reviewer must determine whether it applies to this package."
          : status === "invalid"
            ? "The entered value does not match the expected declaration format."
            : "Text was detected, but legal compliance has not been certified.",
    };
  });

  return {
    rulesetVersion: RULESET_VERSION,
    legalConclusion: false,
    overall: findings.some((finding) => ["missing", "invalid"].includes(finding.status))
      ? "incomplete"
      : "review_required",
    disclaimer:
      "OCR-assisted review only. A qualified reviewer must determine applicability, placement, legibility and legal compliance from the original package.",
    findings,
  };
}
