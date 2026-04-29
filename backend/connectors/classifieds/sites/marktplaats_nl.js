// Marktplaats — Netherlands' dominant classifieds (eBay-owned).
// Stable hz-Listing class prefix used since the SPA rewrite years ago.
module.exports = {
  id:        "marktplaats_nl",
  label:     "Marktplaats (Netherlands)",
  country:   "NL",
  locale:    "nl-NL",
  base_url:  "https://www.marktplaats.nl",
  search_url: ({ query, location, minPrice, maxPrice }) => {
    // Marktplaats uses path-segment search: /q/<encoded-query>/.
    const q = encodeURIComponent((query || "").trim().replace(/\s+/g, "-"));
    const u = new URL(`https://www.marktplaats.nl/q/${q}/`);
    if (minPrice) u.searchParams.set("priceFrom", String(minPrice));
    if (maxPrice) u.searchParams.set("priceTo",   String(maxPrice));
    if (location) u.searchParams.set("distanceMeters", "100000");
    return u.toString();
  },
  card_selector: ".hz-Listing, [data-testid='listing']",
  fields: {
    title:    ".hz-Listing-title, h3",
    price:    ".hz-Listing-price",
    location: ".hz-Listing-location-and-time, .hz-Listing-location",
    url:      ".hz-Listing-title-link, a.hz-Link",
  },
  selector_tier: 1,
};
