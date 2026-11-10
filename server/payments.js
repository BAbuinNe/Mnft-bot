import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

const MAX_INIT_AGE = 3600;
const MAX_STARS = 10000;

export function verifyInitData(initData, botToken, now = Date.now()) {
    if (typeof initData !== 'string' || !initData || initData.length > 8192 || !botToken) return null;
    const params = new URLSearchParams(initData);
    const hash = params.get('hash');
    const authDate = Number(params.get('auth_date'));
    if (!hash || !/^[a-f0-9]{64}$/i.test(hash) || !Number.isSafeInteger(authDate) ||
        authDate > Math.floor(now / 1000) + 60 || authDate < Math.floor(now / 1000) - MAX_INIT_AGE) return null;
    params.delete('hash');
    const dataCheckString = [...params.entries()].sort(([a], [b]) => a.localeCompare(b))
        .map(([key, value]) => `${key}=${value}`).join('\n');
    const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
    const actual = createHmac('sha256', secret).update(dataCheckString).digest();
    if (!timingSafeEqual(actual, Buffer.from(hash, 'hex'))) return null;
    try {
        const user = JSON.parse(params.get('user') || 'null');
        return Number.isSafeInteger(user?.id) && user.id > 0 ? user.id : null;
    } catch { return null; }
}

export async function telegramMethod(botToken, method, body) {
    const response = await fetch(`https://api.telegram.org/bot${botToken}/${method}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body), signal: AbortSignal.timeout(8000)
    });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(`Telegram ${method} failed: ${result.description || response.status}`);
    return result.result;
}

export function createPayments({ db, botToken }) {
    async function createInvoice(userId, amount) {
        if (!Number.isSafeInteger(amount) || amount < 5 || amount > MAX_STARS) {
            throw new RangeError('Amount must be from 5 to 10000 Stars');
        }
        const id = randomUUID();
        await db.run('INSERT OR IGNORE INTO users (id, stars_balance) VALUES (?, 0)', [userId]);
        await db.run('INSERT INTO star_invoices (id, user_id, amount, status, expires_at) VALUES (?, ?, ?, ?, ?)',
            [id, userId, amount, 'pending', Math.floor(Date.now() / 1000) + 900]);
        try {
            const invoiceUrl = await telegramMethod(botToken, 'createInvoiceLink', {
                title: 'M-NFT Stars', description: `Пополнение баланса на ${amount} ⭐`,
                payload: id, currency: 'XTR', prices: [{ label: `${amount} Stars`, amount }]
            });
            return { invoiceUrl, invoiceId: id };
        } catch (error) {
            await db.run('UPDATE star_invoices SET status = ? WHERE id = ?', ['failed', id]);
            throw error;
        }
    }

    async function answerPreCheckout(query) {
        const invoice = await db.get('SELECT * FROM star_invoices WHERE id = ?', [query.invoice_payload]);
        let valid = invoice?.status === 'pending' && Number(invoice.user_id) === Number(query.from?.id) &&
            query.currency === 'XTR' && Number(invoice.amount) === Number(query.total_amount) &&
            Number(invoice.expires_at) >= Math.floor(Date.now() / 1000);
        if (valid) {
            const reserved = await db.run("UPDATE star_invoices SET status = 'checking' WHERE id = ? AND status = 'pending'",
                [invoice.id]);
            valid = reserved.changes === 1;
        }
        await telegramMethod(botToken, 'answerPreCheckoutQuery', {
            pre_checkout_query_id: query.id, ok: Boolean(valid),
            ...(!valid ? { error_message: 'Счёт недействителен. Создайте новый счёт в Mini App.' } : {})
        });
        return valid;
    }

    async function creditPayment(message) {
        const payment = message.successful_payment;
        const userId = Number(message.from?.id);
        const chargeId = payment?.telegram_payment_charge_id;
        if (!Number.isSafeInteger(userId) || !chargeId) throw new Error('Incomplete payment update');
        const perform = async () => {
            await db.run('BEGIN TRANSACTION');
            try {
                const invoice = await db.get('SELECT * FROM star_invoices WHERE id = ?', [payment.invoice_payload]);
                if (!invoice || Number(invoice.user_id) !== userId || payment.currency !== 'XTR' ||
                    Number(invoice.amount) !== Number(payment.total_amount)) throw new Error('Payment does not match invoice');
                const existing = await db.get('SELECT charge_id FROM star_payments WHERE charge_id = ?', [chargeId]);
                if (existing) { await db.run('COMMIT'); return { alreadyCredited: true }; }
                if (invoice.status !== 'checking') throw new Error('Invoice is not payable');
                await db.run('INSERT INTO star_payments (charge_id, invoice_id, user_id, amount) VALUES (?, ?, ?, ?)',
                    [chargeId, invoice.id, userId, invoice.amount]);
                const updated = await db.run('UPDATE users SET stars_balance = stars_balance + ? WHERE id = ?', [invoice.amount, userId]);
                if (updated.changes !== 1) throw new Error('User balance update failed');
                await db.run('UPDATE star_invoices SET status = ? WHERE id = ?', ['paid', invoice.id]);
                await db.run('INSERT INTO transaction_history (user_id, type, amount, status, completed_at, notes) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, ?)',
                    [userId, 'deposit', invoice.amount, 'completed', `Telegram Stars invoice ${invoice.id}`]);
                await db.run('COMMIT');
                return { alreadyCredited: false };
            } catch (error) { await db.run('ROLLBACK'); throw error; }
        };
        return db.withContext ? db.withContext(perform) : perform();
    }

    async function recordRefund(message) {
        const refund = message.refunded_payment;
        const userId = Number(message.from?.id);
        const chargeId = refund?.telegram_payment_charge_id;
        if (!Number.isSafeInteger(userId) || !chargeId) throw new Error('Incomplete refund update');
        const perform = async () => {
            await db.run('BEGIN TRANSACTION');
            try {
                const payment = await db.get('SELECT * FROM star_payments WHERE charge_id = ?', [chargeId]);
                if (!payment || Number(payment.user_id) !== userId || refund.currency !== 'XTR' ||
                    Number(payment.amount) !== Number(refund.total_amount) ||
                    payment.invoice_id !== refund.invoice_payload) throw new Error('Refund does not match payment');
                const existing = await db.get('SELECT charge_id FROM star_refunds WHERE charge_id = ?', [chargeId]);
                if (existing) { await db.run('COMMIT'); return { alreadyRecorded: true }; }
                await db.run('INSERT INTO star_refunds (charge_id, user_id, amount) VALUES (?, ?, ?)',
                    [chargeId, userId, payment.amount]);
                const updated = await db.run('UPDATE users SET stars_balance = stars_balance - ? WHERE id = ?',
                    [payment.amount, userId]);
                if (updated.changes !== 1) throw new Error('User balance update failed');
                await db.run('INSERT INTO transaction_history (user_id, type, amount, status, completed_at, notes) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, ?)',
                    [userId, 'withdrawal', payment.amount, 'completed', `Telegram Stars refund ${chargeId}`]);
                await db.run('COMMIT');
                return { alreadyRecorded: false };
            } catch (error) { await db.run('ROLLBACK'); throw error; }
        };
        return db.withContext ? db.withContext(perform) : perform();
    }

    return { createInvoice, answerPreCheckout, creditPayment, recordRefund };
}
