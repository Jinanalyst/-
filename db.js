'use strict';
// libSQL (SQLite 호환). 로컬은 file: 모드, 배포(Vercel)는 Turso 원격 모드.
const { createClient } = require('@libsql/client');

const url = process.env.TURSO_DATABASE_URL || 'file:jachwi.db';
const authToken = process.env.TURSO_AUTH_TOKEN;
const client = createClient(authToken ? { url, authToken } : { url });

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT UNIQUE NOT NULL,
    email         TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    nickname      TEXT NOT NULL,
    area          TEXT,
    created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );
  CREATE TABLE IF NOT EXISTS listings (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id      INTEGER NOT NULL,
    title        TEXT NOT NULL,
    category     TEXT NOT NULL,
    price        INTEGER NOT NULL DEFAULT 0,
    condition    TEXT,
    description  TEXT,
    status       TEXT NOT NULL DEFAULT '판매중',
    lat          REAL,
    lng          REAL,
    location_txt TEXT,
    views        INTEGER NOT NULL DEFAULT 0,
    created_at   TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );
  CREATE TABLE IF NOT EXISTS images (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    listing_id INTEGER NOT NULL,
    src        TEXT NOT NULL,
    kind       TEXT NOT NULL DEFAULT 'image'
  );
  CREATE TABLE IF NOT EXISTS comments (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    listing_id INTEGER NOT NULL,
    user_id    INTEGER NOT NULL,
    body       TEXT NOT NULL,
    parent_id  INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );
  CREATE TABLE IF NOT EXISTS favorites (
    user_id    INTEGER NOT NULL,
    listing_id INTEGER NOT NULL,
    PRIMARY KEY (user_id, listing_id)
  );
  CREATE TABLE IF NOT EXISTS messages (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    listing_id  INTEGER,
    sender_id   INTEGER NOT NULL,
    receiver_id INTEGER NOT NULL,
    body        TEXT NOT NULL,
    is_read     INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );
`;

// 스키마 준비 Promise (콜드 스타트마다 idempotent 하게 실행)
const ready = client.executeMultiple(SCHEMA);

async function get(sql, args = []) {
  const r = await client.execute({ sql, args });
  return r.rows[0];
}
async function all(sql, args = []) {
  const r = await client.execute({ sql, args });
  return r.rows;
}
async function run(sql, args = []) {
  const r = await client.execute({ sql, args });
  return {
    lastInsertRowid: r.lastInsertRowid != null ? Number(r.lastInsertRowid) : null,
    changes: r.rowsAffected
  };
}

module.exports = { client, ready, get, all, run };
