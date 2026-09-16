export const FIELD_DEFINITIONS = [
  ["quantity", "Net quantity"],
  ["mrp", "MRP declaration"],
  ["unitSalePrice", "Unit sale price"],
  ["consumerCare", "Consumer care details"],
  ["allergens", "Allergen declaration"],
  ["fssai", "FSSAI licence"],
  ["veg", "Veg / non-veg declaration"],
  ["manufacturer", "Manufacturer / packer"],
  ["importer", "Importer"],
  ["countryOfOrigin", "Country of origin"],
  ["commodityName", "Common / generic name"],
  ["dates", "Packed / best-before date"],
  ["ingredients", "Ingredients"],
  ["nutrition", "Nutrition facts"],
];

const FIELD_VALIDATORS = {
  quantity: /^(?:\d+(?:[.,]\d+)?)\s*(?:kg|g|mg|l|ml|oz|fl\s*oz)$/i,
  mrp: /^(?:₹\s*)?\d+(?:[.,]\d{1,2})?$/i,
  unitSalePrice: /^(?:₹\s*)?\d+(?:[.,]\d{1,2})?\s*\/\s*(?:kg|g|l|ml|each)$/i,
  consumerCare: /(?:\+?\d[\d()\-\s]{7,}\d|[\w.+-]+@[\w.-]+\.[a-z]{2,})/i,
  fssai: /^\d{14}$/,
  dates: /^(?:\d{4}-\d{2}(?:-\d{2})?|[\d\w][\d\w\s./-]{2,29})$/i,
};

export function normalizeFieldValue(key, value) {
  const clean = String(value || "").replace(/\s+/g, " ").trim();
  if (!clean) return "";
  if (key === "quantity") {
    const match = clean.match(/^(\d+(?:[.,]\d+)?)\s*(kg|g|mg|l|ml|oz|fl\s*oz)$/i);
    if (!match) return clean;
    const unit = /^fl\s*oz$/i.test(match[2]) ? "fl oz" : match[2].toLowerCase();
    return `${match[1].replace(",", ".")} ${unit}`;
  }
  if (key === "mrp") {
    const match = clean.match(/(?:₹\s*)?(\d+(?:[.,]\d{1,2})?)/);
    return match ? `₹${match[1].replace(",", ".")}` : clean;
  }
  if (key === "dates") {
    const fullDate = clean.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
    if (fullDate) return `${fullDate[3]}-${fullDate[2].padStart(2, "0")}-${fullDate[1].padStart(2, "0")}`;
    const month = clean.match(/^(\d{1,2})[/-](\d{4})$/);
    if (month) return `${month[2]}-${month[1].padStart(2, "0")}`;
  }
  return clean;
}

export function validateField(key, value) {
  const normalized = normalizeFieldValue(key, value);
  if (!normalized) return { valid: false, normalized, reason: "A value is required." };
  const validator = FIELD_VALIDATORS[key];
  if (validator && !validator.test(normalized)) {
    return { valid: false, normalized, reason: "The value does not match the expected declaration format." };
  }
  if (!validator && normalized.length < 2) {
    return { valid: false, normalized, reason: "The value is too short to verify." };
  }
  return { valid: true, normalized, reason: "Format check passed; legal review is still required." };
}

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

