// Состояние рейтинга
let ratingState = {
    currentMode: localStorage.getItem('ratingMode') || 'holders',
    cache: {
        holders: { data: null, timestamp: 0 },
        referrals: { data: null, timestamp: 0 }
    }
};

const CLIENT_CACHE_TTL = 36000; // 30 секунд

function switchRatingMode(mode) {
    if (mode === ratingState.currentMode) return;
    
    ratingState.currentMode = mode;
    localStorage.setItem('ratingMode', mode);
    
    document.querySelectorAll('.rating-mode-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.mode === mode);
    });
    
    // Обновляем заголовок
    const heroTitle = document.querySelector('#rating .hero-title');
    if (heroTitle) {
        heroTitle.textContent = mode === 'holders' 
            ? '🏆 Топ коллекционеров' 
            : '👥 Топ рефералов';
    }
    
    loadRatingData();
    if (window.vibrate) window.vibrate([3, 5, 3]);
}

function loadRatingData() {
    const podiumContainer = document.getElementById('ratingPodium');
    const listContainer = document.getElementById('ratingList');
    
    if (!podiumContainer || !listContainer) return;

    const heroTitle = document.querySelector('#rating .hero-title');
    if (heroTitle) {
        heroTitle.textContent = ratingState.currentMode === 'holders' 
            ? '🏆 Топ коллекционеров' 
            : '👥 Топ рефералов';
    }

    // Просто очищаем контейнеры, без сообщения о загрузке
    podiumContainer.innerHTML = '';
    listContainer.innerHTML = '';

    const cache = ratingState.cache[ratingState.currentMode];
    const now = Date.now();
    
    if (cache.data && (now - cache.timestamp) < CLIENT_CACHE_TTL) {
        console.log(`📦 Используем кэшированные данные для ${ratingState.currentMode}`);
        renderRating(cache.data);
    } else {
        console.log(`🔄 Запрашиваем свежие данные для ${ratingState.currentMode}`);
        if (ratingState.currentMode === 'holders') {
            socket.emit('get_top_holders');
        } else {
            socket.emit('get_top_referrers');
        }
    }
}

