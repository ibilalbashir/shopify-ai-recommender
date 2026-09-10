# Shopify AI Product Recommender

An installable Shopify app: a chat bubble on the storefront where a customer
types what they want ("something for oily skin under $30", or just "hi"),
and an AI assistant (Gemini) recommends real products from that store's own
catalog — with images, prices, and links.

It's built as a generic app: any Shopify store can install it via OAuth,
each with its own isolated product catalog and chat history. You're
testing it on Kiyowish first, but nothing here is Kiyowish-specific.

## How it works

1. A merchant installs the app by visiting `/auth?shop=their-store.myshopify.com`
   and approving the permission screen. Shopify redirects back to this app,
   which exchanges the code for an access token and stores it.
2. On install, the app registers a **ScriptTag** with Shopify, so
   `widget.js` auto-loads on every page of that storefront — no theme
   editing required.
3. The widget shows a chat bubble. Each message the customer sends goes to
   this app's `/api/chat` endpoint, which:
   - fetches (and caches) the shop's product catalog via the Admin API,
   - narrows it down to the ~40 most relevant products by keyword,
   - asks Gemini to pick up to 4 that fit and write a short reply,
   - sends product cards (image, title, price, link) back to the widget.

## 1. Create the Shopify app credentials

1. Go to your [Shopify Partner Dashboard](https://partners.shopify.com) →
   **Apps** → **Create app** → **Create app manually**.
2. Set the **App URL** to your deployed server's URL (step 2 below), e.g.
   `https://your-app.onrender.com`.
3. Set the **Allowed redirection URL** to
   `https://your-app.onrender.com/auth/callback`.
4. Copy the **Client ID** and **Client secret** — these become
   `SHOPIFY_API_KEY` and `SHOPIFY_API_SECRET`.
5. (Optional, for the Shopify App Store later) register the mandatory
   compliance webhooks in the app's **Webhooks** settings pointing at:
   - `/webhooks/customers/data_request`
   - `/webhooks/customers/redact`
   - `/webhooks/shop/redact`
   These are already implemented in `src/routes/webhooks.js`.

You don't need a Shopify Partner "app store listing" to use this on your
own stores — a manually-created app can be installed directly via the
`/auth` link with no review process.

## 2. Create a Postgres database

Shop access tokens and the cached product catalog are stored in Postgres so
they survive restarts and redeploys (a local file would get wiped every time
the host restarts the app). The easiest free option:

1. Go to [neon.com](https://neon.com) and create a free account (no credit
   card required) and a new project — Neon's free tier doesn't expire.
2. Copy the connection string it gives you (starts with `postgresql://...`)
   — this becomes `DATABASE_URL`.

The app creates its own `shops` table automatically on first start, so no
manual schema setup is needed.

⚠️ Two options that look convenient but **won't work** here:
- **Render's free Postgres** — it's deleted automatically after 30 days,
  so shop installs would silently break a month in.
- **Render's free Key Value (Redis) instance** — it's wiped on every
  restart, which defeats the entire point of moving off the local file.

Neon (or any persistent managed Postgres you pay for / keep alive) is the
right fit.

## 3. Get a Gemini API key

Go to [aistudio.google.com/apikey](https://aistudio.google.com/apikey) and
click **Create API key**. It's free, with no credit card required, and
comes with a generous free-tier quota — fine for testing and small-to-
medium traffic; keep an eye on usage if traffic grows.

## 4. Deploy the server (hosting)

You don't have a server yet, so the simplest path is **Render**
(free tier available, no credit card for the starter tier):

1. Push this folder to a GitHub repo (or use Render's "deploy from a
   public repo" / manual upload if you'd rather not use git yet).
2. In [Render](https://render.com) → **New** → **Web Service** → connect
   the repo.
3. Settings:
   - **Build command:** `npm install`
   - **Start command:** `npm start`
   - **Environment:** Node
4. Add environment variables (from `.env.example`):
   `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`, `SHOPIFY_SCOPES`, `HOST`
   (your Render URL, e.g. `https://shopify-ai-recommender.onrender.com`,
   no trailing slash), `DATABASE_URL` (your Neon connection string),
   `GEMINI_API_KEY`, `GEMINI_MODEL`.
5. Deploy. Once live, go back to the Partner Dashboard and make sure the
   **App URL** / **redirect URL** match your real Render URL exactly.

Railway or Fly.io work the same way if you'd rather use those instead.

⚠️ One thing to know about Render's free tier: it "spins down" after 15
minutes idle and takes ~30-60s to wake back up on the next request — the
first chat message after a quiet period will feel slow. Fine for testing;
upgrade to a paid instance (or use Railway) if that's a problem once real
customers use it.

### Local testing (optional, before deploying)

```bash
npm install
cp .env.example .env   # fill in the values
npm start
```

To test OAuth locally you need a public HTTPS URL (Shopify won't redirect
to `localhost`) — use a tunnel like `ngrok http 3000` and set `HOST` to the
ngrok URL while testing.

## 5. Install it on a store

Visit:

```
https://your-app-host/auth?shop=your-store.myshopify.com
```

(for Kiyowish, once its product catalog is populated:
`https://your-app-host/auth?shop=kiyowish.myshopify.com` — check the exact
`.myshopify.com` handle in Shopify admin under **Settings → Domains** if
you're not sure).

Approve the install. You'll land on a confirmation page, and the chat
bubble will appear on the storefront within a few seconds.

## Project layout

```
server.js                  Express app entrypoint
src/shopify.js             OAuth + Admin API helpers (hand-rolled, no SDK)
src/store.js               Per-shop token/catalog storage (Postgres)
src/routes/auth.js         /auth, /auth/callback (install flow)
src/routes/chat.js         /api/chat (the widget calls this)
src/routes/webhooks.js     Mandatory GDPR + app/uninstalled webhooks
src/services/products.js   Fetches + caches + shortlists the catalog
src/services/gemini.js     Prompts Gemini for recommendations
public/widget.js           The embeddable chat widget (vanilla JS)
```

## Known limitations / good next steps

- **Chat history is in-memory** and resets on server restart/redeploy.
- **Keyword shortlisting** (not semantic search) picks which ~40 products
  get shown to Gemini for very large catalogs. Works well for small-to-
  medium catalogs; for a store with thousands of SKUs, consider adding
  embeddings-based search (e.g. store product embeddings and do a vector
  similarity search instead of keyword matching).
- **No admin UI yet** — everything is configured via environment
  variables. A settings page (tone of voice, which collections to
  include/exclude, etc.) would be a natural next feature.
- Uses `ScriptTag` injection for simplicity. If you eventually submit this
  to the Shopify App Store, Shopify now prefers **Theme App Extensions**
  for storefront UI — the chat logic here would carry over unchanged, only
  the embedding mechanism would need converting.
