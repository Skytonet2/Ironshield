module.exports = {
  id:        "jiji_ug",
  label:     "Jiji Uganda",
  country:   "UG",
  locale:    "en-UG",
  base_url:  "https://jiji.ug",
  search_url: ({ query, location, minPrice, maxPrice }) => {
    const u = new URL("https://jiji.ug/search");
    if (query)    u.searchParams.set("query", query);
    if (location) u.searchParams.set("filter_location", location);
    if (minPrice) u.searchParams.set("filter_price_from", String(minPrice));
    if (maxPrice) u.searchParams.set("filter_price_to",   String(maxPrice));
    return u.toString();
  },
  card_selector: "a[href*='/'][class*='b-list-advert']",
  fields: { title: "[class*='title']", price: "[class*='price']", location: "[class*='region']", url: null },
  selector_tier: 1,
};
