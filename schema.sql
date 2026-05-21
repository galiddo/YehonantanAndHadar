CREATE TABLE IF NOT EXISTS bus_signups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  passengers INTEGER NOT NULL,
  pickup TEXT,
  notes TEXT,
  ip TEXT,
  user_agent TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_bus_signups_created_at ON bus_signups(created_at DESC);
