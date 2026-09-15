export const FIELD_DEFINITIONS = [
  ["quantity", "Net quantity"],
  ["mrp", "MRP declaration"],
  ["consumerCare", "Consumer care details"],
  ["allergens", "Allergen declaration"],
  ["fssai", "FSSAI licence"],
  ["veg", "Veg / non-veg declaration"],
  ["manufacturer", "Manufacturer / packer"],
  ["dates", "Packed / best-before date"],
  ["ingredients", "Ingredients"],
  ["nutrition", "Nutrition facts"],
];

export function findEvidenceWord(value, words = []) {
  const terms = String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, " ")
    .split(/\s+/)
    .filter((term) => term.length > 2);

  if (!terms.length || !Array.isArray(words)) return null;

  return (
    words.find((word) => {
      const wordText = String(word?.text || "").toLowerCase();
      return terms.some((term) => wordText.includes(term));
    }) || null
  );
}

export function parseLabel(text = "", words = [], confidence = 0) {
  const rawText = String(text || "");
  const sourceWords = Array.isArray(words) ? words : [];
  const numericConfidence = Number.isFinite(Number(confidence))
    ? Number(confidence)
    : 0;
  const clean = rawText.replace(/\s+/g, " ").trim();
  const after = (pattern) => ((clean.match(pattern) || [])[1] || "").trim();
  const phone =
    after(
      /(?:consumer|customer)\s*(?:care|service)?[^\d]{0,40}([+()\d\-\s]{8,18})/i,
    ) || after(/(\+?91[-\s]?\d{10})/);
  const values = {
    quantity:
      after(
        /(?:net\s*(?:qty|quantity|wt|weight)?\s*[:\-]?)\s*(\d+(?:\.\d+)?\s*(?:kg|g|mg|l|ml)\b)/i,
      ) || after(/\b(\d+(?:\.\d+)?\s*(?:kg|g|mg|l|ml))\b/i),
    mrp:
      after(
        /(?:mrp|maximum\s+retail\s+price)[^₹\d]{0,20}(₹?\s*\d+(?:\.\d{1,2})?)/i,
      ) || after(/(₹\s*\d+(?:\.\d{1,2})?)/),
    consumerCare: phone,
    allergens: after(
      /(?:allergen(?:s)?|contains?)\s*[:\-]?\s*((?:milk|peanut|groundnut|tree nuts|soy|gluten|wheat|egg|sesame|mustard|fish)[^\.]{0,110})/i,
    ),
    fssai:
      after(/(?:fssai[^\d]{0,20})(\d{14})/i) || after(/\b(\d{14})\b/),
    veg: /non[-\s]?veg|non vegetarian/i.test(clean)
      ? "Non-vegetarian declaration detected"
      : /vegetarian|\bveg\b/i.test(clean)
        ? "Vegetarian text detected — visual mark needs review"
        : "",
    manufacturer: after(
      /(?:manufactured|marketed|packed)\s+by\s*[:\-]?\s*([^\.]{5,160})/i,
    ),
    dates: after(
      /(?:packed\s*(?:on)?|mfd|manufactured|best\s*before|use\s*by|expiry)[^\d]{0,18}([\d\w\/-]{4,30})/i,
    ),
    ingredients: after(/ingredients?\s*[:\-]\s*([^\.]{8,220})/i),
    nutrition: ["energy", "protein", "carbohydrate", "sugar", "fat", "sodium"]
      .filter((name) => new RegExp(name, "i").test(clean))
      .join(", "),
  };
  const fields = {};

  FIELD_DEFINITIONS.forEach(([key, label]) => {
    const value = values[key];
    const visual = key === "veg";
    const evidence = value ? findEvidenceWord(value, sourceWords) : null;
    fields[key] = {
      key,
      label,
      value: value || "Not found",
      original: value || "Not found",
      confidence: value ? Math.round(numericConfidence) : 0,
      status:
        value && numericConfidence >= 72 && !visual ? "pass" : "review",
      detail: value
        ? visual
          ? "Confirm the package mark visually before passing."
          : `OCR confidence ${Math.round(numericConfidence)}%`
        : "No reliable value found. Add or verify manually.",
      bbox: evidence?.bbox ?? null,
      imageIndex: evidence?.imageIndex ?? 0,
    };
  });

  return {
    createdAt: new Date().toISOString(),
    raw: rawText,
    confidence: Math.round(numericConfidence),
    words: sourceWords,
    fields,
    listing: null,
  };
}
