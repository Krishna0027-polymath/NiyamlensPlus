const priceFrom = (value = "") => {
  const match = String(value).match(
    /(?:₹|rs\.?|inr)\s*([\d,]+(?:\.\d{1,2})?)/i,
  );
  return match ? match[1].replace(/,/g, "") : "";
};

export default async function handler(request, response) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    return response.status(405).json({ error: "Method not allowed" });
  }
  response.setHeader("Cache-Control", "no-store");

  if (!process.env.TAVILY_API_KEY) {
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
    const upstream = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.TAVILY_API_KEY}`,
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
    const result =
      (payload.results || []).find((item) =>
        priceFrom(`${item.title || ""} ${item.content || ""}`),
      ) || payload.results?.[0];
    const price = result
      ? priceFrom(`${result.title || ""} ${result.content || ""}`)
      : "";

    return response.status(200).json({
      status: price ? "found" : "review",
      title: result?.title || "",
      price,
      source: result?.url || "Tavily Search",
      checkedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Tavily listing lookup failed", error);
    return response
      .status(502)
      .json({ error: "Retailer lookup failed. Please review manually." });
  }
}
