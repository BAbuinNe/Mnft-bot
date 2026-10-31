let marketNFTs = [];
let marketFilters = {
    collection: [],
    rarity: [],     
    pattern: [], 
    background: [], 
    model: [],       
    sort: 'newest',
    priceMin: 0,
    priceMax: 999999
};

let cachedModels = null;
let cachedCollectionsMarket = null;
let cachedPatterns = null;
let cachedBackgrounds = null;

let lastModelsFetch = 0;
let lastCollectionsFetch = 0;
let lastPatternsFetch = 0;
let lastBackgroundsFetch = 0;

const CACHE_TTL = 5 * 60 * 1000; // 5 минут кэширования

let marketLoadInProgress = false;
let marketRequestTimeout = null;
let lastRequestTime = 0;
const REQUEST_DEBOUNCE_DELAY = 300;

// Сохраняем снимок фильтров для отмены
let marketFiltersSnapshot = null;

// Вспомогательная функция
function capitalizeFirstLetter(string) {
    return string.charAt(0).toUpperCase() + string.slice(1);
}


async function fetchWithCache(cacheKey, fetchFunction, forceRefresh = false) {
    const now = Date.now();
    
    // Определяем кэш для каждого типа
    let cacheData, cacheTime;
    
    switch(cacheKey) {
        case 'models':
            cacheData = window.cachedModels;
            cacheTime = window.lastModelsFetch;
            break;
        case 'collections':
            cacheData = window.cachedCollectionsMarket;
            cacheTime = window.lastCollectionsMarketFetch;
            break;
        case 'patterns':
            cacheData = window.cachedPatterns;
            cacheTime = window.lastPatternsFetch;
            break;
        case 'backgrounds':
            cacheData = window.cachedBackgrounds;
            cacheTime = window.lastBackgroundsFetch;
            break;
        default:
            cacheData = null;
            cacheTime = 0;
    }
    
    // Проверяем кэш
    if (cacheData && !forceRefresh && cacheTime && (now - cacheTime) < CACHE_TTL) {
        console.log(`📦 Используем кэшированные ${cacheKey}:`, cacheData.length);
        return cacheData;
    }
    
    // Загружаем новые данные
    try {
        const data = await fetchFunction();
        
        // Сохраняем в кэш
        switch(cacheKey) {
            case 'models':
                window.cachedModels = data;
                window.lastModelsFetch = now;
                break;
            case 'collections':
                window.cachedCollectionsMarket = data;
                window.lastCollectionsMarketFetch = now;
                break;
            case 'patterns':
                window.cachedPatterns = data;
                window.lastPatternsFetch = now;
                break;
            case 'backgrounds':
                window.cachedBackgrounds = data;
                window.lastBackgroundsFetch = now;
                break;
        }
        
        console.log(`📦 Загружены новые ${cacheKey}:`, data.length);
        return data;
        
    } catch (error) {
        console.error(`❌ Ошибка загрузки ${cacheKey}:`, error);
        return cacheData || [];
    }
}

// Функция загрузки NFT на продаже с сервера с фильтрами
async function loadMarketItems() {
    console.log('📊 loadMarketItems вызвана');
    console.log('🔍 Текущие фильтры маркета:', JSON.stringify(marketFilters, null, 2));
    
    if (marketLoadInProgress) return;
    marketLoadInProgress = true;
    
    const marketGrid = document.getElementById('marketGrid');
    if (!marketGrid) {
        marketLoadInProgress = false;
        return;
    }
    
    try {
        marketGrid.innerHTML = `
            <div class="empty-market">
                <div class="loading-spinner"></div>
                <p>Загрузка маркета...</p>
                <p class="empty-hint">Применяем фильтры</p>
            </div>
        `;
        
        const filterData = {
            collection: marketFilters.collection.length > 0 ? marketFilters.collection : undefined,
            rarity: marketFilters.rarity.length > 0 ? marketFilters.rarity : undefined,
            pattern: marketFilters.pattern.length > 0 ? marketFilters.pattern : undefined,
            background: marketFilters.background.length > 0 ? marketFilters.background : undefined,
            model: marketFilters.model.length > 0 ? marketFilters.model : undefined, // <-- НОВОЕ
            sort: marketFilters.sort || 'newest',
            priceMin: marketFilters.priceMin || 0,
            priceMax: marketFilters.priceMax || 999999
        };
        
        console.log('🔄 Отправка запроса с фильтрами:', filterData);
        
        let listings = [];
        
        if (window.socket && window.socket.connected) {
            listings = await new Promise((resolve, reject) => {
                const timeoutId = setTimeout(() => {
                    console.log('⚠️ Таймаут загрузки маркета');
                    resolve([]);
                }, 10000);
                
                const handleResponse = (data) => {
                    clearTimeout(timeoutId);
                    window.socket.off('nfts_for_sale', handleResponse);
                    
                    if (data.success) {
                        console.log(`✅ Загружено ${data.listings.length} NFT с фильтрами`);
                        resolve(data.listings || []);
                    } else {
                        console.error('❌ Ошибка загрузки маркета:', data.error);
                        resolve([]);
                    }
                };
                
                window.socket.once('nfts_for_sale', handleResponse);
                window.socket.emit('get_nfts_for_sale', filterData);
            });
        }
        
        displayMarketNFTs(listings);
        updateMarketActiveFilters();
        
    } catch (error) {
        console.error('❌ Ошибка загрузки маркета:', error);
        marketGrid.innerHTML = `
            <div class="empty-market">
                <div class="empty-icon">⚠️</div>
                <p>Ошибка загрузки</p>
                <p class="empty-hint">${error.message || 'Неизвестная ошибка'}</p>
            </div>
        `;
    } finally {
        marketLoadInProgress = false;
    }
}

function applyLocalFilters(nfts, filters) {
    if (!nfts || nfts.length === 0) return nfts;
    
    let filtered = [...nfts];
    
    // Фильтрация по коллекции (множественный выбор)
    if (filters.collection && filters.collection.length > 0) {
        filtered = filtered.filter(nft => {
            const name = (nft.collectionName || '').toLowerCase();
            // Проверяем, содержит ли название коллекции хотя бы один из выбранных фильтров
            return filters.collection.some(filter => name.includes(filter));
        });
    }
    
    // Фильтрация по редкости (множественный выбор)
    if (filters.rarity && filters.rarity.length > 0) {
        filtered = filtered.filter(nft => {
            // Преобразуем редкость в ID как на фронтенде
            const rarityToId = {
                'Легендарный': 'legendary',
                'Эпический': 'epic',
                'Редкий': 'rare',
                'Обычный': 'common'
            };
            const nftRarityId = rarityToId[nft.rarity];
            return filters.rarity.includes(nftRarityId);
        });
    }
    
    // Сортировка
    if (filters.sort) {
        switch(filters.sort) {
            case 'newest':
                filtered.sort((a, b) => new Date(b.listedAt || b.createdAt) - new Date(a.listedAt || a.createdAt));
                break;
            case 'oldest':
                filtered.sort((a, b) => new Date(a.listedAt || a.createdAt) - new Date(b.listedAt || b.createdAt));
                break;
            case 'price_low':
                filtered.sort((a, b) => (a.price || 0) - (b.price || 0));
                break;
            case 'price_high':
                filtered.sort((a, b) => (b.price || 0) - (a.price || 0));
                break;
            case 'rarity_high':
                // Сортировка по редкости (от самой высокой)
                const rarityOrder = { 'Легендарный': 4, 'Эпический': 3, 'Редкий': 2, 'Обычный': 1 };
                filtered.sort((a, b) => (rarityOrder[b.rarity] || 0) - (rarityOrder[a.rarity] || 0));
                break;
            case 'rarity_low':
                // Сортировка по редкости (от самой низкой)
                const rarityOrderLow = { 'Легендарный': 4, 'Эпический': 3, 'Редкий': 2, 'Обычный': 1 };
                filtered.sort((a, b) => (rarityOrderLow[a.rarity] || 0) - (rarityOrderLow[b.rarity] || 0));
                break;
        }
    }
    
    return filtered;
}

