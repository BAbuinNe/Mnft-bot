import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { createPayments, verifyInitData } from './payments.js';

function database() {
    const sqlite = new DatabaseSync(':memory:');
    sqlite.exec(readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'));
    const bind = params => params.length === 1 && Array.isArray(params[0]) ? params[0] : params;
    return {
        get: async (sql, ...params) => sqlite.prepare(sql).get(...bind(params)),
        run: async (sql, ...params) => {
            if (/^(BEGIN|COMMIT|ROLLBACK)/.test(sql)) { sqlite.exec(sql); return { changes: 0 }; }
            const result = sqlite.prepare(sql).run(...bind(params));
            return { changes: Number(result.changes) };
        },
        withContext: callback => callback(),
        close: () => sqlite.close()
    };
}

test('initData requires a valid Telegram signature and recent timestamp', () => {
    const token = '123:secret';
    const authDate = Math.floor(Date.now() / 1000);
    const data = `auth_date=${authDate}&user=${encodeURIComponent(JSON.stringify({ id: 42 }))}`;
    const secret = createHmac('sha256', 'WebAppData').update(token).digest();
    const hash = createHmac('sha256', secret).update(`auth_date=${authDate}\nuser={"id":42}`).digest('hex');
    assert.equal(verifyInitData(`${data}&hash=${hash}`, token), 42);
    assert.equal(verifyInitData(`${data}&hash=${hash}`, 'wrong'), null);
    assert.equal(verifyInitData(`${data}&hash=${'0'.repeat(64)}`, token), null);
});

test('Stars credit only once after matching successful_payment', async () => {
    const db = database();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (_url, options) => {
        const method = JSON.parse(options.body).pre_checkout_query_id ? true : false;
        return { ok: true, json: async () => ({ ok: true, result: method || 'https://t.me/invoice/example' }) };
    };
    try {
        const payments = createPayments({ db, botToken: '123:secret' });
        const invoice = await payments.createInvoice(42, 7);
        assert.equal(invoice.invoiceUrl, 'https://t.me/invoice/example');
        assert.equal(await payments.answerPreCheckout({ id: 'q1', from: { id: 42 }, currency: 'XTR', total_amount: 7, invoice_payload: invoice.invoiceId }), true);
        assert.equal(await payments.answerPreCheckout({ id: 'q1b', from: { id: 42 }, currency: 'XTR', total_amount: 7, invoice_payload: invoice.invoiceId }), false);
        assert.equal(await payments.answerPreCheckout({ id: 'q2', from: { id: 99 }, currency: 'XTR', total_amount: 7, invoice_payload: invoice.invoiceId }), false);
        const message = { from: { id: 42 }, successful_payment: {
            invoice_payload: invoice.invoiceId, currency: 'XTR', total_amount: 7,
            telegram_payment_charge_id: 'charge-1'
        } };
        await assert.rejects(payments.creditPayment({ ...message, successful_payment: { ...message.successful_payment, total_amount: 8 } }));
        assert.equal((await db.get('SELECT stars_balance FROM users WHERE id = 42')).stars_balance, 0);
        assert.deepEqual(await payments.creditPayment(message), { alreadyCredited: false });
        assert.deepEqual(await payments.creditPayment(message), { alreadyCredited: true });
        assert.equal((await db.get('SELECT stars_balance FROM users WHERE id = 42')).stars_balance, 7);
        assert.equal((await db.get('SELECT COUNT(*) AS n FROM transaction_history')).n, 1);
    } finally { globalThis.fetch = originalFetch; db.close(); }
});
