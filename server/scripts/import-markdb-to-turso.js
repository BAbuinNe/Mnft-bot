import path from 'node:path';
import { fileURLToPath } from 'node:url';
import 'dotenv/config';
import { open as openSqlite } from 'sqlite';
import sqlite3 from 'sqlite3';
import { createClient } from '@libsql/client';

const here = path.dirname(fileURLToPath(import.meta.url));
const serverDir = path.resolve(here, '..');
const sourcePath = path.join(serverDir, 'mark.db');
const schemaPath = path.join(serverDir, 'schema.sql');
const tables = [
  'users',
  'backgrounds',
  'levels',
  'm_nft_collections',
  'patterns',
  'models',
  'pens',
  'm_nfts',
  'm_nfts_on_sale',
  'nft_transfers',
  'transaction_history'
];

const { TURSO_DATABASE_URL: url, TURSO_AUTH_TOKEN: authToken } = process.env;
if (!url || !authToken) {
  throw new Error('Set TURSO_DATABASE_URL and TURSO_AUTH_TOKEN before importing.');
}

const source = await openSqlite({ filename: sourcePath, driver: sqlite3.Database });
const target = createClient({ url, authToken });
let transaction;

try {
  const schema = await (await import('node:fs/promises')).readFile(schemaPath, 'utf8');
  await target.executeMultiple(schema);

  const existingCounts = {};
  for (const table of tables) {
    const result = await target.execute(`SELECT COUNT(*) AS count FROM "${table}"`);
    existingCounts[table] = Number(result.rows[0].count);
  }
  const existingRows = Object.values(existingCounts).reduce((sum, count) => sum + count, 0);
  if (existingRows !== 0) {
    throw new Error(`Target database is not empty (${existingRows} existing rows). Import stopped without changing data.`);
  }

  transaction = await target.transaction('write');
  const imported = {};
  for (const table of tables) {
    const rows = await source.all(`SELECT * FROM "${table}"`);
    imported[table] = rows.length;
    if (!rows.length) continue;
    const columns = Object.keys(rows[0]);
    const sql = `INSERT INTO "${table}" (${columns.map((column) => `"${column}"`).join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`;
    for (const row of rows) {
      await transaction.execute({ sql, args: columns.map((column) => row[column]) });
    }
  }
  await transaction.commit();
  transaction = null;
  console.log(`Imported legacy database into private Turso: ${JSON.stringify(imported)}`);
} catch (error) {
  if (transaction) await transaction.rollback().catch(() => {});
  throw error;
} finally {
  await source.close();
  await target.close();
}

