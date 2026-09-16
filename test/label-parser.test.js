import assert from "node:assert/strict";
import test from "node:test";
import {
  findEvidenceWord,
  normalizeFieldValue,
  parseLabel,
  parseNutrition,
  validateField,
} from "../dist/label-parser.js";

const box = (x0, y0, x1, y1) => ({ x0, y0, x1, y1 });

test("realistic package OCR parses fields without existing app state", () => {
  const text = `
    Crunchy Millet Bites
    Net Quantity: 250 g
    MRP ₹120.00 inclusive of all taxes
    Ingredients: Millet flour, groundnut oil, milk solids, salt.
    Allergen: Contains milk and groundnut.
    Manufactured by: Niyam Foods Pvt Ltd, Pune
    FSSAI Lic. No. 12345678901234
    Packed on 08/2026 Best Before 6 months
    Serving size: 25 g. Nutrition per 100 g: Energy 510 kcal Protein 8 g Carbohydrate 61 g Sugar 4 g Total Fat 26 g Sodium 390 mg
    Consumer care: +91 9876543210
    Vegetarian product
  `;
  const words = [
    { text: "250 g", bbox: box(10, 20, 80, 45), imageIndex: 0 },
    { text: "₹120.00", bbox: box(90, 20, 165, 45), imageIndex: 0 },
    {
      text: "Millet flour",
      bbox: box(10, 60, 130, 85),
      imageIndex: 1,
    },
    { text: "milk", bbox: box(10, 90, 55, 115), imageIndex: 1 },
    {
      text: "12345678901234",
      bbox: box(10, 120, 180, 145),
      imageIndex: 1,
    },
    { text: "Energy", bbox: box(10, 150, 75, 175), imageIndex: 2 },
  ];

  const scan = parseLabel(text, words, 86.4);

  assert.equal(scan.confidence, 86);
  assert.equal(scan.fields.quantity.value, "250 g");
  assert.equal(scan.fields.mrp.value, "₹120.00");
  assert.match(scan.fields.ingredients.value, /Millet flour/);
  assert.match(scan.fields.allergens.value, /milk and groundnut/i);
  assert.equal(scan.fields.fssai.value, "12345678901234");
  assert.match(scan.fields.nutrition.value, /energy/i);
  assert.equal(scan.fields.quantity.bbox, words[0].bbox);
  assert.equal(scan.fields.ingredients.imageIndex, 1);
  assert.equal(scan.fields.fssai.bbox, words[4].bbox);
  assert.equal(scan.fields.nutrition.imageIndex, 2);
  assert.equal(scan.fields.quantity.status, "detected");
  assert.equal(scan.nutrition.basis.type, "per100g");
  assert.deepEqual(scan.nutrition.servingSize, { amount: 25, unit: "g" });
  assert.equal(scan.nutrition.nutrients.totalFat.amount, 26);
  assert.equal(scan.nutrition.nutrients.sodium.amount, 390);
});

test("structured nutrition parses per-serving values and declared daily percentages", () => {
  const nutrition = parseNutrition(`
    Serving size: 40 g. Average values per serving (40 g)
    Total Fat 3.35 g 5%; Saturated Fat 4.4 g 20%; Trans Fat 100 mg;
    Added Sugars 12.5 g 25%; Sodium 0.4 g 20%
  `);

  assert.equal(nutrition.basis.type, "perServing");
  assert.deepEqual(nutrition.servingSize, { amount: 40, unit: "g" });
  assert.equal(nutrition.nutrients.totalFat.declaredDailyPercent, 5);
  assert.equal(nutrition.nutrients.saturatedFat.declaredDailyPercent, 20);
  assert.equal(nutrition.nutrients.transFat.amount, 0.1);
  assert.equal(nutrition.nutrients.addedSugar.amount, 12.5);
  assert.equal(nutrition.nutrients.sodium.amount, 400);
});

