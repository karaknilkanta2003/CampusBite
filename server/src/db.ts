import { DatabaseSync, type SQLInputValue, type StatementSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

export type Param = SQLInputValue;

let database: DatabaseSync | null = null;
const statements = new Map<string, StatementSync>();

/** Opens (or creates) the database and applies the schema. Pass ':memory:' in tests. */
export function openDb(file: string): DatabaseSync {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA busy_timeout = 5000;');
  const schema = fs.readFileSync(new URL('./schema.sql', import.meta.url), 'utf8');
  db.exec(schema);
  migrate(db);
  database = db;
  statements.clear();
  return db;
}

/** Adds columns introduced after a database was first created. */
function migrate(db: DatabaseSync): void {
  const has = (table: string, col: string) =>
    (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).some((c) => c.name === col);
  const add: [string, string, string][] = [
    ['canteens', 'kind', "TEXT NOT NULL DEFAULT 'canteen'"],
    ['canteens', 'lat', 'REAL'],
    ['canteens', 'lon', 'REAL'],
  ];
  for (const [table, col, ddl] of add) {
    if (!has(table, col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${ddl}`);
  }
}

export function db(): DatabaseSync {
  if (!database) throw new Error('Database not opened');
  return database;
}

function stmt(sql: string): StatementSync {
  let s = statements.get(sql);
  if (!s) {
    s = db().prepare(sql);
    statements.set(sql, s);
  }
  return s;
}

export function all<T>(sql: string, ...params: Param[]): T[] {
  return stmt(sql).all(...params) as T[];
}

export function get<T>(sql: string, ...params: Param[]): T | undefined {
  return stmt(sql).get(...params) as T | undefined;
}

export function run(sql: string, ...params: Param[]): { changes: number; id: number } {
  const r = stmt(sql).run(...params);
  return { changes: Number(r.changes), id: Number(r.lastInsertRowid) };
}

let depth = 0;
/** Runs fn inside one write transaction. Nested calls join the outer transaction. */
export function tx<T>(fn: () => T): T {
  if (depth > 0) return fn();
  db().exec('BEGIN IMMEDIATE');
  depth++;
  try {
    const result = fn();
    db().exec('COMMIT');
    return result;
  } catch (err) {
    db().exec('ROLLBACK');
    throw err;
  } finally {
    depth--;
  }
}
