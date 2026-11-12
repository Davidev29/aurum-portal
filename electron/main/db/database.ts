import BetterSqlite3 from 'better-sqlite3'
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import * as schema from './schema'
import { MIGRATIONS } from './migrations'

export type AppDatabase = BetterSQLite3Database<typeof schema>

export interface DatabaseContext {
  sqlite: BetterSqlite3.Database
  db: AppDatabase
  path: string
  close: () => void
}

export function createDatabase(filename: string): DatabaseContext {
  if (filename !== ':memory:') {
    mkdirSync(path.dirname(filename), { recursive: true })
  }
  const sqlite = new BetterSqlite3(filename)
  if (filename !== ':memory:') {
    sqlite.pragma('journal_mode = WAL')
  }
  sqlite.pragma('foreign_keys = ON')
  sqlite.pragma('busy_timeout = 5000')
  sqlite.pragma('synchronous = NORMAL')

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `)

  const applyMigration = sqlite.transaction((migration: (typeof MIGRATIONS)[number]) => {
    sqlite.exec(migration.sql)
    sqlite
      .prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)')
      .run(migration.version, migration.name, new Date().toISOString())
  })

  for (const migration of MIGRATIONS) {
    const applied = sqlite
      .prepare('SELECT 1 FROM schema_migrations WHERE version = ?')
      .get(migration.version)
    if (!applied) applyMigration(migration)
  }

  const db = drizzle(sqlite, { schema })
  return {
    sqlite,
    db,
    path: filename,
    close: () => {
      if (sqlite.open) sqlite.close()
    },
  }
}
