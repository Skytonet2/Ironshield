// Leboncoin — France's dominant classifieds. Stable data-test-id
// attribute scheme dating back several years; safer than class names
// for Leboncoin specifically since they shuffle CSS but keep the
// data-test-ids.
module.exports = {
  id:        "leboncoin_fr",
  label:     "Leboncoin (France)",
  country:   "FR",
  locale:    "fr-FR",
  base_url:  "https://www.leboncoin.fr",
  search_url: ({ query, location, minPrice, maxPrice }) => {
    const u = new URL("https://www.leboncoin.fr/recherche");
    if (query) u.searchParams.set("text", query);
    if (location) u.searchParams.set("locations", location);
    if (minPrice || maxPrice) {
      // Leboncoin range syntax: price=min-max (or min- / -max for open ends).
      const lo = minPrice != null ? String(minPrice) : "";
      const hi = maxPrice != null ? String(maxPrice) : "";
      if (lo || hi) u.searchParams.set("price", `${lo}-${hi}`);
    }
    return u.toString();
  },
  card_selector: "[data-test-id='ad']",
  fields: {
    title:    "[data-test-id='adcard-title'], h2",
    price:    "[data-test-id='price'], span[aria-label*='prix']",
    location: "[data-test-id='adcard-location']",
    url:      "a[data-test-id='adcard']",
  },
  selector_tier: 1,
};
