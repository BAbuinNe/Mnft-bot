-- Structure only. This file intentionally contains no records from mark.db.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY UNIQUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  referrer_id INTEGER DEFAULT NULL,
  referrals_count INTEGER DEFAULT 0,
  stars_balance INTEGER DEFAULT 0,
  spent INTEGER
);

CREATE TABLE IF NOT EXISTS backgrounds (
  id INTEGER PRIMARY KEY NOT NULL UNIQUE,
  back_0 TEXT NOT NULL,
  back_100 TEXT NOT NULL,
  name TEXT NOT NULL,
  rarity REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS levels (
  lvl INTEGER PRIMARY KEY UNIQUE,
  min INTEGER,
  max INTEGER,
  file_name TEXT
);

CREATE TABLE IF NOT EXISTS m_nft_collections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  image_file_id TEXT NOT NULL,
  total_supply INTEGER DEFAULT 1000,
  sold_count INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  price INTEGER,
  updateble INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS patterns (
  id INTEGER PRIMARY KEY NOT NULL,
  name INTEGER NOT NULL,
  rarity REAL NOT NULL,
  file_name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS m_nfts (
  id INTEGER PRIMARY KEY NOT NULL UNIQUE,
  collection_id INTEGER NOT NULL REFERENCES m_nft_collections(id),
  number INTEGER NOT NULL,
  owner_id INTEGER REFERENCES users(id),
  created_at NUM NOT NULL,
  model INTEGER,
  background INTEGER REFERENCES backgrounds(id),
  pattern INTEGER REFERENCES patterns(id),
  "update" INTEGER,
  dressed INTEGER,
  pinned INTEGER
);

CREATE TABLE IF NOT EXISTS m_nfts_on_sale (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nft_id INTEGER NOT NULL UNIQUE REFERENCES m_nfts(id),
  price INTEGER NOT NULL,
  seller_id INTEGER NOT NULL REFERENCES users(id),
  listed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS models (
  id INTEGER PRIMARY KEY NOT NULL,
  name INTEGER NOT NULL,
  file_name TEXT NOT NULL,
  rarity REAL NOT NULL,
  collection_id INTEGER
);

CREATE TABLE IF NOT EXISTS nft_transfers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  transfer_type TEXT NOT NULL,
  nft_id INTEGER NOT NULL REFERENCES m_nfts(id),
  amount REAL DEFAULT 0,
  from_user_id INTEGER NOT NULL REFERENCES users(id),
  to_user_id INTEGER NOT NULL REFERENCES users(id),
  timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS pens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  file_name TEXT NOT NULL,
  rarity REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS transaction_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  type TEXT NOT NULL CHECK(type IN ('deposit', 'withdrawal')),
  amount INTEGER NOT NULL,
  status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'completed', 'failed', 'cancelled')),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMP,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS star_invoices (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  amount INTEGER NOT NULL CHECK(amount BETWEEN 5 AND 10000),
  status TEXT NOT NULL CHECK(status IN ('pending', 'checking', 'paid', 'failed')),
  expires_at INTEGER NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS star_payments (
  charge_id TEXT PRIMARY KEY,
  invoice_id TEXT NOT NULL UNIQUE REFERENCES star_invoices(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  amount INTEGER NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS star_refunds (
  charge_id TEXT PRIMARY KEY REFERENCES star_payments(charge_id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  amount INTEGER NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
