const AppConfig = {
    // Username вашего бота
    BOT_USERNAME: 'm_nft_bot', // ← Меняйте только здесь

    STAR_PRICE_USD: 0.015,
    TON_PRICE_USD: 2.00,
    
    // Другие настройки при необходимости
    APP_NAME: 'm-nft',
    REFERRAL_PERCENTAGE: 20, 
    
    // URL (автоматически генерируются на основе BOT_USERNAME)
    get BOT_URL() {
        return `https://t.me/${this.BOT_USERNAME}`;
    },
    
    get START_URL() {
        return `${this.BOT_URL}/market?startapp=`;
    }
};
const TransactionTypes = {
    DEPOSIT: 'deposit',
    WITHDRAWAL: 'withdrawal',
    NFT_SALE: 'nft_sale',        // Упрощаем: объединяем продажу и покупку
    NFT_PURCHASE: 'nft_purchase'
};

const TransactionTypeLabels = {
    [TransactionTypes.DEPOSIT]: 'Пополнение',
    [TransactionTypes.WITHDRAWAL]: 'Вывод',
    [TransactionTypes.NFT_SALE]: 'Продажа NFT',
    [TransactionTypes.NFT_PURCHASE]: 'Покупка NFT'
};

window.TransactionTypes = TransactionTypes;
window.TransactionTypeLabels = TransactionTypeLabels;

window.AppConfig = AppConfig;