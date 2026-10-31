// Конфигурация главной страницы
let homeConfig = {
    currentCategory: [], 
    currentRarity: [],   
    currentSort: 'newest',
    availableGifts: []
};
let homeFiltersSnapshot = null;

let homeLoadInProgress = false;
let homeRequestTimeout = null;
let lastHomeRequestTime = 0;
const HOME_REQUEST_DEBOUNCE_DELAY = 300;

// Функции для работы с фильтрами
function selectFilter(filterType) {
    console.log(`Выбран фильтр: ${filterType}`);
    openHomeFilterModal(filterType);
}

// Применить фильтр
function applyHomeFilter(filterType, filterId, filterName) {
    console.log(`Применение фильтра в главной: ${filterType} -> ${filterId}`);
    
    const checkbox = document.getElementById(`${filterType}_${filterId}`);
    if (!checkbox) return;
    
    let filterArray;
    switch(filterType) {
        case 'category': filterArray = homeConfig.currentCategory; break;
        case 'rarity': filterArray = homeConfig.currentRarity; break;
        default: return;
    }
    
    // ИСПРАВЛЕНИЕ: Преобразуем ID в строку для сравнения
    const filterIdStr = filterId.toString();
    
    if (checkbox.checked) {
        // Удаляем из массива, если уже выбран
        const index = filterArray.indexOf(filterIdStr);
        if (index > -1) {
            filterArray.splice(index, 1);
        }
        checkbox.checked = false;
    } else {
        // Добавляем в массив
        if (!filterArray.includes(filterIdStr)) {
            filterArray.push(filterIdStr);
        }
        checkbox.checked = true;
    }
    
    // Обновляем отображение
    updateHomeFilterDisplay();
    
    // ВАЖНО: НЕМЕДЛЕННО ПРИМЕНЯЕМ ФИЛЬТРЫ
    loadHomeGifts();
    
    // Вибрация
    if (window.vibrate) {
        window.vibrate([5, 3, 5]);
    }
}

// Обновление UI фильтров в модалке
function updateHomeFilterUI(filterType) {
    // Обновляем чекбоксы
    if (filterType === 'category') {
        homeConfig.currentCategory.forEach(categoryId => {
            const checkbox = document.getElementById(`category_${categoryId}`);
            if (checkbox) checkbox.checked = true;
        });
        
        // Снимаем чекбоксы с невыбранных
        ['all', 'cap', 'car', 'pencil', 'pepe'].forEach(categoryId => {
            if (!homeConfig.currentCategory.includes(categoryId)) {
                const checkbox = document.getElementById(`category_${categoryId}`);
                if (checkbox) checkbox.checked = false;
            }
        });
    } else if (filterType === 'rarity') {
        homeConfig.currentRarity.forEach(rarityId => {
            const checkbox = document.getElementById(`rarity_${rarityId}`);
            if (checkbox) checkbox.checked = true;
        });
        
        // Снимаем чекбоксы с невыбранных
        ['all', 'legendary', 'epic', 'rare', 'common'].forEach(rarityId => {
            if (!homeConfig.currentRarity.includes(rarityId)) {
                const checkbox = document.getElementById(`rarity_${rarityId}`);
                if (checkbox) checkbox.checked = false;
            }
        });
    }
}

// Функция для отмены фильтров в главной
function cancelHomeFilters() {
    // Восстанавливаем из снимка
    if (window.homeFiltersSnapshot) {
        homeConfig.currentCategory = [...window.homeFiltersSnapshot.currentCategory];
        homeConfig.currentRarity = [...window.homeFiltersSnapshot.currentRarity];
    }
    
    // Закрываем модалку
    const modal = document.getElementById('filterModal');
    if (modal) {
        modal.classList.remove('active');
    }
    
    // Вибрация
    if (window.vibrate) {
        window.vibrate(1);
    }
}

