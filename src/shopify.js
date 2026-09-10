// Hand-rolled Shopify OAuth + Admin API helpers. No Shopify SDK, so there's
// nothing to fight when library versions change — just plain HTTPS calls,
// which is easier to read and debug for a first build.

// Node 18+ ships a global `fetch`, so no HTTP library dependency is needed.
const crypto = require("crypto");

const {
  SHOPIFY_API_KEY,
  SHOPIFY_API_SECRET,
  SHOPIFY_SCOPES,
  HOST,
} = process.env;

const ADMIN_API_VERSION = "2024-10";

function isValidShop(shop) {
  return typeof shop === "string" && /^[a-zA-Z0-9][a-zA-Z0-9-]*\.myshopify\.com$/.test(shop);
}

// Builds the URL to send a merchant to in order to approve installation.
function buildAuthUrl(shop, state) {
  const redirectUri = `${HOST}/auth/callback`;
  const params = new URLSearchParams({
    client_id: SHOPIFY_API_KEY,
    scope: SHOPIFY_SCOPES,
    redirect_uri: redirectUri,
    state,
  });
  return `https://${shop}/admin/oauth/authorize?${params.toString()}`;
}

// Verifies the HMAC Shopify signs every OAuth/callback and proxy request
// with, using the app's client secret. Protects against forged requests.
function verifyHmac(query) {
  const { hmac, signature, ...rest } = query;
  if (!hmac) return false;
  const message = Object.keys(rest)
    .sort()
    .map((key) => `${key}=${Array.isArray(rest[key]) ? rest[key].join(",") : rest[key]}`)
    .join("&");
  const digest = crypto
    .createHmac("sha256", SHOPIFY_API_SECRET)
    .update(message)
    .digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(digest, "utf8"), Buffer.from(hmac, "utf8"));
  } catch {
    return false;
  }
}

// Verifies the HMAC on mandatory GDPR webhooks, which Shopify signs
// differently (base64, over the raw request body).
function verifyWebhookHmac(rawBody, hmacHeader) {
  if (!hmacHeader) return false;
  const digest = crypto
    .createHmac("sha256", SHOPIFY_API_SECRET)
    .update(rawBody, "utf8")
    .digest("base64");
  try {
    return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(hmacHeader));
  } catch {
    return false;
  }
}

async function exchangeCodeForToken(shop, code) {
  const res = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: SHOPIFY_API_KEY,
      client_secret: SHOPIFY_API_SECRET,
      code,
    }),
  });
  if (!res.ok) {
    throw new Error(`Token exchange failed: ${res.status} ${await res.text()}`);
  }
  return res.json(); // { access_token, scope }
}

async function adminApi(shop, accessToken, endpoint, options = {}) {
  const url = `https://${shop}/admin/api/${ADMIN_API_VERSION}/${endpoint}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": accessToken,
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    throw new Error(`Admin API ${endpoint} failed: ${res.status} ${await res.text()}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

// Registers our widget script to auto-load on every storefront page.
// This is what makes the app "just work" after install, with nothing for
// the merchant to paste into their theme.
async function registerScriptTag(shop, accessToken) {
  const src = `${HOST}/widget.js`;
  const existing = await adminApi(shop, accessToken, "script_tags.json");
  const already = existing.script_tags.find((t) => t.src === src);
  if (already) return already;
  const created = await adminApi(shop, accessToken, "script_tags.json", {
    method: "POST",
    body: JSON.stringify({ script_tag: { event: "onload", src } }),
  });
  return created.script_tag;
}

module.exports = {
  isValidShop,
  buildAuthUrl,
  verifyHmac,
  verifyWebhookHmac,
  exchangeCodeForToken,
  adminApi,
  registerScriptTag,
};