const NUTRIENT_DEFINITIONS = {
  totalFat: {
    label: "Total fat",
    pattern: /(?:total\s+fat|total\s+lipids?|(?<!saturated\s)(?<!trans\s)(?<!sat\s)\bfat\b)\s*[:\-]?\s*(\d+(?:[.,]\d+)?)\s*(mg|milligrams?|g(?:m|ms)?|grams?)\b(?:\s*[,;|]?\s*(\d+(?:[.,]\d+)?)\s*%)?/i,
    unitFirstPattern: /(?:total\s+fat|total\s+lipids?|(?<!saturated\s)(?<!trans\s)(?<!sat\s)\bfat\b)\s*\(?(mg|milligrams?|g(?:m|ms)?|grams?)\)?\s*[:\-]?\s*(\d+(?:[.,]\d+)?)(?:\s*[,;|]?\s*(\d+(?:[.,]\d+)?)\s*%)?/i,
    unit: "g",
  },
  saturatedFat: {
    label: "Saturated fat",
    pattern: /(?:saturated\s+(?:fat|fatty\s+acids?)|saturates|sat\.?\s*fat)\s*[:\-]?\s*(\d+(?:[.,]\d+)?)\s*(mg|milligrams?|g(?:m|ms)?|grams?)\b(?:\s*[,;|]?\s*(\d+(?:[.,]\d+)?)\s*%)?/i,
    unitFirstPattern: /(?:saturated\s+(?:fat|fatty\s+acids?)|saturates|sat\.?\s*fat)\s*\(?(mg|milligrams?|g(?:m|ms)?|grams?)\)?\s*[:\-]?\s*(\d+(?:[.,]\d+)?)(?:\s*[,;|]?\s*(\d+(?:[.,]\d+)?)\s*%)?/i,
    unit: "g",
  },
  transFat: {
    label: "Trans fat",
    pattern: /trans\s+(?:fat|fatty\s+acids?)\s*[:\-]?\s*(\d+(?:[.,]\d+)?)\s*(mg|milligrams?|g(?:m|ms)?|grams?)\b(?:\s*[,;|]?\s*(\d+(?:[.,]\d+)?)\s*%)?/i,
    unitFirstPattern: /trans\s+(?:fat|fatty\s+acids?)\s*\(?(mg|milligrams?|g(?:m|ms)?|grams?)\)?\s*[:\-]?\s*(\d+(?:[.,]\d+)?)(?:\s*[,;|]?\s*(\d+(?:[.,]\d+)?)\s*%)?/i,
    unit: "g",
  },
  addedSugar: {
    label: "Added sugar",
    pattern: /(?:added\s+sugars?|sugars?\s+added)\s*[:\-]?\s*(\d+(?:[.,]\d+)?)\s*(mg|milligrams?|g(?:m|ms)?|grams?)\b(?:\s*[,;|]?\s*(\d+(?:[.,]\d+)?)\s*%)?/i,
    unitFirstPattern: /(?:added\s+sugars?|sugars?\s+added)\s*\(?(mg|milligrams?|g(?:m|ms)?|grams?)\)?\s*[:\-]?\s*(\d+(?:[.,]\d+)?)(?:\s*[,;|]?\s*(\d+(?:[.,]\d+)?)\s*%)?/i,
    unit: "g",
  },
  totalSugar: {
    label: "Total sugars",
    pattern: /(?:total\s+sugars?|of\s*which\s+sugars?|(?<!added\s)\bsugars?\b)\s*[:\-]?\s*(\d+(?:[.,]\d+)?)\s*(mg|milligrams?|g(?:m|ms)?|grams?)\b(?:\s*[,;|]?\s*(\d+(?:[.,]\d+)?)\s*%)?/i,
    unitFirstPattern: /(?:total\s+sugars?|of\s*which\s+sugars?|(?<!added\s)\bsugars?\b)\s*\(?(mg|milligrams?|g(?:m|ms)?|grams?)\)?\s*[:\-]?\s*(\d+(?:[.,]\d+)?)(?:\s*[,;|]?\s*(\d+(?:[.,]\d+)?)\s*%)?/i,
    unit: "g",
  },
  sodium: {
    label: "Sodium",
    pattern: /sodium\s*[:\-]?\s*(\d+(?:[.,]\d+)?)\s*(mg|g)\b(?:\s*[,;|]?\s*(\d+(?:[.,]\d+)?)\s*%)?/i,
    unitFirstPattern: /sodium\s*\(?(mg|g)\)?\s*[:\-]?\s*(\d+(?:[.,]\d+)?)(?:\s*[,;|]?\s*(\d+(?:[.,]\d+)?)\s*%)?/i,
    unit: "mg",
  },
  totalSalt: {
    label: "Salt",
    pattern: /\bsalt\s*[:\-]?\s*(\d+(?:[.,]\d+)?)\s*(mg|milligrams?|g(?:m|ms)?|grams?)\b(?:\s*[,;|]?\s*(\d+(?:[.,]\d+)?)\s*%)?/i,
    unitFirstPattern: /\bsalt\s*\(?(mg|milligrams?|g(?:m|ms)?|grams?)\)?\s*[:\-]?\s*(\d+(?:[.,]\d+)?)(?:\s*[,;|]?\s*(\d+(?:[.,]\d+)?)\s*%)?/i,
    unit: "g",
  },
};

