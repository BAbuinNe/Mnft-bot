let currentHistoryTab = 'inventory';

// Переключение между вкладками в профиле
function switchProfileTab(tab) {
    currentHistoryTab = tab;
    
    // Обновляем активные кнопки табов
    document.querySelectorAll('.tab-button').forEach(btn => {
        btn.classList.remove('active');
    });
    
    document.querySelectorAll('.profile-tab-content').forEach(content => {
        content.classList.remove('active');
    });
    
    // Активируем выбранную вкладку
    const tabButton = document.querySelector(`.tab-button[onclick*="${tab}"]`);
    if (tabButton) tabButton.classList.add('active');
    
    const content = document.getElementById(`${tab}Content`);
    if (content) content.classList.add('active');
    
    // Если переключаемся на историю - загружаем транзакции
    if (tab === 'history') {
        loadProfileHistory();
    }
    
    // Вибрация
    if (window.vibrate) {
        window.vibrate(1);
    }
}

function formatTransactionDate(dateString) {
    if (!dateString) return 'Дата неизвестна';
    
    try {
        const date = new Date(dateString);
        
        if (isNaN(date.getTime())) {
            return dateString;
        }
        
        // Форматируем дату: день.месяц.год
        return date.toLocaleDateString('ru-RU', {
            day: '2-digit',
            month: '2-digit', 
            year: 'numeric'
        });
        
    } catch (error) {
        console.error('Error formatting date:', error);
        return dateString;
    }
}

async function loadProfileHistory() {
    console.log('🔍 loadProfileHistory() called');
    try {
        const historyList = document.getElementById('profileHistoryList');
        if (!historyList) return;
        
        const tg = window.Telegram?.WebApp;
        const user = tg?.initDataUnsafe?.user;
        const userId = user?.id;
        console.log('🔍 User ID:', userId);
        
        if (!userId || !window.socket) {
            historyList.innerHTML = `
                <div class="empty-history">
                    <div class="empty-icon">🔒</div>
                    <p>Необходима авторизация</p>
                </div>
            `;
            return;
        }
        
        // Показываем загрузку
        historyList.innerHTML = `
            <div class="empty-history">
                <div class="empty-icon">⏳</div>
                <p>Загрузка истории...</p>
            </div>
        `;
        
        // Запрашиваем историю через socket
        window.socket.emit('get_transaction_history', { userId: userId });
        
        // Обработчик ответа
        window.socket.once('transaction_history', (data) => {
            if (data.success && data.transactions && data.transactions.length > 0) {
                displayProfileTransactionHistory(data.transactions);
            } else {
                historyList.innerHTML = `
                    <div class="empty-history">
                        <div class="empty-icon">📜</div>
                        <p>История транзакций пуста</p>
                        <p class="empty-hint">Здесь будут отображаться ваши операции</p>
                    </div>
                `;
            }
        });
        
    } catch (error) {
        console.error('❌ Error loading profile history:', error);
        const historyList = document.getElementById('profileHistoryList');
        if (historyList) {
            historyList.innerHTML = `
                <div class="empty-history">
                    <div class="empty-icon">⚠️</div>
                    <p>Ошибка загрузки</p>
                    <p class="empty-hint">Попробуйте еще раз</p>
                </div>
            `;
        }
    }
}

