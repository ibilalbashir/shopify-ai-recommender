const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes("localhost")
    ? false
    : { rejectUnauthorized: false }, // required by Neon and most managed Postgres hosts
});

const ready = pool.query(`
  CREATE TABLE IF NOT EXISTS shops (
    shop TEXT PRIMARY KEY,
    data JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )
`);

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

module.exports = { getShop, saveShop, deleteShop };