// Функция для очистки фильтров в главной
function clearHomeFilters() {
    console.log('📦 начало очистки');
    
    // Получаем тип фильтра из глобальной переменной
    const filterType = window.currentHomeFilterType;
    console.log('🎯 Тип фильтра из переменной:', filterType);
    
    if (!filterType) {
        console.log('⚠️ Тип фильтра не определен, очищаем все');
        // Очищаем все фильтры главной
        homeConfig.currentCategory = [];
        homeConfig.currentRarity = [];
        homeConfig.currentSort = 'newest';
    } else {
        // Очищаем только конкретный фильтр
        if (filterType === 'category') {
            console.log('🧹 Очищаем категории');
            homeConfig.currentCategory = [];
        } else if (filterType === 'rarity') {
            console.log('🧹 Очищаем редкость');
            homeConfig.currentRarity = [];
        } else if (filterType === 'sort') {
            console.log('🧹 Очищаем сортировку');
            homeConfig.currentSort = 'newest';
        }
    }
    
    // Сбрасываем все чекбоксы в текущей модалке
    console.log('✅ Сбрасываем чекбоксы');
    const allCheckboxes = document.querySelectorAll('#filterModal input[type="checkbox"]');
    allCheckboxes.forEach(cb => {
        cb.checked = false;
    });
    
    // Закрываем модалку
    const modal = document.getElementById('filterModal');
    if (modal) {
        modal.classList.remove('active');
    }
    
    // Обновляем UI и загружаем данные
    updateHomeFilterDisplay();
    loadHomeGifts();
    
    console.log('✅ Очистка завершена');
    
    // Вибрация
    if (window.vibrate) {
        window.vibrate([5, 3, 5]);
    }
}

// Функция для применения фильтров главной (после закрытия модалки)
function applyHomeFilters() {
    // Обновляем UI
    updateHomeFilterDisplay();
    
    // Загружаем подарки с примененными фильтрами
    loadHomeGifts();
    
    // Закрываем модалку
    const modal = document.getElementById('filterModal');
    if (modal) {
        modal.classList.remove('active');
    }
    
    // Сбрасываем снимок
    window.homeFiltersSnapshot = null;
    
    // Вибрация
    if (window.vibrate) {
        window.vibrate([3, 5, 3]);
    }
}

// Обновление отображения фильтров на главной
function updateHomeFilterDisplay() {
    const categoryElement = document.getElementById('selectedCategory');
    const rarityElement = document.getElementById('selectedRarity');
    const sortElement = document.getElementById('selectedSort');
    
    // Для категории - ВСЕГДА показываем "1 выбрано", "2 выбрано" и т.д.
    if (categoryElement) {
        if (homeConfig.currentCategory.length === 0) {
            categoryElement.textContent = 'Все';
        } else {
            // ИСПРАВЛЕНИЕ: Всегда показываем количество, даже если выбран 1 элемент
            categoryElement.textContent = `${homeConfig.currentCategory.length} выбрано`;
        }
        
        const categoryCard = document.querySelector('.filter-card[onclick*="category"]');
        if (categoryCard) {
            categoryCard.classList.toggle('active', homeConfig.currentCategory.length > 0);
        }
    }
    
    // Для редкости - ВСЕГДА показываем "1 выбрано", "2 выбрано" и т.д.
    if (rarityElement) {
        if (homeConfig.currentRarity.length === 0) {
            rarityElement.textContent = 'Любая';
        } else {
            // ИСПРАВЛЕНИЕ: Всегда показываем количество, даже если выбран 1 элемент
            rarityElement.textContent = `${homeConfig.currentRarity.length} выбрано`;
        }
        
        const rarityCard = document.querySelector('.filter-card[onclick*="rarity"]');
        if (rarityCard) {
            rarityCard.classList.toggle('active', homeConfig.currentRarity.length > 0);
        }
    }
    
    // Для сортировки - оставляем как есть (одиночный выбор, показываем название)
    if (sortElement) {
        const sortNames = {
            'newest': 'Новые',
            'oldest': 'Старые', 
            'price_low': 'Цена ↑',
            'price_high': 'Цена ↓',
            'rarity_high': 'Редкость ↓',
            'rarity_low': 'Редкость ↑',
            'collection': 'Коллекция'
        };
        sortElement.textContent = sortNames[homeConfig.currentSort] || 'Новые';
        
        const sortCard = document.querySelector('.filter-card[onclick*="sort"]');
        if (sortCard) {
            sortCard.classList.toggle('active', homeConfig.currentSort !== 'newest');
        }
    }
}

// Вспомогательные функции
function getCategoryNameById(id) {
    const categories = {
        'cap': 'Cap',
        'car': 'Car',
        'pencil': 'Pencil',
        'pepe': 'Pepe'
    };
    return categories[id] || id;
}

