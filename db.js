// Capa de datos: SQLite nativo de Node (node:sqlite). Todo el dinero se guarda en céntimos.
const { DatabaseSync } = require('node:sqlite');
const path = require('path');

const db = new DatabaseSync(process.env.DB_PATH || path.join(__dirname, 'taptap.db'));
db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  pass TEXT NOT NULL,
  name TEXT NOT NULL,
  handle TEXT UNIQUE NOT NULL,
  title TEXT DEFAULT '',
  bio TEXT DEFAULT '',
  color TEXT DEFAULT '#7c3aed',
  goal_cents INTEGER DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS venues (
  id INTEGER PRIMARY KEY,
  owner_id INTEGER NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  join_code TEXT UNIQUE NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS memberships (
  venue_id INTEGER NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (venue_id, user_id)
);
-- Una propina va a una persona (user_id) o al bote común de un local (venue_id).
CREATE TABLE IF NOT EXISTS tips (
  id INTEGER PRIMARY KEY,
  uid TEXT UNIQUE NOT NULL,
  user_id INTEGER REFERENCES users(id),
  venue_id INTEGER REFERENCES venues(id),
  amount_cents INTEGER NOT NULL,
  fee_cents INTEGER NOT NULL DEFAULT 0,
  covered_fee INTEGER NOT NULL DEFAULT 0,
  payer_name TEXT DEFAULT '',
  message TEXT DEFAULT '',
  rating INTEGER,
  status TEXT NOT NULL DEFAULT 'pending',
  provider TEXT NOT NULL DEFAULT 'demo',
  provider_ref TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  paid_at TEXT
);
-- Libro de movimientos: el saldo de cada persona es la suma de sus filas.
CREATE TABLE IF NOT EXISTS ledger (
  id INTEGER PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  venue_id INTEGER REFERENCES venues(id),
  amount_cents INTEGER NOT NULL,
  kind TEXT NOT NULL,           -- tip | pool_in | pool_out | pool_share | withdrawal
  ref TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS withdrawals (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  amount_cents INTEGER NOT NULL,
  iban TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'solicitado',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_tips_user ON tips(user_id, status);
CREATE INDEX IF NOT EXISTS idx_tips_venue ON tips(venue_id, status);
CREATE INDEX IF NOT EXISTS idx_ledger_user ON ledger(user_id);
CREATE INDEX IF NOT EXISTS idx_ledger_venue ON ledger(venue_id);
`);

function tx(fn) {
  db.exec('BEGIN IMMEDIATE');
  try { const r = fn(); db.exec('COMMIT'); return r; }
  catch (e) { db.exec('ROLLBACK'); throw e; }
}

const q = (sql) => db.prepare(sql);

module.exports = {
  db, tx,
  userBalance: (uid) => q('SELECT COALESCE(SUM(amount_cents),0) b FROM ledger WHERE user_id=?').get(uid).b,
  // Bote del local: entradas por propinas al local menos lo ya repartido.
  poolBalance: (vid) => q("SELECT COALESCE(SUM(amount_cents),0) b FROM ledger WHERE venue_id=? AND kind IN ('pool_in','pool_out')").get(vid).b,
  q,
};
