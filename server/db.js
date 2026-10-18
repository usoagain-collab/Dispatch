import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS islands (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  code TEXT NOT NULL DEFAULT '',
  color TEXT NOT NULL DEFAULT '#2563eb',
  sort INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'dispatcher', 'viewer')),
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS user_islands (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  island_id INTEGER NOT NULL REFERENCES islands(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, island_id)
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS skills (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  category TEXT NOT NULL DEFAULT 'General'
);

CREATE TABLE IF NOT EXISTS technicians (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  home_island_id INTEGER NOT NULL REFERENCES islands(id),
  color TEXT NOT NULL DEFAULT '#0ea5e9',
  active INTEGER NOT NULL DEFAULT 1,
  notes TEXT NOT NULL DEFAULT ''
);

-- level: 1 = trainee, 2 = qualified, 3 = expert
CREATE TABLE IF NOT EXISTS technician_skills (
  technician_id INTEGER NOT NULL REFERENCES technicians(id) ON DELETE CASCADE,
  skill_id INTEGER NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
  level INTEGER NOT NULL DEFAULT 2 CHECK (level BETWEEN 1 AND 3),
  PRIMARY KEY (technician_id, skill_id)
);

-- kind = 'travel': tech works on island_id for the date range (inclusive).
-- kind = 'time_off': tech is unavailable for the date range; island_id is NULL.
CREATE TABLE IF NOT EXISTS travel (
  id INTEGER PRIMARY KEY,
  technician_id INTEGER NOT NULL REFERENCES technicians(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('travel', 'time_off')),
  island_id INTEGER REFERENCES islands(id),
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (end_date >= start_date),
  CHECK ((kind = 'travel') = (island_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS travel_tech_dates ON travel (technician_id, start_date, end_date);

CREATE TABLE IF NOT EXISTS jobs (
  id INTEGER PRIMARY KEY,
  island_id INTEGER NOT NULL REFERENCES islands(id),
  technician_id INTEGER REFERENCES technicians(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  customer_name TEXT NOT NULL DEFAULT '',
  customer_phone TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  job_type TEXT NOT NULL DEFAULT 'Service',
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'emergency')),
  status TEXT NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('unscheduled', 'scheduled', 'in_progress', 'completed', 'cancelled')),
  start_at TEXT,
  end_at TEXT,
  duration_minutes INTEGER NOT NULL DEFAULT 120,
  notes TEXT NOT NULL DEFAULT '',
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS jobs_island_start ON jobs (island_id, start_at);
CREATE INDEX IF NOT EXISTS jobs_tech_start ON jobs (technician_id, start_at);

CREATE TABLE IF NOT EXISTS job_skills (
  job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  skill_id INTEGER NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
  PRIMARY KEY (job_id, skill_id)
);
`;

export function openDb(file = process.env.DB_FILE || path.resolve('data/dispatch.db')) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  db.exec(SCHEMA);
  return db;
}

/** Run fn inside a transaction, rolling back if it throws. */
export function tx(db, fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
