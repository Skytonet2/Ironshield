// Subito — Italy's biggest classifieds (Schibsted-owned). Heavy SPA
// with a virtuoso virtual-scroller for results; selectors are
// best-effort and likely need calibration on first live run.
module.exports = {
  id:        "subito_it",
  label:     "Subito (Italy)",
  country:   "IT",
  locale:    "it-IT",
  base_url:  "https://www.subito.it",
  search_url: ({ query, location, minPrice, maxPrice }) => {
    const u = new URL("https://www.subito.it/annunci-italia/vendita/usato/");
    if (query) u.searchParams.set("q", query);
    if (location) u.searchParams.set("city", location);
    if (minPrice) u.searchParams.set("ps", String(minPrice));
    if (maxPrice) u.searchParams.set("pe", String(maxPrice));
    return u.toString();
  },
  card_selector: "[class*='item-card-listing'], a[class*='ItemCard']",
  fields: {
    title:    "h2, [class*='item-title']",
    price:    "[class*='price'], p[class*='price']",
    location: "[class*='item-location'], [class*='town']",
    url:      null,
  },
  scroll:        true,
  wait_for:      "[class*='item-card-listing'], a[class*='ItemCard']",
  timeout_ms:    45_000,
  selector_tier: 2,
};
