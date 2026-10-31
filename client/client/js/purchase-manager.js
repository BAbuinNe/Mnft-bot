// purchase-manager.js
class PurchaseManager {
    constructor() {
        this.currentPurchase = null;
        this.currentSource = null; // 'market', 'home', 'inventory'
    }

    /**
     * Показать модалку подтверждения покупки
     * @param {Object} nftData - Данные NFT
     * @param {string} source - Источник: 'market', 'home'
     */
    showConfirmation(nftData, source) {
        this.currentPurchase = nftData;
        this.currentSource = source;
        
        // Создаем модалку если ее нет
        this.createConfirmationModal();
        
        // Обновляем содержимое
        this.updateConfirmationContent();
        
        // Показываем модалку
        document.getElementById('purchaseConfirmationModal').classList.add('active');
        
        if (window.vibrate) window.vibrate(1);
    }

    createConfirmationModal() {
        if (document.getElementById('purchaseConfirmationModal')) return;
        
        const modal = document.createElement('div');
        modal.id = 'purchaseConfirmationModal';
        modal.className = 'confirmation-modal purchase-confirmation';
        modal.innerHTML = `
            <div class="confirmation-modal-overlay" onclick="window.purchaseManager.close()"></div>
            <div class="confirmation-modal-content">
                <!-- ОДНА строка с NFT -->
                <div class="purchase-nft-row">
                    <div class="purchase-nft-icon" id="purchaseNftIcon">🎴</div>
                    <div class="purchase-nft-info">
                        <div class="purchase-nft-name" id="purchaseNftName">NFT</div>
                    </div>
                    <div class="purchase-price-display">
                        <span class="purchase-price-value" id="purchasePriceValue">0</span>
                        <span style="color: #FFD700">⭐</span>
                    </div>
                </div>
                
                <!-- Баланс одной строкой -->
                <div class="purchase-balance-section">
                    Ваш баланс: <span class="purchase-balance-value" id="purchaseBalanceValue">0 ⭐</span>
                </div>
                
                <!-- Информация о типе покупки -->
                <div class="purchase-type-info" id="purchaseTypeInfo" style="font-size: 0.85em; color: var(--text-secondary); text-align: center; margin: 10px 0;"></div>
                
                <!-- Кнопки -->
                <div class="purchase-footer">
                    <button class="purchase-cancel-btn" onclick="window.purchaseManager.close()">
                        Отмена
                    </button>
                    <button class="purchase-confirm-btn" id="purchaseConfirmBtn" onclick="window.purchaseManager.confirm()">
                        Купить
                    </button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
    }

    updateConfirmationContent() {
        if (!this.currentPurchase) return;
        
        const nft = this.currentPurchase;
        const price = nft.price || 0;
        const userBalance = window.appState?.starsBalance || 0;
        const canBuy = userBalance >= price;
        
        // Проверяем, является ли изображение URL
        const isImageUrl = nft.image && 
            (nft.image.startsWith('http') || nft.image.startsWith('/'));
        
        // Обновляем элементы
        const nftIcon = document.getElementById('purchaseNftIcon');
        const nftNameEl = document.getElementById('purchaseNftName');
        const priceValue = document.getElementById('purchasePriceValue');
        const balanceValue = document.getElementById('purchaseBalanceValue');
        const confirmBtn = document.getElementById('purchaseConfirmBtn');
        const typeInfo = document.getElementById('purchaseTypeInfo');
        
        if (nftIcon && nft) {
            // Очищаем содержимое
            nftIcon.innerHTML = '';
            
            if (isImageUrl) {
                // Если это URL изображения
                const img = document.createElement('img');
                img.src = nft.image;
                img.alt = nft.fullName || nft.name || 'NFT';
                img.style.width = '100%';
                img.style.height = '100%';
                img.style.objectFit = 'contain';
                nftIcon.appendChild(img);
                nftIcon.style.background = 'transparent';
            } else {
                // Если это эмодзи
                nftIcon.textContent = nft.image || '🎴';
                const rarityColor = getRarityColor(nft.rarity);
                nftIcon.style.background = `${rarityColor}20`;
            }
        }
        
        if (nftNameEl) {
            nftNameEl.textContent = nft.fullName || nft.name || `NFT #${nft.number || nft.id}`;
            if (nft.rarity) {
                const rarityColor = getRarityColor(nft.rarity);
                nftNameEl.style.color = rarityColor;
            }
        }
        
        if (priceValue) {
            priceValue.textContent = price.toLocaleString();
        }
        
        if (balanceValue) {
            balanceValue.textContent = `${userBalance.toLocaleString()} ⭐`;
            balanceValue.style.color = canBuy ? 'var(--text-primary)' : 'var(--accent)';
        }
        
        if (typeInfo) {
            if (this.currentSource === 'market') {
                typeInfo.textContent = 'Покупка NFT на маркете';
            } else if (this.currentSource === 'home') {
                typeInfo.textContent = 'Покупка нового NFT из каталога';
            } else {
                typeInfo.textContent = '';
            }
        }
        
