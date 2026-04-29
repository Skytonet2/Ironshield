// Jiji Nigeria — the original site. High-confidence selectors, used
// in production by the legacy jiji connector since Tier 4.
module.exports = {
  id:             "jiji_ng",
  label:          "Jiji Nigeria",
  country:        "NG",
  locale:         "en-NG",
  base_url:       "https://jiji.ng",
  search_url: ({ query, location, minPrice, maxPrice }) => {
    const u = new URL("https://jiji.ng/search");
    if (query)    u.searchParams.set("query", query);
    if (location) u.searchParams.set("filter_location", location);
    if (minPrice) u.searchParams.set("filter_price_from", String(minPrice));
    if (maxPrice) u.searchParams.set("filter_price_to",   String(maxPrice));
    return u.toString();
  },
  card_selector: "a[href*='/'][class*='b-list-advert']",
  fields: {
    title:    "[class*='title']",
    price:    "[class*='price']",
    location: "[class*='region']",
    url:      null, // card itself is the anchor
  },
  selector_tier: 1,
};
