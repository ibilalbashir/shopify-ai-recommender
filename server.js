require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");

const REQUIRED_ENV = ["SHOPIFY_API_KEY", "SHOPIFY_API_SECRET", "HOST", "DATABASE_URL", "GEMINI_API_KEY"];
const missing = REQUIRED_ENV.filter((key) => !process.env[key]);
if (missing.length) {
  console.error(`Missing required environment variables: ${missing.join(", ")}`);
  console.error("Copy .env.example to .env and fill these in before starting the server.");
  process.exit(1);
}
if (!process.env.ADMIN_SECRET) {
  console.warn("ADMIN_SECRET not set — /admin/chats (view what customers ask the bot) is disabled until you set it.");
}

const authRoutes = require("./src/routes/auth");
const chatRoutes = require("./src/routes/chat");
const webhookRoutes = require("./src/routes/webhooks");
const adminRoutes = require("./src/routes/admin");

const app = express();
app.use(cors()); // widget runs on the merchant's storefront domain, chat API must accept cross-origin calls

app.get("/", (_req, res) => {
  res.send(
    '<p>Shopify AI Recommender is running.</p><p>Install on a store: <code>/auth?shop=your-store.myshopify.com</code></p>'
  );
});

app.use(authRoutes);
app.use(chatRoutes);
app.use(webhookRoutes);
app.use(adminRoutes);

// Serves public/widget.js at https://your-app-host/widget.js
app.use(express.static(path.join(__dirname, "public")));

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Shopify AI Recommender listening on port ${port}`);
});