// Отображение NFT в маркете
function displayMarketNFTs(nfts) {
    const marketGrid = document.getElementById('marketGrid');
    if (!marketGrid) return;
    
    // Сохраняем загруженные NFT
    marketNFTs = nfts;
    
    if (!nfts || nfts.length === 0) {
        marketGrid.innerHTML = `
            <div class="empty-market">
                <div class="empty-icon">🔍</div>
                <p>Ничего не найдено</p>
                <p class="empty-hint">Попробуйте изменить фильтры</p>
            </div>
        `;
        return;
    }
    
    marketGrid.innerHTML = nfts.map((nft, index) => {
        const rarityColor = getRarityColor(nft.rarity);
        const rarityClass = nft.rarity ? nft.rarity.toLowerCase() : 'обычный';
        const isOwner = isCurrentUserOwner(nft.ownerId);
        
        // ВАЖНОЕ ИСПРАВЛЕНИЕ: Используем те же функции отображения, что и в профиле
        const isUpgraded = nft.update === 1;
        const cardBackgroundStyle = getNFTCardBackground(nft); // Используем функцию из inventory.js
        
        // Получаем паттерн если есть
        const patternHtml = (isUpgraded && nft.patternData && nft.patternData.file_name) 
            ? getNFTCardFullPattern(`/m_nft_image/patterns/${nft.patternData.file_name}.svg`, 
                            nft.backgroundData?.back_0)
            : '';

        return `
            <div class="inventory-item" onclick="viewMarketNFT(${nft.id})" 
                 style="${cardBackgroundStyle} animation-delay: ${index * 0.05}s; position: relative;">
                <h4 class="nft-supply-indicator market-nft-number">
                    #${nft.number || '?'}
                </h4>

                ${patternHtml}
                <div style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; 
                    background: linear-gradient(to top, rgba(13, 13, 16, 0.6) 0%, 
                    rgba(13, 13, 16, 0.15) 30%, 
                    rgba(13, 13, 16, 0.1) 70%, transparent 100%);
                    border-radius: 18px; z-index: 1;"></div>

                <div class="inventory-item-image" style="position: relative; z-index: 2;">
                    ${generateNFTImageHTML(nft)} <!-- Используем ту же функцию что и в профиле -->
                </div>

                <div class="inventory-item-info" style="position: relative; z-index: 3;">
                    <h4 class="nft-name" style="text-align: center; text-shadow: 0 1px 2px rgba(0,0,0,0.3);">
                        ${nft.modelName || nft.modelData?.name || 'NFT'}
                    </h4>
                    
                    ${isOwner ? `
                        <div style="background: rgba(255, 215, 0, 0.1); border-radius: 20px; padding: 8px; margin: 0 6px 6px;">
                            <div style="font-size: 0.8em; color: #FFD700; text-align: center;">
                                Ваша цена: ${nft.price || 0} ⭐
                            </div>
                        </div>
                    ` : `
                        <div class="market-buy-button-container">
                            <button class="market-buy-button" onclick="buyNFT(${nft.id}, ${nft.price || 0}, event)">
                                <span class="market-buy-price">${nft.price || 0} ⭐</span>
                            </button>
                        </div>
                    `}
                </div>
            </div>
        `;
    }).join('');
}

function getBrightness(hexColor) {
    // Убираем # если есть
    hexColor = hexColor.replace('#', '');
    
    // Преобразуем hex в RGB
    const r = parseInt(hexColor.substr(0, 2), 16);
    const g = parseInt(hexColor.substr(2, 2), 16);
    const b = parseInt(hexColor.substr(4, 2), 16);
    
    // Формула яркости (0-255)
    return (r * 299 + g * 587 + b * 114) / 1000;
}

function getPatternFilterStyle(bgColor) {
    if (!bgColor) return '';
    
    const brightness = getBrightness(bgColor);
    
    // Если фон темный (яркость < 128) - делаем иконки светлыми
    // Если фон светлый (яркость >= 128) - делаем иконки темными
    if (brightness < 96) {
        return 'filter: invert(1) brightness(0.8);';
    } else {
        return 'filter: invert(0) brightness(0.8);';
    }
}

function getNFTCardFullPattern(svgPath, bgColor) {
    if (!svgPath) return '';
    
    const filterStyle = getPatternFilterStyle(bgColor);
    
    const innerCircleRadius = 25;
    const middleCircleRadius = 32;
    const outerCircleRadius = 44;
    const extraCircleRadius = 55;
    
    let patternHtml = '<div class="card-pattern" style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none; border-radius: 18px; overflow: hidden;">';
    
    // 1. Внутренний круг
    const innerIconsCount = 6;
    for (let i = 0; i < innerIconsCount; i++) {
        const angle = (i / innerIconsCount) * Math.PI * 2;
        const x = 50 + Math.cos(angle) * innerCircleRadius;
        const y = 50 + Math.sin(angle) * innerCircleRadius;
        
        patternHtml += `
            <div style="position: absolute;
                        z-index: 1;
                        top: ${y}%;
                        left: ${x}%;
                        width: 8%; 
                        height: 8%;
                        min-width: 16px; 
                        min-height: 16px;
                        transform: translate(-50%, -50%);
                        opacity: 0.25;
                        background-image: url('${svgPath}');
                        background-size: contain;
                        background-repeat: no-repeat;
                        background-position: center;
                        ${filterStyle}">
            </div>
        `;
    }
    
    // 2. Средний круг
    const rotationOffset = Math.PI / 6;
    
    const middleAngles = [
        0,
        (2 * Math.PI) / 3,
        (2 * Math.PI) / 3 + Math.PI / 3,
        (2 * Math.PI) / 3 + Math.PI / 3 + (2 * Math.PI) / 3
    ];
    
    for (let i = 0; i < middleAngles.length; i++) {
        const angle = middleAngles[i] + rotationOffset;
        const x = 50 + Math.cos(angle) * middleCircleRadius;
        const y = 50 + Math.sin(angle) * middleCircleRadius;
        
        patternHtml += `
            <div style="position: absolute;
                        top: ${y}%;
                        left: ${x}%;
                        width: 10%;  
                        height: 10%;
                        min-width: 18px; 
                        min-height: 18px;
                        transform: translate(-50%, -50%);
                        opacity: 0.18;
                        background-image: url('${svgPath}');
                        background-size: contain;
                        background-repeat: no-repeat;
                        background-position: center;
                        ${filterStyle}">
            </div>
        `;
    }
    
    // 3. Внешний круг
    const outerIconsCount = 12;
    for (let i = 0; i < outerIconsCount; i++) {
        const angle = (i / outerIconsCount) * Math.PI * 2;
        const x = 50 + Math.cos(angle) * outerCircleRadius;
        const y = 50 + Math.sin(angle) * outerCircleRadius;
        
        patternHtml += `
            <div style="position: absolute;
                        top: ${y}%;
                        left: ${x}%;
                        width: 7%; 
                        height: 7%;
                        min-width: 12px; 
                        min-height: 12px;
                        transform: translate(-50%, -50%);
                        opacity: 0.12;
                        background-image: url('${svgPath}');
                        background-size: contain;
                        background-repeat: no-repeat;
                        background-position: center;
                        ${filterStyle}">
            </div>
        `;
    }
    
    // 4. Самый внешний круг
    const extraCircleIconsCount = 8;
    for (let i = 0; i < extraCircleIconsCount; i++) {
        const angle = (i / extraCircleIconsCount) * Math.PI * 2;
        const x = 50 + Math.cos(angle) * extraCircleRadius;
        const y = 50 + Math.sin(angle) * extraCircleRadius;
        
        patternHtml += `
            <div style="position: absolute;
                        top: ${y}%;
                        left: ${x}%;
                        width: 6%;  
                        height: 6%;
                        min-width: 10px;
                        min-height: 10px;
                        transform: translate(-50%, -50%);
                        opacity: 0.08;
                        background-image: url('${svgPath}');
                        background-size: contain;
                        background-repeat: no-repeat;
                        background-position: center;
                        ${filterStyle}">
            </div>
        `;
    }
    
    patternHtml += '</div>';
    return patternHtml;
}

