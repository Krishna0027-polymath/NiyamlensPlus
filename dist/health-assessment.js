export const ADULT_DAILY_REFERENCES = {
  totalFat: 67,
  saturatedFat: 22,
  transFat: 2,
  addedSugar: 50,
  sodium: 2_000,
  totalSalt: 5,
};

const SEVERITY = { low: 0, medium: 1, high: 2 };

// Used only when a label gives values per 100 g/ml without a serving size.
// This describes product composition; it does not estimate the eaten portion.
const PER_HUNDRED_THRESHOLDS = {
  per100g: {
    totalFat: { low: 3, high: 17.5 },
    saturatedFat: { low: 1.5, high: 5 },
    totalSugar: { low: 5, high: 22.5 },
    sodium: { low: 100, high: 600 },
    totalSalt: { low: 0.3, high: 1.5 },
  },
  per100ml: {
    totalFat: { low: 1.5, high: 8.75 },
    saturatedFat: { low: 0.75, high: 2.5 },
    totalSugar: { low: 2.5, high: 11.25 },
    sodium: { low: 136, high: 341 },
    totalSalt: { low: 0.3, high: 0.75 },
  },
};

const ADDED_SUGAR_SOURCE_PATTERN =
  /\b(?:sugar|sucrose|dextrose|glucose\s+syrup|corn\s+syrup|high[-\s]?fructose\s+corn\s+syrup|invert\s+sugar|maltose)\b/i;

const INGREDIENT_RULES = [
  {
    key: "partiallyHydrogenatedOil",
    pattern: /\b(?:partially\s+hydrogenated(?:\s+(?:vegetable\s+)?oil)?|phvo)\b/i,
    level: "warning",
    text: {
      en: [
        "Partially hydrogenated oil found",
        "This can be a source of artificial trans fat, which raises heart-health risk. Prefer a product without it and check trans fat per serving.",
      ],
      hi: [
        "आंशिक हाइड्रोजनीकृत तेल मिला",
        "यह कृत्रिम ट्रांस फैट का स्रोत हो सकता है, जो हृदय जोखिम बढ़ाता है। इसके बिना विकल्प चुनें और प्रति सर्विंग ट्रांस फैट देखें।",
      ],
    },
  },
  {
    key: "caffeine",
    pattern: /\b(?:added\s+)?caffeine\b/i,
    level: "warning",
    text: {
      en: [
        "Caffeine found; dose unknown",
        "Too much caffeine can cause harm, but the ingredient list does not show the dose. Check caffeine amount and limit other caffeine today.",
      ],
      hi: [
        "कैफीन मिला; मात्रा अज्ञात",
        "अधिक कैफीन नुकसान कर सकता है, लेकिन सामग्री सूची इसकी मात्रा नहीं बताती। कैफीन की मात्रा देखें और आज अन्य कैफीन सीमित रखें।",
      ],
    },
  },
  {
    key: "aspartame",
    pattern: /\baspartame\b/i,
    level: "warning",
    text: {
      en: [
        "Aspartame-specific warning",
        "Presence alone does not mean danger for most adults, but people with PKU must avoid or restrict it. The ingredient list does not show the dose.",
      ],
      hi: [
        "एस्पार्टेम की विशेष चेतावनी",
        "केवल मौजूद होना अधिकांश वयस्कों के लिए खतरा नहीं बताता, लेकिन PKU वाले लोगों को इससे बचना या इसे सीमित करना चाहिए। मात्रा नहीं दी गई है।",
      ],
    },
  },
  {
    key: "addedSugarSource",
    pattern: ADDED_SUGAR_SOURCE_PATTERN,
    level: "warning",
    skipWhenAnyNutrientAvailable: ["addedSugar", "totalSugar"],
    text: {
      en: [
        "Added-sugar source found; amount unknown",
        "Frequent high intake can increase dental and metabolic risk. Use the added-sugar value per serving to judge the amount.",
      ],
      hi: [
        "अतिरिक्त चीनी का स्रोत मिला; मात्रा अज्ञात",
        "बार-बार अधिक सेवन दांतों और मेटाबॉलिक जोखिम को बढ़ा सकता है। मात्रा जानने के लिए प्रति सर्विंग अतिरिक्त चीनी देखें।",
      ],
    },
  },
  {
    key: "sodiumSource",
    pattern:
      /\b(?:monosodium\s+glutamate|msg|sodium\s+benzoate|sodium\s+nitrite|sodium\s+bicarbonate|common\s+sal(?:t)?|[il]odi[sz]ed\s+sa(?:lt|ill?)|salt)\b/i,
    level: "warning",
    skipWhenAnyNutrientAvailable: ["sodium", "totalSalt"],
    text: {
      en: [
        "Sodium-contributing ingredient found",
        "The ingredient can add sodium, but its name does not reveal the amount. Use sodium per serving to judge blood-pressure concern.",
      ],
      hi: [
        "सोडियम देने वाली सामग्री मिली",
        "यह सामग्री सोडियम बढ़ा सकती है, लेकिन नाम से मात्रा पता नहीं चलती। रक्तचाप की चिंता जानने के लिए प्रति सर्विंग सोडियम देखें।",
      ],
    },
  },
  {
    key: "saturatedFatSource",
    pattern: /\b(?:palm(?:olein)?\s+(?:oil|orl)|palm\s+fat|coconut\s+oil|butter|ghee)\b/i,
    level: "warning",
    skipWhenNutrientAvailable: "saturatedFat",
    text: {
      en: [
        "Saturated-fat source found",
        "Concern depends on the amount, not the ingredient name alone. Check the declared saturated-fat value and prefer a lower one for frequent intake.",
      ],
      hi: [
        "संतृप्त वसा का स्रोत मिला",
        "चिंता केवल सामग्री के नाम से नहीं, मात्रा से तय होती है। घोषित संतृप्त वसा देखें और नियमित सेवन के लिए कम मात्रा चुनें।",
      ],
    },
  },
  {
    key: "highIntensitySweetener",
    pattern:
      /\b(?:sucralose|acesulfame(?:\s+potassium|[-\s]?k)?|saccharin|neotame|advantame|steviol\s+glycosides?)\b/i,
    level: "warning",
    text: {
      en: [
        "High-intensity sweetener found",
        "Its presence alone does not prove danger, and the ingredient list does not show the dose. Follow package warnings and serving guidance.",
      ],
      hi: [
        "तीव्र मिठास देने वाला स्वीटनर मिला",
        "केवल मौजूद होना खतरे का प्रमाण नहीं है और सामग्री सूची मात्रा नहीं बताती। पैक की चेतावनी और सर्विंग निर्देश मानें।",
      ],
    },
  },
];

