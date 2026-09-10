const { adminApi } = require("../shopify");
const { getShop, saveShop } = require("../store");

const CACHE_TTL_MS = 15 * 60 * 1000; // refresh catalog at most every 15 min

// Pulls the store's active, published products into a small flat shape
// that's cheap to send to the LLM and easy to render as product cards.
async function fetchCatalog(shop, accessToken) {
  const products = [];
  let endpoint = "products.json?limit=250&status=active&fields=id,title,handle,body_html,product_type,tags,images,variants";
  while (endpoint) {
    const url = `https://${shop}/admin/api/2024-10/${endpoint}`;
    const res = await fetch(url, {
      headers: { "X-Shopify-Access-Token": accessToken },
    });
    if (!res.ok) throw new Error(`Failed to fetch products: ${res.status}`);
    const body = await res.json();
    for (const p of body.products) {
      const cheapestVariant = (p.variants || []).reduce(
        (min, v) => (min === null || parseFloat(v.price) < parseFloat(min.price) ? v : min),
        null
      );
      products.push({
        id: p.id,
        title: p.title,
        handle: p.handle,
        description: stripHtml(p.body_html).slice(0, 400),
        type: p.product_type || "",
        tags: p.tags ? p.tags.split(",").map((t) => t.trim()) : [],
        image: p.images && p.images[0] ? p.images[0].src : null,
        price: cheapestVariant ? cheapestVariant.price : null,
        available: (p.variants || []).some((v) => v.inventory_quantity == null || v.inventory_quantity > 0),
      });
    }
    // Basic Link-header pagination (Shopify's cursor-based paging).
    const link = res.headers.get("link");
    const nextMatch = link && link.match(/<([^>]+)>;\s*rel="next"/);
    endpoint = nextMatch ? nextMatch[1].split("/admin/api/2024-10/")[1] : null;
  }
  return products;
}

function stripHtml(html) {
  return (html || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

// Returns the shop's product catalog, using a short-lived cache so a busy
// chat widget doesn't re-fetch the whole catalog from Shopify on every
// message.
async function getCatalog(shop) {
  const record = await getShop(shop);
  if (!record || !record.accessToken) {
    throw new Error(`No access token stored for ${shop}. Has the app been installed?`);
  }
  const isFresh = record.catalogFetchedAt && Date.now() - record.catalogFetchedAt < CACHE_TTL_MS;
  if (isFresh && record.catalog) return record.catalog;

  const catalog = await fetchCatalog(shop, record.accessToken);
  await saveShop(shop, { catalog, catalogFetchedAt: Date.now() });
  return catalog;
}

// Cheap keyword pre-filter so we don't have to send a huge catalog to the
// LLM on every request (keeps latency and token cost down). Scores each
// product by how many words from the user's message appear in its title,
// type, tags or description, and returns the top N. Falls back to the
// first N products if nothing scores (e.g. a vague opener like "hi").
function shortlist(catalog, userMessage, limit = 40) {
  const words = userMessage
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 2);

  if (words.length === 0) return catalog.slice(0, limit);

  const scored = catalog.map((p) => {
    const haystack = `${p.title} ${p.type} ${p.tags.join(" ")} ${p.description}`.toLowerCase();
    const score = words.reduce((sum, w) => sum + (haystack.includes(w) ? 1 : 0), 0);
    return { p, score };
  });

  scored.sort((a, b) => b.score - a.score);
  const topScored = scored.filter((s) => s.score > 0).slice(0, limit);
  if (topScored.length >= Math.min(5, catalog.length)) {
    return topScored.map((s) => s.p);
  }
  // Not much matched — mix in some top sellers/first-listed items so the
  // model still has a reasonable set to choose from.
  const seen = new Set(topScored.map((s) => s.p.id));
  const filler = catalog.filter((p) => !seen.has(p.id)).slice(0, limit - topScored.length);
  return [...topScored.map((s) => s.p), ...filler];
}

module.exports = { getCatalog, shortlist };
