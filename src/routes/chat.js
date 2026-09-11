const express = require("express");
const { getShop, logMessage } = require("../store");
const { isValidShop } = require("../shopify");
const { getCatalog, shortlist } = require("../services/products");
const { getRecommendations } = require("../services/gemini");

const router = express.Router();

// Simple in-memory per-visitor conversation history, keyed by a session id
// the widget generates and keeps in localStorage. Cleared on server
// restart — fine for an MVP; move to a real store if you need durability.
const conversations = new Map();
const MAX_HISTORY_TURNS = 8;

router.post("/api/chat", express.json(), async (req, res) => {
  const { shop, message, sessionId } = req.body || {};

  if (!isValidShop(shop)) return res.status(400).json({ error: "Missing or invalid shop." });
  if (!message || typeof message !== "string" || !message.trim()) {
    return res.status(400).json({ error: "Missing message." });
  }

  const shopRecord = await getShop(shop);
  if (!shopRecord || !shopRecord.accessToken) {
    return res.status(404).json({ error: "This store hasn't installed the app." });
  }

  const key = `${shop}:${sessionId || "anon"}`;
  const history = conversations.get(key) || [];

  try {
    const catalog = await getCatalog(shop);
    const candidates = shortlist(catalog, message, 40);

    const { reply, productIds } = await getRecommendations({
      shopName: shop,
      userMessage: message,
      history,
      products: candidates,
    });

    const products = productIds
      .map((id) => catalog.find((p) => String(p.id) === String(id)))
      .filter(Boolean)
      .map((p) => ({
        id: p.id,
        title: p.title,
        price: p.price,
        image: p.image,
        url: `https://${shop}/products/${p.handle}`,
      }));

    history.push({ role: "user", content: message });
    history.push({ role: "assistant", content: reply });
    conversations.set(key, history.slice(-MAX_HISTORY_TURNS * 2));

    // Fire-and-forget: persisted to Postgres so you can review what people
    // ask (and how the bot answered) on the /admin/chats page. logMessage
    // swallows its own errors, so this never affects the customer's reply.
    logMessage({ shop, sessionId: sessionId || "anon", role: "user", message });
    logMessage({ shop, sessionId: sessionId || "anon", role: "assistant", message: reply, productIds });

    res.json({ reply, products });
  } catch (err) {
    console.error("Chat error:", err);
    res.status(500).json({ error: "The assistant hit a snag. Please try again." });
  }
});

module.exports = router;