const INGREDIENT_ALLERGENS = [
  ["milk", /\b(?:milk|casein|whey)\b/i],
  ["groundnut/peanut", /\b(?:groundnut|peanut)\b/i],
  ["tree nuts", /\b(?:almond|cashew|walnut|pistachio|hazelnut|tree\s+nuts?)\b/i],
  ["soy", /\b(?:soy|soya)\b/i],
  ["wheat/gluten", /\b(?:whea(?:t|l)|gluten)\b/i],
  ["egg", /\beggs?\b/i],
  ["sesame", /\bsesame\b/i],
  ["mustard", /\bmustard\b/i],
  ["fish/shellfish", /\b(?:fish|shellfish|prawn|shrimp|crab)\b/i],
];

const COPY = {
  totalFat: {
    en: {
      high: ["High total-fat concern", "Frequent intake can make it harder to stay within the daily fat limit; choose a lower-fat option."],
      medium: ["Moderate total-fat concern", "Keep other fatty foods limited today."],
    },
    hi: {
      high: ["कुल वसा की अधिक चिंता", "बार-बार सेवन से रोज़ की वसा सीमा पार हो सकती है; कम वसा वाला विकल्प चुनें।"],
      medium: ["कुल वसा की मध्यम चिंता", "आज दूसरे अधिक वसा वाले खाद्य पदार्थ सीमित रखें।"],
    },
  },
  saturatedFat: {
    en: {
      high: ["High saturated-fat concern", "Frequent intake may raise heart-health risk; choose a lower-saturated-fat option."],
      medium: ["Moderate saturated-fat concern", "Limit other saturated-fat foods today."],
    },
    hi: {
      high: ["संतृप्त वसा की अधिक चिंता", "बार-बार सेवन हृदय के जोखिम को बढ़ा सकता है; कम संतृप्त वसा वाला विकल्प चुनें।"],
      medium: ["संतृप्त वसा की मध्यम चिंता", "आज अन्य संतृप्त वसा वाले खाद्य पदार्थ सीमित रखें।"],
    },
  },
  transFat: {
    en: {
      high: ["High trans-fat concern", "Trans fat is best kept as low as possible; choose an option with less trans fat."],
      medium: ["Moderate trans-fat concern", "Avoid adding more trans fat from other foods today."],
    },
    hi: {
      high: ["ट्रांस फैट की अधिक चिंता", "ट्रांस फैट को जितना हो सके कम रखें; कम ट्रांस फैट वाला विकल्प चुनें।"],
      medium: ["ट्रांस फैट की मध्यम चिंता", "आज दूसरे खाद्य पदार्थों से ट्रांस फैट लेने से बचें।"],
    },
  },
  addedSugar: {
    en: {
      high: ["High added-sugar concern", "Frequent intake may increase dental and metabolic health risk; choose a lower-sugar option."],
      medium: ["Moderate added-sugar concern", "Keep other sugary foods and drinks limited today."],
    },
    hi: {
      high: ["अतिरिक्त चीनी की अधिक चिंता", "बार-बार सेवन दांतों और मेटाबॉलिक स्वास्थ्य का जोखिम बढ़ा सकता है; कम चीनी वाला विकल्प चुनें।"],
      medium: ["अतिरिक्त चीनी की मध्यम चिंता", "आज अन्य मीठे खाद्य और पेय सीमित रखें।"],
    },
  },
  sodium: {
    en: {
      high: ["High sodium concern", "Frequent intake may increase blood-pressure risk; choose a lower-sodium option."],
      medium: ["Moderate sodium concern", "Keep other salty foods limited today."],
    },
    hi: {
      high: ["सोडियम की अधिक चिंता", "बार-बार सेवन रक्तचाप का जोखिम बढ़ा सकता है; कम सोडियम वाला विकल्प चुनें।"],
      medium: ["सोडियम की मध्यम चिंता", "आज अन्य नमकीन खाद्य पदार्थ सीमित रखें।"],
    },
  },
  totalSugar: {
    en: {
      high: ["High total-sugar concern", "Frequent intake may increase dental and metabolic health risk; choose a lower-sugar option."],
      medium: ["Moderate total-sugar concern", "Keep the portion modest and limit other sugary foods and drinks today."],
    },
    hi: {
      high: ["कुल चीनी की अधिक चिंता", "बार-बार सेवन दांतों और मेटाबॉलिक स्वास्थ्य का जोखिम बढ़ा सकता है; कम चीनी वाला विकल्प चुनें।"],
      medium: ["कुल चीनी की मध्यम चिंता", "मात्रा सीमित रखें और आज अन्य मीठे खाद्य व पेय कम लें।"],
    },
  },
  totalSalt: {
    en: {
      high: ["High salt concern", "Frequent intake may increase blood-pressure risk; choose a lower-salt option."],
      medium: ["Moderate salt concern", "Keep other salty foods limited today."],
    },
    hi: {
      high: ["नमक की अधिक चिंता", "बार-बार सेवन रक्तचाप का जोखिम बढ़ा सकता है; कम नमक वाला विकल्प चुनें।"],
      medium: ["नमक की मध्यम चिंता", "आज अन्य नमकीन खाद्य पदार्थ सीमित रखें।"],
    },
  },
};