function renderRating(response) {
    console.log('📊 renderRating получил:', response);
    
    const data = response.data || response;
    console.log(`📊 Данные для ${ratingState.currentMode}:`, data);
    
    const podiumContainer = document.getElementById('ratingPodium');
    const listContainer = document.getElementById('ratingList');
    
    if (!podiumContainer || !listContainer) return;

    ratingState.cache[ratingState.currentMode] = {
        data: data,
        timestamp: Date.now()
    };

    if (!data || data.length === 0) {
        podiumContainer.innerHTML = '';
        listContainer.innerHTML = '';
        return;
    }

    // Функция для форматирования имени
    const formatName = (user) => {
        if (user.firstName && user.lastName) {
            return `${user.firstName} ${user.lastName}`;
        }
        if (user.firstName) {
            return user.firstName;
        }
        if (user.username) {
            return user.username;
        }
        return `User ${user.id}`;
    };

    // Функция для создания бейджа надетого NFT
    const getWornNFTBadge = (user) => {
        if (!user.wornNFT) return '';
        
        const nft = user.wornNFT;
        const isPodium = arguments[1]; // костыль для определения контекста
        
        if (nft.imageUrl) {
            return `
                <div class="${isPodium ? 'podium-worn-nft' : 'worn-nft-mini'}" title="Надетый NFT">
                    <img src="${nft.imageUrl}" alt="NFT" 
                         onerror="this.style.display='none'; this.parentElement.innerHTML='🎴'">
                </div>
            `;
        } else {
            return `
                <div class="${isPodium ? 'podium-worn-nft' : 'worn-nft-mini'}" title="Надетый NFT">
                    <span>🎴</span>
                </div>
            `;
        }
    };

    const getFirstPlaceCrown = () => {
        // Показываем корону только в режиме рефералов
        if (ratingState.currentMode !== 'referrals') return '';
        
        // Ссылка для открытия при клике
        const crownLink = 'https://t.me/nft/XmasStocking-82654';
        
        return `
            <div class="first-place-crown" onclick="event.stopPropagation(); window.open('${crownLink}', '_blank')">
                <img src="/m_nft_image/gift.png" 
                     alt="Crown" 
                     class="crown-image"
                     onerror="this.style.display='none'; this.parentElement.innerHTML='👑'; this.parentElement.classList.add('crown-fallback');">
            </div>
        `;
    };

    const top3 = data.slice(0, 3);
    const remaining = data.slice(3, 20);
    
    if (top3.length === 0) {
        podiumContainer.innerHTML = '';
        listContainer.innerHTML = '';
        return;
    }

    let podiumHtml = '';
    
    // Второе место (серебро)
    if (top3[1]) {
        podiumHtml += `
        <div class="podium-item second">
            <div class="podium-avatar">
                ${top3[1].hasAvatar ? `<img src="${top3[1].avatarUrl}" alt="" onerror="this.style.display='none'; this.parentElement.innerHTML='🥈'">` : '🥈'}
            </div>
            <div class="podium-name">
                <span class="podium-name-text">${formatName(top3[1])}</span>
                ${top3[1].wornNFT ? `
                    <div class="podium-worn-nft" title="Надетый NFT">
                        ${top3[1].wornNFT.imageUrl 
                            ? `<img src="${top3[1].wornNFT.imageUrl}" alt="" onerror="this.style.display='none'; this.parentElement.innerHTML='🎴'">`
                            : '🎴'
                        }
                    </div>
                ` : ''}
            </div>
            <div class="podium-count">${top3[1].count} ${ratingState.currentMode === 'holders' ? 'NFT' : 'реф'}</div>
        </div>
        `;
    }
    
    // Первое место (золото)
    if (top3[0]) {
        const hasCrown = ratingState.currentMode === 'referrals'; // true только для рефералов

        podiumHtml += `
        <div class="podium-item first ${hasCrown ? 'has-crown' : ''}">
            <div class="podium-avatar-container">
                <div class="podium-avatar">
                    ${top3[0].hasAvatar ? `<img src="${top3[0].avatarUrl}" alt="" onerror="this.style.display='none'; this.parentElement.innerHTML='👑'">` : '👑'}
                </div>
                ${hasCrown ? getFirstPlaceCrown() : ''}
            </div>
            <div class="podium-name">
                <span class="podium-name-text">${formatName(top3[0])}</span>
                ${top3[0].wornNFT ? `
                    <div class="podium-worn-nft" title="Надетый NFT">
                        ${top3[0].wornNFT.imageUrl 
                            ? `<img src="${top3[0].wornNFT.imageUrl}" alt="" onerror="this.style.display='none'; this.parentElement.innerHTML='🎴'">`
                            : '🎴'
                        }
                    </div>
                ` : ''}
            </div>
            <div class="podium-count">${top3[0].count} ${ratingState.currentMode === 'holders' ? 'NFT' : 'реф'}</div>
        </div>
        `;
    }
    
    // Третье место (бронза)
    if (top3[2]) {
        podiumHtml += `
        <div class="podium-item third">
            <div class="podium-avatar">
                ${top3[2].hasAvatar ? `<img src="${top3[2].avatarUrl}" alt="" onerror="this.style.display='none'; this.parentElement.innerHTML='🥉'">` : '🥉'}
            </div>
            <div class="podium-name">
                <span class="podium-name-text">${formatName(top3[2])}</span>
                ${top3[2].wornNFT ? `
                    <div class="podium-worn-nft" title="Надетый NFT">
                        ${top3[2].wornNFT.imageUrl 
                            ? `<img src="${top3[2].wornNFT.imageUrl}" alt="" onerror="this.style.display='none'; this.parentElement.innerHTML='🎴'">`
                            : '🎴'
                        }
                    </div>
                ` : ''}
            </div>
            <div class="podium-count">${top3[2].count} ${ratingState.currentMode === 'holders' ? 'NFT' : 'реф'}</div>
        </div>
        `;
    }
    
    podiumContainer.innerHTML = podiumHtml;
    
    // Список остальных
    listContainer.innerHTML = remaining.map((user, index) => `
        <div class="rating-list-item">
            <div class="rating-position">${index + 4}</div>
            <div class="rating-list-avatar">
                ${user.hasAvatar ? `<img src="${user.avatarUrl}" alt="" onerror="this.style.display='none'; this.parentElement.innerHTML='👤'">` : '👤'}
            </div>
            <div class="rating-list-info">
                <div class="rating-list-name">
                    <span class="rating-list-name-text">${formatName(user)}</span>
                    ${user.wornNFT ? `
                        <div class="worn-nft-mini" title="Надетый NFT">
                            ${user.wornNFT.imageUrl 
                                ? `<img src="${user.wornNFT.imageUrl}" alt="" onerror="this.style.display='none'; this.parentElement.innerHTML='🎴'">`
                                : '🎴'
                            }
                        </div>
                    ` : ''}
                </div>
                <div class="rating-list-stats">
                    <span>${user.count}</span> ${ratingState.currentMode === 'holders' ? 'NFT' : 'рефералов'}
                </div>
            </div>
        </div>
    `).join('');

}

function initRating() {
    console.log('🏆 Инициализация рейтинга');
    
    const ratingSection = document.getElementById('rating');
    const heroSection = ratingSection?.querySelector('.hero-section');
    
    if (heroSection && !document.querySelector('.rating-mode-switch')) {
        const switchHtml = `
            <div class="rating-mode-switch">
                <button class="rating-mode-btn ${ratingState.currentMode === 'holders' ? 'active' : ''}" 
                        data-mode="holders" onclick="switchRatingMode('holders')">Холдеры</button>
                <button class="rating-mode-btn ${ratingState.currentMode === 'referrals' ? 'active' : ''}" 
                        data-mode="referrals" onclick="switchRatingMode('referrals')">Рефералы</button>
            </div>
        `;
        heroSection.insertAdjacentHTML('afterend', switchHtml);
    }
    
    // Слушаем фоновые обновления
    if (window.socket) {
        window.socket.on('holders_data_updated', (data) => {
            console.log('🔄 Фоновое обновление холдеров');
            if (ratingState.currentMode === 'holders') {
                renderRating(data);
            }
        });
        
        window.socket.on('referrals_data_updated', (data) => {
            console.log('🔄 Фоновое обновление рефералов');
            if (ratingState.currentMode === 'referrals') {
                renderRating(data);
            }
        });
    }
    
    loadRatingData();
}

// Экспорт функций
window.initRating = initRating;
window.loadRatingData = loadRatingData;
window.switchRatingMode = switchRatingMode;
window.renderRating = renderRating;