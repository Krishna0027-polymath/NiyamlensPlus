import assert from "node:assert/strict";
import test from "node:test";
import {
  assessIngredients,
  assessLabelHealth,
} from "../dist/health-assessment.js";
import { parseLabel } from "../dist/label-parser.js";

function assess(text, confidence = 90) {
  return assessLabelHealth(parseLabel(text, [], confidence));
}

test("classifies exact 5% as low and exact 20% as high", () => {
  const low = assess("Nutrition per serving. Total Fat 3.35 g; Sodium 100 mg");
  const high = assess("Nutrition per serving. Total Fat 13.4 g; Sodium 400 mg");

  assert.equal(low.overall, "low");
  assert.equal(low.findings.length, 0);
  assert.equal(high.overall, "high");
  assert.deepEqual(
    high.findings.map((finding) => finding.key),
    ["totalFat", "sodium"],
  );
});

test("uses label-declared daily percentage before calculating from amount", () => {
  const health = assess("Nutrition per serving. Sodium 10 mg 25%");

  assert.equal(health.overall, "high");
  assert.equal(health.findings[0].percent, 25);
});

test("flags total sugar per serving when the ingredients confirm an added-sugar source", () => {
  const health = assess(`
    Ingredients: carbonated water, high fructose corn syrup, caramel colour, caffeine.
    Nutrition Amount/Serving. Serving size 1 bottle. Total Sugars 65 g; Sodium 75 mg 3%.
  `);

  assert.equal(health.overall, "high");
  assert.equal(health.findings[0].key, "totalSugar");
  assert.equal(Math.round(health.findings[0].percent), 130);
  assert.match(health.findings[0].text.en.message, /lower-sugar option/i);
});

test("converts per-100 values only with a matching readable serving size", () => {
  const available = assess("Serving size 50 g. Nutrition per 100 g. Sodium 600 mg");
  const missing = assess("Nutrition per 100 g. Sodium 600 mg");
  const ambiguous = assess("Serving size 50 ml. Nutrition per 100 g. Sodium 600 mg");

  assert.equal(available.overall, "medium");
  assert.equal(Math.round(available.findings[0].percent), 15);
  assert.equal(missing.overall, "medium");
  assert.equal(missing.findings[0].basis, "perHundred");
  assert.equal(ambiguous.overall, "medium");
  assert.equal(ambiguous.findings[0].basis, "perHundred");
  assert.match(missing.text.en.disclaimer, /per-100 amount/i);
});

test("does not guess when per-serving and per-100 bases are both present", () => {
  const health = assess(
    "Serving size 30 g. Nutrition per 100 g and per serving. Sodium 600 mg",
  );

  assert.equal(health.overall, "unavailable");
});

test("low OCR confidence produces unavailable guidance instead of a guess", () => {
  const health = assess("Nutrition per serving. Sodium 900 mg", 71);

  assert.equal(health.overall, "unavailable");
  assert.match(health.text.en.summary, /unavailable/i);
  assert.match(health.text.hi.summary, /उपलब्ध नहीं/);
});

test("orders warnings by severity and keeps narration concise and risk-focused", () => {
  const health = assess(`
    Net quantity 250 g. MRP ₹120. Packed on 08/2026.
    Nutrition per serving. Total Fat 10 g; Saturated Fat 6 g;
    Trans Fat 0.5 g; Added Sugar 15 g; Sodium 500 mg
  `);
  const narration = health.text.en.narration;

  assert.equal(health.overall, "high");
  assert.equal(health.findings[0].level, "high");
  assert.ok(narration.trim().split(/\s+/).length <= 60);
  assert.doesNotMatch(narration, /250|120|08\/2026|MRP|quantity/i);
  assert.match(narration, /concern/i);
});

test("allergens remain conditional and do not imply danger to everyone", () => {
  const health = assess(
    "Allergen: Contains milk or groundnut. Nutrition per serving. Sodium 80 mg",
  );
  const allergen = health.findings.find((finding) => finding.kind === "allergen");

  assert.equal(health.overall, "low");
  assert.match(allergen.text.en.message, /if you are allergic/i);
  assert.match(allergen.text.en.message, /milk or groundnut/i);
});

test("explains explicit ingredient concerns even when nutrition cannot be scored", () => {
  const health = assess(
    "Ingredients: wheat flour, partially hydrogenated vegetable oil, sugar, added caffeine.",
  );

  assert.equal(health.overall, "unavailable");
  assert.deepEqual(
    health.findings
      .filter((finding) => finding.kind === "ingredient")
      .map((finding) => finding.key),
    ["partiallyHydrogenatedOil", "caffeine", "addedSugarSource"],
  );
  assert.match(health.text.en.summary, /ingredient-specific cautions/i);
  assert.match(health.findings[0].text.en.message, /artificial trans fat/i);
  assert.ok(health.text.en.narration.trim().split(/\s+/).length <= 60);
});