function getRarityNameById(id) {
    const rarities = {
        'legendary': 'Легендарные',
        'epic': 'Эпические',
        'rare': 'Редкие',
        'common': 'Обычные'
    };
    return rarities[id] || id;
}

// Загрузка подарков для главной страницы
async function loadHomeGifts() {
    if (homeLoadInProgress) {
        console.log('⏸️ Запрос уже выполняется, пропускаем');
        return;
    }
    
    if (homeRequestTimeout) {
        clearTimeout(homeRequestTimeout);
    }
    
    homeRequestTimeout = setTimeout(async () => {
        homeLoadInProgress = true;
        
        const giftsGrid = document.getElementById('homeGiftsGrid');
        if (!giftsGrid) {
            homeLoadInProgress = false;
            return;
        }
        
        try {
            // Показываем загрузку
            giftsGrid.innerHTML = `
                <div class="empty-gifts">
                    <div class="loading-spinner"></div>
                    <p>Загрузка...</p>
                </div>
            `;
            
            // ИСПРАВЛЕНИЕ: Преобразуем ID в числа для сервера
            const categoryIds = homeConfig.currentCategory
                .map(id => parseInt(id))
                .filter(id => !isNaN(id));
            
            // Подготавливаем данные для запроса
            const filterData = {
                category: categoryIds.length > 0 ? categoryIds : undefined,
                rarity: homeConfig.currentRarity.length > 0 ? homeConfig.currentRarity : undefined,
                sort: homeConfig.currentSort || 'newest'
            };
            
            console.log('🔄 Запрос доступных NFT с фильтрами:', filterData);
            
            let nfts = [];
            
            // Используем socket для получения данных
            if (window.socket && window.socket.connected) {
                nfts = await new Promise((resolve) => {
                    window.socket.emit('get_available_nfts', filterData);
                    
                    window.socket.once('available_nfts_list', (data) => {
                        if (data.success) {
                            console.log(`✅ Загружено ${data.nfts.length} NFT для главной`);
                            resolve(data.nfts || []);
                        } else {
                            console.error('❌ Ошибка загрузки NFT:', data.error);
                            resolve([]);
                        }
                    });
                    
                    setTimeout(() => {
                        console.log('⏰ Таймаут загрузки NFT');
                        resolve([]);
                    }, 5000);
                });
            }
            
            // Отображаем NFT
            displayAvailableNFTs(nfts);
            
        } catch (error) {
            console.error('❌ Ошибка загрузки NFT:', error);
            giftsGrid.innerHTML = `
                <div class="empty-gifts">
                    <div class="empty-icon">⚠️</div>
                    <p>Ошибка загрузки</p>
                    <p class="empty-hint">${error.message || 'Попробуйте позже'}</p>
                </div>
            `;
        } finally {
            homeLoadInProgress = false;
            console.log('✅ Запрос loadHomeGifts завершен');
        }
    }, HOME_REQUEST_DEBOUNCE_DELAY);
}

// Получение доступных NFT для главной страницы
async function getAvailableNFTs() {
    try {
        if (window.socket && window.socket.connected) {
            return await new Promise((resolve) => {
                window.socket.emit('get_available_nfts', {
                    category: homeConfig.currentCategory !== 'all' ? homeConfig.currentCategory : undefined,
                    rarity: homeConfig.currentRarity !== 'all' ? homeConfig.currentRarity : undefined
                });
                
                window.socket.once('available_nfts_list', (data) => {
                    if (data.success) {
                        resolve(data.nfts || []);
                    } else {
                        console.error('❌ Ошибка загрузки доступных NFT:', data.error);
                        resolve([]);
                    }
                });
                
                setTimeout(() => resolve([]), 5000);
            });
        }
        return [];
    } catch (error) {
        console.error('❌ Ошибка получения доступных NFT:', error);
        return [];
    }
}

