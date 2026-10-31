// level-modal.js
let currentLevelData = null;

function createLevelModal() {
    const modal = document.createElement('div');
    modal.id = 'levelModal';
    modal.className = 'filter-modal nft-modal';
    modal.innerHTML = `
        <div class="filter-modal-content">
            <button class="filter-modal-close" style="position: absolute; top: 12px; right: 12px; z-index: 10;" onclick="closeLevelModal()">✕</button>
            
            <div class="nft-header" style="padding-top: 30px;">            
                <div style="margin: 20px 20px 10px 20px;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                        <span style="color: var(--text-secondary); font-size: 0.85em;">Уровень <span id="levelModalPrevLevel">0</span></span>
                        <span style="color: var(--text-secondary); font-size: 0.85em;">Уровень <span id="levelModalNextLevel">2</span></span>
                    </div>
                    
                    <div class="level-progress-bar" style="height: 12px; background: var(--surface); border-radius: 20px; overflow: hidden; border: 1px solid var(--border); position: relative;">
                        <div class="level-progress-fill" id="levelModalProgressFill" style="height: 100%; background: linear-gradient(90deg, var(--primary) 0%, var(--success) 100%); width: 0%; transition: width 0.3s ease; border-radius: 20px;"></div>
                    </div>
                    
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 12px;">
                        <div style="display: flex; align-items: center; gap: 6px; background: rgba(255,215,0,0.1); padding: 6px 12px; border-radius: 30px;">
                            <span style="color: #FFD700; font-size: 1.1em;">⭐</span>
                            <span style="color: var(--text-primary); font-weight: 600;" id="levelModalSpent">0</span>
                            <span style="color: var(--text-secondary); font-size: 0.8em;">потрачено</span>
                        </div>
                        
                        <div style="display: flex; align-items: center; gap: 6px; background: rgba(42,127,255,0.1); padding: 6px 12px; border-radius: 30px;">
                            <span style="color: var(--primary); font-size: 1.1em;">→</span>
                            <span style="color: var(--text-primary); font-weight: 600;" id="levelModalNeeded">0</span>
                            <span style="color: var(--text-secondary); font-size: 0.8em;">до след.</span>
                        </div>
                    </div>
                </div>
            </div>
            
            <div class="filter-modal-body">
                <div class="nft-info-section">
                    <div style="padding: 0 0 12px 0; text-align: center;">
                        <h4 style="color: var(--text-primary); font-size: 1em; font-weight: 600; margin: 0;">За что повышается уровень?</h4>
                        <p style="color: var(--text-secondary); font-size: 0.85em; margin: 4px 0 0 0;">Уровень растет с каждой покупкой</p>
                    </div>
                    
                    <div class="nft-info-table">
                        <div class="nft-info-row">
                            <div class="nft-info-label">
                                <span style="display: flex; align-items: center; gap: 6px;">
                                    <span style="font-size: 1.2em;"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path fill="currentColor" d="M19 20c0 1.11-.89 2-2 2a2 2 0 0 1-2-2c0-1.11.89-2 2-2a2 2 0 0 1 2 2M7 18c-1.11 0-2 .89-2 2a2 2 0 0 0 2 2c1.11 0 2-.89 2-2s-.89-2-2-2m.2-3.37l-.03.12c0 .14.11.25.25.25H19v2H7a2 2 0 0 1-2-2c0-.35.09-.68.24-.96l1.36-2.45L3 4H1V2h3.27l.94 2H20c.55 0 1 .45 1 1c0 .17-.05.34-.12.5l-3.58 6.47c-.34.61-1 1.03-1.75 1.03H8.1zM8.5 11H10V9H7.56zM11 9v2h3V9zm3-1V6h-3v2zm3.11 1H15v2h1zm1.67-3H15v2h2.67zM6.14 6l.94 2H10V6z"/></svg></span>
                                    Покупка
                                </span>
                            </div>
                            <div class="nft-info-value" style="color: #FFD700;">
                                +100% потраченных звезд
                            </div>
                        </div>
                        
                        <div class="nft-info-row">
                            <div class="nft-info-label">
                                <span style="display: flex; align-items: center; gap: 6px;">
                                    <span style="font-size: 1.2em;"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path fill="currentColor" d="M21 8V6H7v2zm0 8v-5H7v5zm0-12a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6c0-1.11.89-2 2-2zM3 20h15v2H3a2 2 0 0 1-2-2V9h2z"/></svg></span>
                                    Продажа
                                </span>
                            </div>
                            <div class="nft-info-value" style="color: var(--text-secondary);">
                                не влияет
                            </div>
                        </div>
                        
                        <div class="nft-info-row">
                            <div class="nft-info-label">
                                <span style="display: flex; align-items: center; gap: 6px;">
                                    <span style="font-size: 1.2em;"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path fill="currentColor" d="M12 18a6 6 0 0 1-6-6c0-1 .25-1.97.7-2.8L5.24 7.74A7.93 7.93 0 0 0 4 12a8 8 0 0 0 8 8v3l4-4l-4-4m0-11V1L8 5l4 4V6a6 6 0 0 1 6 6c0 1-.25 1.97-.7 2.8l1.46 1.46A7.93 7.93 0 0 0 20 12a8 8 0 0 0-8-8"/></svg></span>
                                    Передача
                                </span>
                            </div>
                            <div class="nft-info-value" style="color: var(--text-secondary);">
                                комиссия 5 ⭐ не влияет
                            </div>
                        </div>
                    </div>
                </div>
            </div>
            
            <div class="modal-footer">
                <button class="filter-modal-apply" onclick="closeLevelModal()">OK</button>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
    setupLevelModalEvents();
}

function setupLevelModalEvents() {
    const modal = document.getElementById('levelModal');
    if (!modal) return;
    
    modal.addEventListener('click', (e) => {
        if (e.target === modal) closeLevelModal();
    });
    
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && modal.classList.contains('active')) {
            closeLevelModal();
        }
    });
}

function openLevelModal() {
    const modal = document.getElementById('levelModal');
    if (!modal) {
        createLevelModal();
    }
    
    updateLevelModalData();
    document.getElementById('levelModal').classList.add('active');
    if (window.vibrate) window.vibrate(1);
}

function closeLevelModal() {
    const modal = document.getElementById('levelModal');
    if (modal) {
        modal.classList.remove('active');
    }
    if (window.vibrate) window.vibrate(1);
}

function updateLevelModalData() {
    if (!window.appState?.userData) return;
    
    const userData = window.appState.userData;
    const level = userData.level || 1;
    const spent = userData.spent || 0;
    
    // Используем лимиты из userData (полученные при регистрации)
    const currentMin = userData.currentLevelMin !== undefined ? userData.currentLevelMin : 0;
    const currentMax = userData.currentLevelMax !== undefined ? userData.currentLevelMax : 1000;
    const nextMin = userData.nextLevelMin !== undefined ? userData.nextLevelMin : 1000;
    const nextMax = userData.nextLevelMax !== undefined ? userData.nextLevelMax : 2000;
    
    // Расчет прогресса
    let progress = 100;
    let needed = 0;
    
    if (nextMin > currentMin) {
        const range = nextMin - currentMin;
        const currentProgress = spent - currentMin;
        progress = Math.min(100, Math.max(0, (currentProgress / range) * 100));
        needed = Math.max(0, nextMin - spent);
    }
    
    // Обновляем элементы модалки
    const currentLevelEl = document.getElementById('levelModalCurrentLevel');
    const prevLevelEl = document.getElementById('levelModalPrevLevel');
    const nextLevelEl = document.getElementById('levelModalNextLevel');
    const spentEl = document.getElementById('levelModalSpent');
    const neededEl = document.getElementById('levelModalNeeded');
    const progressFill = document.getElementById('levelModalProgressFill');
    
    if (currentLevelEl) currentLevelEl.textContent = level;
    if (prevLevelEl) prevLevelEl.textContent = Math.max(1, level);
    if (nextLevelEl) nextLevelEl.textContent = level + 1;
    if (spentEl) spentEl.textContent = Math.floor(spent).toLocaleString();
    if (neededEl) neededEl.textContent = Math.max(0, needed).toLocaleString(); 
    if (progressFill) progressFill.style.width = `${progress}%`;
}

// Добавляем обработчик клика на уровень в профиле
function setupLevelClickListener() {
    const checkInterval = setInterval(() => {
        const profileLevel = document.getElementById('profileLevel');
        const levelLeftImage = document.querySelector('.level-image-left');
        
        if (profileLevel || levelLeftImage) {
            clearInterval(checkInterval);
            
            if (profileLevel) {
                profileLevel.style.cursor = 'pointer';
                profileLevel.addEventListener('click', (e) => {
                    e.stopPropagation();
                    openLevelModal();
                });
            }
            
            if (levelLeftImage) {
                levelLeftImage.style.cursor = 'pointer';
                levelLeftImage.addEventListener('click', (e) => {
                    e.stopPropagation();
                    openLevelModal();
                });
            }
        }
    }, 500);
}

// Инициализация при загрузке страницы
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        createLevelModal();
        setupLevelClickListener();
    });
} else {
    createLevelModal();
    setupLevelClickListener();
}

// Обновляем перехват функции updateUserLevel
const originalUpdateUserLevel = window.updateUserLevel;
window.updateUserLevel = function() {
    if (originalUpdateUserLevel) originalUpdateUserLevel();
    setupLevelClickListener();
    
    // Если модалка открыта, обновляем данные
    const modal = document.getElementById('levelModal');
    if (modal && modal.classList.contains('active')) {
        updateLevelModalData();
    }
};

// Экспортируем функции
window.openLevelModal = openLevelModal;
window.closeLevelModal = closeLevelModal;