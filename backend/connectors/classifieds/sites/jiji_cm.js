module.exports = {
  id:        "jiji_cm",
  label:     "Jiji Cameroon",
  country:   "CM",
  locale:    "en-CM",
  base_url:  "https://jiji.cm",
  search_url: ({ query, location, minPrice, maxPrice }) => {
    const u = new URL("https://jiji.cm/search");
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