test("ingredient advice states when quantity is unknown instead of guessing danger", () => {
  const findings = assessIngredients(
    "Aspartame, sucralose, palm oil, monosodium glutamate",
  );

  assert.equal(findings[0].key, "aspartame");
  assert.equal(findings[0].quantityKnown, false);
  assert.match(findings[0].text.en.message, /does not mean danger/i);
  assert.match(findings[0].text.en.message, /PKU/i);
  assert.equal(
    findings.every((finding) => finding.quantityKnown === false),
    true,
  );
});

test("does not duplicate ingredient sugar and sodium cautions when amounts are available", () => {
  const health = assess(`
    Ingredients: sugar, glucose syrup, monosodium glutamate.
    Nutrition per serving. Added Sugar 12 g; Sodium 500 mg
  `);
  const keys = health.findings.map((finding) => finding.key);

  assert.equal(keys.includes("addedSugarSource"), false);
  assert.equal(keys.includes("sodiumSource"), false);
  assert.equal(keys.includes("addedSugar"), true);
  assert.equal(keys.includes("sodium"), true);
});

test("finds explicit allergen ingredients when a separate allergen statement is absent", () => {
  const health = assess("Ingredients: wheat flour, milk solids, peanut oil, salt.");
  const allergen = health.findings.find(
    (finding) => finding.key === "ingredientAllergens",
  );

  assert.ok(allergen);
  assert.match(allergen.text.en.message, /milk/);
  assert.match(allergen.text.en.message, /groundnut\/peanut/);
  assert.match(allergen.text.en.message, /wheat\/gluten/);
  assert.match(allergen.text.en.message, /if allergic/i);
});

test("does not issue ingredient warnings from low-confidence OCR", () => {
  const health = assess(
    "Ingredients: partially hydrogenated vegetable oil, caffeine, aspartame.",
    60,
  );

  assert.equal(health.findings.length, 0);
  assert.equal(health.ingredientFindingCount, 0);
  assert.match(health.text.en.summary, /unavailable/i);
});

test("shows review-qualified ingredient cautions for a difficult but readable label", () => {
  const health = assess(
    "INOREDIENTS: refined wheal flour, iodized saill, spices.",
    70,
  );

  assert.equal(health.overall, "unavailable");
  assert.equal(
    health.findings.some((finding) => finding.key === "sodiumSource"),
    true,
  );
  assert.equal(
    health.findings.some((finding) => finding.key === "ingredientAllergens"),
    true,
  );
  assert.match(health.text.en.disclaimer, /confirm each warning/i);
});

test("assesses the attached-style label with OCR spelling damage and per-100 values", () => {
  const health = assess(`
    NUTRITION FACTS/INFORMATION AMOUNT PER 100g (approx.)
    CARBOHYDRATE 78.2g OFWHICH SUGARS 25.5g DIETARY FIBRE 1.8g
    PROTEIN 6.5g FAT 12.5g ENERGY 451 kcal
    IGREDIENTS: WHEAT FLOUR (67%), SUGAR, EDIBLE VEGETABLE OIL (PALM OIL),
    INVERT SUGAR SYRUP, RAISING AGENTS [503(ii), 500(ii)], COMMON SALT.
  `, 98);

  assert.equal(health.overall, "high");
  assert.deepEqual(
    health.findings.slice(0, 2).map((finding) => [finding.key, finding.level]),
    [["totalSugar", "high"], ["totalFat", "medium"]],
  );
  assert.equal(health.ingredientFindingCount, 2);
  assert.deepEqual(
    health.findings.slice(2, 4).map((finding) => finding.key),
    ["sodiumSource", "saturatedFatSource"],
  );
  assert.match(health.text.en.disclaimer, /actual risk depends on the portion/i);
});

test("recognizes conservative salt and palm-oil warnings after common OCR damage", () => {
  const health = assess(`
    INGREDIENTS: WHEAT FLOUR (67%), SUGAR, EDIBLE VEG OIL (PALM ORL),
    INVERT SUGAR SYRUP, RAISING AGENTS, EDIBLE COMMON SAL.
  `, 80);

  assert.deepEqual(
    health.findings.slice(0, 3).map((finding) => finding.key),
    ["addedSugarSource", "sodiumSource", "saturatedFatSource"],
  );
});

test("supports common nutrition aliases and unit spellings across labels", () => {
  const solid = assess(`
    Nutrition information per 100 grams.
    Fat 18 grams; Saturates 6 gm; Of which sugars 23 g; Salt 1.6 g.
  `);
  const serving = assess(`
    Serving size 25 gm. Nutrition per serving.
    Saturated fatty acids 4 g; Trans fatty acids 0.4 g; Salt 0.5 g.
  `);

  assert.equal(solid.overall, "high");
  assert.deepEqual(
    solid.findings.slice(0, 4).map((finding) => finding.key),
    ["totalFat", "saturatedFat", "totalSugar", "totalSalt"],
  );
  assert.equal(serving.overall, "high");
  assert.deepEqual(
    serving.findings.map((finding) => finding.key),
    ["transFat", "saturatedFat", "totalSalt"],
  );
});
