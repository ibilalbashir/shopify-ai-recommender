// Very small file-based store for per-shop data (access tokens + a cached
// product catalog). This is intentionally simple so the app has zero
// external database to set up. It is fine for testing on a handful of
// stores. For production with many merchants, swap this for a real
// database (Postgres, SQLite, etc.) behind the same three functions.

const fs = require("fs");
const path = require("path");

const DB_FILE = path.join(__dirname, "..", "data", "shops.json");

function readAll() {
  try {
    const raw = fs.readFileSync(DB_FILE, "utf8");
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === "ENOENT") return {};
    throw err;
  }
}

function writeAll(data) {
  fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

function getShop(shop) {
  const all = readAll();
  return all[shop] || null;
}

function saveShop(shop, patch) {
  const all = readAll();
  all[shop] = { ...(all[shop] || {}), ...patch };
  writeAll(all);
  return all[shop];
}

function deleteShop(shop) {
  const all = readAll();
  delete all[shop];
  writeAll(all);
}

module.exports = { getShop, saveShop, deleteShop };
