let tg = window.Telegram.WebApp;
let user = tg.initDataUnsafe?.user;
tg.BackButton.show();

const BOT_USERNAME = window.AppConfig?.BOT_USERNAME;

function vibrate(pattern = 1) {
    if (navigator.vibrate) navigator.vibrate(pattern);
}

let appState = {
    userData: null,
    bonusBalance: 0,
    starsBalance: 0,
    currentRate: 0
};

let isProcessing = false;
const DEBOUNCE_DELAY = 500;

function smoothScrollToTop() {
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function initApp() {
    tg.expand();
    tg.setHeaderColor('#1a1a1a');
    tg.setBackgroundColor('#0f0f0f');
    
    initTheme();
    
    if (tg && tg.platform !== 'unknown') {
        tg.requestFullscreen?.();
        setTimeout(() => tg.expand(), 50);
    }
    
    // 1. Сначала инициализируем socket и данные пользователя
    initSocket({
        userId: user?.id,
        username: user?.username,
        firstName: user?.first_name,
        lastName: user?.last_name
    });
    updateUI();
    setupBalanceListeners();
    
    // 2. Подождите немного чтобы socket подключился
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // 3. Затем инициализируем главную страницу
    if (window.initHome) {
        await window.initHome();
    }
    
    // 4. Показываем главную страницу
    showSection('home');
    
    // 5. Остальная инициализация в фоне
    setTimeout(() => {
        createDepositModal();
        initTonConnect();
        initInventory();
        initProfileHistory();
        setupMarketListeners();
        
        // Инициализация модалки улучшения
        if (window.initUpgradeModal) {
            window.initUpgradeModal();
        }
        
        if (window.initReferralProgram) {
            window.initReferralProgram();
        }
        if (window.initMarket) {
            window.initMarket();
        }
        if (window.initGlobalHistory) {
            window.initGlobalHistory();
        }
        if (window.initRating) {  // <-- Добавить эту строку
            window.initRating();   // <-- Добавить эту строку
        }
    }, 100);
    
    // Пытаемся получить текущий баланс
    if (socket && socket.connected && user?.id) {
        socket.emit('register_user', { userId: user.id });
    }

    // После небольшой задержки, если socket еще не подключился
    setTimeout(() => {
        if (user?.id && (!socket || !socket.connected)) {
            console.log('⚠️ Socket not connected, manual registration needed');
        }
    }, 2000);
}

function setupMarketListeners() {
    if (window.socket) {
        window.socket.on('market_updated', () => {
            console.log('🔄 Обновление маркета - перезагрузка данных');

            // Перезагружаем маркет
            if (window.loadMarketItems) {
                window.loadMarketItems();
            }

            // Также перезагружаем инвентарь чтобы обновить статус "На продаже"
            if (window.loadInventoryItems && document.getElementById('profile')?.classList.contains('active')) {
                window.loadInventoryItems();
            }
        });

        window.socket.on('balance_updated', (data) => {
            if (data.userId === window.Telegram?.WebApp?.initDataUnsafe?.user?.id) {
                window.appState.starsBalance = data.newBalance;
                updateStarsBalance();
                updateMarketBalance();
            }
        });
    }
}

function refreshUserData() {
    const tgUser = window.Telegram?.WebApp?.initDataUnsafe?.user;
    if (!tgUser?.id || !window.socket || !window.socket.connected) {
        console.log('⚠️ Cannot refresh user data: socket not connected or no user ID');
        return;
    }
        
    window.socket.emit('register_user', { 
        userId: tgUser.id 
    });
}

function createDefaultUserData() {
    return {
        id: user?.id || 'Unknown',
        username: user?.username || 'Не установлен',
        bonusBalance: 0,
        referralCount: 0,
        referrals: [],
        referralLink: `${window.AppConfig?.BOT_URL}`,
        purchaseStats: {},
        starsBalance: 0
    };
}

function updateUI() {
    const tgUser = window.Telegram.WebApp.initDataUnsafe?.user;
    const displayId = tgUser?.id || appState.userData?.id || 'Unknown';
    
    let displayName = 'Не установлен';
    
    if (tgUser) {
        if (tgUser.first_name && tgUser.last_name) {
            displayName = `${tgUser.first_name} ${tgUser.last_name}`;
        } else if (tgUser.first_name) {
            displayName = tgUser.first_name;
        } else if (tgUser.username) {
            displayName = `@${tgUser.username}`;
        }
    } else if (appState.userData?.username) {
        displayName = `@${appState.userData.username}`;
    }
    
    updateElementText('profileId', `ID: ${displayId}`);
    document.getElementById('profileId').onclick = copyUserId;
    document.getElementById('profileId').style.cursor = 'pointer';
    updateElementText('profileUsername', displayName); 
    
    const avatarImg = document.getElementById('userAvatar');
    const avatarFallback = document.getElementById('avatarFallback');
    
    if (tgUser?.photo_url && avatarImg) {
        avatarImg.src = tgUser.photo_url;
        avatarImg.style.display = 'block';
        avatarFallback.style.display = 'none';
    }
    
    if (appState.userData) {
        updateElementText('referralsCount', appState.userData.referrals_count || 0);
        updateElementText('earnedBonuses', `${formatNumber(appState.userData.bonusBalance || 0)} ⭐`);
        updateStarsBalance();
        
        // Добавляем путь к картинке уровня, если его нет
        if (!appState.userData.levelImage) {
            const level = appState.userData.level || 1;
            appState.userData.levelImage = `/m_nft_image/lvl/${level}.png`;
        }
        
        // Вызываем обновление уровня
        updateUserLevel();
        
        const referralLink = document.getElementById('referralLink');
        if (referralLink) referralLink.value = appState.userData.referralLink;
        
        appState.bonusBalance = appState.userData.bonusBalance || 0;
    }
    setTimeout(updateWornNFTBadge, 0);
}

function copyUserId() {
    const tgUser = window.Telegram.WebApp.initDataUnsafe?.user;
    const userId = tgUser?.id || 'Unknown';
    
    navigator.clipboard.writeText(userId.toString())
        .then(() => window.tg?.showPopup({title: 'Скопировано', message: `ID ${userId} скопирован`}))
        .catch(() => {
            // Fallback для старых браузеров
            const input = document.createElement('input');
            input.value = userId;
            document.body.appendChild(input);
            input.select();
            document.execCommand('copy');
            document.body.removeChild(input);
            window.tg?.showPopup({title: 'Скопировано', message: `ID ${userId} скопирован`});
        });
    
    if (window.vibrate) window.vibrate(1);
}

function updateRateDisplay() {
    const currentRateElement = document.getElementById('currentRate');
    const profileRateElement = document.getElementById('profileRate');
    
    if (currentRateElement) {
        currentRateElement.textContent = formatNumber(appState.currentRate);
    }
    if (profileRateElement) {
        profileRateElement.textContent = formatNumber(appState.currentRate);
    }
}

function updateStarsBalance() {
    const balance = appState.starsBalance || 0;
    const balanceText = balance.toLocaleString();
    
    // Обновляем все возможные места отображения баланса
    const balanceElements = [
        'headerBalance',
        'marketBalance', 
        'profileBalance',
        'starsBalance'
    ];
    
    balanceElements.forEach(id => {
        const element = document.getElementById(id);
        if (element) {
            element.textContent = balanceText;
        }
    });
    
    // Также обновляем userData
    if (appState.userData) {
        appState.userData.starsBalance = balance;
    }
}

// ===== ФУНКЦИИ ДЛЯ МОДАЛЬНОГО ОКНА БАЛАНСА =====

let currentCurrency = 'stars'; // 'stars' или 'ton'

// Открытие модального окна баланса
function openBalanceModal() {
    // Скрываем все секции
    document.querySelectorAll('.section').forEach(section => {
        section.classList.remove('active');
    });
    
    // Показываем модальное окно баланса
    const balanceModal = document.getElementById('balanceModal');
    if (balanceModal) {
        balanceModal.classList.add('active');
    }
    
    // Показываем кнопку "Назад" в Telegram
    if (tg && tg.BackButton) {
        tg.BackButton.show();
        tg.BackButton.offClick(closeBalanceModal); // Убираем старый
        tg.BackButton.onClick(closeBalanceModal); // Добавляем новый
    }
    
    // Обновляем данные в модальном окне
    updateBalanceModal();
    
    // Вибрация
    vibrate(1);
}

// Закрытие модального окна баланса
function closeBalanceModal() {
    const balanceModal = document.getElementById('balanceModal');
    if (balanceModal) {
        balanceModal.classList.remove('active');
    }
    
    // Если есть открытое окно пополнения, закрываем его
    const depositModal = document.getElementById('depositModal');
    if (depositModal && depositModal.classList.contains('active')) {
        depositModal.classList.remove('active');
    }
    
    showSection('profile');
    vibrate(1);
}

// Обновление данных в модальном окне баланса
function updateBalanceModal() {
    const balanceAmount = document.getElementById('balanceAmount');
    const balanceLabel = document.getElementById('balanceText'); // исправлено: balanceText вместо balanceLabel
    
    if (!balanceAmount || !balanceLabel) return;
    
    if (currentCurrency === 'stars') {
        // Отображаем звезды
        const starsBalance = appState.starsBalance || 0;
        balanceAmount.textContent = starsBalance.toLocaleString();
        balanceLabel.textContent = 'на вашем счету';
    } else {
        // Отображаем TON (нужно будет добавить логику получения баланса TON)
        const tonBalance = 0; // Замените на реальный баланс TON
        balanceAmount.textContent = tonBalance.toFixed(2);
        balanceLabel.textContent = 'TON на счету';
    }
}

// Переключение валюты
function switchCurrency(currency) {
    currentCurrency = currency;
    
    // Обновляем активные кнопки
    const starsBtn = document.getElementById('starsCurrencyBtn');
    const tonBtn = document.getElementById('tonCurrencyBtn');
    
    if (starsBtn && tonBtn) {
        starsBtn.classList.toggle('active', currency === 'stars');
        tonBtn.classList.toggle('active', currency === 'ton');
    }
    
    // Обновляем отображение баланса
    updateBalanceModal();
    
    // Вибрация
    vibrate([3, 5, 3]);
}

// Пополнение баланса
function depositFunds() {
    openDepositModal();
    
    vibrate([3, 5, 3]);
}

function updateElementText(id, text) {
    const element = document.getElementById(id);
    if (element) element.textContent = text;
}

function formatNumber(num) {
    if (typeof num !== 'number') num = parseFloat(num) || 0;
    const rounded = Math.round(num * 10000) / 10000;
    let formatted = rounded.toString();
    
    if (formatted.includes('.')) formatted = formatted.replace(/\.?0+$/, '');
    if (formatted.endsWith('.')) formatted = formatted.slice(0, -1);
    
    return formatted === '' ? '0' : formatted;
}

function showSection(sectionId) {
    const currentActiveSection = document.querySelector('.section.active');
    if (currentActiveSection && currentActiveSection.id === sectionId) {
        vibrate(1);
        return;
    }
    
    const sections = ['home', 'profile', 'history', 'referral', 'market', 'rating', 'balanceModal']; 
    
    // Скрыть все секции
    sections.forEach(id => {
        const section = document.getElementById(id);
        if (section) section.classList.remove('active');
    });
    
    // Показать нужную секцию
    const targetSection = document.getElementById(sectionId);
    if (targetSection) targetSection.classList.add('active');
    
    // ВСЕГДА обновляем навигацию при смене секции
    updateNavigation(sectionId);
    
    // УПРАВЛЕНИЕ КНОПКОЙ "НАЗАД"
    if (tg && tg.BackButton) {
        if (sectionId === 'profile' || sectionId === 'market' || sectionId === 'home' || sectionId === 'rating') {
            tg.BackButton.hide();
        } else if (sectionId === 'balanceModal') {
            tg.BackButton.show();
            tg.BackButton.onClick(closeBalanceModal);
        } else if (sectionId === 'referral') {
            tg.BackButton.show();
            tg.BackButton.onClick(closeReferralModal);
        } else {
            tg.BackButton.hide();
        }
    }
    
    // Загружаем данные в зависимости от секции
    if (sectionId === 'profile' && window.loadInventoryItems) {
        window.loadInventoryItems();
    } else if (sectionId === 'market' && window.loadMarketItems) {
        window.loadMarketItems();
    } else if (sectionId === 'history' && window.loadGlobalSalesHistory) {
        window.loadGlobalSalesHistory();
    } else if (sectionId === 'home' && window.initHome) {
        window.initHome();
    } else if (sectionId === 'rating' && window.loadRatingData) {
        window.loadRatingData();
    }
    
    vibrate(1);
}

function updateNavigation(sectionId) {
    const navItems = document.querySelectorAll('.nav-item');
    const sectionMap = {
        'home': 0,
        'rating': 1,
        'market': 2,
        'profile': 3,
        'history': 4
    };
    
    navItems.forEach((item, index) => {
        item.classList.remove('active');
    });
    
    // Подсвечиваем только основные секции (не модальные)
    if (sectionMap.hasOwnProperty(sectionId)) {
        const navIndex = sectionMap[sectionId];
        if (navItems[navIndex]) {
            navItems[navIndex].classList.add('active');
        }
    }
}

// Добавляем функцию обновления баланса в маркете
function updateMarketBalance() {
    const marketBalanceElement = document.getElementById('marketBalance');
    if (marketBalanceElement) {
        marketBalanceElement.textContent = (appState.starsBalance || 0).toLocaleString();
    }
}

function copyReferralLink() {
    const linkInput = document.getElementById('referralLink');
    if (linkInput) {
        linkInput.select();
        document.execCommand('copy');
        vibrate([3, 5, 3]);
    }
}

function showSuccess(message) { 
    tg.showPopup({title: 'Успех', message: message}); 
}

function showError(message) { 
    tg.showPopup({title: 'Ошибка', message: message}); 
}

async function shareReferralLink() {
    try {
        const user = window.Telegram.WebApp.initDataUnsafe?.user;
        if (!user) {
            showError('Данные пользователя не загружены');
            return;
        }
        const botUrl = window.AppConfig?.BOT_URL;
        const referralLink = `${botUrl}/market?startapp=${user.id}`;
        const messageText = '🎉 Лучший бот уникальными M-NFT, мгновенная выдача, щедрая реферальная программа!';
        
        if (window.Telegram && window.Telegram.WebApp) {
            if (window.Telegram.WebApp.shareUrl) {
                window.Telegram.WebApp.shareUrl(messageText, referralLink);
            } else if (window.Telegram.WebApp.openLink) {
                const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(referralLink)}&text=${encodeURIComponent(messageText)}`;
                window.Telegram.WebApp.openLink(shareUrl);
            } 
        }
        
        vibrate([5, 3, 5]);
    } catch (error) {
        console.error('Ошибка:', error);
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

async function updateWornNFTBadge() {
    const tgUser = window.Telegram?.WebApp?.initDataUnsafe?.user;
    const userId = tgUser?.id;
    
    if (!userId) return;

    // Получаем надетый NFT
    let wornNFT = null;
    
    if (window.socket && window.socket.connected) {
        wornNFT = await new Promise(resolve => {
            window.socket.emit('get_worn_nft', userId);
            window.socket.once('worn_nft', (data) => {
                resolve(data.success ? data.nft : null);
            });
            setTimeout(() => resolve(null), 2000);
        });
    } else {
        wornNFT = window.cachedUserNFTs?.find(nft => nft.dressed === true);
    }
    
    // Находим элементы
    const profileName = document.getElementById('profileUsername');
    const profileHeader = document.querySelector('.profile-header');
    const profileId = document.querySelector('.profile-id');
    const settingsButton = document.querySelector('.settings-button');
    const balanceBadge = document.querySelector('.balance-badge');
    const balanceAddBtn = document.querySelector('.balance-add-btn'); // Добавляем кнопку +
    const currentTheme = localStorage.getItem('theme') || 'dark';
    
    if (!profileName) return;
    
    // ПРИМЕНЯЕМ ФОН И УЗОР К ХЕДЕРУ
    if (profileHeader) {
        // Удаляем старый паттерн
        const oldPattern = profileHeader.querySelector('.profile-header-pattern');
        if (oldPattern) oldPattern.remove();
        
        // Удаляем старый ::after стиль, если он был добавлен динамически
        const oldAfter = profileHeader.querySelector('.profile-header-after');
        if (oldAfter) oldAfter.remove();
        
        if (wornNFT?.update === 1 && wornNFT.background_id) {
            // Фон
            const back0 = wornNFT.back_0 || '1a1a1a';
            const back100 = wornNFT.back_100 || '0f0f0f';
            profileHeader.style.background = `radial-gradient(circle at 50% 0%, #${back0}, #${back100})`;
            
            // СОЗДАЕМ ЭЛЕМЕНТ ДЛЯ ЗАТЕМНЕНИЯ (как в CSS ::after)
            const darkenElement = document.createElement('div');
            darkenElement.className = 'profile-header-after';
            
            // Используем разные значения для светлой и темной темы
            const overlayOpacity = currentTheme === 'light' ? '0.05' : '0.1';
            const overlayColor = currentTheme === 'light' ? '0, 0, 0' : '15, 15, 15';
            
            darkenElement.style.cssText = `
                position: absolute;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background: linear-gradient(to bottom, rgba(${overlayColor}, ${overlayOpacity}) 0%, rgba(${overlayColor}, ${overlayOpacity}) 100%);
                pointer-events: none;
                z-index: 1;
            `;
            profileHeader.appendChild(darkenElement);
            
            // УЗОР
            if (wornNFT.pattern_id && wornNFT.pattern_file_name) {
                const svgPath = `/m_nft_image/patterns/${wornNFT.pattern_file_name}.svg`;
                
                const patternHtml = getProfileHeaderPattern(svgPath, wornNFT.back_0);
                
                const patternDiv = document.createElement('div');
                patternDiv.className = 'profile-header-pattern';
                patternDiv.style.cssText = 'position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none; z-index: 2;';
                patternDiv.innerHTML = patternHtml;
                
                profileHeader.appendChild(patternDiv);
            }
        } else {
            // Сбрасываем фон на стандартный
            profileHeader.style.background = '';
            profileHeader.style.background = 'var(--background-dark)';
        }
    }
    
    // ===== НОВАЯ ЛОГИКА: УПРАВЛЕНИЕ ФОНАМИ ЭЛЕМЕНТОВ ХЕДЕРА =====
    
    if (wornNFT) {
        // ✅ НАДЕТ NFT: Применяем стили темной темы (полупрозрачный белый фон)
        
        // Для profile-id
        if (profileId) {
            profileId.style.setProperty('background', 'rgba(255, 255, 255, 0.1)');
            profileId.style.setProperty('border', '1px solid rgba(255, 255, 255, 0.2)');
            profileId.style.setProperty('box-shadow', '0 1px 1px rgba(0, 0, 0, 0.4)');
            profileId.style.color = 'var(--text-primary-nft)';
        }
        
        // Для balance-badge
        if (balanceBadge) {
            balanceBadge.style.setProperty('background', 'rgba(255, 255, 255, 0.1)');
            balanceBadge.style.setProperty('border', '1px solid rgba(255, 255, 255, 0.2)');
            balanceBadge.style.setProperty('box-shadow', '0 1px 1px rgba(0, 0, 0, 0.4)');
            balanceBadge.style.color = 'var(--text-primary-nft)';
        }
        
        // Для settings-button
        if (settingsButton) {
            settingsButton.style.setProperty('background', 'rgba(255, 255, 255, 0.1)');
            settingsButton.style.setProperty('border', '1px solid rgba(255, 255, 255, 0.2)');
            settingsButton.style.setProperty('box-shadow', '0 1px 1px rgba(0, 0, 0, 0.4)');
            settingsButton.style.color = 'var(--text-primary-nft)';
        }
        
        // Для balance-add-btn (кнопка +)
        if (balanceAddBtn) {
            balanceAddBtn.style.setProperty('background', 'rgba(255, 255, 255, 0.2)');
            balanceAddBtn.style.setProperty('border', '1px solid rgba(255, 255, 255, 0.3)');
            balanceAddBtn.style.setProperty('box-shadow', '0 1px 1px rgba(0, 0, 0, 0.4)');
            balanceAddBtn.style.color = 'var(--text-primary-nft)';
        }
    } else {
        // ❌ НЕТ НАДЕТОГО NFT: Возвращаем стандартное поведение (зависит от глобальной темы)
        
        if (profileId) {
            profileId.style.removeProperty('background');
            profileId.style.removeProperty('border');
            profileId.style.removeProperty('color');
            profileId.style.removeProperty('box-shadow');
        }
        
        if (balanceBadge) {
            balanceBadge.style.removeProperty('background');
            balanceBadge.style.removeProperty('border');
            balanceBadge.style.removeProperty('color');
            balanceBadge.style.removeProperty('box-shadow');
        }
        
        if (settingsButton) {
            settingsButton.style.removeProperty('background');
            settingsButton.style.removeProperty('border');
            settingsButton.style.removeProperty('color');
            settingsButton.style.removeProperty('box-shadow');
        }
        
        if (balanceAddBtn) {
            balanceAddBtn.style.removeProperty('background');
            balanceAddBtn.style.removeProperty('border');
            balanceAddBtn.style.removeProperty('color');
            balanceAddBtn.style.removeProperty('box-shadow');
        }
    }
    
    // ===== КОНЕЦ НОВОЙ ЛОГИКИ =====
    
    // Оборачиваем имя в контейнер
    let container = profileName.parentElement;
    
    if (!container.classList.contains('profile-name-container')) {
        container = document.createElement('div');
        container.className = 'profile-name-container';
        profileName.parentNode.insertBefore(container, profileName);
        container.appendChild(profileName);
    }
    
    // Удаляем старый бейдж
    const oldBadge = container.querySelector('.worn-nft-badge');
    if (oldBadge) oldBadge.remove();
    
    // Убираем класс с отступом
    container.classList.remove('has-worn-nft');
    
    // Сбрасываем цвет имени
    profileName.style.color = '';
    
    // Добавляем новый бейдж
    if (wornNFT) {
        const badge = document.createElement('div');
        badge.className = 'worn-nft-badge';
        
        const iconDiv = document.createElement('div');
        iconDiv.className = 'worn-nft-icon';
        
        // Генерируем изображение
        if (wornNFT.update === 1 && wornNFT.model_file_name) {
            const modelPath = `/m_nft_image/${wornNFT.collection_name || wornNFT.collectionName}/${wornNFT.model_file_name}.PNG`;
            iconDiv.innerHTML = `<img src="${modelPath}" alt="Worn NFT">`;
        } else {
            const imagePath = wornNFT.collection_image ? `/m_nft_image/base/${wornNFT.collection_image}` : null;
            if (imagePath) {
                iconDiv.innerHTML = `<img src="${imagePath}" alt="Worn NFT">`;
            } else {
                iconDiv.innerHTML = `<span style="font-size: 1.2em;">🎴</span>`;
            }
        }
        
        badge.appendChild(iconDiv);
        profileName.after(badge);
        container.classList.add('has-worn-nft');
        
        // Изменяем цвет имени
        const textColor = 'var(--text-primary-nft)';
        profileName.style.color = textColor;
        
        // Цвета для profileId, balanceBadge, settingsButton, balanceAddBtn уже установлены выше
    }
}

function getProfileHeaderPattern(svgPath, bgColor) {
    if (!svgPath) return '';
    
    const filterStyle = window.getPatternFilterStyle ? window.getPatternFilterStyle(bgColor) : '';
    
    const middleCircleRadius = 18;
    const innerCircleRadius = 24;
    const outerCircleRadius = 36;
    
    let patternHtml = '';
    
    // 2. Средний круг
    const rotationOffset = Math.PI / 4;
    const middleAngles = [
        0,
        Math.PI / 2,
        Math.PI,
        (3 * Math.PI) / 2
    ];
    
    for (let i = 0; i < middleAngles.length; i++) {
        const angle = middleAngles[i] + rotationOffset;
        const x = 50 + Math.cos(angle) * middleCircleRadius;
        const y = 50 + Math.sin(angle) * middleCircleRadius;
        
        patternHtml += `
            <div style="position: absolute;
                        top: ${y}%;
                        left: ${x}%;
                        width: 9%;
                        height: 9%;
                        min-width: 18px; max-width: 30px;
                        min-height: 18px; max-height: 30px;
                        transform: translate(-50%, -50%);
                        opacity: 0.2;
                        background-image: url('${svgPath}');
                        background-size: contain;
                        background-repeat: no-repeat;
                        background-position: center;
                        ${filterStyle}">
            </div>
        `;
    }
    
    const innerIconsCount = 4;
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
                        min-width: 16px; max-width: 28px;
                        min-height: 16px; max-height: 28px;
                        transform: translate(-50%, -50%);
                        opacity: 0.15;
                        background-image: url('${svgPath}');
                        background-size: contain;
                        background-repeat: no-repeat;
                        background-position: center;
                        ${filterStyle}">
            </div>
        `;
    }
    
    const outerIconsCount = 10;
    for (let i = 0; i < outerIconsCount; i++) {
        const angle = (i / outerIconsCount) * Math.PI * 2;
        const x = 50 + Math.cos(angle) * outerCircleRadius;
        const y = 50 + Math.sin(angle) * outerCircleRadius;
        
        patternHtml += `
            <div style="position: absolute;
                        top: ${y}%;
                        left: ${x}%;
                        width: 6%;
                        height: 6%;
                        min-width: 12px; max-width: 24px;
                        min-height: 12px; max-height: 24px;
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
    
    return patternHtml;
}

function openSettings(event) {
    console.log('⚙️ Открытие настроек');
    vibrate(1);
    closeSettingsMenu();
    createSettingsMenu(event);
}

// Создание меню настроек
function createSettingsMenu(event) {
    // Получаем позицию кнопки
    const button = event.currentTarget;
    const rect = button.getBoundingClientRect();
    
    // Создаем затемнение
    const overlay = document.createElement('div');
    overlay.className = 'settings-menu-overlay';
    overlay.onclick = closeSettingsMenu;
    document.body.appendChild(overlay);
    
    // Создаем меню
    const menu = document.createElement('div');
    menu.className = 'settings-context-menu';
    menu.id = 'settingsMenu';
    
    // Получаем текущую тему
    const currentTheme = localStorage.getItem('theme') || 'dark';
    
    // Устанавливаем позицию
    menu.style.position = 'absolute';
    menu.style.top = (rect.bottom + window.scrollY + 8) + 'px';
    menu.style.left = (rect.left + window.scrollX) + 'px';
    
    // HTML содержимое меню
    menu.innerHTML = `
        <div class="settings-menu-item">
            <span class="settings-menu-item-label">Тема</span>
            <div class="theme-toggle">
                <button class="theme-option ${currentTheme === 'dark' ? 'active' : ''}" data-theme="dark">🌙</button>
                <button class="theme-option ${currentTheme === 'light' ? 'active' : ''}" data-theme="light">☀️</button>
            </div>
        </div>
    `;
    
    // Добавляем меню в DOM
    document.body.appendChild(menu);
    
    // Добавляем обработчики для переключателей темы
    const themeOptions = menu.querySelectorAll('.theme-option');
    themeOptions.forEach(option => {
        option.addEventListener('click', function(e) {
            e.stopPropagation();
            const newTheme = this.dataset.theme;
            themeOptions.forEach(opt => opt.classList.remove('active'));
            this.classList.add('active');
            vibrate([3, 5, 3]);
            
            // Применяем новую тему
            setTheme(newTheme);
        });
    });
    
    // Небольшая задержка для анимации
    setTimeout(() => {
        menu.classList.add('active');
    }, 10);
    
    // Закрытие по Escape
    document.addEventListener('keydown', handleEscapeKey);
}

// Функция закрытия меню
function closeSettingsMenu() {
    const menu = document.getElementById('settingsMenu');
    const overlay = document.querySelector('.settings-menu-overlay');
    
    if (menu) {
        menu.classList.remove('active');
        setTimeout(() => {
            if (menu && menu.parentNode) {
                menu.parentNode.removeChild(menu);
            }
        }, 200); // Удаляем после анимации
    }
    
    if (overlay && overlay.parentNode) {
        overlay.parentNode.removeChild(overlay);
    }
    
    document.removeEventListener('keydown', handleEscapeKey);
}

// Обработчик клавиши Escape
function handleEscapeKey(event) {
    if (event.key === 'Escape') {
        closeSettingsMenu();
    }
}

function setTheme(theme) {
    console.log('🎨 Смена темы на:', theme);
    
    // Сохраняем в localStorage
    localStorage.setItem('theme', theme);
    
    // Получаем корневой элемент
    const root = document.documentElement;
    
    if (theme === 'light') {
        // Светлая тема Telegram
        root.style.setProperty('--background', '#dddddd');      
        root.style.setProperty('--surface', '#f8f9fa');         
        root.style.setProperty('--surface-light', '#f0f2f5');   
        root.style.setProperty('--surface-dark', '#e0e3e6');    
        root.style.setProperty('--text-primary', '#000000');    
        root.style.setProperty('--text-secondary', '#6c757d');  
        root.style.setProperty('--text-tertiary', '#adb5bd');   
        root.style.setProperty('--text-primary-nft', '#e1e1e1');
        root.style.setProperty('--border', '#dee2e6');          
        root.style.setProperty('--border-light', '#e9ecef');    
        root.style.setProperty('--primary', '#2a7fff');         
        root.style.setProperty('--primary-dark', '#1a5fcc');    
        root.style.setProperty('--primary-light', '#e8f0fe');   
        root.style.setProperty('--accent', '#ff4757');          
        root.style.setProperty('--success', '#00d4aa');         
        root.style.setProperty('--shadow', '0 8px 32px rgba(0, 0, 0, 0.08)'); 
        root.style.setProperty('--shadow-small', '0 4px 16px rgba(0, 0, 0, 0.04)');
        root.style.setProperty('--avatar-background', 'rgba(42, 127, 255, 0.08)'); 
        root.style.setProperty('--header-element-bg', 'rgba(255, 255, 255, 0.3)');
        root.style.setProperty('--header-element-border', 'rgba(255, 255, 255, 0.5)');
        root.style.setProperty('--header-element-hover', 'rgba(255, 255, 255, 0.4)');
        root.style.setProperty('--header-element-box', 'rgba(0, 0, 0, 0.4)');

        // Обновляем цвет статус-бара в Telegram
        if (window.Telegram?.WebApp) {
            window.Telegram.WebApp.setHeaderColor('#dddddd');
            window.Telegram.WebApp.setBackgroundColor('#dddddd');
        }
    } else {
        // Темная тема Telegram
        root.style.setProperty('--background', '#1a1a1f');
        root.style.setProperty('--surface', '#2a2a30');
        root.style.setProperty('--surface-light', '#373740');
        root.style.setProperty('--surface-dark', '#232329');
        root.style.setProperty('--text-primary', '#ffffff');
        root.style.setProperty('--text-secondary', '#b0b0b8');
        root.style.setProperty('--text-tertiary', '#8a8a92');
        root.style.setProperty('--text-primary-nft', '#e1e1e1');
        root.style.setProperty('--border', '#3a3a42');
        root.style.setProperty('--border-light', '#46464e');
        root.style.setProperty('--primary', '#2a7fff');
        root.style.setProperty('--primary-dark', '#1a5fcc');
        root.style.setProperty('--accent', '#ff4757');
        root.style.setProperty('--success', '#00d4aa');
        root.style.setProperty('--shadow', '0 8px 32px rgba(0, 0, 0, 0.4)');
        root.style.setProperty('--shadow-small', '0 4px 16px rgba(0, 0, 0, 0.3)');
        root.style.setProperty('--avatar-background', 'rgba(42, 127, 255, 0.1)');
        root.style.setProperty('--header-element-bg', 'rgba(255, 255, 255, 0.1)');
        root.style.setProperty('--header-element-border', 'rgba(255, 255, 255, 0.2)');
        root.style.setProperty('--header-element-box', 'rgba(255, 255, 255, 0.4)');
        
        // Обновляем цвет статус-бара в Telegram
        if (window.Telegram?.WebApp) {
            window.Telegram.WebApp.setHeaderColor('#1a1a1a');
            window.Telegram.WebApp.setBackgroundColor('#0f0f0f');
        }
    }
    
    // Обновляем meta theme-color
    let metaThemeColor = document.querySelector('meta[name="theme-color"]');
    if (metaThemeColor) {
        metaThemeColor.setAttribute('content', theme === 'light' ? '#dddddd' : '#1a1a1a');
    }
    
    // ✅ Обновляем цвета всех элементов хедера, если надет NFT
    setTimeout(() => {
        const profileName = document.getElementById('profileUsername');
        const profileId = document.querySelector('.profile-id');
        const settingsButton = document.querySelector('.settings-button');
        const balanceBadge = document.querySelector('.balance-badge');
        const wornNFT = window.cachedUserNFTs?.find(nft => nft.dressed === true);
        
        if (wornNFT) {
            const textColor = 'var(--text-primary-nft)';
            
            if (profileName) profileName.style.color = textColor;
            if (profileId) profileId.style.color = textColor;
            if (settingsButton) settingsButton.style.color = textColor;
            if (balanceBadge) balanceBadge.style.color = textColor;
        } else {
            if (profileName) profileName.style.color = '';
            if (profileId) profileId.style.color = '';
            if (settingsButton) settingsButton.style.color = '';
            if (balanceBadge) balanceBadge.style.color = '';
        }
    }, 10);
    
    // Принудительно обновляем цвета
    forceThemeUpdate(theme);
}

function updateHeaderColors() {
    const profileName = document.getElementById('profileUsername');
    const profileId = document.querySelector('.profile-id');
    const settingsButton = document.querySelector('.settings-button');
    const balanceBadge = document.querySelector('.balance-badge');
    const wornNFT = window.cachedUserNFTs?.find(nft => nft.dressed === true);
    
    if (wornNFT) {
        const textColor = 'var(--text-primary-nft)';
        
        if (profileName) profileName.style.color = textColor;
        if (profileId) profileId.style.color = textColor;
        if (settingsButton) settingsButton.style.color = textColor;
        if (balanceBadge) balanceBadge.style.color = textColor;
    } else {
        if (profileName) profileName.style.color = '';
        if (profileId) profileId.style.color = '';
        if (settingsButton) settingsButton.style.color = '';
        if (balanceBadge) balanceBadge.style.color = '';
    }
}

// Принудительное обновление темы для сложных компонентов
function forceThemeUpdate(theme) {
    // Обновляем все SVG иконки, если нужно
    document.querySelectorAll('.profile-filter-card-icon svg, .nav-icon svg').forEach(svg => {
        // Просто триггерим ререндер
        svg.style.display = 'none';
        svg.offsetHeight; // Форсируем reflow
        svg.style.display = '';
    });
    
    // Обновляем фон хедера профиля, если есть надетый NFT
    setTimeout(updateWornNFTBadge, 100);
}

// Функция инициализации темы при загрузке
function initTheme() {
    const savedTheme = localStorage.getItem('theme') || 'dark';
    setTheme(savedTheme);
}

// Обновляем функцию updateWornNFTBadge для поддержки светлой темы
const originalUpdateWornNFTBadge = window.updateWornNFTBadge;
window.updateWornNFTBadge = function() {
    if (originalUpdateWornNFTBadge) {
        originalUpdateWornNFTBadge();
    }
    
    // Дополнительная логика для светлой темы
    const currentTheme = localStorage.getItem('theme') || 'dark';
    if (currentTheme === 'light') {
        // Корректируем цвета для светлой темы в надетом NFT
        const profileHeader = document.querySelector('.profile-header');
        if (profileHeader) {
            // Инвертируем или корректируем цвета для лучшей видимости на светлом фоне
            const wornNFT = window.cachedUserNFTs?.find(nft => nft.dressed === true);
            if (wornNFT) {
                // Можно добавить дополнительную обработку для светлой темы
            }
        }
    }
};

// Обработчик клавиши Escape
function handleEscapeKey(event) {
    if (event.key === 'Escape') {
        closeSettingsMenu();
    }
}

function updateUserLevel() {
    const level = appState.userData?.level || 1;
    // Используем levelImage из userData или формируем путь сами
    const levelImage = appState.userData?.levelImage || `/m_nft_image/lvl/${level}.png`;
    
    // Обновляем уровень в отдельном блоке профиля
    const profileLevel = document.getElementById('profileLevel');
    if (profileLevel) {
        // Очищаем содержимое
        profileLevel.innerHTML = '';
        
        // Создаем элемент изображения
        const levelImg = document.createElement('img');
        levelImg.src = levelImage;
        levelImg.alt = `Level ${level}`;
        levelImg.className = 'level-image';
        levelImg.style.width = '22px';
        levelImg.style.height = '22px';
        levelImg.style.objectFit = 'contain';
        levelImg.style.display = 'inline-block';
        levelImg.style.cursor = 'pointer';
        
        // Добавляем обработчик клика
        levelImg.addEventListener('click', (e) => {
            e.stopPropagation();
            if (window.openLevelModal) window.openLevelModal();
        });
        
        // Обработка ошибки загрузки изображения
        levelImg.onerror = function() {
            console.warn('⚠️ Не удалось загрузить изображение уровня:', levelImage);
            this.style.display = 'none';
        };
        
        profileLevel.appendChild(levelImg);
    }
    
    // Обновляем отображение уровня рядом с именем (теперь СЛЕВА)
    const profileName = document.getElementById('profileUsername');
    if (profileName) {
        // Создаем или получаем контейнер для имени и уровня
        let container = profileName.parentElement;
        if (!container.classList.contains('profile-name-container')) {
            container = document.createElement('div');
            container.className = 'profile-name-container';
            profileName.parentNode.insertBefore(container, profileName);
            container.appendChild(profileName);
        }
                
        // Удаляем старую картинку слева (если была)
        const oldLeftImage = container.querySelector('.level-image-left');
        if (oldLeftImage) oldLeftImage.remove();
        
        // Создаем картинку уровня для отображения СЛЕВА от имени
        const levelLeftImage = document.createElement('img');
        levelLeftImage.className = 'level-image-left';
        levelLeftImage.src = levelImage;
        levelLeftImage.alt = `Level ${level}`;
        levelLeftImage.style.width = '22px';
        levelLeftImage.style.height = '22px';
        levelLeftImage.style.objectFit = 'contain';
        levelLeftImage.style.cursor = 'pointer';
        
        // Добавляем обработчик клика
        levelLeftImage.addEventListener('click', (e) => {
            e.stopPropagation();
            if (window.openLevelModal) window.openLevelModal();
        });
        
        // Вставляем картинку ПЕРЕД именем
        container.insertBefore(levelLeftImage, profileName);
    }
}

function calculateLevelProgress(spent) {
    if (!spent || spent <= 0) return 0;
    
    const currentLevel = appState.userData?.level || 1;
    
    // Находим spent для текущего и следующего уровня
    const baseForLevel10 = 1000;
    
    // Функция, обратная calculateLevel
    const spentForLevel = (level) => {
        if (level <= 1) return 0;
        // spent = baseForLevel10 * (10^((level-1)/99) - 1)
        return baseForLevel10 * (Math.pow(10, (level - 1) / 99) - 1);
    };
    
    const spentCurrent = spentForLevel(currentLevel);
    const spentNext = spentForLevel(currentLevel + 1);
    
    if (spentNext <= spentCurrent) return 100;
    
    const progress = ((spent - spentCurrent) / (spentNext - spentCurrent)) * 100;
    return Math.min(100, Math.max(0, progress));
}

document.addEventListener('DOMContentLoaded', () => {
    initApp();
    updateHeaderColors();
    setTimeout(() => {
        if (window.initInventory) {
            window.initInventory();
        }
    }, 250);
    // Инициализация маркета
    if (window.initMarket) {
        window.initMarket();
    }
    setTimeout(updateWornNFTBadge, 1000);
});

window.openBalanceModal = openBalanceModal;
window.closeBalanceModal = closeBalanceModal;
window.depositFunds = depositFunds;
window.copyUserId = copyUserId;
window.updateNavigation = updateNavigation;
window.openSettings = openSettings;
window.closeSettingsMenu = closeSettingsMenu;
window.setTheme = setTheme;
window.appState = appState;
window.updateUI = updateUI;
window.refreshUserData = refreshUserData;