const GENERAL_COPY = {
  en: {
    title: "Saathi health check",
    disclaimer: "General adult guidance only. Your total diet and medical conditions can change the risk.",
    unavailable: "Health assessment unavailable—scan the nutrition panel more clearly.",
    low: "Low concern based on the readable nutrition panel.",
    medium: "Moderate concern. Limit frequency and balance the rest of the day.",
    high: "High concern for frequent intake. Consider a lower-concern alternative.",
    allergenTitle: "Allergen warning",
    allergen: (value) => `Avoid this product if you are allergic to ${value}.`,
    ingredientOnly:
      "Nutrition risk cannot be scored; ingredient-specific cautions are shown below.",
    ingredientOcrReview:
      "Some ingredient text was read from a difficult image; confirm each warning against the package.",
    perHundredNote:
      "This is based on the label's per-100 amount; your actual risk depends on the portion and how often you eat it.",
    ingredientAllergenTitle: "Possible allergen in ingredients",
    ingredientAllergen: (value) =>
      `The ingredient list mentions ${value}. Avoid it if allergic and confirm the package allergen statement.`,
  },
  hi: {
    title: "साथी स्वास्थ्य जांच",
    disclaimer: "यह केवल सामान्य वयस्क मार्गदर्शन है। आपका पूरा आहार और स्वास्थ्य स्थिति जोखिम बदल सकते हैं।",
    unavailable: "स्वास्थ्य आकलन उपलब्ध नहीं है—पोषण तालिका की साफ़ फोटो लें।",
    low: "पढ़ी गई पोषण तालिका के आधार पर चिंता कम है।",
    medium: "चिंता मध्यम है। सेवन की आवृत्ति सीमित रखें और बाकी दिन संतुलन रखें।",
    high: "बार-बार सेवन के लिए चिंता अधिक है। बेहतर विकल्प चुनने पर विचार करें।",
    allergenTitle: "एलर्जी चेतावनी",
    allergen: (value) => `यदि आपको ${value} से एलर्जी है तो इस उत्पाद से बचें।`,
    ingredientOnly:
      "पोषण जोखिम का स्तर तय नहीं हो सका; सामग्री से जुड़ी सावधानियां नीचे दी गई हैं।",
    ingredientOcrReview:
      "कुछ सामग्री पाठ कठिन फोटो से पढ़ा गया है; हर चेतावनी को पैक से मिलाकर जांचें।",
    perHundredNote:
      "यह आकलन लेबल की प्रति 100 मात्रा पर आधारित है; वास्तविक जोखिम आपकी खाई गई मात्रा और सेवन की आवृत्ति पर निर्भर करता है।",
    ingredientAllergenTitle: "सामग्री में संभावित एलर्जेन",
    ingredientAllergen: (value) =>
      `सामग्री सूची में ${value} है। एलर्जी होने पर इससे बचें और पैक की एलर्जी चेतावनी जांचें।`,
  },
};

