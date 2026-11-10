// Only the server may create invoices or credit Stars. Telegram's "paid" callback
// is a UI hint; the balance is read back after the webhook commits the payment.
window.processPayment = async function processPayment() {
    const webApp = window.Telegram?.WebApp;
    const amount = Number(document.getElementById('depositAmountInput')?.value);
    const button = document.getElementById('depositActionBtn');
    if (!webApp?.initData) return showError('Откройте Mini App через Telegram');
    if (!Number.isSafeInteger(amount) || amount < 5 || amount > 10000) {
        return showError('Введите сумму от 5 до 10000 ⭐');
    }
    if (button) button.disabled = true;
    const headers = { 'Content-Type': 'application/json', 'X-Telegram-Init-Data': webApp.initData };
    try {
        const response = await fetch('https://mnft-bot-backend.vercel.app/api/payments/invoice', {
            method: 'POST', headers, body: JSON.stringify({ amount })
        });
        const invoice = await response.json();
        if (!response.ok || !invoice.success) throw new Error(invoice.error || 'Не удалось создать счёт');
        webApp.openInvoice(invoice.invoiceUrl, async (status) => {
            if (button) button.disabled = false;
            if (status !== 'paid') {
                if (status === 'failed') showError('Платёж не завершён');
                return;
            }
            for (let attempt = 0; attempt < 8; attempt++) {
                await new Promise(resolve => setTimeout(resolve, 1500));
                try {
                    const balanceResponse = await fetch('https://mnft-bot-backend.vercel.app/api/payments/invoice/' + encodeURIComponent(invoice.invoiceId), {
                        headers: { 'X-Telegram-Init-Data': webApp.initData }
                    });
                    const balance = await balanceResponse.json();
                    if (balanceResponse.ok && balance.success && balance.status === 'paid') {
                        appState.starsBalance = balance.balance;
                        if (typeof updateStarsBalance === 'function') updateStarsBalance();
                        if (typeof updateBalanceModal === 'function') updateBalanceModal();
                        showSuccess('Баланс обновлён: ' + balance.balance + ' ⭐');
                        return;
                    }
                } catch (error) { console.error('Balance refresh failed:', error); }
            }
            showError('Платёж обрабатывается. Обновите баланс через несколько секунд.');
        });
    } catch (error) {
        showError(error.message || 'Ошибка оплаты');
        if (button) button.disabled = false;
    }
};
