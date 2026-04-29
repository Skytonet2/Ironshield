// OLX Poland — biggest Polish classifieds. data-cy / data-testid
// attributes are stable across OLX's many country deployments.
module.exports = {
  id:        "olx_pl",
  label:     "OLX Poland",
  country:   "PL",
  locale:    "pl-PL",
  base_url:  "https://www.olx.pl",
  search_url: ({ query, location, minPrice, maxPrice }) => {
    // OLX uses path-segment search: /oferty/q-<query>/.
    const q = encodeURIComponent((query || "").trim().replace(/\s+/g, "-"));
    const u = new URL(`https://www.olx.pl/oferty/q-${q}/`);
    if (minPrice) u.searchParams.set("search%5Bfilter_float_price%3Afrom%5D", String(minPrice));
    if (maxPrice) u.searchParams.set("search%5Bfilter_float_price%3Ato%5D",   String(maxPrice));
    if (location) u.searchParams.set("search%5Bcity_id%5D", location);
    return u.toString();
  },
  card_selector: "[data-cy='l-card']",
  fields: {
    title:    "[data-cy='listing-title'], h6",
    price:    "[data-testid='ad-price']",
    location: "[data-testid='location-date']",
    url:      "a",
  },
  selector_tier: 1,
};