function classification(percent) {
  if (percent <= 5) return "low";
  if (percent >= 20) return "high";
  return "medium";
}

function perHundredClassification(nutrition, key, item) {
  const thresholds = PER_HUNDRED_THRESHOLDS[nutrition.basis?.type]?.[key];
  if (!thresholds || !Number.isFinite(item.amount)) return null;
  if (item.amount <= thresholds.low) return "low";
  if (item.amount > thresholds.high) return "high";
  return "medium";
}

function percentForServing(nutrition, key, item, ingredients = "") {
  if (Number.isFinite(item.declaredDailyPercent)) {
    return item.declaredDailyPercent;
  }
  const reference =
    ADULT_DAILY_REFERENCES[key] ||
    (key === "totalSugar" && ADDED_SUGAR_SOURCE_PATTERN.test(ingredients)
      ? ADULT_DAILY_REFERENCES.addedSugar
      : null);
  if (!reference) return null;

  let amount = item.amount;
  if (nutrition.basis?.type === "perServing") {
    // The printed amount already represents one serving.
  } else if (
    ["per100g", "per100ml"].includes(nutrition.basis?.type) &&
    nutrition.servingSize?.amount &&
    nutrition.servingSize.unit === nutrition.basis.unit
  ) {
    amount *= nutrition.servingSize.amount / 100;
  } else {
    return null;
  }
  return (amount / reference) * 100;
}

function translatedFinding(key, level, percent, basis = "serving") {
  const result = { key, level, percent, basis, kind: "nutrient", text: {} };
  for (const lang of ["en", "hi"]) {
    const [title, message] = COPY[key][lang][level];
    result.text[lang] = { title, message, speech: `${title}. ${message}` };
  }
  return result;
}

function ingredientFinding(rule, matchedText) {
  return {
    key: rule.key,
    level: rule.level,
    kind: "ingredient",
    matchedText,
    quantityKnown: false,
    text: Object.fromEntries(
      ["en", "hi"].map((lang) => {
        const [title, message] = rule.text[lang];
        return [lang, { title, message, speech: `${title}. ${message}` }];
      }),
    ),
  };
}

export function assessIngredients(ingredients = "", nutrition = { nutrients: {} }) {
  const value = String(ingredients || "").trim();
  if (!value || value === "Not found") return [];
  const findings = [];

  for (const rule of INGREDIENT_RULES) {
    if (
      rule.skipWhenAnyNutrientAvailable?.some(
        (key) => nutrition.nutrients?.[key],
      )
    ) {
      continue;
    }
    if (rule.skipWhenNutrientAvailable && nutrition.nutrients?.[rule.skipWhenNutrientAvailable]) {
      continue;
    }
    const match = value.match(rule.pattern);
    if (match) findings.push(ingredientFinding(rule, match[0]));
    if (findings.length >= 3) break;
  }
  return findings;
}

function ingredientAllergenFinding(ingredients) {
  const found = INGREDIENT_ALLERGENS.filter(([, pattern]) => pattern.test(ingredients)).map(
    ([name]) => name,
  );
  if (!found.length) return null;
  const value = found.join(", ");
  return {
    key: "ingredientAllergens",
    level: "warning",
    kind: "allergen",
    text: Object.fromEntries(
      ["en", "hi"].map((lang) => [
        lang,
        {
          title: GENERAL_COPY[lang].ingredientAllergenTitle,
          message: GENERAL_COPY[lang].ingredientAllergen(value),
          speech: `${GENERAL_COPY[lang].ingredientAllergenTitle}. ${GENERAL_COPY[lang].ingredientAllergen(value)}`,
        },
      ]),
    ),
  };
}

