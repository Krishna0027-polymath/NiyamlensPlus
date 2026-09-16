import { protectApi } from "../lib/request-security.js";

export function createListingLookupHandler({
  fetchImplementation = globalThis.fetch,
  environment = process.env,
} = {}) {
  return async function handler(request, response) {
  if (!protectApi(request, response, { name: "listing", limit: 10, environment })) return;
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    return response.status(405).json({ error: "Method not allowed" });
  }
  response.setHeader("Cache-Control", "no-store");

  if (!environment.TAVILY_API_KEY) {
    return response
      .status(503)
      .json({ error: "Retailer lookup is not configured" });
  }

  const { productName = "", barcode = "" } = request.body || {};
  const product = String(barcode || productName)
    .trim()
    .slice(0, 180);
  if (product.length < 3) {
    return response
      .status(400)
      .json({ error: "A product name or barcode is required" });
  }

  try {
    const upstream = await fetchImplementation("https://api.tavily.com/search", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${environment.TAVILY_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query: `${product} MRP price India`,
        search_depth: "basic",
        max_results: 5,
        include_answer: false,
        include_raw_content: false,
        country: "india",
      }),
    });

    if (!upstream.ok) throw new Error(`Tavily returned ${upstream.status}`);
    const payload = await upstream.json();
    const references = (payload.results || []).slice(0, 5).map((item) => ({
      title: String(item.title || "").slice(0, 240),
      url: String(item.url || ""),
      excerpt: String(item.content || "").slice(0, 500),
    }));

    return response.status(200).json({
      status: references.length ? "references_found" : "review",
      references,
      disclaimer:
        "Search results are unverified reference leads, not evidence of a retailer price or Legal Metrology violation.",
      checkedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Tavily listing lookup failed", error);
    return response
      .status(502)
      .json({ error: "Retailer lookup failed. Please review manually." });
  }
  };
}

export default createListingLookupHandler();
