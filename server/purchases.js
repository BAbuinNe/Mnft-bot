export class PurchaseService {
    constructor(db) { this.db = db; }

    async transaction(callback) {
        const run = async () => {
            await this.db.run('BEGIN TRANSACTION');
            try {
                const result = await callback();
                await this.db.run('COMMIT');
                return result;
            } catch (error) {
                await this.db.run('ROLLBACK');
                throw error;
            }
        };
        return this.db.withContext ? this.db.withContext(run) : run();
    }

    async buyMarket(nftId, buyerId) {
        if (!Number.isSafeInteger(nftId) || nftId <= 0) throw new Error('Некорректный NFT');
        return this.transaction(async () => {
            const listing = await this.db.get(`
                SELECT s.price, s.seller_id, n.owner_id FROM m_nfts_on_sale s
                JOIN m_nfts n ON n.id = s.nft_id WHERE s.nft_id = ?`, [nftId]);
            const price = Number(listing?.price);
            if (!listing || !Number.isSafeInteger(price) || price <= 0 ||
                Number(listing.owner_id) !== Number(listing.seller_id) ||
                Number(listing.seller_id) === buyerId) throw new Error('NFT недоступен для покупки');
            const debit = await this.db.run(
                'UPDATE users SET stars_balance = stars_balance - ?, spent = COALESCE(spent, 0) + ? WHERE id = ? AND stars_balance >= ?',
                [price, price, buyerId, price]);
            if (debit.changes !== 1) throw new Error('Недостаточно звезд');
            const sellerAmount = Math.round(price / 1.1);
            const seller = await this.db.run('UPDATE users SET stars_balance = stars_balance + ? WHERE id = ?',
                [sellerAmount, listing.seller_id]);
            if (seller.changes !== 1) throw new Error('Продавец не найден');
            const moved = await this.db.run(
                'UPDATE m_nfts SET owner_id = ?, pinned = NULL, dressed = NULL WHERE id = ? AND owner_id = ?',
                [buyerId, nftId, listing.seller_id]);
            if (moved.changes !== 1) throw new Error('NFT уже продан');
            const removed = await this.db.run('DELETE FROM m_nfts_on_sale WHERE nft_id = ? AND seller_id = ?',
                [nftId, listing.seller_id]);
            if (removed.changes !== 1) throw new Error('Объявление изменилось');
            await this.db.run('INSERT INTO nft_transfers (transfer_type, nft_id, amount, from_user_id, to_user_id) VALUES (?, ?, ?, ?, ?)',
                ['purchase', nftId, price, listing.seller_id, buyerId]);
            const buyer = await this.db.get('SELECT stars_balance FROM users WHERE id = ?', [buyerId]);
            return { nftId, price, newBalance: Number(buyer.stars_balance) };
        });
    }

    async buyCollection(collectionId, buyerId) {
        if (!Number.isSafeInteger(collectionId) || collectionId <= 0) throw new Error('Некорректная коллекция');
        return this.transaction(async () => {
            const collection = await this.db.get('SELECT price, total_supply, sold_count FROM m_nft_collections WHERE id = ?', [collectionId]);
            const price = Number(collection?.price);
            if (!collection || !Number.isSafeInteger(price) || price <= 0) throw new Error('Коллекция недоступна');
            if (Number(collection.sold_count) >= Number(collection.total_supply)) throw new Error('Коллекция распродана');
            const debit = await this.db.run(
                'UPDATE users SET stars_balance = stars_balance - ?, spent = COALESCE(spent, 0) + ? WHERE id = ? AND stars_balance >= ?',
                [price, price, buyerId, price]);
            if (debit.changes !== 1) throw new Error('Недостаточно звезд');
            const stock = await this.db.run(
                'UPDATE m_nft_collections SET sold_count = sold_count + 1 WHERE id = ? AND sold_count < total_supply',
                [collectionId]);
            if (stock.changes !== 1) throw new Error('Коллекция распродана');
            const nextId = await this.db.get('SELECT COALESCE(MAX(id), 0) + 1 AS id FROM m_nfts');
            const number = Number(collection.sold_count) + 1;
            await this.db.run('INSERT INTO m_nfts (id, collection_id, number, owner_id, created_at) VALUES (?, ?, ?, ?, ?)',
                [Number(nextId.id), collectionId, number, buyerId, Math.floor(Date.now() / 1000)]);
            const buyer = await this.db.get('SELECT stars_balance FROM users WHERE id = ?', [buyerId]);
            return { nftId: Number(nextId.id), price, newBalance: Number(buyer.stars_balance) };
        });
    }
}
