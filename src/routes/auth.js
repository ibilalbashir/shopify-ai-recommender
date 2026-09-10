const express = require("express");
const crypto = require("crypto");
const {
  isValidShop,
  buildAuthUrl,
  verifyHmac,
  exchangeCodeForToken,
  registerScriptTag,
} = require("../shopify");
const { saveShop } = require("../store");

const router = express.Router();

// In-memory nonce store for the OAuth `state` param (CSRF protection).
// Fine for a single-instance server; if you scale to multiple instances
// behind a load balancer, move this to shared storage (Redis, DB, etc.).
const pendingStates = new Set();

// Step 1: merchant (or you, for testing) hits /auth?shop=my-store.myshopify.com
router.get("/auth", (req, res) => {
  const { shop } = req.query;
  if (!isValidShop(shop)) {
    return res.status(400).send("Missing or invalid ?shop= parameter. Expected e.g. my-store.myshopify.com");
  }
  const state = crypto.randomBytes(16).toString("hex");
  pendingStates.add(state);
  res.redirect(buildAuthUrl(shop, state));
});

// Step 2: Shopify redirects back here after the merchant approves install.
router.get("/auth/callback", async (req, res) => {
  const { shop, code, state } = req.query;

  if (!isValidShop(shop)) return res.status(400).send("Invalid shop.");
  if (!state || !pendingStates.has(state)) return res.status(403).send("Invalid or expired state.");
  pendingStates.delete(state);
  if (!verifyHmac(req.query)) return res.status(403).send("Invalid HMAC — request may be forged.");

  try {
    const { access_token, scope } = await exchangeCodeForToken(shop, code);
    await saveShop(shop, { accessToken: access_token, scope, installedAt: Date.now() });

    // Auto-inject the chat widget on every storefront page — no theme
    // editing required by the merchant.
    await registerScriptTag(shop, access_token);

    res.send(successPage(shop));
  } catch (err) {
    console.error("OAuth callback error:", err);
    res.status(500).send("Something went wrong finishing installation. Check server logs.");
  }
});

function successPage(shop) {
  return `<!doctype html>
<html>
  <body style="font-family: -apple-system, sans-serif; max-width: 480px; margin: 80px auto; text-align: center;">
    <h1>✅ Installed on ${shop}</h1>
    <p>The AI shopping assistant is now live on your storefront.</p>
    <p><a href="https://${shop}" target="_blank">Open your store</a> to see the chat bubble in the corner of the page.</p>
  </body>
</html>`;
}

module.exports = router;
