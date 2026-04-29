// Wallapop — Spain's biggest classifieds. Heavy single-page app:
// the search results are rendered after JS hydration, so we need to
// wait + scroll. Selectors here are best-effort based on observed
// 2025 markup; expect calibration on first live run.
module.exports = {
  id:        "wallapop_es",
  label:     "Wallapop (Spain)",
  country:   "ES",
  locale:    "es-ES",
  base_url:  "https://es.wallapop.com",
  search_url: ({ query, minPrice, maxPrice }) => {
    const u = new URL("https://es.wallapop.com/app/search");
    if (query) u.searchParams.set("keywords", query);
    if (minPrice) u.searchParams.set("min_sale_price", String(minPrice));
    if (maxPrice) u.searchParams.set("max_sale_price", String(maxPrice));
    return u.toString();
  },
  card_selector: "[data-testid='search-list-item'], a[class*='ItemCard']",
  fields: {
    title:    "[class*='ItemCard__title'], h3",
    price:    "[class*='ItemCard__price'], span[class*='price']",
    location: "[class*='ItemCard__location']",
    url:      null, // card itself is usually the anchor
  },
  scroll:        true,
  wait_for:      "[data-testid='search-list-item'], a[class*='ItemCard']",
  timeout_ms:    45_000,
  selector_tier: 2,
};
