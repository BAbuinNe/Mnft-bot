
let cachedCollectionStats = {};
let cachedCollections = null;
let currentFilterSection = 'profile'; // 'profile', 'market', 'home'
window.currentFilterSection = currentFilterSection;

// Кэш для фильтров профиля
let cachedProfileCollections = null;
let cachedProfileModels = null;
let cachedProfilePatterns = null;
let cachedProfileBackgrounds = null;

let lastProfileCollectionsFetch = 0;
let lastProfileModelsFetch = 0;
let lastProfilePatternsFetch = 0;
let lastProfileBackgroundsFetch = 0;

const PROFILE_CACHE_TTL = 5 * 60 * 1000;

if (typeof window.cachedUserNFTs === 'undefined') {
    window.cachedUserNFTs = [];
}

let currentFilters = {
    collection: [], 
    model: [],     
    symbol: [],    
    background: [],
    filter: null   
}; 
window.currentFilters = currentFilters;

function getRarityBySupply(totalSupply) {
    if (!totalSupply || typeof totalSupply !== 'number') return 'Обычный';
    
    if (totalSupply <= 50) return 'Легендарный';
    if (totalSupply <= 200) return 'Эпический';
    if (totalSupply <= 1000) return 'Редкий';
    return 'Обычный';
}

function escapeHtml(text) {
    if (!text) return '';
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

let previousFilters = null;
let filtersSnapshot = null;

async function openFilterModal(filterType) {
    console.log('🔧 openFilterModal вызвана с типом:', filterType);
    
    const clickedElement = event?.currentTarget;
    
    // Добавляем визуальный фидбек сразу при нажатии
    if (clickedElement) {
        clickedElement.style.transform = 'scale(0.97)';
        clickedElement.style.transition = 'transform 0.1s ease';
    }
    
    // Небольшая задержка перед открытием модалки
    setTimeout(async () => {
        // Сбрасываем трансформацию элемента
        if (clickedElement) {
            clickedElement.style.transform = '';
        }
        
        // Весь существующий код функции openFilterModal
        const activeSection = document.querySelector('.section.active')?.id || 'profile';
        window.currentFilterSection = activeSection;

        const modal = document.getElementById('filterModal');
        const modalTitle = document.getElementById('filterModalTitle');
        const modalBody = document.getElementById('filterModalBody');
        
        if (!modal || !modalTitle || !modalBody) return;
        
        // Сохраняем снимок текущих фильтров при открытии
        filtersSnapshot = {
            collection: [...currentFilters.collection],
            model: [...currentFilters.model],
            symbol: [...currentFilters.symbol],
            background: [...currentFilters.background],
            filter: currentFilters.filter
        };
        
        // Устанавливаем заголовок
        const titles = {
            collection: 'Выбор коллекции',
            model: 'Выбор модели',
            symbol: 'Выбор узора',
            background: 'Выбор фона',
            pattern: 'Выбор узора',    
            filter: 'Фильтры'
        };
        modalTitle.textContent = titles[filterType] || 'Фильтры';
        
        // Показываем загрузку
        modalBody.innerHTML = `
            <div style="text-align: center; padding: 40px 20px; color: var(--text-secondary);">
                <div class="loading-spinner"></div>
                <p style="margin-top: 10px;">Загрузка...</p>
            </div>
        `;
        
        // Показываем модалку
        modal.classList.add('active');
        
        // Настраиваем обработчик клика вне окна
        setupFilterModalClickOutside();
        
        try {
            // Проверяем, загружены ли коллекции
            if (!cachedProfileCollections || cachedProfileCollections.length === 0) {
                console.log('📦 Коллекции не загружены, загружаем...');
                await fetchProfileCollections(true);
            }
            
            // Проверяем, загружены ли модели
            if (!cachedProfileModels || cachedProfileModels.length === 0) {
                console.log('📦 Модели не загружены, загружаем...');
                await fetchProfileModels(true);
            }
            
            // Проверяем, загружены ли узоры
            if (!cachedProfilePatterns || cachedProfilePatterns.length === 0) {
                console.log('📦 Узоры не загружены, загружаем...');
                await fetchProfilePatterns(true);
            }
            
            // Проверяем, загружены ли фоны
            if (!cachedProfileBackgrounds || cachedProfileBackgrounds.length === 0) {
                console.log('📦 Фоны не загружены, загружаем...');
                await fetchProfileBackgrounds(true);
            }
            
            console.log('✅ Все данные фильтров загружены');
            
            // Асинхронно загружаем контент фильтра
            const filterContent = await getFilterContent(filterType);
            modalBody.innerHTML = filterContent;
            
            // Синхронизируем чекбоксы
            const activeSection = document.querySelector('.section.active')?.id;
            if (activeSection === 'market' && typeof syncMarketCheckboxesWithSnapshot === 'function') {
                syncMarketCheckboxesWithSnapshot();
            } else {
                syncCheckboxesWithSnapshot();
            }
            
        } catch (error) {
            console.error('Error loading filter content:', error);
            modalBody.innerHTML = `
                <div style="text-align: center; padding: 40px 20px; color: var(--accent);">
                    <div style="font-size: 2em; margin-bottom: 10px;">⚠️</div>
                    <p>Ошибка загрузки фильтра</p>
                    <p style="font-size: 0.9em; margin-top: 10px;">Попробуйте еще раз</p>
                    <button onclick="openFilterModal('${filterType}')" style="margin-top: 20px; padding: 10px 20px; background: var(--accent); color: white; border: none; border-radius: 10px;">
                        Повторить
                    </button>
                </div>
            `;
        }
        
        // Вибрация
        if (window.vibrate) {
            window.vibrate(1);
        }
    }, 100); // Задержка 100мс
}

function syncCheckboxesWithSnapshot() {
    if (!filtersSnapshot) return;
    
    console.log('🔄 Синхронизация чекбоксов со снимком:', filtersSnapshot);
    
    // Синхронизируем коллекции
    document.querySelectorAll('input[id^="collection_"]').forEach(cb => {
        const id = cb.id.replace('collection_', '');
        const numId = parseInt(id);
        cb.checked = filtersSnapshot.collection.includes(numId);
    });
    
    // Синхронизируем модели
    document.querySelectorAll('input[id^="model_"]').forEach(cb => {
        const id = cb.id.replace('model_', '');
        const numId = parseInt(id);
        cb.checked = filtersSnapshot.model.includes(numId);
    });
    
    // Синхронизируем узоры (symbol)
    document.querySelectorAll('input[id^="symbol_"]').forEach(cb => {
        const id = cb.id.replace('symbol_', '');
        const numId = parseInt(id);
        cb.checked = filtersSnapshot.symbol.includes(numId);
    });
    
    // Синхронизируем фоны
    document.querySelectorAll('input[id^="background_"]').forEach(cb => {
        const id = cb.id.replace('background_', '');
        const numId = parseInt(id);
        cb.checked = filtersSnapshot.background.includes(numId);
    });
    
    // Синхронизируем сортировку
    if (filtersSnapshot.filter) {
        const filterCb = document.getElementById(`filter_${filtersSnapshot.filter}`);
        if (filterCb) {
            filterCb.checked = true;
        }
    }
}

// Закрытие модального окна фильтров
function closeFilterModal() {
    const modal = document.getElementById('filterModal');
    
    // ВОССТАНАВЛИВАЕМ ГЛОБАЛЬНЫЕ ФИЛЬТРЫ ИЗ СНИМКА
    if (filtersSnapshot) {
        currentFilters.collection = [...filtersSnapshot.collection];
        currentFilters.model = [...filtersSnapshot.model];
        currentFilters.symbol = [...filtersSnapshot.symbol];
        currentFilters.background = [...filtersSnapshot.background];
        currentFilters.filter = filtersSnapshot.filter;
        
        console.log('🔄 Восстановлены фильтры из снимка:', currentFilters);
    }
    
    if (modal) {
        modal.classList.remove('active');
    }
    
    // Обновляем UI карточек фильтров
    const activeSection = document.querySelector('.section.active')?.id;
    if (activeSection === 'profile') {
        updateActiveFilters();
    } else if (activeSection === 'market' && window.updateMarketActiveFilters) {
        window.updateMarketActiveFilters();
    }
    
    if (window.vibrate) {
        window.vibrate(1);
    }
}

// Получение контента для фильтра
async function getFilterContent(filterType) {
    // Проверяем текущую секцию
    const section = window.currentFilterSection || 
                    document.querySelector('.section.active')?.id || 
                    'profile';
    
    // Если это не профиль - делегируем соответствующему модулю
    if (section === 'market') {
        if (filterType === 'collection') {
            return await window.getMarketCollectionsContent();
        } else if (filterType === 'rarity') {
            return window.getMarketRarityContent();
        } else if (filterType === 'pattern') {
            return await window.getMarketPatternContent();
        } else if (filterType === 'background') {  
            return await window.getMarketBackgroundContent();
        } else if (filterType === 'model') {  
            return await window.getMarketModelContent();
        } else if (filterType === 'sort') {
            return window.getMarketSortContent();
        } else if (filterType === 'price') {
            return window.getMarketPriceContent();
        }
    } else if (section === 'home') {
        if (filterType === 'category') {
            return await window.getHomeCategoryContent();
        } else if (filterType === 'rarity') {
            return window.getHomeRarityContent();
        } else if (filterType === 'sort') {
            return window.getHomeSortContent();
        }
    }
    
    if (filterType === 'collection') {
        try {
            const collections = await fetchProfileCollections();

            if (!collections || collections.length === 0) {
                return `<div class="filter-empty-state"><p>Коллекций не найдено</p></div>`;
            }

            // === НОВЫЙ КОД: Получаем NFT пользователя для подсчета ===
            // Получаем ID пользователя
            const tgUser = window.Telegram?.WebApp?.initDataUnsafe?.user;
            const userId = tgUser?.id;

            let userNFTs = window.cachedUserNFTs || [];

            // Если кэш пуст, пробуем загрузить
            if (userNFTs.length === 0 && userId && window.socket?.connected) {
                console.log('📥 Загружаем NFT пользователя для подсчета коллекций...');
                userNFTs = await loadUserNFTsFromServer(userId);
            }

            // Создаем объект для подсчета количества NFT по каждой коллекции
            const collectionCounts = {};
            userNFTs.forEach(nft => {
                if (nft.collectionId) {
                    collectionCounts[nft.collectionId] = (collectionCounts[nft.collectionId] || 0) + 1;
                }
            });
            console.log('📊 Статистика по коллекциям:', collectionCounts);
            // === КОНЕЦ НОВОГО КОДА ===

            let html = '<div class="filter-container">';

            html += collections.map(collection => {
                const collectionId = collection.id;
                const isSelected = currentFilters.collection.includes(collectionId);

                // === ИСПРАВЛЕНИЕ: Используем подсчитанное количество вместо collection.userNFTCount ===
                const userNFTCount = collectionCounts[collectionId] || 0;

                let imageHtml = collection.image_file_id ? 
                    `<div class="filter-item-image">
                        <img src="/m_nft_image/base/${collection.image_file_id}" 
                             style="width: 35px; height: 35px; border-radius: 10px; object-fit: cover;">
                     </div>` :
                    `<span style="font-size: 1.2em; margin-right: 8px;">🎴</span>`;

                return `
                    <div class="filter-item" onclick="selectFilterItem('collection', ${collectionId}, '${escapeHtml(collection.name)}')">
                        <div class="filter-item-content">
                            <span class="filter-item-name">
                                ${imageHtml}
                                ${escapeHtml(collection.name)}
                                <span style="font-size: 0.8em; color: var(--text-secondary); margin-left: 6px; background: var(--surface-dark); padding: 2px 6px; border-radius: 8px;">
                                        ${userNFTCount} шт.
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

            html += '</div>';
            return html;

        } catch (error) {
            console.error('❌ Ошибка загрузки коллекций:', error);
            return '<p style="color: var(--text-secondary); text-align: center; padding: 20px;">Ошибка загрузки коллекций</p>';
        }
    }
    
    else if (filterType === 'model') {
        try {
            const allModels = await fetchProfileModels();
            console.log('📊 Выбранные коллекции:', currentFilters.collection);

            if (!allModels || allModels.length === 0) {
                return `
                    <div class="filter-empty-state">
                        <div class="empty-icon">🖼️</div>
                        <p>Модели не найдены</p>
                    </div>
                `;
            }

            // Фильтруем модели по выбранным коллекциям
            let modelsToShow = allModels;

            if (currentFilters.collection && currentFilters.collection.length > 0) {
                const selectedCollectionIds = currentFilters.collection
                    .map(id => parseInt(id))
                    .filter(id => !isNaN(id));
                
                if (selectedCollectionIds.length > 0) {
                    modelsToShow = allModels.filter(model => {
                        if (!model.collection_id) return false;
                        return selectedCollectionIds.includes(model.collection_id);
                    });
                }
            }

            if (modelsToShow.length === 0) {
                return `
                    <div class="filter-empty-state">
                        <div class="empty-icon">🎨</div>
                        <p>Нет моделей для выбранных коллекций</p>
                    </div>
                `;
            }

            const modelsByCollection = {};
            modelsToShow.forEach(model => {
                let collectionName = model.collection_name || 'Другие';
                if (!collectionName || collectionName === 'Другие') {
                    if (model.collection_id === 1) collectionName = 'Caps';
                    else if (model.collection_id === 2) collectionName = 'Cars';
                    else if (model.collection_id === 3) collectionName = 'Pencils';
                    else if (model.collection_id === 4) collectionName = 'Pepes';
                    else collectionName = 'Другие';
                }
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
                    // ВАЖНО: Используем currentFilters для профиля, а не marketFilters
                    const isSelected = currentFilters.model.includes(modelId);

                    const imagePath = model.file_name ? 
                        `/m_nft_image/${collectionName}/${model.file_name}.PNG` : null;

                    let imageHtml = '';
                    if (imagePath) {
                        imageHtml = `
                            <div class="filter-item-image" style="width: 40px; height: 40px; margin-right: 12px; overflow: hidden;">
                                <img src="${imagePath}" 
                                     alt="${escapeHtml(model.name)}" 
                                     style="width: 100%; height: 100%; object-fit: contain;">
                            </div>
                        `;
                    } else {
                        imageHtml = `<span style="font-size: 1.5em; margin-right: 12px;">🖼️</span>`;
                    }

                    html += `
                        <div class="filter-item" onclick="selectFilterItem('model', ${modelId}, '${escapeHtml(model.name)}')">
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
            console.error('❌ Ошибка загрузки моделей:', error);
            return `
                <div class="filter-empty-state">
                    <div class="empty-icon">⚠️</div>
                    <p>Ошибка загрузки моделей</p>
                </div>
            `;
        }
    }
    
    else if (filterType === 'pattern' || filterType === 'symbol') {
        try {
            const patterns = await fetchProfilePatterns();
            
            if (!patterns || patterns.length === 0) {
                return `<div class="filter-empty-state"><p>Узоры не найдены</p></div>`;
            }
            
            let html = '<div class="filter-container">';
            
            html += patterns.map(pattern => {
                const patternId = pattern.id;
                const isSelected = currentFilters.symbol.includes(patternId.toString());
                
                const svgPath = pattern.file_name ? 
                    `/m_nft_image/patterns/${pattern.file_name}.svg` : null;
                
                let imageHtml = svgPath ?
                    `<div class="filter-item-image">
                        <img src="${svgPath}" style="width: 25px; height: 25px; object-fit: contain;">
                     </div>` :
                    `<span style="font-size: 1.2em; margin-right: 8px;">🎨</span>`;
                
                return `
                    <div class="filter-item" onclick="selectFilterItem('symbol', ${patternId}, '${escapeHtml(pattern.name)}')">
                        <div class="filter-item-content">
                            <span class="filter-item-name">
                                ${imageHtml}
                                ${escapeHtml(pattern.name)}
                                <span style="font-size: 0.8em; margin-left: 6px; padding: 2px 6px; border-radius: 8px;">
                                    ${pattern.rarity}%
                                </span>
                            </span>
                        </div>
                        <div class="filter-item-checkbox">
                            <input type="checkbox" id="symbol_${patternId}" ${isSelected ? 'checked' : ''}>
                            <label for="symbol_${patternId}"></label>
                        </div>
                    </div>
                `;
            }).join('');
            
            html += '</div>';
            return html;
            
        } catch (error) {
            console.error('❌ Ошибка загрузки узоров:', error);
            return '<p style="color: var(--text-secondary); text-align: center; padding: 20px;">Ошибка загрузки узоров</p>';
        }
    }
    
    else if (filterType === 'background') {
        try {
            const backgrounds = await fetchProfileBackgrounds();
            
            if (!backgrounds || backgrounds.length === 0) {
                return `<div class="filter-empty-state"><p>Фоны не найдены</p></div>`;
            }
            
            let html = '<div class="filter-container">';
            
            html += backgrounds.map(background => {
                const backgroundId = background.id;
                const isSelected = currentFilters.background.includes(backgroundId.toString());
                
                const gradientStyle = `radial-gradient(circle, #${background.back_0} 0%, #${background.back_100} 100%)`;
                
                return `
                    <div class="filter-item" onclick="selectFilterItem('background', ${backgroundId}, '${escapeHtml(background.name)}')">
                        <div class="filter-item-content">
                            <span class="filter-item-name">
                                <div class="filter-item-image" 
                                     style="width: 35px; 
                                            height: 35px; 
                                            border-radius: 6px; 
                                            background: ${gradientStyle};
                                            margin-right: 8px;
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
            console.error('❌ Ошибка загрузки фонов:', error);
            return '<p style="color: var(--text-secondary); text-align: center; padding: 20px;">Ошибка загрузки фонов</p>';
        }
    }
    
    else if (filterType === 'filter') {
        // Существующий код для фильтров сортировки
        const filterOptions = [
            { id: 'newest', name: 'Сначала новые' },
            { id: 'oldest', name: 'Сначала старые' },
            { id: 'rarity-high', name: 'Сначала редкие' },
            { id: 'rarity-low', name: 'Сначала обычные' },
            { id: 'number-low', name: 'По номеру ↑' },
            { id: 'number-high', name: 'По номеру ↓' },
            { id: 'collection', name: 'По коллекциям' }
        ];
        
        let html = '<div class="filter-container">';
        
        html += filterOptions.map(option => {
            const isSelected = currentFilters.filter === option.id;
            
            return `
                <div class="filter-item" onclick="selectProfileFilterButton('${option.id}', '${option.name}')">
                    <div class="filter-item-content">
                        <span class="filter-item-name">
                            ${option.name}
                        </span>
                    </div>
                    <div class="filter-item-checkbox">
                        <input type="checkbox" id="filter_${option.id}" ${isSelected ? 'checked' : ''}>
                        <label for="filter_${option.id}"></label>
                    </div>
                </div>
            `;
        }).join('');
        
        html += '</div>';
        return html;
    }
    
    return '<p style="color: var(--text-secondary); text-align: center; padding: 20px;">Фильтр не найден</p>';
}

function toggleProfileFilter(filterId, isChecked) {
    if (isChecked) {
        // Сначала снимаем все остальные чекбоксы
        document.querySelectorAll('input[id^="filter_"]').forEach(cb => {
            if (cb.id !== `filter_${filterId}`) {
                cb.checked = false;
            }
        });
        
        // Устанавливаем новый фильтр
        currentFilters.filter = filterId;
    } else {
        // Снимаем фильтр
        currentFilters.filter = null;
    }
    
    // Обновляем отображение
    updateActiveFilters();
    
    // Вибрация
    if (window.vibrate) {
        window.vibrate([3, 5, 3]);
    }
}

function setupFilterModalClickOutside() {
    const modal = document.getElementById('filterModal');
    if (!modal) return;
    
    // Удаляем старый обработчик, если был
    modal.removeEventListener('click', modalClickHandler);
    
    // Добавляем новый
    modal.addEventListener('click', modalClickHandler);
    
    // Также закрытие по Escape
    document.addEventListener('keydown', function(event) {
        if (event.key === 'Escape' && modal.classList.contains('active')) {
            closeFilterModal();
        }
    });
}

function modalClickHandler(event) {
    const modal = document.getElementById('filterModal');
    // Если клик был на самом модальном окне (не на контенте)
    if (event.target === modal) {
        closeFilterModal(); // Теперь это отмена
    }
}

function getFilterTitle(filterType) {
    const titles = {
        'collection': 'Коллекция',
        'model': 'Модель',
        'symbol': 'Символ',
        'background': 'Фон',
        'filter': 'Фильтры'
    };
    return titles[filterType] || filterType;
}

async function fetchCollections(forceRefresh = false) {
    try {
        // Если уже есть кэш и не требуется принудительное обновление
        if (cachedCollections && !forceRefresh) {
            return cachedCollections;
        }
        
        let collections = [];
        
        if (window.socket && window.socket.connected) {
            collections = await new Promise((resolve) => {
                window.socket.emit('get_collections');
                window.socket.once('collections_list', async (data) => {
                    resolve(data.success ? data.collections : []);
                });
            });
        } else {
            const response = await fetch('/api/collections');
            const data = await response.json();
            collections = data.success ? data.collections : [];
        }
        
        // Обрабатываем количество NFT пользователя
        const processedCollections = await processCollectionCounts(collections);
        
        // Кэшируем результат
        cachedCollections = processedCollections;
        
        return processedCollections;
    } catch (error) {
        console.error('Error fetching collections:', error);
        return [];
    }
}

// Функция для подсчета NFT пользователя по коллекциям
async function processCollectionCounts(collections) {
    console.log('🔢 Начало подсчета NFT по коллекциям');
    
    // Получаем ID пользователя
    const tgUser = window.Telegram?.WebApp?.initDataUnsafe?.user;
    const userId = tgUser?.id;
    
    if (!userId) {
        console.log('⚠️ Нет ID пользователя, пропускаем подсчет');
        return collections;
    }
    
    console.log('👤 User ID для подсчета:', userId);
    
    try {
        // Загружаем NFT пользователя (кэшируем)
        if (cachedUserNFTs.length === 0) {
            console.log('📥 Загружаем NFT пользователя...');
            cachedUserNFTs = await loadUserNFTsFromServer(userId);
            console.log(`📥 NFT пользователя загружено: ${cachedUserNFTs.length}`);
        } else {
            console.log(`📦 Используем кэшированные NFT: ${cachedUserNFTs.length}`);
        }
        
        // Подсчитываем количество NFT по каждой коллекции
        const collectionCounts = {};
        cachedUserNFTs.forEach(nft => {
            if (nft.collectionId) {
                collectionCounts[nft.collectionId] = (collectionCounts[nft.collectionId] || 0) + 1;
            }
        });
        
        console.log('📈 Статистика по коллекциям:', collectionCounts);
        
        // Обновляем коллекции с количеством NFT пользователя
        const result = collections.map(collection => {
            const userNFTCount = collectionCounts[collection.id] || 0;
            console.log(`Коллекция ${collection.id} (${collection.name}): ${userNFTCount} NFT`);
            
            return {
                ...collection,
                userNFTCount: userNFTCount
            };
        });
        
        console.log('✅ Подсчет завершен');
        return result;
    } catch (error) {
        console.error('❌ Ошибка processing collection counts:', error);
        return collections;
    }
}

// Выбор элемента фильтра (для collection, model, symbol, background)
function selectFilterItem(filterType, itemId, itemName) {
    const activeSection = document.querySelector('.section.active')?.id;
    
    if (activeSection === 'profile') {
        selectProfileFilterItem(filterType, itemId);
    } else if (activeSection === 'market') {
        selectMarketFilterItem(filterType, itemId);
    } else if (activeSection === 'home') {
        if (window.selectHomeFilterItem) {
            window.selectHomeFilterItem(filterType, itemId, itemName);
        }
    }
}

// Выбор элемента фильтра для профиля
function selectProfileFilterItem(filterType, itemId) {
    console.log(`🔘 selectProfileFilterItem: ${filterType}, ID: ${itemId}`);
    
    const itemIdNum = Number(itemId);
    let checkboxId;
    let filterArray;
    
    if (filterType === 'collection') {
        checkboxId = `collection_${itemIdNum}`;
        filterArray = currentFilters.collection;
    } else if (filterType === 'model') {
        checkboxId = `model_${itemIdNum}`;
        filterArray = currentFilters.model;
    } else if (filterType === 'symbol' || filterType === 'pattern') {
        checkboxId = `symbol_${itemIdNum}`;
        filterArray = currentFilters.symbol;
    } else if (filterType === 'background') {
        checkboxId = `background_${itemIdNum}`;
        filterArray = currentFilters.background;
    } else {
        return;
    }
    
    const checkbox = document.getElementById(checkboxId);
    if (!checkbox) return;
    
    // Инвертируем состояние чекбокса
    if (checkbox.checked) {
        // Если чекбокс был отмечен - снимаем отметку
        const index = filterArray.indexOf(itemIdNum);
        if (index > -1) {
            filterArray.splice(index, 1);
        }
        checkbox.checked = false;
    } else {
        // Если чекбокс не был отмечен - отмечаем
        if (!filterArray.includes(itemIdNum)) {
            filterArray.push(itemIdNum);
        }
        checkbox.checked = true;
    }
    
    console.log(`📌 Новое состояние фильтра ${filterType}:`, [...filterArray]);
    
    // Если меняется коллекция - сбрасываем модели
    if (filterType === 'collection') {
        console.log('🔄 Изменились коллекции, сбрасываем модели');
        currentFilters.model = [];
        
        // Обновляем чекбоксы моделей в DOM
        document.querySelectorAll('input[id^="model_"]').forEach(cb => {
            cb.checked = false;
        });
        
        // Если открыта модалка моделей - обновляем её содержимое
        const modalTitle = document.getElementById('filterModalTitle');
        if (modalTitle && modalTitle.textContent === 'Выбор модели') {
            refreshModelsFilterContent();
        }
    }
    
    if (window.vibrate) {
        window.vibrate([3, 5, 3]);
    }
}

// Выбор кнопки фильтра (для типа 'filter')
function selectFilterButton(filterId, filterName) {
    // Определяем, в какой секции мы находимся
    const activeSection = document.querySelector('.section.active')?.id;
    
    if (activeSection === 'profile') {
        // Используем логику профиля
        selectProfileFilterButton(filterId, filterName);
    } else if (activeSection === 'market') {
        // Используем логику маркета
        selectMarketFilterButton(filterId, filterName);
    }
}

// Выбор кнопки фильтра для маркета
function selectMarketFilterButton(filterId, filterName) {
    // Сначала снимаем выделение со всех кнопок фильтра
    document.querySelectorAll('.filter-button-option').forEach(button => {
        button.classList.remove('active');
    });
    
    if (marketFilters.filter === filterId) {
        // Снимаем выбор
        marketFilters.filter = null;
    } else {
        // Выбираем новый фильтр
        marketFilters.filter = filterId;
        // Добавляем класс active к выбранной кнопке
        const activeButton = document.querySelector(`.filter-button-option[onclick*="${filterId}"]`);
        if (activeButton) {
            activeButton.classList.add('active');
        }
    }
    
    // Вибрация
    if (window.vibrate) {
        window.vibrate([3, 5, 3]);
    }
}

// Выбор кнопки фильтра для профиля
function selectProfileFilterButton(filterId, filterName) {
    const checkbox = document.getElementById(`filter_${filterId}`);
    if (!checkbox) return;
    
    // Снимаем все остальные чекбоксы фильтров
    document.querySelectorAll('input[id^="filter_"]').forEach(cb => {
        if (cb.id !== `filter_${filterId}`) {
            cb.checked = false;
        }
    });
    
    if (checkbox.checked) {
        // Если уже выбран - снимаем
        checkbox.checked = false;
        currentFilters.filter = null;
    } else {
        // Выбираем новый
        checkbox.checked = true;
        currentFilters.filter = filterId;
    }
    
    // УБИРАЕМ ВЫЗОВ updateActiveFilters()
    
    // Вибрация
    if (window.vibrate) {
        window.vibrate([3, 5, 3]);
    }
}

// Обновление отображения активных фильтров
function updateActiveFilters() {
    const filterCards = document.querySelectorAll('.profile-filter-card');
    
    filterCards.forEach(card => {
        const onclickAttr = card.getAttribute('onclick');
        if (!onclickAttr) return;
        
        const match = onclickAttr.match(/'([^']+)'/);
        if (!match) return;
        
        const filterType = match[1];
        let isActive = false;
        let count = 0;
        
        if (filterType === 'collection' && currentFilters.collection) {
            isActive = currentFilters.collection.length > 0;
            count = currentFilters.collection.length;
        } else if (filterType === 'model' && currentFilters.model) {
            isActive = currentFilters.model.length > 0;
            count = currentFilters.model.length;
        } else if (filterType === 'symbol' && currentFilters.symbol) {
            isActive = currentFilters.symbol.length > 0;
            count = currentFilters.symbol.length;
        } else if (filterType === 'background' && currentFilters.background) {
            isActive = currentFilters.background.length > 0;
            count = currentFilters.background.length;
        } else if (filterType === 'filter') {
            isActive = currentFilters.filter !== null;
            count = currentFilters.filter ? 1 : 0;
        }
        
        if (isActive) {
            card.classList.add('active');
        } else {
            card.classList.remove('active');
        }
        
        updateFilterCardText(filterType, count, isActive);
    });
}

// Вспомогательная функция для капитализации первой буквы
function capitalizeFirstLetter(string) {
    return string.charAt(0).toUpperCase() + string.slice(1);
}

// Обновление текста в карточке фильтра
function updateFilterCardText(filterType, count, isActive) {
    const filterValueElement = document.getElementById(`selected${capitalizeFirstLetter(filterType)}Filter`);
    if (!filterValueElement) return;
    
    if (filterType === 'filter') {
        // Для типа фильтра показываем название выбранного фильтра
        if (currentFilters.filter) {
            const filterNames = {
                'newest': 'Новые',
                'oldest': 'Старые',
                'rarity-high': 'Редкость ↓',
                'rarity-low': 'Редкость ↑',
                'number-low': 'Номер ↑',
                'number-high': 'Номер ↓',
                'collection': 'Коллекция'
            };
            filterValueElement.textContent = filterNames[currentFilters.filter] || 'Выбрано';
        } else {
            filterValueElement.textContent = 'Нет';
        }
    } else if (isActive) {
        // Для остальных фильтров показываем количество выбранных
        filterValueElement.textContent = count === 1 ? '1 выбрано' : `${count} выбрано`;
    } else {
        // Если ничего не выбрано
        filterValueElement.textContent = filterType === 'filter' ? 'Нет' : 'Все';
    }
}

function hasActiveFilters() {
    return currentFilters.collection.length > 0 || 
           currentFilters.model.length > 0 || 
           currentFilters.symbol.length > 0 || 
           currentFilters.background.length > 0 || 
           currentFilters.filter !== null;
}

// Вспомогательная функция: определяет тип фильтра по заголовку
function getFilterTypeByTitle(title) {
    const titlesMap = {
        'Выбор коллекции': 'collection',
        'Выбор модели': 'model',
        'Выбор символа': 'symbol',
        'Выбор фона': 'background',
        'Фильтры': 'filter'
    };
    return titlesMap[title] || null;
}

// Очистка всех фильтров
function clearFilters() {
    console.log('🧹 clearFilters вызвана');
    
    // Определяем активную секцию
    const activeSection = document.querySelector('.section.active')?.id;
    console.log('📍 Активная секция:', activeSection);
    
    if (activeSection === 'profile') {
        // Для профиля используем clearProfileFilters
        if (typeof window.clearProfileFilters === 'function') {
            window.clearProfileFilters();
        } else {
            console.error('❌ Функция clearProfileFilters не найдена');
            clearProfileFilters(); // Прямой вызов
        }
    } 
    else if (activeSection === 'market') {
        // Для маркета используем clearMarketFilters
        if (typeof window.clearMarketFilters === 'function') {
            window.clearMarketFilters();
        } else {
            console.error('❌ Функция clearMarketFilters не найдена');
        }
    }
    else if (activeSection === 'home') {
        // Для главной страницы (если нужно)
        if (typeof window.clearHomeFilters === 'function') {
            window.clearHomeFilters();
        } else {
            closeFilterModal();
        }
    }
    else {
        // Если секция не определена, просто закрываем
        closeFilterModal();
    }
}

// Вспомогательная функция для обновления содержимого текущего фильтра
async function refreshCurrentFilterContent() {
    const modalTitle = document.getElementById('filterModalTitle');
    const modalBody = document.getElementById('filterModalBody');
    
    if (!modalTitle || !modalBody) return;
    
    const title = modalTitle.textContent;
    let filterType = null;
    
    if (title === 'Выбор коллекции') filterType = 'collection';
    else if (title === 'Выбор модели') filterType = 'model';
    else if (title === 'Выбор узора') filterType = 'symbol';
    else if (title === 'Выбор фона') filterType = 'background';
    else if (title === 'Фильтры') filterType = 'filter';
    
    if (filterType) {
        const filterContent = await getFilterContent(filterType);
        modalBody.innerHTML = filterContent;
    }
}


// Функция очистки конкретного типа фильтра
function clearFilterType(filterType) {
    switch(filterType) {
        case 'collection':
            currentFilters.collection = [];
            document.querySelectorAll('input[id^="collection_"]').forEach(cb => {
                cb.checked = false;
            });
            break;
            
        case 'filter':
            currentFilters.filter = null;
            // Снимаем все чекбоксы фильтров
            document.querySelectorAll('input[id^="filter_"]').forEach(cb => {
                cb.checked = false;
            });
            break;
            
        // Остальные типы пока не реализованы
        case 'model':
        case 'symbol':
        case 'background':
            currentFilters[filterType] = [];
            break;
    }
    
    // Вибрация
    if (window.vibrate) {
        window.vibrate([5, 3, 5]);
    }
}

// Применение фильтров
function applyFilters() {
    console.log('🔵 applyFilters вызвана');
    console.log('📊 Текущие фильтры ДО применения:', JSON.stringify(currentFilters, null, 2));
    
    // Обновляем UI карточек фильтров
    updateActiveFilters();
    
    // Определяем, в какой секции мы находимся
    const activeSection = document.querySelector('.section.active')?.id;
    console.log('📍 Активная секция:', activeSection);
    
    // Загружаем данные с новыми фильтрами
    if (activeSection === 'profile') {
        console.log('📦 Загружаем инвентарь профиля с фильтрами');
        loadInventoryItems();
    } else if (activeSection === 'market' && window.loadMarketItems) {
        console.log('🛒 Загружаем маркет с фильтрами');
        window.loadMarketItems();
    }
    
    // Закрываем модалку
    const modal = document.getElementById('filterModal');
    if (modal) {
        modal.classList.remove('active');
    }
    
    // Обновляем снимок новым состоянием
    filtersSnapshot = {
        collection: [...currentFilters.collection],
        model: [...currentFilters.model],
        symbol: [...currentFilters.symbol],
        background: [...currentFilters.background],
        filter: currentFilters.filter
    };
    
    console.log('✅ applyFilters завершена, новый снимок:', filtersSnapshot);
    
    // Вибрация
    if (window.vibrate) {
        window.vibrate([3, 5, 3]);
    }
}

async function loadUserNFTsFromServer(userId) {
    try {
        // Используем socket.io для получения NFT
        if (window.socket && window.socket.connected) {
            return new Promise((resolve) => {
                window.socket.emit('get_user_nfts', userId);
                window.socket.once('user_nfts', (data) => {
                    if (data.success) {                        
                        // ОБНОВЛЯЕМ ГЛОБАЛЬНЫЙ КЭШ
                        window.cachedUserNFTs = data.nfts || [];
                        console.log('✅ Кэш обновлен через socket');
                        
                        resolve(window.cachedUserNFTs);
                    } else {
                        console.error('Error loading NFTs:', data.error);
                        resolve([]);
                    }
                });
            });
        } else {
            console.error('Error loading NFTs:', data.error);
        }
    } catch (error) {
        console.error('Error loading NFTs:', error);
        return [];
    }
}

// Загрузка предметов инвентаря

async function loadInventoryItems() {
    console.log('🔄 loadInventoryItems вызвана');
    console.log('📊 Текущие фильтры для запроса:', JSON.stringify(currentFilters, null, 2));
    
    if (window.nftLoadInProgress) {
        console.log('⏳ Загрузка уже в процессе, пропускаем');
        return;
    }
    window.nftLoadInProgress = true;
    
    const inventoryGrid = document.getElementById('inventoryGrid');
    if (!inventoryGrid) {
        console.error('❌ Не найден элемент inventoryGrid');
        window.nftLoadInProgress = false;
        return;
    }
    
    // Получаем ID пользователя из Telegram
    const tgUser = window.Telegram?.WebApp?.initDataUnsafe?.user;
    const userId = tgUser?.id;
    
    if (!userId) {
        console.error('❌ Нет ID пользователя');
        inventoryGrid.innerHTML = `
            <div class="empty-inventory">
                <div class="empty-icon">🔒</div>
                <p>Пользователь не авторизован</p>
                <p class="empty-hint">Войдите через Telegram</p>
            </div>
        `;
        window.nftLoadInProgress = false;
        return;
    }
    
    console.log('👤 User ID:', userId);
    
    try {
        const filterData = {
            collection: currentFilters.collection.length > 0 ? currentFilters.collection : undefined, // теперь просто массив чисел
            model: currentFilters.model.length > 0 ? currentFilters.model : undefined,
            symbol: currentFilters.symbol.length > 0 ? currentFilters.symbol : undefined,
            background: currentFilters.background.length > 0 ? currentFilters.background : undefined,
            sort: currentFilters.filter || undefined
        };
        
        console.log('📤 Отправка запроса на сервер:', {
            userId,
            filters: filterData
        });
        
        let userNFTs = [];
        
        if (window.socket && window.socket.connected) {
            console.log('🔌 Socket подключен, отправляем запрос');
            
            userNFTs = await new Promise((resolve, reject) => {
                const timeoutId = setTimeout(() => {
                    console.log('⚠️ Таймаут загрузки инвентаря');
                    resolve([]);
                }, 10000);
                
                const handleResponse = (data) => {
                    clearTimeout(timeoutId);
                    window.socket.off('user_nfts_with_filters', handleResponse);
                    
                    console.log('📥 Получен ответ от сервера:', data);
                    
                    if (data.success && data.nfts) {
                        console.log(`✅ Загружено ${data.nfts.length} NFT с серверными фильтрами`);
                        console.log('📊 Первый NFT из ответа:', data.nfts[0]);
                        
                        // Кэшируем NFT
                        window.cachedUserNFTs = data.nfts;
                        resolve(data.nfts);
                    } else {
                        console.error('❌ Ошибка загрузки инвентаря:', data.error);
                        resolve([]);
                    }
                };
                
                window.socket.once('user_nfts_with_filters', handleResponse);
                window.socket.emit('get_user_nfts_with_filters', { 
                    userId, 
                    filters: filterData 
                });
                console.log('📨 Отправлен socket-событие: get_user_nfts_with_filters');
            });
        } else {
            console.log('⚠️ Socket не подключен, используем кэшированные данные');
            userNFTs = window.cachedUserNFTs || [];
        }
        
        console.log(`📊 Получено ${userNFTs.length} NFT от сервера`);
        
        if (userNFTs.length === 0) {
            console.log('📭 Нет NFT для отображения');
            inventoryGrid.innerHTML = `
                <div class="empty-inventory">
                    <div class="empty-icon">🎁</div>
                    <p>Инвентарь пуст</p>
                    <p class="empty-hint">У вас пока нет NFT</p>
                </div>
            `;
            window.nftLoadInProgress = false;
            return;
        }
        
        inventoryGrid.innerHTML = userNFTs.map((nft, index) => {
            const isOnSale = nft.forSale === true || nft.forSale === 1 || nft.forSale === 'true' || nft.forSale === '1';
            const isUpgraded = nft.update === 1;
            const isPinned = nft.pinned && nft.pinned > 0;
            const cardBackgroundStyle = getNFTCardBackground(nft);
            const patternHtml = (isUpgraded && nft.patternData && nft.patternData.file_name) 
                ? getNFTCardFullPatternProfile(`/m_nft_image/patterns/${nft.patternData.file_name}.svg`,
                    nft.backgroundData?.back_0)
                : '';

            // Определяем нужно ли показывать стикер и какой
            let stickerClass = '';
            let stickerText = '';
            let showSticker = false;

            if (isOnSale) {
                // Плашка маркета показывается у ВСЕХ NFT на продаже (и улучшенных, и нет)
                stickerClass = 'market';
                stickerText = 'Маркет';
                showSticker = true;
            } else if (!isUpgraded) {
                // Плашка редкости показывается ТОЛЬКО у НЕулучшенных NFT
                const rarityClass = nft.rarity ? nft.rarity.toLowerCase() : 'обычный';
                const rarityStickerClass = {
                    'легендарный': 'legendary',
                    'эпический': 'epic',
                    'редкий': 'rare',
                    'обычный': 'common'
                }[rarityClass] || 'common';

                stickerClass = rarityStickerClass;

                const rarityShortNames = {
                    'Легендарный': 'Легенд.',
                    'Эпический': 'Эпич.',
                    'Редкий': 'Редкий',
                    'Обычный': 'Обыч.'
                };
                stickerText = rarityShortNames[nft.rarity] || nft.rarity || 'Обыч.';
                showSticker = true;
            }
            
            return `
                <div class="inventory-item in" onclick="viewNFT(${nft.id})" 
                     style="${cardBackgroundStyle} animation-delay: ${index * 0.05}s; position: relative;">
            
                    ${patternHtml}
            
                    <!-- СТИКЕР РЕДКОСТИ (повернутый на 45°) -->
                    ${showSticker ? `
                        <div class="nft-rarity-sticker ${stickerClass}">
                            <div class="nft-rarity-sticker-container">
                                ${stickerText}
                            </div>
                        </div>
                    ` : ''}
            
                    <div style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; 
                        background: linear-gradient(to top, rgba(13, 13, 16, 0.6) 0%, 
                        rgba(13, 13, 16, 0.15) 30%, 
                        rgba(13, 13, 16, 0.1) 70%, transparent 100%);
                        border-radius: 18px; z-index: 1;"></div>
            
                    <!-- Значок закрепления (левая сторона) -->
                    ${isPinned ? '<div class="pinned-badge" title="Закреплен"><svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24"><path fill="currentColor" d="M16 5v7l1.7 1.7q.15.15.225.338t.075.387V15q0 .425-.288.712T17 16h-4v5.85q0 .425-.288.713T12 22.85t-.712-.288T11 21.85V16H7q-.425 0-.712-.288T6 15v-.575q0-.2.075-.387T6.3 13.7L8 12V5q-.425 0-.712-.288T7 4t.288-.712T8 3h8q.425 0 .713.288T17 4t-.288.713T16 5"/></svg></div>' : ''}
            
                    <div class="inventory-item-image" style="position: relative; z-index: 2;">
                        ${generateNFTImageHTML(nft)}
                    </div>
            
                    <div class="inventory-item-info" style="position: relative; z-index: 3;">
                        <h4 class="nft-name" style="text-shadow: 0 1px 2px rgba(0,0,0,0.3);">
                            ${nft.fullName || 'NFT #' + (nft.number || '?')}
                        </h4>
                    </div>
                </div>
            `;
        }).join('');
        
        console.log('✅ Инвентарь успешно загружен с серверной фильтрацией');
        window.nftLoadInProgress = false;
        
    } catch (error) {
        console.error('❌ Ошибка загрузки инвентаря:', error);
        inventoryGrid.innerHTML = `
            <div class="empty-inventory">
                <div class="empty-icon">⚠️</div>
                <p>Ошибка загрузки</p>
                <p class="empty-hint">${error.message || 'Неизвестная ошибка'}</p>
            </div>
        `;
        window.nftLoadInProgress = false;
    }
}

const rarityShortNames = {
    'Легендарный': 'Легенд.',
    'Эпический': 'Эпич.',
    'Редкий': 'Редкий',
    'Обычный': 'Обычный'
};

// Функция для отмены фильтров профиля (аналогично маркету)
function cancelProfileFilters() {
    // Восстанавливаем фильтры из снимка
    if (filtersSnapshot) {
        currentFilters.collection = [...filtersSnapshot.collection];
        currentFilters.model = [...filtersSnapshot.model];
        currentFilters.symbol = [...filtersSnapshot.symbol];
        currentFilters.background = [...filtersSnapshot.background];
        currentFilters.filter = filtersSnapshot.filter;
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

// Функция применения фильтров профиля
function applyProfileFilters() {
    // Обновляем UI
    updateActiveFilters();
    
    // Загружаем NFT с примененными фильтрами
    loadInventoryItems();
    
    // Закрываем модалку
    const modal = document.getElementById('filterModal');
    if (modal) {
        modal.classList.remove('active');
    }
    
    // Сбрасываем снимок
    filtersSnapshot = null;
    
    // Вибрация
    if (window.vibrate) {
        window.vibrate([3, 5, 3]);
    }
}

// Обновляем функцию clearFilters для профиля
function clearProfileFilters() {
    console.log('🧹 clearProfileFilters вызвана');
    
    const modalTitle = document.getElementById('filterModalTitle');
    const title = modalTitle?.textContent;
    
    let filterType = null;
    if (title === 'Выбор коллекции') filterType = 'collection';
    else if (title === 'Выбор модели') filterType = 'model';
    else if (title === 'Выбор узора') filterType = 'symbol';
    else if (title === 'Выбор фона') filterType = 'background';
    else if (title === 'Фильтры') filterType = 'filter';
    
    if (!filterType) {
        closeFilterModal();
        return;
    }
    
    console.log(`🧹 Очистка фильтра профиля: ${filterType}`);
    
    // Очищаем ТОЛЬКО текущий тип фильтра
    if (filterType === 'collection') {
        currentFilters.collection = [];
    } 
    else if (filterType === 'model') {
        currentFilters.model = [];
    }
    else if (filterType === 'symbol') {
        currentFilters.symbol = [];
    }
    else if (filterType === 'background') {
        currentFilters.background = [];
    }
    else if (filterType === 'filter') {
        currentFilters.filter = null;
    }
    
    console.log('📊 currentFilters ПОСЛЕ очистки:', JSON.stringify(currentFilters));
    
    // Обновляем снимок новым состоянием
    filtersSnapshot = {
        collection: [...currentFilters.collection],
        model: [...currentFilters.model],
        symbol: [...currentFilters.symbol],
        background: [...currentFilters.background],
        filter: currentFilters.filter
    };
    
    // Обновляем UI карточек фильтров
    updateActiveFilters();
    
    // Загружаем данные с очищенными фильтрами
    loadInventoryItems();
    
    // Закрываем модалку
    closeFilterModal();
    
    if (window.vibrate) {
        window.vibrate([5, 3, 5]);
    }
}

// Функция получения цвета редкости
function getRarityColor(rarity) {
    const colors = {
        'Легендарный': '#a6953c',
        'Эпический': '#7154ac',
        'Редкий': '#3a54a4',
        'Обычный': '#808080'
    };
    return colors[rarity] || '#808080';
}

function generateNFTImageHTML(nft) {
    // Функция теперь возвращает только изображение без фона
    if (nft.update === 1 && nft.modelData && nft.modelData.file_name) {
        // Улучшенный NFT - только изображение модели
        const modelImagePath = `/m_nft_image/${nft.collectionName || nft.collection_name}/${nft.modelData.file_name}.PNG`;
        
        return `
            <div style="width: 100%; height: 100%; position: relative; display: flex; align-items: center; justify-content: center;">
                <img src="${modelImagePath}" 
                     alt="${nft.modelData.name}" 
                     style="width: 100%; height: 100%; object-fit: contain; position: relative; z-index: 2;">
            </div>
        `;
    } else {
        // Не улучшенный NFT
        if (typeof nft.image === 'string' && (nft.image.includes('<') || nft.image.includes('&lt;'))) {
            return nft.image;
        }
        
        if (typeof nft.image === 'string' && (nft.image.startsWith('/') || nft.image.startsWith('http'))) {
            return `<img src="${nft.image}" alt="${nft.fullName}" style="width: 100%; height: 100%; object-fit: contain;">`;
        }
        
        return `<span style="font-size: 2em;">${nft.image || '🎴'}</span>`;
    }
}

// Новая функция для получения данных фона карточки
function getNFTCardBackground(nft) {
    if (nft.update === 1 && nft.backgroundData && nft.backgroundData.back_0 && nft.backgroundData.back_100) {
        // ТОЧНО такой же градиент как в модалке
        return `background: radial-gradient(circle, #${nft.backgroundData.back_0} 0%, #${nft.backgroundData.back_100} 75%);`;
    } else {
        // Для не-апгрейднутых NFT - тот же стиль что в модалке
        const rarityColor = getRarityColor(nft.rarity);
        return `background: ${rarityColor};`;
    }
}

function getNFTCardFullPatternProfile(svgPath, bgColor) {
    if (!svgPath) return '';
    
    const filterStyle = window.getPatternFilterStyle(bgColor);
    
    const innerCircleRadius = 18;    // В процентах от размера карточки
    const middleCircleRadius = 28;   
    const outerCircleRadius = 45;    
    const extraCircleRadius = 55;    
    
    let patternHtml = '<div class="card-pattern" style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none; border-radius: 18px; overflow: hidden;">';
    
    // 1. Внутренний круг - 6 иконок
    const innerIconsCount = 6;
    for (let i = 0; i < innerIconsCount; i++) {
        const angle = (i / innerIconsCount) * Math.PI * 2;
        const x = 50 + Math.cos(angle) * innerCircleRadius;
        const y = 50 + Math.sin(angle) * innerCircleRadius;
        
        patternHtml += `
            <div style="position: absolute;
                        top: ${y}%;
                        left: ${x}%;
                        width: 13%;     <!-- 8% от ширины карточки -->
                        height: 13%;   
                        min-width: 12px; max-width: 20px; <!-- Ограничения -->
                        min-height: 12px; max-height: 20px;
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
    
    // 2. Средний круг - 4 иконки
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
                        width: 14%;     <!-- 9% от ширины карточки -->
                        height: 14%;    <!-- 9% от высоты карточки -->
                        min-width: 14px; max-width: 22px;
                        min-height: 14px; max-height: 22px;
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
    
    // 3. Внешний круг - 12 иконок
    const outerIconsCount = 12;
    for (let i = 0; i < outerIconsCount; i++) {
        const angle = (i / outerIconsCount) * Math.PI * 2;
        const x = 50 + Math.cos(angle) * outerCircleRadius;
        const y = 50 + Math.sin(angle) * outerCircleRadius;
        
        patternHtml += `
            <div style="position: absolute;
                        top: ${y}%;
                        left: ${x}%;
                        width: 12%;     <!-- 7% от ширины карточки -->
                        height: 12%;    <!-- 7% от высоты карточки -->
                        min-width: 12px; max-width: 18px;
                        min-height: 12px; max-height: 18px;
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
    
    // 4. Самый внешний круг - 8 иконок
    const extraCircleIconsCount = 8;
    for (let i = 0; i < extraCircleIconsCount; i++) {
        const angle = (i / extraCircleIconsCount) * Math.PI * 2;
        const x = 50 + Math.cos(angle) * extraCircleRadius;
        const y = 50 + Math.sin(angle) * extraCircleRadius;
        
        patternHtml += `
            <div style="position: absolute;
                        top: ${y}%;
                        left: ${x}%;
                        width: 11%;     <!-- 6% от ширины карточки -->
                        height: 11%;    <!-- 6% от высоты карточки -->
                        min-width: 10px; max-width: 16px;
                        min-height: 10px; max-height: 16px;
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

// Добавим функцию для создания паттерна в карточке (аналогично модалке)
function getNFTCardPattern(svgPath) {
    if (!svgPath) return '';
    
    const iconSize = 30; // Меньше для карточки
    const innerCircleRadius = 15;
    const outerCircleRadius = 30;
    
    let patternHtml = '<div style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none; opacity: 0.2;">';
    
    // Внутренний круг
    const innerIconsCount = 6;
    for (let i = 0; i < innerIconsCount; i++) {
        const angle = (i / innerIconsCount) * Math.PI * 2;
        const x = 50 + Math.cos(angle) * innerCircleRadius;
        const y = 50 + Math.sin(angle) * outerCircleRadius;
        
        patternHtml += `
            <div style="position: absolute;
                        top: ${y}%;
                        left: ${x}%;
                        width: ${iconSize}px;
                        height: ${iconSize}px;
                        transform: translate(-50%, -50%);
                        background-image: url('${svgPath}');
                        background-size: contain;
                        background-repeat: no-repeat;
                        background-position: center;
                        ${filterStyle}">
            </div>
        `;
    }
    
    // Внешний круг
    const outerIconsCount = 8;
    for (let i = 0; i < outerIconsCount; i++) {
        const angle = (i / outerIconsCount) * Math.PI * 2;
        const x = 50 + Math.cos(angle) * outerCircleRadius;
        const y = 50 + Math.sin(angle) * outerCircleRadius;
        
        patternHtml += `
            <div style="position: absolute;
                        top: ${y}%;
                        left: ${x}%;
                        width: ${iconSize}px;
                        height: ${iconSize}px;
                        transform: translate(-50%, -50%);
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

// Просмотр NFT
function viewNFT(nftId) {
    console.log('👀 Открытие NFT из инвентаря:', nftId);
    
    // Добавляем визуальный фидбек сразу при нажатии
    const clickedElement = event?.currentTarget;
    if (clickedElement) {
        clickedElement.style.transform = 'scale(0.97)';
        clickedElement.style.transition = 'transform 0.1s ease';
    }
    
    // Небольшая задержка перед открытием модалки (150-200мс)
    setTimeout(() => {
        // Сбрасываем трансформацию элемента
        if (clickedElement) {
            clickedElement.style.transform = '';
        }
        
        // Находим NFT в кэше пользователя
        const nft = window.cachedUserNFTs.find(item => item.id == nftId); 
        
        if (!nft) {
            console.error('❌ NFT не найден в кэше пользователя');
            return;
        }
        
        console.log('📊 Данные NFT для модалки:', nftId);

        if (window.socket && window.socket.connected) {
            window.socket.emit('check_nft_sale_status', nftId);
            window.socket.once('nft_sale_status', (data) => {
                console.log('📊 Статус продажи от сервера:', data);
                if (data.success && data.onSale) {
                    // Принудительно обновляем статус
                    nft.forSale = true;
                    nft.salePrice = data.price;
                    console.log('✅ Обновлен статус продажи:', nft);
                }
            });
        }
        
        const nftData = {
            ...nft,
            price: nft.forSale ? nft.salePrice : 0,
            forSale: nft.forSale || false,
            ownedByUser: true
        };
        
        console.log('🚀 Передаем в модалку:', nftData);
        
        if (window.updateNFTModal) {
            window.updateNFTModal(nftData);
        } else {
            console.error('❌ Функция updateNFTModal не найдена');
        }
        
        if (window.openNFTModal) {
            window.openNFTModal();
        } else {
            console.error('❌ Функция openNFTModal не найдена');
        }
        
        if (window.vibrate) window.vibrate([3, 5, 3]);
    }, 100); // Задержка
}


async function fetchProfileWithCache(cacheKey, fetchFunction, forceRefresh = false) {
    const now = Date.now();
    
    // Определяем кэш для каждого типа
    let cacheData, cacheTime;
    
    switch(cacheKey) {
        case 'models':
            cacheData = cachedProfileModels;
            cacheTime = lastProfileModelsFetch;
            break;
        case 'collections':
            cacheData = cachedProfileCollections;
            cacheTime = lastProfileCollectionsFetch;
            break;
        case 'patterns':
            cacheData = cachedProfilePatterns;
            cacheTime = lastProfilePatternsFetch;
            break;
        case 'backgrounds':
            cacheData = cachedProfileBackgrounds;
            cacheTime = lastProfileBackgroundsFetch;
            break;
        default:
            cacheData = null;
            cacheTime = 0;
    }
    
    // Проверяем кэш
    if (cacheData && !forceRefresh && cacheTime && (now - cacheTime) < PROFILE_CACHE_TTL) {
        console.log(`📦 Профиль: используем кэшированные ${cacheKey}:`, cacheData.length);
        return cacheData;
    }
    
    // Загружаем новые данные
    try {
        const data = await fetchFunction();
        
        // Сохраняем в кэш
        switch(cacheKey) {
            case 'models':
                cachedProfileModels = data;
                lastProfileModelsFetch = now;
                break;
            case 'collections':
                cachedProfileCollections = data;
                lastProfileCollectionsFetch = now;
                break;
            case 'patterns':
                cachedProfilePatterns = data;
                lastProfilePatternsFetch = now;
                break;
            case 'backgrounds':
                cachedProfileBackgrounds = data;
                lastProfileBackgroundsFetch = now;
                break;
        }
        
        console.log(`📦 Профиль: загружены новые ${cacheKey}:`, data.length);
        return data;
        
    } catch (error) {
        console.error(`❌ Профиль: ошибка загрузки ${cacheKey}:`, error);
        return cacheData || [];
    }
}

async function fetchProfileCollections(forceRefresh = false) {
    return fetchProfileWithCache('collections', async () => {
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

async function fetchProfileModels(forceRefresh = false) {
    return fetchProfileWithCache('models', async () => {
        if (window.socket && window.socket.connected) {
            return new Promise((resolve) => {
                window.socket.emit('get_models');
                window.socket.once('models_list', (data) => {
                    resolve(data.success ? data.models : []);
                });
                setTimeout(() => resolve([]), 5000);
            });
        }
        return [];
    }, forceRefresh);
}

async function fetchProfilePatterns(forceRefresh = false) {
    return fetchProfileWithCache('patterns', async () => {
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

async function fetchProfileBackgrounds(forceRefresh = false) {
    return fetchProfileWithCache('backgrounds', async () => {
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

async function refreshModelsFilterContent() {
    const modalTitle = document.getElementById('filterModalTitle');
    const modalBody = document.getElementById('filterModalBody');
    
    if (!modalTitle || !modalBody) return;
    
    if (modalTitle.textContent === 'Выбор модели') {
        console.log('🔄 Обновление списка моделей при изменении коллекций');
        console.log('📊 Текущие фильтры коллекций:', currentFilters.collection);
        
        // Показываем загрузку
        modalBody.innerHTML = `
            <div style="text-align: center; padding: 40px 20px; color: var(--text-secondary);">
                <div class="loading-spinner"></div>
                <p style="margin-top: 10px;">Обновление списка моделей...</p>
            </div>
        `;
        
        try {
            const filterContent = await getFilterContent('model');
            modalBody.innerHTML = filterContent;
            
            // ВАЖНО: После обновления контента, синхронизируем чекбоксы
            syncCheckboxesWithSnapshot();
            
        } catch (error) {
            console.error('❌ Ошибка обновления списка моделей:', error);
            modalBody.innerHTML = `
                <div class="filter-empty-state">
                    <p>Ошибка загрузки моделей</p>
                </div>
            `;
        }
    }
}

function refreshProfileFiltersCache() {
    console.log('🔄 Принудительное обновление кэша фильтров профиля');
    fetchProfileCollections(true);
    fetchProfileModels(true);
    fetchProfilePatterns(true);
    fetchProfileBackgrounds(true);
}

// Инициализация инвентаря
async function initInventory() {
    await fetchCollections();
    await loadInventoryItems();
    updateActiveFilters();
    refreshProfileFiltersCache();
    setupFilterModalClickOutside();
}

// Экспорт функций
window.openFilterModal = openFilterModal;
window.closeFilterModal = closeFilterModal;
window.selectFilterItem = selectFilterItem;
window.selectFilterButton = selectFilterButton;
window.clearFilters = clearFilters;
window.applyFilters = applyFilters;
window.viewNFT = viewNFT;
window.getRarityColor = getRarityColor;
window.getRarityBySupply = getRarityBySupply;
window.cachedUserNFTs = cachedUserNFTs;
window.refreshProfileFiltersCache = refreshProfileFiltersCache;
window.fetchProfileCollections = fetchProfileCollections;
window.fetchProfileModels = fetchProfileModels;
window.fetchProfilePatterns = fetchProfilePatterns;
window.fetchProfileBackgrounds = fetchProfileBackgrounds;
window.clearProfileFilters = clearProfileFilters;
window.getNFTCardBackground = getNFTCardBackground;
window.generateNFTImageHTML = generateNFTImageHTML;
