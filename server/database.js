import { AsyncLocalStorage } from 'node:async_hooks';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const requestContext = new AsyncLocalStorage();

function normalizeArgs(args) {
    if (args.length === 1 && Array.isArray(args[0])) return args[0];
    if (args.length === 1 && args[0] && typeof args[0] === 'object') return args[0];
    return args;
}

export async function openDatabase() {
    const databaseUrl = process.env.TURSO_DATABASE_URL;
    const authToken = process.env.TURSO_AUTH_TOKEN;

    if (databaseUrl && authToken) {
        const { createClient } = await import('@libsql/client');
        const client = createClient({ url: databaseUrl, authToken });
        const schema = await readFile(path.join(here, 'schema.sql'), 'utf8');
        await client.executeMultiple(schema);

        const execute = async (sql, args = []) => {
            const transaction = requestContext.getStore()?.transaction;
            return transaction
                ? transaction.execute({ sql, args })
                : client.execute({ sql, args });
        };

        return {
            withContext(callback) {
                return requestContext.run({ transaction: null }, callback);
            },
            async all(sql, ...params) {
                const result = await execute(sql, normalizeArgs(params));
                return result.rows;
            },
            async get(sql, ...params) {
                const result = await execute(sql, normalizeArgs(params));
                return result.rows[0];
            },
            async run(sql, ...params) {
                const statement = String(sql).trim().replace(/;$/, '').toUpperCase();
                const store = requestContext.getStore();

                if (statement === 'BEGIN' || statement === 'BEGIN TRANSACTION') {
                    if (!store) throw new Error('Database transaction requires a request context');
                    if (store.transaction) throw new Error('Nested database transactions are not supported');
                    store.transaction = await client.transaction('write');
                    return { changes: 0 };
                }
                if (statement === 'COMMIT') {
                    if (!store?.transaction) throw new Error('No active database transaction');
                    const transaction = store.transaction;
                    store.transaction = null;
                    await transaction.commit();
                    return { changes: 0 };
                }
                if (statement === 'ROLLBACK') {
                    if (!store?.transaction) throw new Error('No active database transaction');
                    const transaction = store.transaction;
                    store.transaction = null;
                    await transaction.rollback();
                    return { changes: 0 };
                }

                const result = await execute(sql, normalizeArgs(params));
                return {
                    changes: Number(result.rowsAffected || 0),
                    lastID: Number(result.lastInsertRowid || 0)
                };
            },
            async close() {
                await client.close();
            }
        };
    }

    const [{ open }, sqlite3] = await Promise.all([
        import('sqlite'),
        import('sqlite3')
    ]);

    if (process.env.VERCEL) {
        console.warn('⚠️ TURSO is not configured; using a clean in-memory database. Data will not survive function restarts.');
        const database = await open({ filename: ':memory:', driver: sqlite3.default.Database });
        await database.exec(await readFile(path.join(here, 'schema.sql'), 'utf8'));
        return database;
    }

    return open({
        filename: path.resolve(here, '../db/mark.db'),
        driver: sqlite3.default.Database
    });
}