function wordCount(value) {
  return String(value || "").trim().split(/\s+/).filter(Boolean).length;
}

function narration(summary, findings, disclaimer) {
  const selected = [summary];
  for (const finding of findings.slice(0, 3)) {
    const next = [...selected, finding, disclaimer].join(" ");
    if (wordCount(next) <= 60) selected.push(finding);
  }
  if (wordCount([...selected, disclaimer].join(" ")) <= 60) {
    selected.push(disclaimer);
  }
  return selected.join(" ");
}

export function assessLabelHealth(scan = {}) {
  const nutrition = scan.nutrition || { nutrients: {} };
  const reliable = Number(scan.confidence) >= 72;
  const nutrientFindings = [];
  const ingredientField = scan.fields?.ingredients || {};
  const ingredients = String(ingredientField.value || "").trim();

  if (reliable) {
    for (const [key, item] of Object.entries(nutrition.nutrients || {})) {
      const percent = percentForServing(nutrition, key, item, ingredients);
      if (Number.isFinite(percent)) {
        const level = classification(percent);
        if (level !== "low") nutrientFindings.push(translatedFinding(key, level, percent));
        continue;
      }

      const level = perHundredClassification(nutrition, key, item);
      if (level && level !== "low") {
        nutrientFindings.push(translatedFinding(key, level, null, "perHundred"));
      }
    }
  }

  nutrientFindings.sort(
    (a, b) =>
      SEVERITY[b.level] - SEVERITY[a.level] ||
      (Number(b.percent) || 0) - (Number(a.percent) || 0),
  );

  const evaluatedCount = reliable
    ? Object.entries(nutrition.nutrients || {}).filter(
        ([key, item]) =>
          Number.isFinite(percentForServing(nutrition, key, item, ingredients)) ||
          Boolean(perHundredClassification(nutrition, key, item)),
      ).length
    : 0;
  const overall = !evaluatedCount
    ? "unavailable"
    : nutrientFindings[0]?.level || "low";
  const allergens = String(scan.fields?.allergens?.value || "").trim();
  const hasAllergen = allergens && allergens !== "Not found";
  const findings = [...nutrientFindings];

  const reliableIngredients =
    ingredients &&
    ingredients !== "Not found" &&
    (Number(scan.confidence) >= 68 || ingredientField.status === "reviewed");
  const ingredientFindings = reliableIngredients
    ? assessIngredients(ingredients, nutrition)
    : [];
  findings.push(...ingredientFindings);

  if (hasAllergen) {
    findings.push({
      key: "allergens",
      level: "warning",
      kind: "allergen",
      text: Object.fromEntries(
        ["en", "hi"].map((lang) => [
          lang,
          {
            title: GENERAL_COPY[lang].allergenTitle,
            message: GENERAL_COPY[lang].allergen(allergens),
            speech: `${GENERAL_COPY[lang].allergenTitle}. ${GENERAL_COPY[lang].allergen(allergens)}`,
          },
        ]),
      ),
    });
  } else if (reliableIngredients) {
    const ingredientAllergen = ingredientAllergenFinding(ingredients);
    if (ingredientAllergen) findings.push(ingredientAllergen);
  }

  const text = {};
  const usesPerHundredAssessment = nutrientFindings.some(
    (finding) => finding.basis === "perHundred",
  );
  for (const lang of ["en", "hi"]) {
    const copy = GENERAL_COPY[lang];
    const summary =
      overall === "unavailable" && (ingredientFindings.length || findings.some((item) => item.key === "ingredientAllergens"))
        ? copy.ingredientOnly
        : copy[overall];
    const spokenFindings = findings.map((item) => item.text[lang].speech);
    let disclaimer = usesPerHundredAssessment
      ? `${copy.perHundredNote} ${copy.disclaimer}`
      : copy.disclaimer;
    if (!reliable && reliableIngredients) {
      disclaimer = `${copy.ingredientOcrReview} ${disclaimer}`;
    }
    text[lang] = {
      title: copy.title,
      summary,
      disclaimer,
      narration: narration(summary, spokenFindings, disclaimer),
    };
  }

  return {
    overall,
    findings,
    text,
    evaluatedCount,
    ingredientFindingCount: ingredientFindings.length,
  };
}
