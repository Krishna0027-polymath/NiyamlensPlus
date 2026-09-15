import assert from "node:assert/strict";
import test from "node:test";
import { findEvidenceWord, parseLabel } from "../dist/label-parser.js";

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
    Nutrition per 100 g: Energy 510 kcal Protein 8 g Carbohydrate 61 g Sugar 4 g Fat 26 g Sodium 390 mg
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
});

test("evidence matching returns null for absent or malformed words", () => {
  assert.equal(findEvidenceWord("250 g"), null);
  assert.equal(findEvidenceWord("250 g", null), null);
  assert.equal(findEvidenceWord("250 g", [{ bbox: box(0, 0, 1, 1) }]), null);
});

test("empty OCR produces review fields and a stable empty word list", () => {
  const scan = parseLabel();

  assert.equal(scan.raw, "");
  assert.deepEqual(scan.words, []);
  assert.equal(scan.confidence, 0);
  assert.equal(scan.fields.mrp.value, "Not found");
  assert.equal(scan.fields.mrp.bbox, null);
  assert.equal(scan.fields.mrp.status, "review");
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
  assert.equal(scan.fields.mrp.value, "249");
  assert.match(scan.fields.ingredients.value, /rice flour/);
  assert.equal(scan.fields.quantity.bbox, null);
  assert.equal(scan.fields.quantity.imageIndex, 0);
});