test("parses beverage panels that use Amount/Serving and OCR zeroes", () => {
  const scan = parseLabel(`
    CARBONATED WATER, HIGH
    Coke
    Nutrition Facts
    Amount/Serving % DV*
    FRUCTOSE CORN SYRUP, CARAMEL
    COLOR, PHOSPHORIC ACID
    Total Fat Og 0%
    NATURAL FLAVORS, CAFFEINE
    Serv. Size 1 Bottle
    Sodium 75mg 3%
    20FLOZ
    Sugars 65g
    CONSUMER INFORMATION CALL 1-800-438-2653
  `, [], 97);

  assert.equal(scan.nutrition.basis.type, "perServing");
  assert.equal(scan.nutrition.nutrients.totalFat.amount, 0);
  assert.equal(scan.nutrition.nutrients.sodium.declaredDailyPercent, 3);
  assert.equal(scan.fields.quantity.value, "20 fl oz");
  assert.match(scan.fields.consumerCare.value, /1-800-438-2653/);
  assert.match(scan.fields.ingredients.value, /carbonated water/i);
  assert.match(scan.fields.ingredients.value, /caffeine/i);
});

test("accepts a standalone ingredients heading and rejects a date with no digits", () => {
  const scan = parseLabel(`
    INGREDIENTS\"
    Wheat flour, edible vegetable oil, iodised salt, spices.
    MFD.-USE BY-MFG.By:
    STORAGE ADVICE
    NET QUANTITY: 70g
  `, [], 90);

  assert.match(scan.fields.ingredients.value, /Wheat flour/);
  assert.equal(scan.fields.dates.value, "Not found");
  assert.equal(scan.fields.quantity.value, "70 g");
});

test("separates a left-column ingredient panel from interleaved nutrition OCR", () => {
  const text = `
    Nutrition Facts
    Serving Size 1 oz (28g/About 17 chips)
    Amount Per Serving
    Total Fat 10g
    15%
    Sodium 210mg
    9%
    Flavored Potato Chips
    Ingredients: Potatoes, Vegetable Oil
    Zinc 2%
    (Sunflower, Corn, and/or Canola Oil), Dill
    * Percent Daily Values are based on a 2,000 calorie diet.
    Pickle Seasoning (Maltodextrin [Made
    From Corn], Natural Flavors, Salt,
    Vinegar, Garlic Powder, Yeast Extract, and
    Total Fat Less than 65g
    Spice Extracts [Including Dill]).
  `;
  const words = [
    { text: "Ingredients: Potatoes, Vegetable Oil", bbox: box(0, 760, 460, 795) },
    { text: "Zinc 2%", bbox: box(500, 769, 596, 797) },
    { text: "(Sunflower, Corn, and/or Canola Oil), Dill", bbox: box(0, 793, 459, 832) },
    { text: "* Percent Daily Values are based on a 2,000 calorie diet.", bbox: box(500, 807, 944, 834) },
    { text: "Pickle Seasoning (Maltodextrin [Made", bbox: box(0, 827, 459, 864) },
    { text: "From Corn], Natural Flavors, Salt,", bbox: box(0, 864, 457, 898) },
    { text: "Vinegar, Garlic Powder, Yeast Extract, and", bbox: box(1, 901, 457, 931) },
    { text: "Total Fat Less than 65g", bbox: box(508, 908, 890, 938) },
    { text: "Spice Extracts [Including Dill]).", bbox: box(0, 935, 349, 969) },
  ];

  const scan = parseLabel(text, words, 100);

  assert.equal(scan.fields.commodityName.value, "Flavored Potato Chips");
  assert.match(scan.fields.ingredients.value, /^Potatoes, Vegetable Oil/);
  assert.match(scan.fields.ingredients.value, /Spice Extracts \[Including Dill\]/);
  assert.doesNotMatch(scan.fields.ingredients.value, /Zinc|Percent Daily|Total Fat/);
  assert.deepEqual(scan.nutrition.servingSize, { amount: 28, unit: "g" });
  assert.equal(scan.nutrition.basis.type, "perServing");
});

