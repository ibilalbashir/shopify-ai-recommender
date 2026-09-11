const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes("localhost")
    ? false
    : { rejectUnauthorized: false }, // required by Neon and most managed Postgres hosts
});

const ready = Promise.all([
  pool.query(`
    CREATE TABLE IF NOT EXISTS shops (
      shop TEXT PRIMARY KEY,
      data JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `),
  // Every chat turn (customer message + bot reply) gets a row here so you
  // can see what people actually ask the bot and how it responded, even
  // after a restart/redeploy wipes the in-memory conversation history.
  pool.query(`
    CREATE TABLE IF NOT EXISTS chat_messages (
      id SERIAL PRIMARY KEY,
      shop TEXT NOT NULL,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL,
      message TEXT NOT NULL,
      product_ids JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `),
  pool.query(`CREATE INDEX IF NOT EXISTS chat_messages_shop_created_idx ON chat_messages (shop, created_at DESC)`),
]);

async function getShop(shop) {
  await ready;
  const { rows } = await pool.query("SELECT data FROM shops WHERE shop = $1", [shop]);
  return rows[0] ? rows[0].data : null;
}

async function saveShop(shop, patch) {
  await ready;
  const existing = (await getShop(shop)) || {};
  const merged = { ...existing, ...patch };
  await pool.query(
    `INSERT INTO shops (shop, data, updated_at) VALUES ($1, $2, now())
     ON CONFLICT (shop) DO UPDATE SET data = $2, updated_at = now()`,
    [shop, merged]
  );
  return merged;
}

async function deleteShop(shop) {
  await ready;
  await pool.query("DELETE FROM shops WHERE shop = $1", [shop]);
}

// Best-effort: logging what customers ask should never break the chat
// itself, so failures here are swallowed (and noted in the server logs)
// rather than thrown.
async function logMessage({ shop, sessionId, role, message, productIds }) {
  try {
    await ready;
    await pool.query(
      `INSERT INTO chat_messages (shop, session_id, role, message, product_ids) VALUES ($1, $2, $3, $4, $5)`,
      [shop, sessionId || "anon", role, message, productIds ? JSON.stringify(productIds) : null]
    );
  } catch (err) {
    console.error("Failed to log chat message (non-fatal):", err);
  }
}

// Recent chat rows, optionally filtered to one shop, newest first. Used by
// the /admin/chats page so you can read through what people are asking the
// bot and how it's answering, to spot gaps and tune the prompt.
async function getRecentMessages({ shop, limit = 500 } = {}) {
  await ready;
  const { rows } = await pool.query(
    `SELECT shop, session_id, role, message, product_ids, created_at
     FROM chat_messages
     WHERE $1::text IS NULL OR shop = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [shop || null, limit]
  );
  return rows;
}

module.exports = { getShop, saveShop, deleteShop, logMessage, getRecentMessages };