// Проверка владельца NFT
function isCurrentUserOwner(ownerId) {
    const tg = window.Telegram?.WebApp;
    const currentUser = tg?.initDataUnsafe?.user;
    
    if (!currentUser?.id) return false;
    return parseInt(ownerId) === parseInt(currentUser.id);
}

// Просмотр NFT в маркете
function viewMarketNFT(nftId) {
    console.log('👀 Открытие NFT из маркета:', nftId);
    
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
        
        const nft = marketNFTs.find(item => item.id === nftId);
        if (!nft || !window.updateNFTModal || !window.openNFTModal) return;
        
        const nftData = {
            ...nft,
            forSale: true,
            ownedByUser: isCurrentUserOwner(nft.ownerId)
        };
        
        window.updateNFTModal(nftData);
        window.openNFTModal();
        
        if (window.vibrate) window.vibrate([3, 5, 3]);
    }, 100);
}

// Покупка NFT
function buyNFT(nftId, price, event) {
    if (event) event.stopPropagation();
    
    const nft = marketNFTs.find(item => item.id === nftId);
    if (!nft) return;
    
    // Используем универсальный менеджер покупок
    if (window.purchaseManager) {
        window.purchaseManager.showConfirmation(nft, 'market');
    } else {
        // Fallback на старую логику
        showOldPurchaseConfirmation(nftId, price, nft.fullName);
    }
    
    if (window.vibrate) window.vibrate([5, 3, 5]);
}

// Инициализация маркета
async function initMarket() {
    try {
        // При входе в маркет обновляем кэш (если нужно)
        refreshAllFiltersCache(); 
        await loadMarketItems();
        updateMarketActiveFilters();
        updateModelCardState();
        updateMarketBalance();
        setupMarketListeners();
        setupSectionChangeListener();
        console.log('✅ Маркет инициализирован');
    } catch (error) {
        console.error('❌ Ошибка инициализации маркета:', error);
    }
}

function refreshAllFiltersCache() {
    console.log('🔄 Принудительное обновление кэша фильтров маркета');
    fetchCollectionsForMarket(true);
    fetchPatternsForMarket(true);
    fetchBackgroundsForMarket(true);
    fetchModelsForMarket(true);
}


function setupMarketListeners() {
    if (window.socket) {
        // Обновление маркета при изменениях
        window.socket.on('market_updated', () => {
            console.log('🔄 Обновление маркета');
            loadMarketItems();
        });
        
        // Обновление баланса
        window.socket.on('balance_updated', (data) => {
            if (data.userId === window.Telegram?.WebApp?.initDataUnsafe?.user?.id) {
                updateMarketBalance();
            }
        });
    }
}

// Функция открытия модального окна фильтров для маркета
function openMarketFilterModal(filterType) {    
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
        
        if (!cachedProfileCollections || cachedProfileCollections.length === 0) {
            refreshAllFiltersCache();
        }
        
        // Для фильтра модели проверяем наличие моделей
        if (filterType === 'model') {
            if (!hasModelsForSelectedCollections()) {
                if (window.vibrate) window.vibrate([20]); 
                return; 
            }
        }
        
        // СОХРАНЯЕМ СНИМОК ТЕКУЩЕГО СОСТОЯНИЯ (актуальных фильтров)
        marketFiltersSnapshot = {
            collection: [...(marketFilters.collection || [])],
            rarity: [...(marketFilters.rarity || [])],
            pattern: [...(marketFilters.pattern || [])],
            background: [...(marketFilters.background || [])],
            model: [...(marketFilters.model || [])],
            sort: marketFilters.sort || 'newest',
            priceMin: marketFilters.priceMin || 0,
            priceMax: marketFilters.priceMax || 999999
        };
        
        window.currentFilterSection = 'market';
        window.openFilterModal(filterType);
        
        // Устанавливаем обработчик клика вне модалки
        setupMarketModalClickOutside();
    }, 100); // Задержка 100мс
}

// Добавьте функцию для синхронизации чекбоксов
function syncMarketCheckboxesWithSnapshot() {
    if (!marketFiltersSnapshot) {
        return;
    }
    
    // Синхронизируем коллекции
    document.querySelectorAll('input[id^="collection_"]').forEach(cb => {
        const id = cb.id.replace('collection_', '');
        const numId = parseInt(id);
        cb.checked = marketFiltersSnapshot.collection.includes(numId);
    });
    
    // Синхронизируем редкость
    document.querySelectorAll('input[id^="rarity_"]').forEach(cb => {
        const id = cb.id.replace('rarity_', '');
        cb.checked = marketFiltersSnapshot.rarity.includes(id);
    });
    
    // Синхронизируем узоры
    document.querySelectorAll('input[id^="pattern_"]').forEach(cb => {
        const id = cb.id.replace('pattern_', '');
        const numId = parseInt(id);
        cb.checked = marketFiltersSnapshot.pattern.includes(numId);
    });
    
    // Синхронизируем фоны
    document.querySelectorAll('input[id^="background_"]').forEach(cb => {
        const id = cb.id.replace('background_', '');
        const numId = parseInt(id);
        cb.checked = marketFiltersSnapshot.background.includes(numId);
    });
    
    // Синхронизируем модели
    document.querySelectorAll('input[id^="model_"]').forEach(cb => {
        const id = cb.id.replace('model_', '');
        const numId = parseInt(id);
        cb.checked = marketFiltersSnapshot.model.includes(numId);
    });
    
    // Синхронизируем сортировку
    if (marketFiltersSnapshot.sort) {
        const sortCb = document.getElementById(`sort_${marketFiltersSnapshot.sort}`);
        if (sortCb) {
            sortCb.checked = true;
        }
    }
}

