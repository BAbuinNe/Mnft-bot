import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { PurchaseService } from './purchases.js';

function fixture() {
    const sqlite = new DatabaseSync(':memory:');
    sqlite.exec(readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'));
    sqlite.exec(`INSERT INTO users (id, stars_balance) VALUES (42, 20), (43, 0);
      INSERT INTO m_nft_collections (id, name, image_file_id, price, total_supply, sold_count)
      VALUES (1, 'Test', 'test.png', 5, 2, 1);
      INSERT INTO m_nfts (id, collection_id, number, owner_id, created_at) VALUES (1, 1, 1, 43, 1);
      INSERT INTO m_nfts_on_sale (nft_id, price, seller_id) VALUES (1, 7, 43);`);
    const bind = p => p.length === 1 && Array.isArray(p[0]) ? p[0] : p;
    return { db: {
        get: async (sql, ...p) => sqlite.prepare(sql).get(...bind(p)),
        run: async (sql, ...p) => {
            if (/^(BEGIN|COMMIT|ROLLBACK)/.test(sql)) { sqlite.exec(sql); return { changes: 0 }; }
            const result = sqlite.prepare(sql).run(...bind(p));
            return { changes: Number(result.changes) };
        },
        withContext: fn => fn()
    }, close: () => sqlite.close() };
}

test('market purchase uses stored price and moves NFT once', async () => {
    const { db, close } = fixture();
    try {
        const purchases = new PurchaseService(db);
        const result = await purchases.buyMarket(1, 42);
        assert.equal(result.price, 7);
        assert.equal(result.newBalance, 13);
        assert.equal((await db.get('SELECT owner_id FROM m_nfts WHERE id = 1')).owner_id, 42);
        assert.equal((await db.get('SELECT stars_balance FROM users WHERE id = 43')).stars_balance, 6);
        await assert.rejects(purchases.buyMarket(1, 42));
        assert.equal((await db.get('SELECT stars_balance FROM users WHERE id = 42')).stars_balance, 13);
    } finally { close(); }
});

test('collection purchase respects stock and balance atomically', async () => {
    const { db, close } = fixture();
    try {
        const purchases = new PurchaseService(db);
        const result = await purchases.buyCollection(1, 42);
        assert.equal(result.price, 5);
        assert.equal(result.newBalance, 15);
        assert.equal((await db.get('SELECT sold_count FROM m_nft_collections WHERE id = 1')).sold_count, 2);
        assert.equal((await db.get('SELECT owner_id FROM m_nfts WHERE id = ?', [result.nftId])).owner_id, 42);
        await assert.rejects(purchases.buyCollection(1, 42));
        assert.equal((await db.get('SELECT stars_balance FROM users WHERE id = 42')).stars_balance, 15);
    } finally { close(); }
});