test("structured nutrition distinguishes per-100 g and per-100 ml bases", () => {
  const solid = parseNutrition("Serving size 30 g. Nutrition per 100 g. Sodium 600 mg");
  const liquid = parseNutrition("Serving size 200 ml. Nutrition per 100 ml. Sodium 40 mg");

  assert.equal(solid.basis.type, "per100g");
  assert.equal(solid.servingSize.amount, 30);
  assert.equal(liquid.basis.type, "per100ml");
  assert.equal(liquid.servingSize.unit, "ml");
});

test("total fat does not borrow the saturated-fat value", () => {
  const nutrition = parseNutrition("Nutrition per serving. Saturated fat 8 g; Sodium 100 mg");

  assert.equal(nutrition.nutrients.totalFat, undefined);
  assert.equal(nutrition.nutrients.saturatedFat.amount, 8);
});

test("parses table-style units before nutrient values", () => {
  const nutrition = parseNutrition(
    "Nutritional values per serving. Total Fat (g) 8; Added Sugar (g) 10; Sodium (mg) 240",
  );

  assert.equal(nutrition.nutrients.totalFat.amount, 8);
  assert.equal(nutrition.nutrients.addedSugar.amount, 10);
  assert.equal(nutrition.nutrients.sodium.amount, 240);
});

test("evidence matching returns null for absent or malformed words", () => {
  assert.equal(findEvidenceWord("250 g"), null);
  assert.equal(findEvidenceWord("250 g", null), null);
  assert.equal(findEvidenceWord("250 g", [{ bbox: box(0, 0, 1, 1) }]), null);
});

test("empty OCR produces missing fields and a stable empty word list", () => {
  const scan = parseLabel();

  assert.equal(scan.raw, "");
  assert.deepEqual(scan.words, []);
  assert.equal(scan.confidence, 0);
  assert.equal(scan.fields.mrp.value, "Not found");
  assert.equal(scan.fields.mrp.bbox, null);
  assert.equal(scan.fields.mrp.status, "missing");
});

test("recognized text without structured fields does not require evidence", () => {
  const scan = parseLabel("A clear brand name and marketing description", [], 91);

  assert.equal(scan.raw, "A clear brand name and marketing description");
  assert.equal(
    Object.values(scan.fields).every((field) => field.value === "Not found"),
    true,
  );
});

test("missing word arrays do not prevent dense multi-line parsing", () => {
  const denseText = Array.from(
    { length: 80 },
    (_, index) => `Storage instruction line ${index + 1}`,
  ).join("\n");
  const scan = parseLabel(
    `${denseText}\nNet wt 1 kg\nMRP: 249\nIngredients: rice flour, spices and salt.`,
    undefined,
    78,
  );

  assert.equal(scan.fields.quantity.value, "1 kg");
  assert.equal(scan.fields.mrp.value, "₹249");
  assert.match(scan.fields.ingredients.value, /rice flour/);
  assert.equal(scan.fields.quantity.bbox, null);
  assert.equal(scan.fields.quantity.imageIndex, 0);
});

test("nutrition quantities are never guessed as package net quantity", () => {
  const scan = parseLabel(
    "Nutrition per serving: Protein 10 g, Total fat 8 g, Sodium 200 mg",
    [],
    92,
  );

  assert.equal(scan.fields.quantity.value, "Not found");
  assert.equal(scan.fields.quantity.status, "missing");
});

test("field normalization and manual-review validation are deterministic", () => {
  assert.equal(normalizeFieldValue("quantity", "250G"), "250 g");
  assert.equal(normalizeFieldValue("dates", "08/2026"), "2026-08");
  assert.equal(validateField("fssai", "12345678901234").valid, true);
  assert.equal(validateField("fssai", "1234").valid, false);
  assert.equal(validateField("quantity", "about one pack").valid, false);
});