// Контент коллекций для маркета
async function getMarketCollectionsContent() {
    try {
        const collections = await fetchCollectionsForMarket();
        
        if (!collections || collections.length === 0) {
            return '<p style="color: var(--text-secondary); text-align: center; padding: 20px;">Коллекций не найдено</p>';
        }
        
        return collections.map(collection => {
            const collectionId = collection.id; // Просто число
            const isSelected = marketFilters.collection.includes(collectionId);
            
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
            
            const rarity = getRarityBySupplyMarket(collection.total_supply);
            const rarityColor = getRarityColor(rarity);
            
            return `
                <div class="filter-item" onclick="selectMarketFilterItem('collection', ${collectionId}, '${escapeHtml(collection.name)}')">
                    <div class="filter-item-content">
                        <span class="filter-item-name">
                            ${imageHtml}
                            ${escapeHtml(collection.name)}
                            <span class="rarity-display" style="background: ${rarityColor};">
                                ${rarity}
                            </span>
                        </span>
                    </div>
                    <div class="filter-item-checkbox">
                        <input type="checkbox" id="collection_${collectionId}" ${isSelected ? 'checked' : ''}>
                        <label for="collection_${collectionId}"></label>
                    </div>
                </div>
            `;
        }).join('');
        
    } catch (error) {
        console.error('❌ Ошибка загрузки коллекций для маркета:', error);
        return '<p style="color: var(--text-secondary); text-align: center; padding: 20px;">Ошибка загрузки коллекций</p>';
    }
}

// Вспомогательная функция для определения редкости
function getRarityBySupplyMarket(totalSupply) {
    if (!totalSupply || typeof totalSupply !== 'number') return 'Обычный';
    
    if (totalSupply <= 50) return 'Легендарный';
    if (totalSupply <= 200) return 'Эпический';
    if (totalSupply <= 1000) return 'Редкий';
    return 'Обычный';
}

// Функция для получения коллекций (как в профиле)
async function fetchCollectionsForMarket(forceRefresh = false) {
    return fetchWithCache('collections', async () => {
        if (window.socket && window.socket.connected) {
            return new Promise((resolve) => {
                window.socket.emit('get_collections');
                window.socket.once('collections_list', (data) => {
                    resolve(data.success ? data.collections : []);
                });
                setTimeout(() => resolve([]), 5000);
            });
        }
        return [];
    }, forceRefresh);
}

// Контент редкости для маркета
function getMarketRarityContent() {
    const rarities = [
        { id: 'legendary', name: 'Легендарные', emoji: '🏆' },
        { id: 'epic', name: 'Эпические', emoji: '💎' },
        { id: 'rare', name: 'Редкие', emoji: '🔮' },
        { id: 'common', name: 'Обычные', emoji: '📦' }
    ];
    
    return `
        ${rarities.map(rarity => {
            const isSelected = marketFilters.rarity.includes(rarity.id);
            return `
                <div class="filter-item" onclick="selectMarketFilterItem('rarity', '${rarity.id}', '${rarity.name}')">
                    <div class="filter-item-content">
                        <span class="filter-item-name">
                            <span style="font-size: 1.2em; margin-right: 8px;">${rarity.emoji}</span>
                            ${rarity.name}
                        </span>
                    </div>
                    <div class="filter-item-checkbox">
                        <input type="checkbox" id="rarity_${rarity.id}" ${isSelected ? 'checked' : ''}>
                        <label for="rarity_${rarity.id}"></label>
                    </div>
                </div>
            `;
        }).join('')}
    `;
}

