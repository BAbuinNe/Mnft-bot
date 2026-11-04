let tonConnectUI, walletInfo;
let walletBalance = 0;
const TON_WALLET_ADDRESS_CLASSIK = 'YOUR_TON_WALLET_ADDRESS'; // Замените на ваш адрес

async function initTonConnect() {
    try {
        // Инициализируем TON Connect UI в скрытом контейнере
        tonConnectUI = new TON_CONNECT_UI.TonConnectUI({
            manifestUrl: 'https://mnft-miniapp.vercel.app/tonconnect-manifest.json',
            buttonRootId: 'tonconnect-ui', // Используем скрытый контейнер
            actionsConfiguration: { twaReturnUrl: 'https://t.me/FternStarsBot/app' }
        });

        const connected = await tonConnectUI.connected;
        if (connected) {
            updateWalletUI(connected);
        }
        tonConnectUI.onStatusChange(wallet => updateWalletUI(wallet));

        // Инициализируем кастомную кнопку
        initCustomWalletButton();

        setInterval(() => {
            if (walletInfo) fetchWalletBalance(walletInfo);
        }, 30000);
    } catch (error) {
        console.error('TON Connect init error:', error);
        createFallbackButton();
    }
}

function initCustomWalletButton() {
    const customButtonContainer = document.getElementById('custom-wallet-button');
    if (!customButtonContainer) return;

    // Проверяем текущий статус подключения
    const connected = tonConnectUI.connected;
    
    if (connected) {
        // Если уже подключен, показываем информацию о кошельке
        updateWalletUI(connected);
    } else {
        // Если не подключен, показываем кнопку подключения
        customButtonContainer.innerHTML = `
            <button class="wallet-text-button" onclick="connectWallet()">
                <span class="wallet-icon">🔗</span>
                <span>Подключить кошелек</span>
            </button>
        `;
    }
}

async function connectWallet() {
    try {
        // Открываем модальное окно выбора кошелька
        await tonConnectUI.openModal();
    } catch (error) {
        console.error('Ошибка подключения кошелька:', error);
        showError('Не удалось подключить кошелек');
    }
}

function updateWalletUI(wallet) {
    const container = document.getElementById('custom-wallet-button');
    if (!container) return;
    
    if (wallet) {
        container.innerHTML = `<button onclick="disconnectWallet()" style="color:#00d4aa;border:none;background:none;cursor:pointer;">✅ Кошелек подключен</button>`;
    } else {
        container.innerHTML = `<button onclick="connectWallet()" style="color:#0088cc;border:none;background:none;cursor:pointer;">🔗 Подключить кошелек</button>`;
    }
}

async function disconnectWallet() {
    try {
        if (tonConnectUI) {
            await tonConnectUI.disconnect();
        }
    } catch (error) {
        console.error('Ошибка отключения кошелька:', error);
        showError('Не удалось отключить кошелек');
    }
}

async function fetchWalletBalance(wallet) {
    try {
        const walletBalanceElement = document.getElementById('walletBalance');
        if (!walletBalanceElement) return;
        
        walletBalanceElement.textContent = 'Загрузка...';
        const account = wallet.account;
        if (!account) {
            walletBalanceElement.textContent = 'Ошибка';
            return;
        }
        
        const response = await fetch(`https://tonapi.io/v2/accounts/${account.address}`);
        if (!response.ok) throw new Error('Ошибка получения баланса');
        
        const data = await response.json();
        const balanceNano = data.balance;
        walletBalance = balanceNano / 1000000000;
        walletBalanceElement.textContent = `${formatNumber(walletBalance)} TON`;
    } catch (error) {
        console.error('Error fetching wallet balance:', error);
        const walletBalanceElement = document.getElementById('walletBalance');
        if (walletBalanceElement) walletBalanceElement.textContent = 'Ошибка';
    }
}

function formatNumber(num) {
    if (typeof num !== 'number') num = parseFloat(num) || 0;
    const rounded = Math.round(num * 10000) / 10000;
    let formatted = rounded.toString();
    
    if (formatted.includes('.')) formatted = formatted.replace(/\.?0+$/, '');
    if (formatted.endsWith('.')) formatted = formatted.slice(0, -1);
    
    return formatted === '' ? '0' : formatted;
}

function showError(message) {
    const tg = window.Telegram?.WebApp;
    if (tg?.showPopup) {
        tg.showPopup({title: 'Ошибка', message: message});
    } else {
        alert(message);
    }
}

// Экспортируем функции в глобальную область видимости
window.connectWallet = connectWallet;
window.disconnectWallet = disconnectWallet;