        if (confirmBtn) {
            confirmBtn.disabled = !canBuy;
            confirmBtn.textContent = canBuy ? 'Купить' : 'Недостаточно средств';
            confirmBtn.style.opacity = canBuy ? '1' : '0.5';
        }
    }

    confirm() {
        if (!this.currentPurchase || !this.currentSource) return;
        
        const price = this.currentPurchase.price || 0;
        const userBalance = window.appState?.starsBalance || 0;
        
        if (userBalance < price) {
            window.tg?.showPopup({
                title: 'Ошибка',
                message: `Недостаточно средств. Нужно ${price} ⭐, у вас ${userBalance} ⭐`
            });
            return;
        }
        
        // Показываем индикатор загрузки
        this.showLoading(true);
        
        // В зависимости от источника используем разную логику
        if (this.currentSource === 'market') {
            this.processMarketPurchase();
        } else if (this.currentSource === 'home') {
            this.processHomePurchase();
        }
    }

    processMarketPurchase() {
        const nft = this.currentPurchase;
        const price = nft.price || 0;
        const user = window.Telegram?.WebApp?.initDataUnsafe?.user;
        
        if (!user?.id) {
            this.showError('Пользователь не авторизован');
            return;
        }
        
        console.log(`🛒 Покупка NFT с маркета: #${nft.id} за ${price} ⭐`);
        
        // Используем существующий обработчик маркета
        if (window.socket && window.socket.connected) {
            window.socket.emit('buy_nft', {
                nftId: nft.id,
                userId: user.id,
                price: price
            });
            
            window.socket.once('buy_nft_result', (data) => {
                this.handlePurchaseResult(data);
            });
            
            // Таймаут на случай отсутствия ответа
            setTimeout(() => {
                if (!this.purchaseCompleted) {
                    this.showError('Таймаут запроса');
                }
            }, 10000);
        } else {
            this.showError('Нет соединения с сервером');
        }
    }

    processHomePurchase() {
        const nft = this.currentPurchase;
        const price = nft.price || 0;
        const user = window.Telegram?.WebApp?.initDataUnsafe?.user;
        
        if (!user?.id) {
            this.showError('Пользователь не авторизован');
            return;
        }
        
        console.log(`🛒 Покупка NFT с главной: #${nft.id} за ${price} ⭐`);
        
        // Используем обработчик для покупки доступных NFT
        if (window.socket && window.socket.connected) {
            window.socket.emit('buy_available_nft', {
                userId: user.id,
                nftId: nft.id,
                price: price
            });
            
            window.socket.once('nft_purchased', (data) => {
                this.handlePurchaseResult(data);
            });
            
            // Таймаут
            setTimeout(() => {
                if (!this.purchaseCompleted) {
                    this.showError('Таймаут запроса');
                }
            }, 10000);
        } else {
            this.showError('Нет соединения с сервером');
        }
    }

    handlePurchaseResult(data) {
        this.purchaseCompleted = true;
        this.showLoading(false);
        
        if (data.success) {
            // Обновляем баланс
            if (window.appState) {
                window.appState.starsBalance = data.newBalance;
            }
            
            if (window.updateStarsBalance) {
                window.updateStarsBalance();
            }
            
            // Показываем успех
            if (window.tg?.showPopup) {
                window.tg.showPopup({
                    title: 'Успешно!',
                    message: `NFT успешно куплен!\nНовый баланс: ${data.newBalance} ⭐`
                });
            }
            
            // Вибрация
            if (window.vibrate) window.vibrate([5, 3, 5, 3, 5]);
            
            // Закрываем модалку
            this.close();
            
            // Обновляем интерфейс в зависимости от источника
            setTimeout(() => {
                if (this.currentSource === 'market' && window.loadMarketItems) {
                    window.loadMarketItems();
                } else if (this.currentSource === 'home' && window.loadHomeGifts) {
                    window.loadHomeGifts();
                }
                
                // Всегда обновляем инвентарь
                if (window.loadInventoryItems) {
                    setTimeout(() => {
                        window.loadInventoryItems();
                    }, 1000);
                }
    
                if (window.refreshUserData) {
                    window.refreshUserData(); 
                }
            }, 500);
            
        } else {
            this.showError(data.error || 'Ошибка при покупке');
        }
    }

    showLoading(show) {
        const confirmBtn = document.getElementById('purchaseConfirmBtn');
        if (!confirmBtn) return;
        
        if (show) {
            confirmBtn.disabled = true;
            confirmBtn.innerHTML = '<div class="mini-spinner" style="width: 20px; height: 20px; margin: 0 auto;"></div>';
        } else {
            confirmBtn.disabled = false;
            confirmBtn.textContent = 'Купить';
        }
    }

    showError(message) {
        this.showLoading(false);
        
        if (window.tg?.showPopup) {
            window.tg.showPopup({
                title: 'Ошибка',
                message: message
            });
        }
    }

    close() {
        const modal = document.getElementById('purchaseConfirmationModal');
        if (modal) {
            modal.classList.remove('active');
        }
        
        this.currentPurchase = null;
        this.currentSource = null;
        this.purchaseCompleted = false;
        
        if (window.vibrate) window.vibrate(1);
    }
}

// Создаем глобальный экземпляр менеджера
window.purchaseManager = new PurchaseManager();