// Контент сортировки для маркета (оставляем одиночный выбор)
function getMarketSortContent() {
    const sorts = [
        { id: 'newest', name: 'Сначала новые', description: 'Сначала недавно добавленные' },
        { id: 'oldest', name: 'Сначала старые', description: 'Сначала давно добавленные' },
        { id: 'price_low', name: 'Цена по возрастанию', description: 'От дешевых к дорогим' },
        { id: 'price_high', name: 'Цена по убыванию', description: 'От дорогих к дешевым' },
        { id: 'rarity_high', name: 'Сначала редкие', description: 'От легендарных к обычным' },
        { id: 'rarity_low', name: 'Сначала обычные', description: 'От обычных к редким' },
        { id: 'collection', name: 'По коллекциям', description: 'Группировать по коллекции' }
    ];
    
    return `
        ${sorts.map(sort => {
            const isSelected = marketFilters.sort === sort.id;
            return `
                <div class="filter-item" onclick="selectMarketFilterItem('sort', '${sort.id}', '${sort.name}')">
                    <div class="filter-item-content">
                        <span class="filter-item-name">
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

// Контент цены для маркета (особый случай)
function getMarketPriceContent() {
    return `
        <div style="padding: 10px;">
            <div style="margin-bottom: 20px;">
                <label style="display: block; margin-bottom: 8px; color: var(--text-secondary); font-size: 0.9em;">
                    Минимальная цена (⭐)
                </label>
                <input type="number" 
                       id="priceMinInput" 
                       value="${marketFilters.priceMin}" 
                       min="0" 
                       max="999999"
                       style="width: 100%; padding: 12px; border-radius: 10px; border: 1px solid var(--border); background: var(--surface); color: var(--text-primary);"
                       onchange="updateMarketPriceFilter('min', this.value)">
            </div>
            
            <div style="margin-bottom: 20px;">
                <label style="display: block; margin-bottom: 8px; color: var(--text-secondary); font-size: 0.9em;">
                    Максимальная цена (⭐)
                </label>
                <input type="number" 
                       id="priceMaxInput" 
                       value="${marketFilters.priceMax === 999999 ? '' : marketFilters.priceMax}" 
                       min="0" 
                       max="999999"
                       placeholder="Без ограничения"
                       style="width: 100%; padding: 12px; border-radius: 10px; border: 1px solid var(--border); background: var(--surface); color: var(--text-primary);"
                       onchange="updateMarketPriceFilter('max', this.value)">
            </div>
        </div>
    `;
}

// Выбор элемента фильтра для маркета (множественный выбор для collection и rarity)
function selectMarketFilterItem(filterType, filterId, filterName) {
    if (!cachedProfileCollections || cachedProfileCollections.length === 0) {
        refreshAllFiltersCache(true);
    }
    
    // Преобразуем ID в число для всех типов, кроме 'rarity' и 'sort'
    let processedId = filterId;
    if (filterType !== 'rarity' && filterType !== 'sort') {
        processedId = Number(filterId);
        if (isNaN(processedId)) return;
    }
    
    const checkbox = document.getElementById(`${filterType}_${filterId}`);
    if (!checkbox) return;
    
    // Множественный выбор
    if (filterType === 'collection' || filterType === 'rarity' || 
        filterType === 'pattern' || filterType === 'background' || 
        filterType === 'model') {
        
        if (checkbox.checked) {
            // Удаляем
            const index = marketFilters[filterType].indexOf(processedId);
            if (index > -1) marketFilters[filterType].splice(index, 1);
            checkbox.checked = false;
        } else {
            // Добавляем
            if (!marketFilters[filterType].includes(processedId)) {
                marketFilters[filterType].push(processedId);
            }
            checkbox.checked = true;
        }
        
        // Если меняется коллекция - обновляем состояние карточки модели
        if (filterType === 'collection') {
            marketFilters.model = []; // Сбрасываем выбранные модели
            document.querySelectorAll('input[id^="model_"]').forEach(cb => cb.checked = false);
            
            // Обновляем состояние карточки модели ТОЛЬКО если маркет активен
            const marketSection = document.getElementById('market');
            if (marketSection && marketSection.classList.contains('active')) {
                updateModelCardState();
            }
            
            // Обновляем содержимое модалки моделей если открыта
            const modalTitle = document.getElementById('filterModalTitle');
            if (modalTitle && modalTitle.textContent === 'Выбор модели') {
                refreshMarketModelsContent();
            }
        }
    }
    
    // Одиночный выбор для сортировки
    else if (filterType === 'sort') {
        document.querySelectorAll('input[id^="sort_"]').forEach(cb => cb.checked = false);
        
        if (marketFilters.sort === filterId) {
            marketFilters.sort = 'newest';
        } else {
            marketFilters.sort = filterId;
            checkbox.checked = true;
        }
    }    
    if (window.vibrate) window.vibrate([3, 5, 3]);
}

// Вспомогательная функция для обновления превью (опционально)
function updateMarketFilterPreview() {
    const totalFilters = 
        (marketFilters.collection?.length || 0) +
        (marketFilters.rarity?.length || 0) +
        (marketFilters.pattern?.length || 0) +
        (marketFilters.background?.length || 0) +
        (marketFilters.model?.length || 0);
}

// Вспомогательная функция для обновления содержимого модалки моделей
async function refreshModelsFilterContent() {
    const modalBody = document.getElementById('filterModalBody');
    if (!modalBody) return;
        
    try {
        const filterContent = await getMarketModelContent();
        modalBody.innerHTML = filterContent;
    } catch (error) {
        console.error('❌ Ошибка обновления списка моделей:', error);
        modalBody.innerHTML = `
            <div class="filter-empty-state">
                <p>Ошибка загрузки моделей</p>
                <p class="empty-hint">Попробуйте еще раз</p>
            </div>
        `;
    }
}

// Функция для обновления текущего фильтра
async function refreshCurrentFilterContent() {
    const modalTitle = document.getElementById('filterModalTitle');
    const modalBody = document.getElementById('filterModalBody');
    
    if (!modalTitle || !modalBody) return;
    
    const title = modalTitle.textContent;
    let filterType = null;
    
    if (title === 'Выбор модели') filterType = 'model';
    else if (title === 'Выбор узора') filterType = 'pattern';
    else if (title === 'Выбор фона') filterType = 'background';
    
    if (filterType) {
        const filterContent = await getMarketModelContent();
        modalBody.innerHTML = filterContent;
    }
}

// Обновление ценового фильтра
function updateMarketPriceFilter(type, value) {
    if (type === 'min') {
        marketFilters.priceMin = parseInt(value) || 0;
    } else if (type === 'max') {
        marketFilters.priceMax = value ? parseInt(value) : 999999;
    }
}

// Обновление отображения выбранного фильтра
function updateMarketFilterDisplay(filterType, filterName) {
    let elementId;
    if (filterType === 'collection') {
        elementId = 'marketSelectedCollection';
    } else if (filterType === 'rarity') {
        elementId = 'marketSelectedRarity';
    } else if (filterType === 'pattern') {
        elementId = 'marketSelectedPattern';
    } else if (filterType === 'background') {  // Добавьте этот блок
        elementId = 'marketSelectedBackground';
    } else if (filterType === 'model') {
        elementId = 'marketSelectedModel';
    } else if (filterType === 'sort') {
        elementId = 'marketSelectedSort';
    } else {
        return; // Если неизвестный тип, выходим
    }
    
    const element = document.getElementById(elementId);
    if (!element) return;
    
    if (filterType === 'collection' || filterType === 'rarity' || 
        filterType === 'pattern' || filterType === 'background' || 
        filterType === 'model') {
        
        const count = marketFilters[filterType]?.length || 0;
        if (count === 0) {
            element.textContent = 'Все';
        } else {
            element.textContent = `${count} выбрано`;
        }
    } 
    else if (filterType === 'sort') {
        const sortNames = {
            'newest': 'Новые',
            'oldest': 'Старые', 
            'price_low': 'Цена ↑',
            'price_high': 'Цена ↓',
            'rarity_high': 'Редкие',
            'rarity_low': 'Обычные',
            'collection': 'Коллекция'
        };
        element.textContent = sortNames[marketFilters.sort] || 'Новые';
    }
    
    // Добавляем/убираем активный класс у карточки
    const card = element.closest('.profile-filter-card');
    if (card) {
        let hasSelection;
        if (filterType === 'sort') {
            hasSelection = marketFilters.sort !== 'newest';
        } else {
            hasSelection = (marketFilters[filterType]?.length || 0) > 0;
        }
        card.classList.toggle('active', hasSelection);
    }
}

// Обновление активных фильтров
function updateMarketActiveFilters() {
    updateMarketFilterDisplay('collection');
    updateMarketFilterDisplay('rarity');
    updateMarketFilterDisplay('pattern');
    updateMarketFilterDisplay('background');
    updateMarketFilterDisplay('model');
    updateMarketFilterDisplay('sort');
}

// Вспомогательная функция
function getMarketFilterDisplayName(type, value) {
    if (type === 'collection') {
        return '';
    }
    
    if (type === 'rarity') {
        return '';
    }
    
    if (type === 'sort') {
        const sorts = {
            newest: 'Новые',
            oldest: 'Старые',
            price_low: 'Цена ↑',
            price_high: 'Цена ↓',
            rarity_high: 'Редкость ↓',
            rarity_low: 'Редкость ↑'
        };
        return sorts[value] || 'Все';
    }
    
    return value;
}


async function fetchPatternsForMarket(forceRefresh = false) {
    return fetchWithCache('patterns', async () => {
        if (window.socket && window.socket.connected) {
            return new Promise((resolve) => {
                window.socket.emit('get_patterns');
                window.socket.once('patterns_list', (data) => {
                    resolve(data.success ? data.patterns : []);
                });
                setTimeout(() => resolve([]), 5000);
            });
        }
        return [];
    }, forceRefresh);
}

async function getMarketPatternContent() {
    try {
        const patterns = await fetchPatternsForMarket();
        
        if (!patterns || patterns.length === 0) {
            return `
                <div class="filter-empty-state">
                    <p>Узоры не найдены</p>
                </div>
            `;
        }
        
        const sortedPatterns = [...patterns].sort((a, b) => b.rarity - a.rarity);
        
        return sortedPatterns.map(pattern => {
            const patternId = pattern.id;
            const isSelected = marketFilters.pattern.includes(patternId);
            
            const svgPath = pattern.file_name ? 
                `/m_nft_image/patterns/${pattern.file_name}.svg` : null;
            
            let imageHtml = '';
            if (svgPath) {
                imageHtml = `
                    <div class="filter-item-image">
                        <img src="${svgPath}" 
                             alt="${pattern.name}" 
                             onerror="this.style.display='none'; this.parentNode.innerHTML='🎨';"
                             style="width: 25px; height: 25px; object-fit: contain;">
                    </div>
                `;
            } else {
                imageHtml = `<span style="font-size: 1.2em; margin-right: 8px;">🎨</span>`;
            }
            
            return `
                <div class="filter-item" onclick="selectMarketFilterItem('pattern', ${patternId}, '${escapeHtml(pattern.name)}')">
                    <div class="filter-item-content">
                        <span class="filter-item-name">
                            ${imageHtml}
                            ${escapeHtml(pattern.name)}
                            <span style="font-size: 0.8em; color: var(--text-secondary); margin-left: 6px; background: var(--surface-dark); padding: 2px 6px; border-radius: 8px;">
                                ${pattern.rarity}%
                            </span>
                        </span>
                    </div>
                    <div class="filter-item-checkbox">
                        <input type="checkbox" id="pattern_${patternId}" ${isSelected ? 'checked' : ''}>
                        <label for="pattern_${patternId}"></label>
                    </div>
                </div>
            `;
        }).join('');
        
    } catch (error) {
        console.error('❌ Ошибка загрузки узоров для маркета:', error);
        return `
            <div class="filter-empty-state">
                <p>Ошибка загрузки узоров</p>
                <p class="empty-hint">Попробуйте позже</p>
            </div>
        `;
    }
}

// Функция для очистки фильтров маркета (внутри модалки)
function clearMarketFilters() {    
    const modalTitle = document.getElementById('filterModalTitle');
    const title = modalTitle?.textContent;
    
    let filterType = null;
    if (title === 'Выбор коллекции') filterType = 'collection';
    else if (title === 'Выбор редкости') filterType = 'rarity';
    else if (title === 'Выбор узора') filterType = 'pattern';
    else if (title === 'Выбор фона') filterType = 'background';
    else if (title === 'Выбор модели') filterType = 'model';
    else if (title === 'Фильтры' || title === 'Сортировка') filterType = 'sort';
    
    if (!filterType) {
        closeFilterModal();
        return;
    }
        
    // Очищаем ТОЛЬКО текущий тип фильтра в marketFilters
    if (filterType === 'collection') {
        marketFilters.collection = [];
        updateModelCardState();
    } 
    else if (filterType === 'rarity') {
        marketFilters.rarity = [];
    }
    else if (filterType === 'pattern') {
        marketFilters.pattern = [];
    }
    else if (filterType === 'background') {
        marketFilters.background = [];
    }
    else if (filterType === 'model') {
        marketFilters.model = [];
    }
    else if (filterType === 'sort') {
        marketFilters.sort = 'newest';
    }    
    
    marketFiltersSnapshot = {
        collection: [...marketFilters.collection],
        rarity: [...marketFilters.rarity],
        pattern: [...marketFilters.pattern],
        background: [...marketFilters.background],
        model: [...marketFilters.model],
        sort: marketFilters.sort,
        priceMin: marketFilters.priceMin,
        priceMax: marketFilters.priceMax
    };
    updateMarketActiveFilters();
    loadMarketItems();
    closeFilterModal();
    
    if (window.vibrate) window.vibrate([5, 3, 5]);
}

function setupMarketModalClickOutside() {
    const modal = document.getElementById('filterModal');
    if (!modal) return;
    
    modal.removeEventListener('click', marketModalClickHandler);
    modal.addEventListener('click', marketModalClickHandler);
}

function marketModalClickHandler(event) {
    const modal = document.getElementById('filterModal');
    if (event.target === modal) {
        cancelMarketFilters();
    }
}

// Вспомогательная функция для обновления содержимого модалки моделей
async function refreshMarketModelsContent() {
    const modalBody = document.getElementById('filterModalBody');
    if (!modalBody) return;
    
    try {
        const filterContent = await getMarketModelContent();
        modalBody.innerHTML = filterContent;
        console.log('✅ Список моделей обновлен');
    } catch (error) {
        console.error('❌ Ошибка обновления списка моделей:', error);
        modalBody.innerHTML = `
            <div class="filter-empty-state">
                <p>Ошибка загрузки моделей</p>
                <p class="empty-hint">Попробуйте еще раз</p>
            </div>
        `;
    }
}

async function fetchBackgroundsForMarket(forceRefresh = false) {
    return fetchWithCache('backgrounds', async () => {
        if (window.socket && window.socket.connected) {
            return new Promise((resolve) => {
                window.socket.emit('get_backgrounds');
                window.socket.once('backgrounds_list', (data) => {
                    resolve(data.success ? data.backgrounds : []);
                });
                setTimeout(() => resolve([]), 5000);
            });
        }
        return [];
    }, forceRefresh);
}
ModelsForMarket

async function fetchModelsForMarket(forceRefresh = false) {
    return fetchWithCache('models', async () => {
        if (window.socket && window.socket.connected) {
            return new Promise((resolve) => {
                window.socket.emit('get_models');
                window.socket.once('models_list', (data) => {
                    const models = data.success ? data.models : [];
                    // Сохраняем в глобальный кэш
                    window.cachedModels = models;
                    resolve(models);
                });
                setTimeout(() => resolve([]), 5000);
            });
        }
        return [];
    }, forceRefresh);
}

function updateModelFilterCardState() {
    const modelCard = document.querySelector('.profile-filter-card[onclick*="model"]');
    if (!modelCard) return;
    
    if (!hasModelsForSelectedCollections()) {
        modelCard.classList.add('disabled');
        modelCard.style.opacity = '0.5';
        modelCard.style.pointerEvents = 'none';
    } else {
        modelCard.classList.remove('disabled');
        modelCard.style.opacity = '1';
        modelCard.style.pointerEvents = 'auto';
    }
}

function filterModelsBySelectedCollections(models) {
    if (!marketFilters.collection || marketFilters.collection.length === 0) {
        return models;
    }
    
    // marketFilters.collection уже массив чисел
    const selectedCollectionIds = marketFilters.collection;
    
    console.log('🎯 Выбранные коллекции (числовые ID):', selectedCollectionIds);
    
    if (selectedCollectionIds.length === 0) {
        return models;
    }
    
    const filteredModels = models.filter(model => {
        if (!model.collection_id) return false;
        return selectedCollectionIds.includes(model.collection_id);
    });
    
    console.log(`🎯 Отфильтровано моделей: ${filteredModels.length} из ${models.length}`);
    
    return filteredModels;
}

async function getMarketBackgroundContent() {
    try {
        const backgrounds = await fetchBackgroundsForMarket();
        
        if (!backgrounds || backgrounds.length === 0) {
            return `
                <div class="filter-empty-state">
                    <p>Фоны не найдены</p>
                </div>
            `;
        }
        
        const sortedBackgrounds = [...backgrounds].sort((a, b) => b.rarity - a.rarity);
        
        let html = '<div class="filter-container">';
        
        html += sortedBackgrounds.map(background => {
            const backgroundId = background.id;
            
            // ВАЖНО: Используем marketFiltersSnapshot для определения выбранных чекбоксов
            // если снимок есть, иначе используем marketFilters
            let isSelected;
            if (marketFiltersSnapshot) {
                isSelected = marketFiltersSnapshot.background.includes(backgroundId);
            } else {
                isSelected = marketFilters.background.includes(backgroundId);
            }
            
            const gradientStyle = `radial-gradient(circle, #${background.back_0} 0%, #${background.back_100} 100%)`;
            
            return `
                <div class="filter-item" onclick="selectMarketFilterItem('background', ${backgroundId}, '${escapeHtml(background.name)}')">
                    <div class="filter-item-content">
                        <span class="filter-item-name">
                            <div class="filter-item-image" 
                                 style="border-radius: 10px; 
                                        background: ${gradientStyle};
                                        margin-right: 8px;
                                        box-shadow: 0 2px 8px rgba(0,0,0,0.2);
                                        border: 1px solid var(--border);">
                            </div>
                            ${escapeHtml(background.name)}
                            <span style="font-size: 0.8em; color: var(--text-secondary); margin-left: 6px; background: var(--surface-dark); padding: 2px 6px; border-radius: 8px;">
                                ${background.rarity}%
                            </span>
                        </span>
                    </div>
                    <div class="filter-item-checkbox">
                        <input type="checkbox" id="background_${backgroundId}" ${isSelected ? 'checked' : ''}>
                        <label for="background_${backgroundId}"></label>
                    </div>
                </div>
            `;
        }).join('');
        
        html += '</div>';
        return html;
        
    } catch (error) {
        console.error('❌ Ошибка загрузки фонов для маркета:', error);
        return `
            <div class="filter-empty-state">
                <p>Ошибка загрузки фонов</p>
                <p class="empty-hint">Попробуйте позже</p>
            </div>
        `;
    }
}

async function getMarketModelContent() {
    console.log('🎯 getMarketModelContent вызвана!');
    console.log('📊 Текущие выбранные коллекции:', marketFilters.collection);
    
    try {
        const allModels = await fetchModelsForMarket();
        
        if (!allModels || allModels.length === 0) {
            return `
                <div class="filter-empty-state">
                    <p>Модели не найдены</p>
                </div>
            `;
        }
        
        // Фильтруем модели по выбранным коллекциям
        const models = filterModelsBySelectedCollections(allModels);
        
        if (models.length === 0) {
            return `
                <div class="filter-empty-state">
                    <div class="empty-icon">🎨</div>
                    <p>Нет моделей для выбранных коллекций</p>
                </div>
            `;
        }
        
        // Группируем отфильтрованные модели по коллекциям
        const modelsByCollection = {};
        models.forEach(model => {
            const collectionName = model.collection_name || 'Другие';
            if (!modelsByCollection[collectionName]) {
                modelsByCollection[collectionName] = [];
            }
            modelsByCollection[collectionName].push(model);
        });
        
        const sortedCollections = Object.keys(modelsByCollection).sort();
        
        let html = '<div class="filter-container">';
        
        sortedCollections.forEach(collectionName => {
            const collectionModels = modelsByCollection[collectionName];
            const sortedModels = [...collectionModels].sort((a, b) => b.rarity - a.rarity);
            
            html += `
                <div class="filter-group-header">
                    <span>${escapeHtml(collectionName)}</span>
                    <span style="font-size: 0.85em; color: var(--text-tertiary);">${collectionModels.length} шт.</span>
                </div>
            `;
            
            sortedModels.forEach(model => {
                const modelId = model.id;
                const isSelected = marketFilters.model.includes(modelId);
                
                const imagePath = model.file_name ? 
                    `/m_nft_image/${collectionName}/${model.file_name}.PNG` : null;
                
                let imageHtml = '';
                if (imagePath) {
                    imageHtml = `
                        <div class="filter-item-image">
                            <img src="${imagePath}" 
                                 alt="${escapeHtml(model.name)}" 
                                 onerror="this.style.display='none'; this.parentNode.innerHTML='🖼️';"
                                 style="width: 35px; height: 35px; object-fit: contain;">
                        </div>
                    `;
                } else {
                    imageHtml = `<span style="font-size: 1.2em; margin-right: 8px;">🖼️</span>`;
                }
                
                html += `
                    <div class="filter-item" onclick="selectMarketFilterItem('model', ${modelId}, '${escapeHtml(model.name)}')">
                        <div class="filter-item-content">
                            <span class="filter-item-name">
                                ${imageHtml}
                                ${escapeHtml(model.name)}
                                <span style="font-size: 0.8em; color: var(--text-secondary); margin-left: 6px; background: var(--surface-dark); padding: 2px 6px; border-radius: 8px;">
                                    ${model.rarity}%
                                </span>
                            </span>
                        </div>
                        <div class="filter-item-checkbox">
                            <input type="checkbox" id="model_${modelId}" ${isSelected ? 'checked' : ''}>
                            <label for="model_${modelId}"></label>
                        </div>
                    </div>
                `;
            });
        });
        
        html += '</div>';
        return html;
        
    } catch (error) {
        console.error('❌ Ошибка загрузки моделей для маркета:', error);
        return `
            <div class="filter-empty-state">
                <p>Ошибка загрузки моделей</p>
                <p class="empty-hint">Попробуйте позже</p>
            </div>
        `;
    }
}

// Вспомогательная функция для получения названий выбранных коллекций
function getSelectedCollectionNames() {
    // Здесь нужно получить названия коллекций по их ID
    // Можно добавить кэш коллекций или использовать данные из DOM
    return '';
}

// Функция для отмены изменений в фильтрах маркета
function cancelMarketFilters() {
    if (!marketFiltersSnapshot) return;
    
    console.log('↩️ Отмена - восстанавливаем из снимка:', marketFiltersSnapshot);
    console.log('📊 Было:', marketFilters);
    
    // ВОССТАНАВЛИВАЕМ ИЗ СНИМКА
    marketFilters.collection = [...marketFiltersSnapshot.collection];
    marketFilters.rarity = [...marketFiltersSnapshot.rarity];
    marketFilters.pattern = [...marketFiltersSnapshot.pattern];
    marketFilters.background = [...marketFiltersSnapshot.background];
    marketFilters.model = [...marketFiltersSnapshot.model];
    marketFilters.sort = marketFiltersSnapshot.sort;
    marketFilters.priceMin = marketFiltersSnapshot.priceMin;
    marketFilters.priceMax = marketFiltersSnapshot.priceMax;
    
    console.log('📊 Стало:', marketFilters);
    
    // Обновляем UI карточек (возвращаем как было)
    updateMarketActiveFilters();
    
    // Закрываем модалку
    document.getElementById('filterModal').classList.remove('active');
    
    // 🔴 НЕ ПЕРЕЗАГРУЖАЕМ ДАННЫЕ!
    // loadMarketItems() НЕ ВЫЗЫВАЕМ
    
    if (window.vibrate) window.vibrate(1);
}

// Функция для применения фильтров маркета
function applyMarketFilters() {
    console.log('✅ applyMarketFilters вызвана');
    console.log('📊 Текущие фильтры ДО применения:', JSON.stringify(marketFilters, null, 2));
    
    // Обновляем UI карточек фильтров
    updateMarketActiveFilters();
    
    // Обновляем состояние карточки модели
    updateModelCardState();
    
    // Загружаем данные с новыми фильтрами
    loadMarketItems();
    
    // ОБНОВЛЯЕМ СНИМОК НОВЫМ СОСТОЯНИЕМ (актуальными фильтрами)
    marketFiltersSnapshot = {
        collection: [...(marketFilters.collection || [])],
        rarity: [...(marketFilters.rarity || [])],
        pattern: [...(marketFilters.pattern || [])],
        background: [...(marketFilters.background || [])],
        model: [...(marketFilters.model || [])],
        sort: marketFilters.sort || 'newest',
        priceMin: marketFilters.priceMin || 0,
        priceMax: marketFilters.priceMax || 999999
    };
    
    console.log('📸 Новый снимок маркета ПОСЛЕ применения:', marketFiltersSnapshot);
    
    // Закрываем модалку
    const modal = document.getElementById('filterModal');
    if (modal) {
        modal.classList.remove('active');
    }
    
    if (window.vibrate) {
        window.vibrate([3, 5, 3]);
    }
}

// Обновление баланса в маркете
function updateMarketBalance() {
    const marketBalanceElement = document.getElementById('marketBalance');
    if (marketBalanceElement && window.appState) {
        marketBalanceElement.textContent = (window.appState.starsBalance || 0).toLocaleString();
    }
}

function hasModelsForSelectedCollections() {
    // Если коллекции не выбраны, считаем что модели есть (показываем все)
    if (!marketFilters.collection || marketFilters.collection.length === 0) {
        return true;
    }
    
    // Проверяем в кэше, есть ли модели для выбранных коллекций
    if (window.cachedModels && window.cachedModels.length > 0) {
        const hasModels = window.cachedModels.some(model => 
            model.collection_id && marketFilters.collection.includes(model.collection_id)
        );
        console.log(`🔍 Проверка моделей для коллекций ${marketFilters.collection}: ${hasModels ? 'есть' : 'нет'}`);
        return hasModels;
    }
    
    // Если кэша нет, считаем что модели есть (оптимистичный подход)
    return true;
}


function updateModelCardState() {
    // Находим карточку модели ТОЛЬКО в маркете
    const marketSection = document.getElementById('market');
    if (!marketSection || !marketSection.classList.contains('active')) {
        return; // Если маркет не активен, ничего не делаем
    }
    
    const modelCard = marketSection.querySelector('.profile-filter-card[onclick*="model"]');
    if (!modelCard) return;
    
    const hasModels = hasModelsForSelectedCollections();
    const valueElement = document.getElementById('marketSelectedModel');
    
    if (!hasModels) {
        // Добавляем класс disabled
        modelCard.classList.add('model-disabled');
        // Меняем текст подсказки
        if (valueElement) {
            valueElement.textContent = 'Нет моделей';
        }
        // Убираем возможность клика
        modelCard.style.pointerEvents = 'none';
        modelCard.style.opacity = '0.5';
    } else {
        // Убираем класс disabled
        modelCard.classList.remove('model-disabled');
        // Восстанавливаем текст
        const count = marketFilters.model?.length || 0;
        if (valueElement) {
            valueElement.textContent = count > 0 ? `${count} выбрано` : 'Все';
        }
        // Возвращаем возможность клика
        modelCard.style.pointerEvents = 'auto';
        modelCard.style.opacity = '1';
    }
}

function hasModelsForSelectedProfileCollections() {
    // Если коллекции не выбраны, считаем что модели есть (показываем все)
    if (!currentFilters.collection || currentFilters.collection.length === 0) {
        return true;
    }
    
    // Проверяем в кэше, есть ли модели для выбранных коллекций
    if (cachedProfileModels && cachedProfileModels.length > 0) {
        const hasModels = cachedProfileModels.some(model => 
            model.collection_id && currentFilters.collection.includes(model.collection_id)
        );
        console.log(`🔍 Профиль: проверка моделей для коллекций ${currentFilters.collection}: ${hasModels ? 'есть' : 'нет'}`);
        return hasModels;
    }
    
    // Если кэша нет, считаем что модели есть
    return true;
}

function updateProfileModelCardState() {
    // Находим карточку модели ТОЛЬКО в профиле
    const profileSection = document.getElementById('profile');
    if (!profileSection || !profileSection.classList.contains('active')) {
        return; // Если профиль не активен, ничего не делаем
    }
    
    const modelCard = profileSection.querySelector('.profile-filter-card[onclick*="model"]');
    if (!modelCard) return;
    
    const hasModels = hasModelsForSelectedProfileCollections();
    const valueElement = document.getElementById('selectedModelFilter');
    
    if (!hasModels) {
        // Добавляем класс disabled
        modelCard.classList.add('profile-model-disabled');
        // Меняем текст подсказки
        if (valueElement) {
            valueElement.textContent = 'Нет моделей';
        }
        // Убираем возможность клика
        modelCard.style.pointerEvents = 'none';
        modelCard.style.opacity = '0.5';
    } else {
        // Убираем класс disabled
        modelCard.classList.remove('profile-model-disabled');
        // Восстанавливаем текст
        const count = currentFilters.model?.length || 0;
        if (valueElement) {
            valueElement.textContent = count > 0 ? `${count} выбрано` : 'Все';
        }
        // Возвращаем возможность клика
        modelCard.style.pointerEvents = 'auto';
        modelCard.style.opacity = '1';
    }
}

function setupSectionChangeListener() {
    // Наблюдаем за изменением активной секции
    const observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
            if (mutation.attributeName === 'class') {
                const marketSection = document.getElementById('market');
                if (marketSection && marketSection.classList.contains('active')) {
                    // Когда маркет становится активным, обновляем состояние
                    setTimeout(() => updateModelCardState(), 100);
                }
            }
        });
    });
    
    const marketSection = document.getElementById('market');
    if (marketSection) {
        observer.observe(marketSection, { attributes: true });
    }
}

// Экспорт функций
window.openMarketFilterModal = openMarketFilterModal;
window.selectMarketFilterItem = selectMarketFilterItem;
window.cancelMarketFilters = cancelMarketFilters;
window.applyMarketFilters = applyMarketFilters;
window.clearMarketFilters = clearMarketFilters;
window.getMarketSortContent = getMarketSortContent;
window.getPatternFilterStyle = getPatternFilterStyle;
window.getBrightness = getBrightness;
window.getMarketCollectionsContent = getMarketCollectionsContent;
window.getMarketRarityContent = getMarketRarityContent;
window.getMarketPriceContent = getMarketPriceContent;
window.getMarketPatternContent = getMarketPatternContent;
window.getMarketBackgroundContent = getMarketBackgroundContent;
window.getMarketModelContent = getMarketModelContent;

// Экспортируем функции загрузки
window.loadMarketItems = loadMarketItems;
window.viewMarketNFT = viewMarketNFT;
window.buyNFT = buyNFT;
window.initMarket = initMarket;
window.refreshAllFiltersCache = refreshAllFiltersCache;