// Отображение доступных NFT на главной
function displayAvailableNFTs(nfts) {
    const giftsGrid = document.getElementById('homeGiftsGrid');
    if (!giftsGrid) return;
    
    if (!nfts || nfts.length === 0) {
        giftsGrid.innerHTML = `
            <div class="empty-gifts">
                <div class="empty-icon">🔍</div>
                <p>NFT не найдены</p>
                <p class="empty-hint">Попробуйте изменить фильтры</p>
            </div>
        `;
        return;
    }
    
    // Сохраняем NFT для быстрого доступа с правильными полями
    homeConfig.availableGifts = nfts.map(nft => ({
        id: nft.id || nft.collectionId,
        fullName: nft.fullName || nft.collectionName,
        image: nft.image || '🎴',
        rarity: nft.rarity || 'Обычный',
        price: nft.price || 0,
        // ВАЖНО: Берем дату создания коллекции из БД
        created_at: nft.created_at, // Поле из БД
        createdAt: nft.createdAt || nft.created_at, // Совместимость
        totalSupply: nft.totalSupply,
        number: nft.number || (nft.soldCount || 0) + 1,
        collectionId: nft.collectionId || nft.id,
        collectionName: nft.collectionName || nft.name,
        soldCount: nft.soldCount || nft.sold_count,
        available: nft.available || Math.max(0, (nft.totalSupply || 0) - (nft.soldCount || nft.sold_count || 0))
    }));
    
    // Отображаем карточки
    giftsGrid.innerHTML = homeConfig.availableGifts.map((nft, index) => {
        const rarityColor = getRarityColor(nft.rarity);
        const isSoldOut = nft.available === 0;
        const availableCount = nft.available || 0;
        const totalSupply = nft.totalSupply || '?';
        
        return `
            <div class="inventory-item" onclick="viewHomeGift(${nft.id})" 
                 style="animation-delay: ${index * 0.05}s; position: relative;">
                
                <!-- БЕЙДЖ РЕДКОСТИ - минимальный код -->
                <div class="nft-rarity-sticker ${nft.rarity === 'Легендарный' ? 'legendary' : 
                                                  nft.rarity === 'Эпический' ? 'epic' : 
                                                  nft.rarity === 'Редкий' ? 'rare' : 'common'}">
                    ${nft.rarity === 'Легендарный' ? 'Легенд.' : 
                      nft.rarity === 'Эпический' ? 'Эпич.' : 
                      nft.rarity === 'Редкий' ? 'Редкий' : 'Обыч.'}
                </div>
                
                <!-- ИНДИКАТОР КОЛИЧЕСТВА - НОВЫЙ ЭЛЕМЕНТ -->
                <div class="nft-supply-indicator">
                    <span>${availableCount}/${totalSupply}</span>
                </div>
                    
                <div class="inventory-item-image" style="background: ${rarityColor};">
                    <img src="${nft.image || '🎴'}" alt="${nft.fullName}" class="nft-image" 
                     style="width: 100%; height: 100%; object-fit: contain; font-size: 2em; text-align: center; line-height: 100px;">
                </div>
                <div class="inventory-item-info" style="background: linear-gradient(to top, rgba(0,0,0,0.4), transparent 30px), ${rarityColor};">
                    <h4 class="nft-name">${nft.fullName || 'NFT #' + (nft.number || '?')}</h4>
                    <div class='market-buy-button-container'> 
                        ${!isSoldOut ? `
                            <button class="market-buy-button" onclick="claimGift(${nft.id}, event)">
                                ${nft.price || 0} ⭐
                            </button>
                        ` : `
                            <button class="market-buy-button" disabled style="opacity: 0.5; cursor: not-allowed;">
                                🔥Sold Out🔥
                            </button>
                        `}
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

// Просмотр подарка
function viewHomeGift(giftId) {
    console.log('👀 Просмотр подарка в главной:', giftId);
    
    const clickedElement = event?.currentTarget;
    
    // Добавляем визуальный фидбек сразу при нажатии
    if (clickedElement) {
        clickedElement.style.transform = 'scale(0.97)';
        clickedElement.style.transition = 'transform 0.1s ease';
    }
    
    // Небольшая задержка перед открытием модалки
    setTimeout(() => {
        // Сбрасываем трансформацию элемента
        if (clickedElement) {
            clickedElement.style.transform = '';
        }
        
        const gift = homeConfig.availableGifts.find(g => g.id === giftId);
        if (!gift) return;
        
        console.log('👀 Просмотр подарка в главной:', gift);
        
        // ПОДГОТОВКА ДАННЫХ ДЛЯ МОДАЛКИ NFT - ИСПРАВЛЕННАЯ ВЕРСИЯ
        const nftData = {
            ...gift,
            id: gift.id, // ID коллекции
            fullName: gift.fullName || `NFT #${gift.number || '?'}`,
            image: gift.image || '🎴',
            rarity: gift.rarity || 'Обычный',
            // ВАЖНО: Берем дату создания КОЛЛЕКЦИИ из БД
            // created_at должен приходить с сервера из таблицы m_nft_collections
            createdAt: gift.created_at || gift.createdAt || gift.created_at,
            price: gift.price || 0,
            collectionPrice: gift.price || 0,
            totalSupply: gift.totalSupply || '?',
            number: gift.number || 0,
            // Статусы
            ownedByUser: false,
            forSale: false,
            // Коллекция
            collectionId: gift.collectionId || gift.id,
            collectionName: gift.collectionName || gift.name,
            // Добавляем для корректного отображения в модалке
            ownerId: 0 // Так как это еще не купленный NFT
        };
        
        console.log('📤 Данные для модалки из главной (с датой):', {
            ...nftData,
            createdAt: nftData.createdAt,
            created_at: nftData.created_at
        });
        
        if (window.updateNFTModal) {
            window.updateNFTModal(nftData);
            window.openNFTModal();
        } else {
            console.error('❌ Функции модального окна не найдены');
        }
        
        // Вибрация
        if (window.vibrate) window.vibrate([3, 5, 3]);
    }, 100);
}

