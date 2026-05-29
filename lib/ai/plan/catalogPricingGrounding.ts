/**
 * Instructions and formatting so Copilot never invents catalog prices or products.
 */

export const CATALOG_TOOL_PRICE_FOOTER = `**Pricing rule:** Quote only the **Sales** amounts shown above. Do not use list price, web/MSRP, estimates, or memory. If a product is not listed above, say it was not found in the price book — do not guess a price.`;

export function catalogPricingGroundingInstructions(): string {
  return [
    "--- CATALOG PRICING (mandatory) ---",
    "When the user asks about products in **your price book** / **catalog** / **what you sell**:",
    "- List **only** products that appear in **PRICE BOOK SEARCH** or **Price book (prefetched)** with a `[pricebook:uuid]` tag.",
    "- **Never invent** product names, SKUs, or prices (e.g. fake Verkada D30/B30/C20 or V-D30 SKUs).",
    "- Use the **Sales (catalog)** field exactly as shown. List price and web MSRP are not sales prices.",
    "- If several catalog rows match, list **each row** with its own name, SKU, and Sales price.",
    "- If results are **related but not exact** (e.g. patch panels when user said \"cables\"), explain what was found and what was not.",
    "- If prefetched/search results are **empty**, explain search stages tried and suggest broader terms — do **not** give a bare apology.",
    "- Ignore earlier assistant messages that listed catalog items **without** `[pricebook:uuid]` — those may be hallucinated.",
  ].join("\n");
}
