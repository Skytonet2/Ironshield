// Kleinanzeigen — Germany's biggest classifieds (rebranded from "eBay
// Kleinanzeigen" in 2024). Stable .aditem class scheme; selectors here
// have been used by community scrapers for years without rotation.
module.exports = {
  id:        "kleinanzeigen_de",
  label:     "Kleinanzeigen (Germany)",
  country:   "DE",
  locale:    "de-DE",
  base_url:  "https://www.kleinanzeigen.de",
  search_url: ({ query, location, minPrice, maxPrice }) => {
    const u = new URL("https://www.kleinanzeigen.de/s-suchanfrage.html");
    if (query)    u.searchParams.set("keywords", query);
    if (location) u.searchParams.set("locationStr", location);
    if (minPrice) u.searchParams.set("minPrice", String(minPrice));
    if (maxPrice) u.searchParams.set("maxPrice", String(maxPrice));
    return u.toString();
  },
  card_selector: "article.aditem, .ad-listitem .aditem",
  fields: {
    title:    ".aditem-main--middle--title, .ellipsis",
    price:    ".aditem-main--middle--price-shipping--price, p.aditem-main--middle--price",
    location: ".aditem-main--top--left",
    url:      "a.ellipsis, h2 a",
  },
  selector_tier: 1,
};
