const express = require("express");
const { verifyWebhookHmac } = require("../shopify");
const { deleteShop } = require("../store");

const router = express.Router();

// Webhook bodies must be verified against the *raw* bytes, so this router
// uses express.raw() instead of express.json() (which would already have
// parsed/mutated the body by the time we could verify it).
function verify(req, res, next) {
  const hmacHeader = req.get("X-Shopify-Hmac-Sha256");
  if (!verifyWebhookHmac(req.body, hmacHeader)) {
    return res.status(401).send("Invalid webhook signature.");
  }
  req.jsonBody = JSON.parse(req.body.toString("utf8"));
  next();
}

const rawBody = express.raw({ type: "application/json" });

// Fired when a merchant uninstalls the app — clean up their stored token
// and cached catalog.
router.post("/webhooks/app/uninstalled", rawBody, verify, async (req, res) => {
  const shop = req.get("X-Shopify-Shop-Domain");
  if (shop) await deleteShop(shop);
  res.sendStatus(200);
});

// ---- Mandatory GDPR webhooks (required by Shopify for any public app) ----
// These stub implementations just acknowledge the request. Since this app
// stores no customer personal data (only shop-level product cache + token),
// there's nothing further to redact — but if you later store customer
// chat transcripts tied to a real identity, implement real deletion here
// before submitting to the Shopify App Store.

router.post("/webhooks/customers/data_request", rawBody, verify, (req, res) => {
  res.sendStatus(200);
});

router.post("/webhooks/customers/redact", rawBody, verify, (req, res) => {
  res.sendStatus(200);
});

router.post("/webhooks/shop/redact", rawBody, verify, async (req, res) => {
  const shop = req.jsonBody && req.jsonBody.shop_domain;
  if (shop) await deleteShop(shop);
  res.sendStatus(200);
});

module.exports = router;
