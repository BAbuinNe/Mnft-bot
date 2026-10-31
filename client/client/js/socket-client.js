let socket = null;

function initSocket(userData = {}) {
    const tg = window.Telegram?.WebApp;
    const user = tg?.initDataUnsafe?.user;
    
    // Используем переданные данные или берем из глобального объекта
    const queryData = {
        userId: userData.userId || user?.id,
        username: userData.username || user?.username || '',
        firstName: userData.firstName || user?.first_name || '',
        lastName: userData.lastName || user?.last_name || ''
    };
    
    socket = io('https://fternstars.ru', {
        transports: ['websocket', 'polling'],
        query: queryData // Передаем данные в query параметрах
    });

    socket.on('connect', () => {
        console.log('✅ Connected to server');
        
        // Получаем user из Telegram WebApp
        const tg = window.Telegram?.WebApp;
        const user = tg?.initDataUnsafe?.user;
        
        if (user?.id) {            
            const referrerId = tg.initDataUnsafe?.start_param;
            
            socket.emit('register_user', { 
                userId: user.id,
                referrerId: referrerId
            });
            
            socket.on('user_registered', async (data) => {
                if (data.success) {
                    console.log(`✅ User registered successfully`);
                }
            });
            
            // Подписываемся на курс валюты
            socket.emit('subscribe_currency');
            socket.emit('get_currency_rate');
            if (user?.id) {
                setTimeout(() => {
                    socket.emit('get_transaction_history', { userId: user.id });
                }, 1000);
            }
        }
    });

    socket.on('inventory_updated', (data) => {
        const tg = window.Telegram?.WebApp;
        const user = tg?.initDataUnsafe?.user;
        
        if (user?.id && user.id === data.userId && window.loadInventoryItems) {
            setTimeout(() => {
                console.log('🔄 Reloading inventory...');
                window.loadInventoryItems();
            }, 200);
        }
    });

    socket.on('user_registered', (data) => {
        if (data.success && window.appState) {
            window.appState.userData = data.user;

            // Добавляем путь к картинке уровня, если его нет
            if (window.appState.userData && !window.appState.userData.levelImage) {
                const level = window.appState.userData.level || 1;
                window.appState.userData.levelImage = `/m_nft_image/lvl/${level}.png`;
            }

            if (window.updateUI) window.updateUI();
            if (window.updateUserLevel) window.updateUserLevel();
        }
    });

    socket.on('transaction_history', (data) => {
        const profileHistoryList = document.getElementById('profileHistoryList');
        
        if (data.success && data.transactions) {
            if (profileHistoryList && window.displayProfileTransactionHistory) {
                window.displayProfileTransactionHistory(data.transactions);
            }
        } else if (profileHistoryList) {
            profileHistoryList.innerHTML = `
                <div class="empty-history">
                    <div class="empty-icon">📜</div>
                    <p>История транзакций пуста</p>
                    <p class="empty-hint">Здесь будут отображаться ваши операции</p>
                </div>
            `;
        }
    });

    socket.on('user_nfts', (data) => {
        if (data.success) {
            window.cachedUserNFTs = data.nfts;
            
            if (window.loadInventoryItems) {
                window.loadInventoryItems();
            }
        } else {
            console.error('❌ Ошибка загрузки NFT:', data.error);
        }
    });

    socket.on('nft_transfer_result', (data) => {        
        if (data.success) {
            if (window.appState && data.newBalance !== undefined) {
                window.appState.starsBalance = data.newBalance;
            }

            if (window.updateStarsBalance) {
                window.updateStarsBalance();
            }

            if (window.closeConfirmationModal) window.closeConfirmationModal();
            if (window.closeTransferModal) window.closeTransferModal();
            if (window.closeNFTModal) window.closeNFTModal();

            window.cachedUserNFTs = [];

            const tg = window.Telegram?.WebApp;
            const user = tg?.initDataUnsafe?.user;

            if (user?.id) {
                socket.emit('get_user_nfts', user.id);

                setTimeout(() => {
                    if (window.loadInventoryItems) {
                        console.log('🔄 Принудительное обновление инвентаря...');
                        window.loadInventoryItems();
                    }
                }, 500);
            }

        } else {
            console.error('❌ NFT transfer failed:', data.error);

            if (window.tg?.showPopup) {
                window.tg.showPopup({
                    title: 'Ошибка',
                    message: data.error || 'Не удалось передать NFT'
                });
            }
        }
    });

    socket.on('balance_updated', (data) => {
        const tg = window.Telegram?.WebApp;
        const user = tg?.initDataUnsafe?.user;
        
        if (user?.id && user.id == data.userId) {
            if (window.appState) {
                window.appState.starsBalance = data.newBalance;
            }

            if (window.updateStarsBalance) {
                window.updateStarsBalance();
            }

            if (window.updateBalanceModal) {
                window.updateBalanceModal();
            }
        }
    });

    socket.on('payment_successful', (data) => {
        const tg = window.Telegram?.WebApp;
        const user = tg?.initDataUnsafe?.user;

        if (user?.id && user.id == data.userId) {
            if (window.appState) {
                window.appState.starsBalance = data.newBalance;
            }

            if (window.updateStarsBalance) {
                window.updateStarsBalance();
            }

            if (window.showSuccess) {
                window.showSuccess(`Баланс пополнен на ${data.amount} ⭐!\nНовый баланс: ${data.newBalance} ⭐`);
            }

            if (window.vibrate) {
                window.vibrate([5, 3, 5, 3, 5]);
            }
        }
    });

    socket.on('global_sales_history', (data) => {
        window.globalSalesHistory = data.transfers || [];
        
        const historySection = document.getElementById('history');
        if (historySection && historySection.classList.contains('active')) {
            if (window.displayGlobalSalesHistory) {
                window.displayGlobalSalesHistory(window.globalSalesHistory);
            }
        }
    });
    
    socket.on('nft_purchased', (data) => {
        if (window.handlePurchaseResponse) {
            window.handlePurchaseResponse(data);
        }
    });

    // Обработчик покупки NFT на маркете
    socket.on('market_nft_purchased', (data) => {
        if (window.handlePurchaseResponse) {
            window.handlePurchaseResponse(data);
        }
    });
    
    socket.on('top_holders_data', (response) => {
        console.log('🏆 Получены данные топ холдеров:', response.cached ? '(из кэша)' : '(свежие)');
        if (typeof window.renderRating === 'function') {
            window.renderRating(response);
        }
    });
    
    socket.on('top_referrers_data', (response) => {
        console.log('👥 Получены данные топ рефералов:', response.cached ? '(из кэша)' : '(свежие)');
        if (typeof window.renderRating === 'function') {
            window.renderRating(response);
        }
    });

    // Обработчик подтверждения pre-checkout
    socket.on('pre_checkout_confirmed', (data) => {
        console.log('✅ Pre-checkout confirmed:', data);
        // Можно обновить UI или показать статус
    });

    socket.on('payment_invoice_created', (response) => {
        console.log('💳 Invoice created response:', response);
        // Этот обработчик используется в processPayment через socket.once
    });

    socket.on('disconnect', () => {
        console.log('❌ Disconnected from server');
    });

    socket.on('connect_error', (error) => {
        console.error('❌ Connection error:', error);
    });

    window.socket = socket;
}

function getSocket() {
    return socket;
}