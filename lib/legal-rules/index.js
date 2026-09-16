export const RULESET_VERSION = "prototype-review-2026-09";

const officialRuleSource =
  "https://consumeraffairs.gov.in/public/upload/admin/cmsfiles/whatsnews/Book_on_Legal_Metrology_Packaged_Commodities_Rules%2C2011_with_all_amendments_whatsnews.pdf";

export const LEGAL_REVIEW_RULES = [
  ["manufacturer", "LMPC-R6-ACTOR", "Manufacturer or packer identity and address", true],
  ["importer", "LMPC-R6-IMPORTER", "Importer identity and address", false],
  ["countryOfOrigin", "LMPC-R6-ORIGIN", "Country of origin", false],
  ["commodityName", "LMPC-R6-COMMODITY", "Common or generic commodity name", true],
  ["quantity", "LMPC-R6-QUANTITY", "Net quantity in a standard unit", true],
  ["mrp", "LMPC-R6-MRP", "Maximum retail price declaration", true],
  ["unitSalePrice", "LMPC-R6-UNIT-PRICE", "Unit sale price", false],
  ["dates", "LMPC-R6-DATE", "Applicable manufacture, pack, import or use-by declaration", false],
  ["consumerCare", "LMPC-R6-CARE", "Consumer-care contact details", true],
].map(([field, id, title, required]) => ({
  id,
  field,
  title,
  required,
  source: officialRuleSource,
  applicability: required
    ? "General declaration review; exemptions and package context still require confirmation"
    : "Conditional declaration; product category and package context determine applicability",
}));