function decimal(value) {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const parsed = Number(String(value).replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

function convertUnit(value, from, to) {
  const normalized = String(from || "").toLowerCase().replace(/\./g, "");
  if (/^(?:g|gm|gms|gram|grams)$/.test(normalized)) from = "g";
  if (/^(?:mg|milligram|milligrams)$/.test(normalized)) from = "mg";
  if (from === to) return value;
  if (from === "mg" && to === "g") return value / 1_000;
  if (from === "g" && to === "mg") return value * 1_000;
  return null;
}

function nutritionBasis(clean) {
  const directServingMatch = clean.match(
    /serv(?:e|ing)\s*size\s*[:\-]?\s*(\d+(?:[.,]\d+)?)\s*(g(?:m|ms)?|grams?|ml|millilit(?:er|re)s?)\b/i,
  );
  const parentheticalMetricServingMatch = clean.match(
    /serv(?:e|ing)\s*size\b[^()]{0,35}\(\s*(\d+(?:[.,]\d+)?)\s*(g(?:m|ms)?|grams?|ml|millilit(?:er|re)s?)\b/i,
  );
  const servingMatch = directServingMatch || parentheticalMetricServingMatch;
  const perServingMatch = clean.match(
    /(?:per\s+(?:serve|serving)|amount\s*(?:\/|per)\s*serving)(?:\s*\(?\s*(\d+(?:[.,]\d+)?)\s*(g(?:m|ms)?|grams?|ml|millilit(?:er|re)s?)\s*\)?)?/i,
  );
  const perHundredMatch = clean.match(/per\s*100\s*(g(?:m|ms)?|grams?|ml|millilit(?:er|re)s?)\b/i);
  const basisUnit = (value) => (/^m/i.test(value) ? "ml" : "g");
  const servingSize = servingMatch
    ? {
        amount: decimal(servingMatch[1]),
        unit: basisUnit(servingMatch[2]),
      }
    : perServingMatch?.[1]
      ? {
          amount: decimal(perServingMatch[1]),
          unit: basisUnit(perServingMatch[2]),
        }
      : null;

  if (perServingMatch && perHundredMatch) {
    return {
      basis: { type: null, amount: null, unit: null, ambiguous: true },
      servingSize,
    };
  }

  if (perServingMatch) {
    return {
      basis: { type: "perServing", amount: servingSize?.amount ?? null, unit: servingSize?.unit ?? null },
      servingSize,
    };
  }
  if (perHundredMatch) {
    const unit = basisUnit(perHundredMatch[1]);
    return {
      basis: { type: unit === "ml" ? "per100ml" : "per100g", amount: 100, unit },
      servingSize,
    };
  }
  return { basis: { type: null, amount: null, unit: null }, servingSize };
}

function boxIsUsable(box) {
  return (
    box &&
    [box.x0, box.y0, box.x1, box.y1].every((value) => Number.isFinite(Number(value))) &&
    Number(box.x1) > Number(box.x0) &&
    Number(box.y1) > Number(box.y0)
  );
}

function ingredientTextFromEvidence(words = []) {
  if (!Array.isArray(words)) return "";
  const rows = words.filter(
    (word) => String(word?.text || "").trim() && boxIsUsable(word?.bbox),
  );
  const headings = rows.filter((word) =>
    /^(?:ingredients?|igredients?|ingredlents?|inoredients?)\b(?:\s*[:\-"]\s*.*)?$/i.test(
      String(word.text).trim(),
    ),
  );
  const heading = headings.at(-1);
  if (!heading) return "";

  const pageWidth = Math.max(...rows.map((word) => Number(word.bbox.x1)), 1);
  const leftTolerance = Math.max(24, pageWidth * 0.12);
  const startY = Number(heading.bbox.y0);
  const candidates = rows
    .filter(
      (word) =>
        Number(word.bbox.y0) >= startY - 4 &&
        Number(word.bbox.x0) >= Number(heading.bbox.x0) - leftTolerance &&
        Number(word.bbox.x0) <= Number(heading.bbox.x0) + leftTolerance,
    )
    .sort(
      (a, b) =>
        Number(a.bbox.y0) - Number(b.bbox.y0) ||
        Number(a.bbox.x0) - Number(b.bbox.x0),
    );

  const lines = [];
  for (const word of candidates) {
    const line = String(word.text).trim();
    if (!lines.length && word !== heading) continue;
    if (
      lines.length &&
      /^(?:nutrition(?:\s+(?:facts|information))?|allergens?|contains\s*:|manufactured|marketed|packed|mrp|fssai)\b/i.test(
        line,
      )
    ) {
      break;
    }
    lines.push(line);
    if (lines.length > 1 && /[.)]\s*$/.test(line)) break;
    if (lines.length >= 18) break;
  }

  return lines
    .join(" ")
    .replace(/^(?:ingredients?|igredients?|ingredlents?|inoredients?)\b\s*[:\-"]?\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function ingredientTextFromRaw(rawText) {
  const lines = String(rawText || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const starts = lines
    .map((line, index) =>
      /^(?:ingredients?|igredients?|ingredlents?|inoredients?)\b(?:\s*[:\-"]\s*.*)?$/i.test(line)
        ? index
        : -1,
    )
    .filter((index) => index >= 0);
  const start = starts.at(-1) ?? -1;
  if (start < 0) return headinglessIngredientText(lines);
  const collected = [];
  for (let index = start; index < lines.length && collected.length < 18; index += 1) {
    const line = lines[index];
    if (
      collected.length &&
      /^(?:nutrition(?:\s+(?:facts|information))?|allergens?|contains\s*:|manufactured|marketed|packed|mrp|fssai|\*?\s*percent\s+daily\s+values?)\b/i.test(
        line,
      )
    ) {
      break;
    }
    collected.push(line);
    if (collected.length > 1 && /[.)]\s*$/.test(line)) break;
  }
  return collected
    .join(" ")
    .replace(/^(?:ingredients?|igredients?|ingredlents?|inoredients?)\b\s*[:\-"]?\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function headinglessIngredientText(lines) {
  const ingredientTerms =
    /\b(?:carbonated\s+water|flou?r|sugar|syrup|oil|salt|acid|colou?r|flavou?rs?|caffeine|spices?|seasoning|starch|maltodextrin|preservative|sweetener)\b/i;
  const nutritionTerms =
    /^(?:total\s+fat|saturated\s+fat|trans\s+fat|sodium|protein|calories?|nutrition|serv(?:ing|\.?\s*size)|amount\s*\/\s*serving)\b/i;
  const stop = lines.findIndex((line) =>
    /^(?:low\s+sodium|consumer\s*information|manufactured|marketed|packed|mrp|fssai|storage\s+advice)\b/i.test(line),
  );
  const candidates = lines
    .slice(0, stop > 0 ? stop : Math.min(lines.length, 30))
    .filter(
      (line) =>
        ingredientTerms.test(line) &&
        !nutritionTerms.test(line) &&
        !/%|\b(?:mg|g)\s*$/i.test(line),
    );
  if (candidates.length < 3 || !candidates.some((line) => line.includes(","))) {
    return "";
  }
  return candidates.join(", ").replace(/\s+/g, " ").trim();
}

function genericFoodName(rawText) {
  const explicit = String(rawText || "").match(
    /(?:common\s+name|generic\s+name|name\s+of\s+(?:the\s+)?commodity)\s*[:\-]?\s*([^\n.]{3,100})/i,
  );
  if (explicit?.[1]) return explicit[1].trim();

  const foodLine = String(rawText || "")
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .find(
      (line) =>
        line.length >= 5 &&
        line.length <= 80 &&
        /\b(?:potato\s+chips?|chips?|biscuits?|cookies?|crackers?|snacks?|beverages?|drinks?|juice|noodles?|cereal|candy|chocolate)\b/i.test(line) &&
        !/^(?:ingredients?|nutrition|serving|calories|total|saturated|trans|sodium|protein)\b/i.test(line),
    );
  return foodLine || "";
}

export function parseNutrition(text = "") {
  const clean = String(text || "")
    .replace(/\b[oO](?=\s*(?:mg|g|%))/g, "0")
    .replace(/\s+/g, " ")
    .trim();
  const { basis, servingSize } = nutritionBasis(clean);
  const nutrients = {};

  for (const [key, definition] of Object.entries(NUTRIENT_DEFINITIONS)) {
    let match = clean.match(definition.pattern);
    let unitFirst = false;
    if (!match) {
      match = clean.match(definition.unitFirstPattern);
      unitFirst = Boolean(match);
    }
    if (!match) continue;
    const rawAmount = decimal(match[unitFirst ? 2 : 1]);
    const sourceUnit = match[unitFirst ? 1 : 2].toLowerCase();
    const amount = convertUnit(rawAmount, sourceUnit, definition.unit);
    if (amount === null) continue;
    nutrients[key] = {
      key,
      label: definition.label,
      amount,
      unit: definition.unit,
      declaredDailyPercent: decimal(match[3]),
    };
  }

  return { basis, servingSize, nutrients };
}

function nutritionSummary(nutrition) {
  return Object.values(nutrition.nutrients)
    .map((item) => `${item.label} ${item.amount} ${item.unit}`)
    .join(", ");
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
    ) ||
    after(/(?:call\s*)?(\d[-\s]?\d{3}[-\s]?\d{3}[-\s]?\d{4})/i) ||
    after(/((?:1800|1860)\s*\d{3,4}\s*\d{4})/i) ||
    after(/(\+?91[-\s]?\d{10})/);
  const nutrition = parseNutrition(rawText);
  const ingredients =
    ingredientTextFromEvidence(sourceWords) || ingredientTextFromRaw(rawText);
  const standaloneImperialQuantity = rawText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => /^\d+(?:[.,]\d+)?\s*(?:fl\s*oz|oz)$/i.test(line));
  const values = {
    quantity:
      after(
        /(?:net\s*(?:qty|quantity|wt|weight)?\s*[:\-]?)\s*(\d+(?:\.\d+)?\s*(?:kg|g|mg|l|ml)\b)/i,
      ) || standaloneImperialQuantity || "",
    mrp:
      after(
        /(?:mrp|maximum\s+retail\s+price)[^₹\d]{0,20}(₹?\s*\d+(?:\.\d{1,2})?)/i,
      ),
    unitSalePrice: after(
      /(?:unit\s+sale\s+price|price\s+per)\s*[:\-]?\s*(₹?\s*\d+(?:\.\d{1,2})?\s*\/\s*(?:kg|g|l|ml|each))/i,
    ),
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
    importer: after(/(?:imported|importer)\s+by\s*[:\-]?\s*([^\.]{5,160})/i),
    countryOfOrigin: after(
      /(?:country\s+of\s+origin|made\s+in|product\s+of)\s*[:\-]?\s*([a-z][a-z\s]{2,60})/i,
    ),
    commodityName: genericFoodName(rawText),
    dates: after(
      /(?:packed\s*(?:on)?|mfd|manufactured|best\s*before|use\s*by|expiry)[^\d]{0,18}(\d[\d\w\/-]{3,29})/i,
    ),
    ingredients,
    nutrition: [
      nutritionSummary(nutrition),
      ["energy", "protein", "carbohydrate", "sugar"]
        .filter((name) => new RegExp(name, "i").test(clean))
        .join(", "),
    ]
      .filter(Boolean)
      .join(", "),
  };
  const fields = {};

  FIELD_DEFINITIONS.forEach(([key, label]) => {
    const value = normalizeFieldValue(key, values[key]);
    const visual = key === "veg";
    const evidence = value ? findEvidenceWord(value, sourceWords) : null;
    const validation = value ? validateField(key, value) : null;
    const status = !value
      ? "missing"
      : !validation.valid
        ? "invalid"
        : numericConfidence >= 72 && !visual
          ? "detected"
          : "review";
    fields[key] = {
      key,
      label,
      value: value || "Not found",
      original: value || "Not found",
      confidence: value ? Math.round(numericConfidence) : 0,
      status,
      detail: value
        ? visual
          ? "Confirm the package mark visually before passing."
          : `${validation.reason} OCR confidence ${Math.round(numericConfidence)}%.`
        : "No reliable value found. Add or verify manually.",
      bbox: evidence?.bbox ?? null,
      imageIndex: evidence?.imageIndex ?? 0,
      reviewedAt: null,
      reviewedBy: null,
      changes: [],
    };
  });

  return {
    createdAt: new Date().toISOString(),
    raw: rawText,
    confidence: Math.round(numericConfidence),
    words: sourceWords,
    fields,
    nutrition,
    listing: null,
    panels: [],
    auditTrail: [],
  };
}