// Функция для отображения истории в профиле
function displayProfileTransactionHistory(transactions) {
    const historyList = document.getElementById('profileHistoryList');
    if (!historyList) return;
    
    const tg = window.Telegram?.WebApp?.initDataUnsafe?.user;
    const userId = tg?.id;
    
    // Карта эмодзи для разных типов операций
    const emojiMap = {
        'Пополнение': '💰',
        'Вывод': '💸',
        'Передача NFT': '🔄',
        'Покупка NFT': '🛒',
        'Продажа NFT': '💵',
        'Получение NFT': '📥'
    };
    
    historyList.innerHTML = transactions.map(transaction => {
        // Получаем ID пользователя из транзакции
        const isSender = transaction.fromUserId == userId;
        const isReceiver = transaction.toUserId == userId;
        
        let typeClass = '';
        let amountText = '';
        let transactionType = transaction.type;
        let notes = transaction.notes || '';
        
        // Определяем правильный тип операции и сумму
        if (transaction.type === 'Передача NFT') {
            if (isSender) {
                transactionType = 'Передача NFT';
                amountText = `-5 ⭐`;
                notes = `Передача NFT: ${transaction.collectionName || 'NFT'} #${transaction.nftNumber || '?'}`;
            } else if (isReceiver) {
                transactionType = 'Получение NFT';
                amountText = '';
                notes = `Получение NFT: ${transaction.collectionName || 'NFT'} #${transaction.nftNumber || '?'}`;
            }
        }
        else if (transaction.type === 'Покупка NFT') {
            typeClass = 'nft-purchase';
            amountText = `-${transaction.amount} ⭐`;
        } else if (transaction.type === 'Продажа NFT') {
            typeClass = 'nft-sale';
            amountText = `+${transaction.amount} ⭐`;
        } else if (transaction.type === 'Пополнение') {
            typeClass = 'deposit';
            amountText = `+${transaction.amount} ⭐`;
        } else if (transaction.type === 'Вывод') {
            typeClass = 'withdrawal';
            amountText = `-${transaction.amount} ⭐`;
        }
        
        // Определяем эмодзи
        let displayEmoji = emojiMap[transactionType] || '🎴';
        
        // Используем данные улучшенного NFT если они есть
        const isUpgradedNFT = transaction.update === 1;
        let displayContent = displayEmoji;
        
        if (isUpgradedNFT && transaction.modelData && transaction.modelData.file_name) {
            // Генерируем улучшенное изображение NFT как в инвентаре
            displayContent = generateUpgradedNFTImageForHistory(transaction);
        } else if (transaction.imageFileId) {
            // Базовое изображение NFT
            const imageUrl = `/m_nft_image/base/${transaction.imageFileId}`;
            displayContent = `<img src="${imageUrl}" alt="${notes}" 
                style="width: 100%; height: 100%; object-fit: contain; border-radius: 8px;">`;
        }
        
        return `
            <div class="history-item ${transaction.isTransfer ? 'transfer-item' : ''}">
                <div class="history-item-header">
                    <div class="history-icon" style="font-size: 1.7em; width: 55px; height: 55px; display: flex; align-items: center; justify-content: center;">
                        ${displayContent}
                    </div>
                    
                    <div class="history-item-info">
                        <span class="history-item-type ${typeClass}">
                            ${notes}
                        </span>
                    </div>
                    
                    ${amountText ? `
                        <span class="history-item-amount ${typeClass}">
                            ${amountText}
                        </span>
                    ` : ''}
                </div>
                
                <div class="history-item-details">
                    <span class="history-item-date">
                        ${formatTransactionDate(transaction.createdAt)}
                    </span>
                    <span class="history-item-status ${transaction.status?.toLowerCase() || 'completed'}">
                        ${transaction.status || 'Успешно'}
                    </span>
                </div>
            </div>
        `;
    }).join('');
}

// Инициализация истории при загрузке
function initProfileHistory() {
    // Подписываемся на событие загрузки истории транзакций
    if (window.socket) {
        window.socket.on('transaction_history', (data) => {
            console.log('📜 Received transaction history for profile:', data);
            
            if (data.success && data.transactions) {
                // Если активна вкладка истории в профиле - обновляем
                if (currentHistoryTab === 'history') {
                    displayProfileTransactionHistory(data.transactions);
                }
            }
        });
    }
}

// Экспорт функций в глобальную область видимости
window.switchProfileTab = switchProfileTab;
window.loadProfileHistory = loadProfileHistory;
window.displayProfileTransactionHistory = displayProfileTransactionHistory;
window.initProfileHistory = initProfileHistory;