// A minimal, password-protected page for reading through what customers
// actually ask the bot (and how it replied), so you can spot gaps and tune
// the prompt in src/services/gemini.js. Not a full admin UI — just a
// read-only log viewer, gated by a shared-secret query param.
const express = require("express");
const { getRecentMessages } = require("../store");

const router = express.Router();

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[c]));
}

router.get("/admin/chats", async (req, res) => {
  if (!process.env.ADMIN_SECRET) {
    return res.status(503).send("Set ADMIN_SECRET in your environment variables to enable this page.");
  }
  if (req.query.key !== process.env.ADMIN_SECRET) {
    return res.status(401).send("Missing or incorrect ?key=");
  }

  const shop = typeof req.query.shop === "string" && req.query.shop.trim() ? req.query.shop.trim() : null;
  const rows = await getRecentMessages({ shop, limit: 500 });

  // Rows arrive newest-first (for the LIMIT to make sense); group into
  // per-visitor conversations and put each conversation's own messages
  // back into chronological order.
  const conversations = new Map();
  for (const row of rows) {
    const key = `${row.shop}:${row.session_id}`;
    if (!conversations.has(key)) {
      conversations.set(key, { shop: row.shop, sessionId: row.session_id, messages: [] });
    }
    conversations.get(key).messages.unshift(row);
  }

  // Conversations themselves ordered by their most recent message, newest first.
  const convoList = [...conversations.values()].sort((a, b) => {
    const aLast = a.messages[a.messages.length - 1].created_at;
    const bLast = b.messages[b.messages.length - 1].created_at;
    return new Date(bLast) - new Date(aLast);
  });

  const body = convoList
    .map((c) => {
      const lastAt = c.messages[c.messages.length - 1].created_at;
      const messagesHtml = c.messages
        .map((m) => {
          const who = m.role === "user" ? "Customer" : "Bot";
          const productIds = Array.isArray(m.product_ids) ? m.product_ids : null;
          const products =
            productIds && productIds.length
              ? `<div class="products">recommended: ${productIds.map((id) => escapeHtml(id)).join(", ")}</div>`
              : "";
          return `<div class="msg ${escapeHtml(m.role)}"><b>${who}:</b> ${escapeHtml(m.message)}${products}</div>`;
        })
        .join("\n");
      return `<div class="convo"><div class="meta">${escapeHtml(c.shop)} — session ${escapeHtml(
        c.sessionId
      )} — last message ${escapeHtml(new Date(lastAt).toLocaleString())}</div>${messagesHtml}</div>`;
    })
    .join("\n<hr/>\n");

  res.send(`<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>Chat logs</title>
<style>
  body { font-family: -apple-system, Segoe UI, sans-serif; max-width: 800px; margin: 20px auto; padding: 0 16px; color: #222; }
  .convo { margin-bottom: 20px; }
  .meta { font-size: 12px; color: #888; margin-bottom: 6px; }
  .msg { margin: 4px 0; padding: 6px 10px; border-radius: 8px; white-space: pre-wrap; }
  .msg.user { background: #eef2ff; }
  .msg.assistant { background: #f3f4f6; }
  .products { font-size: 12px; color: #666; margin-top: 2px; }
  hr { border: none; border-top: 1px solid #eee; margin: 16px 0; }
  h1 { font-size: 18px; }
  .hint { font-size: 13px; color: #888; }
  code { background: #f3f4f6; padding: 1px 4px; border-radius: 4px; }
</style>
</head>
<body>
  <h1>Chat logs${shop ? ` — ${escapeHtml(shop)}` : ""}</h1>
  <p class="hint">Showing up to 500 most recent messages${
    shop ? "" : " across all shops"
  }. Add <code>&shop=your-store.myshopify.com</code> to the URL to filter to one store.</p>
  ${convoList.length ? body : "<p>No chats logged yet.</p>"}
</body>
</html>`);
});

module.exports = router;