// Получить подарок
function claimGift(nftId, event) {
    if (event) event.stopPropagation();
    
    // Находим NFT в доступных подарках
    const gift = homeConfig.availableGifts.find(g => g.id === nftId);
    if (!gift) {
        // Если не нашли в конфиге, пробуем найти в текущих данных
        const giftsGrid = document.getElementById('homeGiftsGrid');
        if (giftsGrid) {
            // Находим соответствующий элемент DOM
            const giftItems = giftsGrid.querySelectorAll('.gift-item');
            giftItems.forEach(item => {
                const buyButton = item.querySelector('.gift-action-button');
                if (buyButton && buyButton.textContent.includes('Купить за')) {
                    const giftElement = item;
                    const nftName = giftElement.querySelector('.gift-nft-name').textContent;
                    const priceText = buyButton.textContent.match(/(\d+)\s*⭐/);
                    const price = priceText ? parseInt(priceText[1]) : 0;
                    
                    if (giftElement.dataset.nftId == nftId || giftElement.getAttribute('onclick')?.includes(nftId)) {
                        gift = {
                            id: nftId,
                            fullName: nftName,
                            price: price,
                            image: giftElement.querySelector('.gift-nft-icon')?.textContent || '🎴',
                            rarity: 'Обычный' // по умолчанию
                        };
                    }
                }
            });
        }
    }
    
    if (!gift) return;
    
    // Используем универсальный менеджер покупок
    if (window.purchaseManager) {
        window.purchaseManager.showConfirmation(gift, 'home');
    } else {
        // Fallback на старую логику
        if (window.tg?.showPopup) {
            window.tg.showPopup({
                title: 'Покупка NFT',
                message: `Вы уверены что хотите купить ${gift.fullName} за ${gift.price || 0} ⭐?`,
                buttons: [
                    { id: 'cancel', type: 'cancel', text: 'Отмена' },
                    { id: 'buy', type: 'default', text: 'Купить' }
                ]
            }).then(buttonId => {
                if (buttonId === 'buy') {
                    processNFTBuy(nftId, gift.price);
                }
            });
        }
    }
}

// Обработка покупки NFT
function processNFTBuy(nftId, price) {
    const tg = window.Telegram?.WebApp;
    const user = tg?.initDataUnsafe?.user;
    
    if (!user?.id) {
        window.tg?.showPopup({
            title: 'Ошибка',
            message: 'Пользователь не авторизован'
        });
        return;
    }
    
    // Проверяем баланс
    if (window.appState.starsBalance < price) {
        window.tg?.showPopup({
            title: 'Ошибка',
            message: `Недостаточно средств. Нужно ${price} ⭐, у вас ${window.appState.starsBalance} ⭐`
        });
        return;
    }
    
    // Отправляем запрос на покупку
    if (window.socket && window.socket.connected) {
        window.socket.emit('buy_available_nft', {
            userId: user.id,
            nftId: nftId,
            price: price
        });
        
        window.socket.once('nft_purchased', (data) => {
            if (data.success) {
                // Обновляем баланс
                window.appState.starsBalance = data.newBalance;
                window.updateStarsBalance();
                
                window.tg?.showPopup({
                    title: 'Успех!',
                    message: `NFT успешно куплен!`
                });
                
                // Вибрация
                if (window.vibrate) window.vibrate([5, 3, 5, 3, 5]);
                
                // Обновляем список NFT
                setTimeout(() => {
                    loadHomeGifts();
                }, 1000);
                
            } else {
                window.tg?.showPopup({
                    title: 'Ошибка',
                    message: data.error || 'Не удалось купить NFT'
                });
            }
        });
    }
}

// Обработка получения подарка
function processGiftClaim(giftId) {
    const tg = window.Telegram?.WebApp;
    const user = tg?.initDataUnsafe?.user;
    
    if (!user?.id) {
        if (window.tg?.showPopup) {
            window.tg.showPopup({
                title: 'Ошибка',
                message: 'Пользователь не авторизован'
            });
        }
        return;
    }
    
    // Отправляем запрос на получение подарка
    if (window.socket && window.socket.connected) {
        window.socket.emit('claim_gift', {
            userId: user.id,
            giftId: giftId
        });
        
        window.socket.once('gift_claimed', (data) => {
            if (data.success) {
                // Показываем успех
                if (window.tg?.showPopup) {
                    window.tg.showPopup({
                        title: 'Успех!',
                        message: `Подарок успешно получен!`
                    });
                }
                
                // Вибрация
                if (window.vibrate) window.vibrate([5, 3, 5, 3, 5]);
                
                // Обновляем список подарков
                setTimeout(() => {
                    loadHomeGifts();
                }, 1000);
                
                // Обновляем инвентарь
                if (window.loadInventoryItems) {
                    setTimeout(() => {
                        window.loadInventoryItems();
                    }, 1500);
                }
                
            } else {
                if (window.tg?.showPopup) {
                    window.tg.showPopup({
                        title: 'Ошибка',
                        message: data.error || 'Не удалось получить подарок'
                    });
                }
            }
        });
    }
}


// Функция открытия модального окна фильтров для главной
function openHomeFilterModal(filterType) {
    const clickedElement = event?.currentTarget;
    
    if (clickedElement) {
        clickedElement.style.transform = 'scale(0.97)';
        clickedElement.style.transition = 'transform 0.1s ease';
    }
    
    setTimeout(() => {
        if (clickedElement) {
            clickedElement.style.transform = '';
        }
        
        window.currentHomeFilterType = filterType;
        
        window.homeFiltersSnapshot = {
            currentCategory: [...homeConfig.currentCategory],
            currentRarity: [...homeConfig.currentRarity]
        };
        
        window.currentFilterSection = 'home';
        
        window.openFilterModal(filterType);
    }, 100);
}

// Загрузка специфичного контента для главной
async function loadHomeSpecificFilterContent(filterType, modalBody) {
    let html = '';
    
    if (filterType === 'category') {
        html = await getHomeCategoryContent(); // Добавьте await
    } else if (filterType === 'rarity') {
        html = getHomeRarityContent();
    } else if (filterType === 'sort') {
        html = getHomeSortContent();
    }
    
    if (html) {
        modalBody.innerHTML = html;
    }
}

// Контент категорий для главной
async function getHomeCategoryContent() {
    try {
        const collections = await fetchCollectionsForHome();
        
        if (!collections || collections.length === 0) {
            return '<p style="color: var(--text-secondary); text-align: center; padding: px;">Коллекций не найдено</p>';
        }
        
        // Генерируем HTML с реальными данными из БД
        return collections.map(collection => {
            const collectionId = collection.id;
            // ИСПРАВЛЕНИЕ: Используем строковое представление ID
            const isSelected = homeConfig.currentCategory.includes(collectionId.toString());
            
            let imageHtml = '';
            if (collection.image_file_id) {
                imageHtml = `
                    <div class="filter-item-image">
                        <img src="/m_nft_image/base/${collection.image_file_id}" 
                             alt="${escapeHtml(collection.name)}" 
                             onerror="this.style.display='none'; this.parentNode.innerHTML='🎴';"
                             style="width: 35px; height: 35px; border-radius: 10px; object-fit: cover;">
                    </div>
                `;
            } else {
                imageHtml = `<span style="font-size: 1.2em; margin-right: 8px;">🎴</span>`;
            }
            
            const rarity = getRarityBySupply(collection.total_supply);
            const rarityColor = getRarityColor(rarity);
            
            // ИСПРАВЛЕНИЕ: Используем числовой ID (без преобразования в строку при вызове)
            return `
                <div class="filter-item" onclick="applyHomeFilter('category', '${collectionId}', '${escapeHtml(collection.name)}')">
                    <div class="filter-item-content">
                        <span class="filter-item-name">
                            ${imageHtml}
                            ${escapeHtml(collection.name)}
                            <span style="font-size: 0.8em; color: ${rarityColor}; margin-left: 6px; background: ${rarityColor}; padding: 2px 6px; border-radius: 8px;">
                                ${rarity}
                            </span>
                        </span>
                    </div>
                    <div class="filter-item-checkbox">
                        <input type="checkbox" id="category_${collectionId}" ${isSelected ? 'checked' : ''}>
                        <label for="category_${collectionId}"></label>
                    </div>
                </div>
            `;
        }).join('');
        
    } catch (error) {
        console.error('❌ Ошибка загрузки категорий для главной:', error);
        return '<p style="color: var(--text-secondary); text-align: center; padding: px;">Ошибка загрузки коллекций</p>';
    }
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Новая функция для получения коллекций (как в профиле)
async function fetchCollectionsForHome() {
    try {
        let collections = [];
        
        if (window.socket && window.socket.connected) {
            collections = await new Promise((resolve) => {
                window.socket.emit('get_collections');
                window.socket.once('collections_list', (data) => {
                    resolve(data.success ? data.collections : []);
                });
                
                // Таймаут
                setTimeout(() => resolve([]), 5000);
            });
        }
        
        // Возвращаем коллекции без учета userNFTCount (для главной не нужно)
        return collections.map(collection => ({
            ...collection,
            // Не добавляем userNFTCount для главной
            userNFTCount: 0
        }));
        
    } catch (error) {
        console.error('Error fetching collections for home:', error);
        return [];
    }
}

// Контент редкости для главной
function getHomeRarityContent() {
    const options = [
        { id: 'legendary', name: 'Легендарные', emoji: '' },
        { id: 'epic', name: 'Эпические', emoji: '' },
        { id: 'rare', name: 'Редкие', emoji: '' },
        { id: 'common', name: 'Обычные', emoji: '' }
    ];
    
    return `
        ${options.map(option => {
            const isSelected = homeConfig.currentRarity.includes(option.id);
            return `
                <div class="filter-item" onclick="applyHomeFilter('rarity', '${option.id}', '${option.name}')">
                    <div class="filter-item-content">
                        <span class="filter-item-name">
                            <span style="font-size: 1.2em; margin-right: 8px;">${option.emoji}</span>
                            ${option.name}
                        </span>
                    </div>
                    <div class="filter-item-checkbox">
                        <input type="checkbox" id="rarity_${option.id}" ${isSelected ? 'checked' : ''}>
                        <label for="rarity_${option.id}"></label>
                    </div>
                </div>
            `;
        }).join('')}
    `;
}

// Выбор элемента фильтра для главной
function selectHomeFilterItem(filterType, filterId, filterName) {
    const checkbox = document.getElementById(`${filterType}_${filterId}`);
    if (!checkbox) return;
    
    // Снимаем выделение со всех чекбоксов этого типа
    document.querySelectorAll(`input[id^="${filterType}_"]`).forEach(cb => {
        cb.checked = false;
    });
    
    // Устанавливаем новый фильтр
    if (filterType === 'category') {
        homeConfig.currentCategory = filterId;
        document.getElementById('selectedCategory').textContent = filterName;
    } else if (filterType === 'rarity') {
        homeConfig.currentRarity = filterId;
        document.getElementById('selectedRarity').textContent = filterName;
    }
    
    checkbox.checked = true;
    
    // Закрываем модалку и применяем фильтры
    setTimeout(() => {
        window.closeFilterModal();
        loadHomeGifts();
    }, 100);
    
    if (window.vibrate) {
        window.vibrate([5, 3, 5]);
    }
}

// Инициализация главной страницы
function initHome() {
    console.log('🏠 Инициализация главной страницы');
    homeLoadInProgress = false;
    updateHomeBalance();
    updateHomeFilterDisplay();
    setTimeout(() => {
        loadHomeGifts();
    }, 100);
    
    setupHomeListeners();
}

// Обновление баланса на главной странице
function updateHomeBalance() {
    const homeBalanceElement = document.getElementById('homeBalance');
    if (homeBalanceElement && window.appState) {
        homeBalanceElement.textContent = (window.appState.starsBalance || 0).toLocaleString();
    }
}

// Настройка обработчиков событий для главной страницы
function setupHomeListeners() {
    // Обновляем баланс при его изменении
    if (window.updateStarsBalance) {
        const originalUpdateStarsBalance = window.updateStarsBalance;
        window.updateStarsBalance = function() {
            originalUpdateStarsBalance.apply(this, arguments);
            updateHomeBalance();
        };
    }
    
    // Обновляем подарки при обновлении маркета
    if (window.socket) {
        window.socket.on('market_updated', () => {
            // Если главная страница активна - обновляем подарки
            const homeSection = document.getElementById('home');
            if (homeSection && homeSection.classList.contains('active')) {
                console.log('🔄 Обновление главной после изменения маркета');
                setTimeout(() => {
                    loadHomeGifts();
                }, 500);
            }
        });
        
        // Также слушаем событие обновления доступных NFT
        window.socket.on('available_nfts_updated', () => {
            const homeSection = document.getElementById('home');
            if (homeSection && homeSection.classList.contains('active')) {
                console.log('🔄 Обновление главной после покупки NFT');
                setTimeout(() => {
                    loadHomeGifts();
                }, 500);
            }
        });
    }
}

// Контент сортировки для главной
function getHomeSortContent() {
    const sorts = [
        { id: 'newest', name: 'Сначала новые', emoji: '' },
        { id: 'oldest', name: 'Сначала старые', emoji: '' },
        { id: 'price_low', name: 'Цена по возрастанию', emoji: '' },
        { id: 'price_high', name: 'Цена по убыванию', emoji: '' },
        { id: 'rarity_high', name: 'Сначала редкие', emoji: '' },
        { id: 'rarity_low', name: 'Сначала обычные', emoji: '' },
        { id: 'collection', name: 'По коллекциям', emoji: '' }
    ];
    
    return `
        ${sorts.map(sort => {
            const isSelected = homeConfig.currentSort === sort.id;
            return `
                <div class="filter-item" onclick="selectHomeSort('${sort.id}', '${sort.name}')">
                    <div class="filter-item-content">
                        <span class="filter-item-name">
                            <span style="font-size: 1.2em; margin-right: 8px;">${sort.emoji}</span>
                            ${sort.name}
                        </span>
                    </div>
                    <div class="filter-item-checkbox">
                        <input type="checkbox" id="sort_${sort.id}" ${isSelected ? 'checked' : ''}>
                        <label for="sort_${sort.id}"></label>
                    </div>
                </div>
            `;
        }).join('')}
    `;
}

// Функция выбора сортировки
function selectHomeSort(sortId, sortName) {
    homeConfig.currentSort = sortId;
    document.getElementById('selectedSort').textContent = sortName;
    
    // Закрываем модалку
    const modal = document.getElementById('filterModal');
    if (modal) {
        modal.classList.remove('active');
    }
    
    // Применяем сортировку
    applyHomeFilters();
    
    // Вибрация
    if (window.vibrate) {
        window.vibrate([5, 3, 5]);
    }
}

// Экспортируем функции
window.initHome = initHome;
window.loadHomeGifts = loadHomeGifts;
window.selectFilter = selectFilter;
window.applyHomeFilter = applyHomeFilter;
window.viewHomeGift = viewHomeGift;
window.claimGift = claimGift;
window.escapeHtml = escapeHtml;
window.cancelHomeFilters = cancelHomeFilters;
window.clearHomeFilters = clearHomeFilters;
window.applyHomeFilters = applyHomeFilters;
window.openHomeFilterModal = openHomeFilterModal;
window.selectHomeSort = selectHomeSort;
window.getHomeCategoryContent = getHomeCategoryContent;
window.getHomeRarityContent = getHomeRarityContent;
window.getHomeSortContent = getHomeSortContent;