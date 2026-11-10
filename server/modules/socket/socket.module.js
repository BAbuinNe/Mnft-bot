import dotenv from 'dotenv';
import { Api } from "telegram";
dotenv.config();

import { CurrencyService } from '../currency/currency.service.js';
import { NFTService } from '../nft/nft.service.js';
import { UserService } from '../user/user.service.js'; 
import { TelegramService } from '../telegram/telegram.service.js';

export class SocketModule {
    constructor(io, redisClient, db) {
        this.io = io;
        this.db = db;
        this.redis = redisClient;
        
        global.socketModule = this;
        
        this.ratingCache = {
            holders: { data: null, timestamp: 0 },
            referrals: { data: null, timestamp: 0 }
        };
        this.CACHE_TTL = 3600000; // 60 секунд
        
        this.currencyService = new CurrencyService(redisClient);
        this.nftService = new NFTService(db);
        this.userService = new UserService(db);
        
        const botToken = process.env.TELEGRAM_BOT_TOKEN;
        if (!botToken) {
            throw new Error('TELEGRAM_BOT_TOKEN is required');
        }
        
        this.telegramService = new TelegramService(botToken);
        
        this.setupSocketHandlers();
        this.startPriceBroadcasting();
        
        console.log('⭐ Socket module started');
        this.currencyService.startPriceUpdates();
    }

    setupSocketHandlers() {
        this.io.on('connection', (socket) => {
            const registerHandler = socket.on.bind(socket);
            const ownedEvents = new Map([
                ['register_user', 'userId'], ['get_referrals', null],
                ['get_transaction_history', null], ['list_nft_for_sale', 'sellerId'],
                ['remove_nft_from_sale', 'userId'], ['upgrade_nft', 'userId'],
                ['toggle_pin_nft', 'userId'], ['wear_nft', 'userId'],
                ['get_user_nfts', null], ['get_user_nfts_with_filters', 'userId'],
                ['get_worn_nft', null]
            ]);
            socket.on = (eventName, handler) => registerHandler(
                eventName,
                (...args) => {
                    if (ownedEvents.has(eventName)) {
                        const field = ownedEvents.get(eventName);
                        const supplied = field ? args[0]?.[field] : (args[0]?.userId ?? args[0]);
                        if (Number(supplied) !== socket.data.telegramUserId) {
                            socket.emit('authorization_error', { error: 'Telegram user mismatch' });
                            return;
                        }
                    }
                    return this.db.withContext
                        ? this.db.withContext(() => handler(...args))
                        : handler(...args);
                }
            );

            console.log(`[SocketModule] 🔌 Client connected: ${socket.id}`);
            // ========== ОБРАБОТЧИК РЕГИСТРАЦИИ ПОЛЬЗОВАТЕЛЯ ==========
            socket.on('register_user', async (data) => {
                try {
                    console.log('🔵 [SERVER] Received register_user event:', data);
                
                    const { userId } = data;
                
                    let referrerId = null;
                    if (data.referrerId) {
                        const numId = Number(data.referrerId);
                        if (!isNaN(numId) && numId > 0) {
                            referrerId = numId;
                        }
                    }
                    const userCreated = await this.userService.createUser(userId, referrerId);
                
                    const userData = await this.userService.getUserStats(userId);
                
                    // Добавляем путь к картинке уровня
                    if (userData) {
                        userData.levelImage = `/m_nft_image/lvl/${userData.level || 1}.png`;
                        
                        // === НОВОЕ: Получаем лимиты текущего уровня ===
                        const levelLimits = await this.getLevelLimits(userData.level || 1);
                        userData.currentLevelMin = levelLimits.min;
                        userData.currentLevelMax = levelLimits.max;
                        
                        // Получаем лимиты следующего уровня (если есть)
                        const nextLevelLimits = await this.getLevelLimits((userData.level || 1) + 1);
                        userData.nextLevelMin = nextLevelLimits.min;
                        userData.nextLevelMax = nextLevelLimits.max;
                    }
                
                    socket.emit('user_registered', { 
                        success: true, 
                        user: userData,
                        isNewUser: userCreated
                    });
                
                } catch (error) {
                    console.error('🔴 Registration error:', error);
                    socket.emit('user_registered', { 
                        success: false, 
                        error: error.message 
                    });
                }
            });

            // ========== ОБРАБОТЧИКИ ВАЛЮТЫ ==========
            socket.on('get_currency_rate', async () => {
                const rateData = await this.currencyService.getCurrentRate();
                socket.emit('currency_rate', { 
                    tonPrice: rateData.tonPrice.toFixed(4),
                    timestamp: rateData.timestamp
                });
            });

            socket.on('subscribe_currency', () => {
                socket.join('currency_updates');
                console.log(`📊 Client ${socket.id} subscribed to currency updates`);
            });

            socket.on('unsubscribe_currency', () => {
                socket.leave('currency_updates');
                console.log(`📊 Client ${socket.id} unsubscribed from currency updates`);
            });

            // ========== ОБРАБОТЧИКИ NFT ==========
            socket.on('get_user_nfts', async (userId) => {
                try {
                    const nfts = await this.nftService.getUserNFTs(userId);
                    socket.emit('user_nfts', { 
                        success: true, 
                        nfts,
                        count: nfts.length
                    });
                } catch (error) {
                    socket.emit('user_nfts', { 
                        success: false, 
                        error: error.message 
                    });
                }
            });

            socket.on('get_collections', async () => {
                try {
                    const collections = await this.nftService.getCollections();
                    socket.emit('collections_list', { 
                        success: true, 
                        collections 
                    });
                } catch (error) {
                    socket.emit('collections_list', { 
                        success: false, 
                        error: error.message 
                    });
                }
            });
            
            socket.on('get_referrals', async (userId) => {
                try {
                    const referrals = await this.userService.getReferralsWithEarnings(userId);
                    
                    socket.emit('referrals_list', { 
                        success: true, 
                        referrals: referrals
                    });

                } catch (error) {
                    console.error('Error getting referrals:', error);
                    socket.emit('referrals_list', { 
                        success: false, 
                        error: error.message 
                    });
                }
            });
            
            socket.on('transfer_nft', () => {
                socket.emit('feature_disabled', { feature: 'transactions' });
            });

            // ОБРАБОТЧИК ДЛЯ ПОИСКА ПОЛЬЗОВАТЕЛЕЙ
            socket.on('search_users', async (query) => {
                try {
                    
                    const users = await this.userService.searchUsers(query);
                    
                    socket.emit('search_users_result', {
                        success: true,
                        users: users,
                        query: query
                    });
                    
                } catch (error) {
                    socket.emit('search_users_result', {
                        success: false,
                        error: error.message,
                        query: query
                    });
                }
            });

            // ========== ОБРАБОТЧИК ПОПОЛНЕНИЯ БАЛАНСА ==========
            socket.on('deposit_stars', () => {
                socket.emit('feature_disabled', { feature: 'transactions' });
            });
            
            // ========== ОБРАБОТЧИК СОЗДАНИЯ ПЛАТЕЖНОГО ИНВОЙСА ==========
            socket.on('create_payment_invoice', () => {
                socket.emit('feature_disabled', { feature: 'transactions' });
            });

            socket.on('get_transaction_history', async (data) => {
                try {
                    let userId;
                
                    if (typeof data === 'object' && data.userId) {
                        userId = data.userId;
                    } else if (typeof data === 'number' || (typeof data === 'string' && !isNaN(data))) {
                        userId = Number(data);
                    } else {
                        console.error('❌ Invalid data format for transaction history:', data);
                        socket.emit('transaction_history', {
                            success: false,
                            error: 'Invalid user ID format',
                            transactions: []
                        });
                        return;
                    }
                    const history = await this.userService.getTransactionHistory(userId, 50);

                    const transfers = await this.getNFTTransfersHistory(userId);

                    const allRecords = [...history, ...transfers].sort((a, b) => 
                        new Date(b.createdAt || b.timestamp) - new Date(a.createdAt || a.timestamp)
                    );
                
                    socket.emit('transaction_history', {
                        success: true,
                        transactions: allRecords,
                        count: allRecords.length
                    });
                
                } catch (error) {
                    console.error('❌ Error fetching transaction history:', error);
                    socket.emit('transaction_history', {
                        success: false,
                        error: error.message,
                        transactions: []
                    });
                }
            });

            // ========== ОБРАБОТЧИК ПРОДАЖИ NFT ==========
            socket.on('list_nft_for_sale', async (data) => {
                try {

                    const { nftId, sellerId, price } = data;

                    const nftCheck = await this.db.get(
                        'SELECT * FROM m_nfts WHERE id = ? AND owner_id = ?',
                        [nftId, sellerId]
                    );

                    if (!nftCheck) {
                        socket.emit('nft_sale_listed', {
                            success: false,
                            error: 'NFT не найден или вы не владеете им'
                        });
                        return;
                    }

                    if (price < 1 || price > 999999) {
                        socket.emit('nft_sale_listed', {
                            success: false,
                            error: 'Некорректная цена. Допустимый диапазон: 1-999,999 ⭐'
                        });
                        return;
                    }

                    const existingListing = await this.db.get(
                        'SELECT * FROM m_nfts_on_sale WHERE nft_id = ?',
                        [nftId]
                    );

                    if (existingListing) {
                        socket.emit('nft_sale_listed', {
                            success: false,
                            error: 'NFT уже выставлен на продажу'
                        });
                        return;
                    }

                    const success = await this.nftService.listNFTForSale(nftId, sellerId, price);

                    if (success) {
                        socket.emit('nft_sale_listed', {
                            success: true,
                            message: 'NFT успешно выставлен на продажу',
                            nftId: nftId,
                            price: price
                        });

                        this.io.emit('market_updated', {
                            timestamp: new Date().toISOString()
                        });

                    } else {
                        socket.emit('nft_sale_listed', {
                            success: false,
                            error: 'Ошибка при выставлении NFT на продажу'
                        });
                    }

                } catch (error) {
                    console.error('❌ NFT sale listing error:', error);
                    socket.emit('nft_sale_listed', {
                        success: false,
                        error: error.message
                    });
                }
            });
            
            socket.on('get_nfts_for_sale', async (data) => {
                try {
                    let query = `
                        SELECT 
                            ms.id as sale_id,
                            ms.price,
                            ms.seller_id,
                            ms.listed_at,
                            mn.id as nft_id,
                            mn.number,
                            mn.collection_id,
                            mn.owner_id,
                            mn.created_at,
                            mn.model,
                            mn.background,
                            mn.pattern,
                            mn.[update],

                            -- Данные коллекции
                            mnc.name as collection_name,
                            mnc.image_file_id,
                            mnc.total_supply,
                            mnc.sold_count,
                            mnc.price as collection_price,
                            mnc.updateble,

                            -- Данные модели
                            m.id as model_id,
                            m.name as model_name,
                            m.rarity as model_rarity,
                            m.file_name as model_file_name,

                            -- Данные фона
                            b.id as background_id,
                            b.back_0,
                            b.back_100,
                            b.name as background_name,
                            b.rarity as background_rarity,

                            -- Данные узора
                            p.id as pattern_id,
                            p.name as pattern_name,
                            p.rarity as pattern_rarity,
                            p.file_name as pattern_file_name

                        FROM m_nfts_on_sale ms
                        JOIN m_nfts mn ON ms.nft_id = mn.id
                        JOIN m_nft_collections mnc ON mn.collection_id = mnc.id
                        LEFT JOIN models m ON mn.model = m.id
                        LEFT JOIN backgrounds b ON mn.background = b.id
                        LEFT JOIN patterns p ON mn.pattern = p.id
                        WHERE 1=1
                    `;
                
                    const params = [];
                
                    if (data.collection && data.collection.length > 0) {
                        // data.collection уже массив чисел
                        query += ' AND mnc.id IN (' + data.collection.map(() => '?').join(',') + ')';
                        params.push(...data.collection);
                        console.log('📦 Маркет: фильтрация по коллекциям ID:', data.collection);
                    }
                
                    if (data.rarity && data.rarity.length > 0) {
                        const rarityConditions = [];

                        data.rarity.forEach(rarity => {
                            switch(rarity) {
                                case 'legendary':
                                    rarityConditions.push('mnc.total_supply <= 50');
                                    break;
                                case 'epic':
                                    rarityConditions.push('(mnc.total_supply > 50 AND mnc.total_supply <= 200)');
                                    break;
                                case 'rare':
                                    rarityConditions.push('(mnc.total_supply > 200 AND mnc.total_supply <= 1000)');
                                    break;
                                case 'common':
                                    rarityConditions.push('mnc.total_supply > 1000');
                                    break;
                            }
                        });

                        if (rarityConditions.length > 0) {
                            query += ' AND (' + rarityConditions.join(' OR ') + ')';
                        }
                    }

                    if (data.pattern && data.pattern.length > 0) {
                        const patternIds = data.pattern.map(id => {
                            const numId = parseInt(id);
                            return isNaN(numId) ? null : numId;
                        }).filter(id => id !== null);

                        if (patternIds.length > 0) {
                            query += ' AND mn.pattern IN (' + patternIds.map(() => '?').join(',') + ')';
                            params.push(...patternIds);
                            console.log(`🎨 Фильтрация по узорам ID:`, patternIds);
                        }
                    }
                    
                    if (data.background && data.background.length > 0) {
                        const backgroundIds = data.background.map(id => {
                            const numId = parseInt(id);
                            return isNaN(numId) ? null : numId;
                        }).filter(id => id !== null);

                        if (backgroundIds.length > 0) {
                            query += ' AND mn.background IN (' + backgroundIds.map(() => '?').join(',') + ')';
                            params.push(...backgroundIds);
                            console.log(`🎨 Фильтрация по фонам ID:`, backgroundIds);
                        }
                    }
                    
                    if (data.model && data.model.length > 0) {
                        const modelIds = data.model.map(id => {
                            const numId = parseInt(id);
                            return isNaN(numId) ? null : numId;
                        }).filter(id => id !== null);

                        if (modelIds.length > 0) {
                            query += ' AND mn.model IN (' + modelIds.map(() => '?').join(',') + ')';
                            params.push(...modelIds);
                            console.log(`📦 Фильтрация по моделям ID:`, modelIds);
                        }
                    }
                
                    if (data.priceMin && data.priceMin > 0) {
                        query += ' AND ms.price >= ?';
                        params.push(data.priceMin);
                    }
                
                    if (data.priceMax && data.priceMax < 999999) {
                        query += ' AND ms.price <= ?';
                        params.push(data.priceMax);
                    }
                
                    let orderBy = 'ms.listed_at DESC';

                    if (data.sort) {
                        switch(data.sort) {
                            case 'newest':
                                orderBy = 'ms.listed_at DESC';
                                break;
                            case 'oldest':
                                orderBy = 'ms.listed_at ASC';
                                break;
                            case 'price_low':
                                orderBy = 'ms.price ASC';
                                break;
                            case 'price_high':
                                orderBy = 'ms.price DESC';
                                break;
                            case 'rarity_high':
                                orderBy = `CASE 
                                    WHEN mnc.total_supply <= 50 THEN 1
                                    WHEN mnc.total_supply <= 200 THEN 2
                                    WHEN mnc.total_supply <= 1000 THEN 3
                                    ELSE 4
                                END ASC, ms.listed_at DESC`;
                                break;
                            case 'rarity_low':
                                orderBy = `CASE 
                                    WHEN mnc.total_supply <= 50 THEN 4
                                    WHEN mnc.total_supply <= 200 THEN 3
                                    WHEN mnc.total_supply <= 1000 THEN 2
                                    ELSE 1
                                END ASC, ms.listed_at DESC`;
                                break;
                            case 'collection':
                                orderBy = 'mnc.name ASC, ms.listed_at DESC';
                                break;
                        }
                    }
                    
                    query += ` ORDER BY ${orderBy}`;
                    query += ' LIMIT 500';
                    
                    console.log('📦 Параметры:', params);
                
                    const listings = await this.db.all(query, params);
                
                    const getRarityBySupply = (totalSupply) => {
                        if (!totalSupply) return 'Обычный';
                        if (totalSupply <= 50) return 'Легендарный';
                        if (totalSupply <= 200) return 'Эпический';
                        if (totalSupply <= 1000) return 'Редкий';
                        return 'Обычный';
                    };
    
                    const formattedListings = listings.map(listing => {
                        const rarity = getRarityBySupply(listing.total_supply);
                    
                        const modelData = listing.model_id ? {
                            id: listing.model_id,
                            name: listing.model_name,
                            rarity: listing.model_rarity,
                            file_name: listing.model_file_name
                        } : null;
                    
                        const backgroundData = listing.background_id ? {
                            id: listing.background_id,
                            back_0: listing.back_0,
                            back_100: listing.back_100,
                            name: listing.background_name,
                            rarity: listing.background_rarity
                        } : null;
                    
                        const patternData = listing.pattern_id ? {
                            id: listing.pattern_id,
                            name: listing.pattern_name,
                            rarity: listing.pattern_rarity,
                            file_name: listing.pattern_file_name
                        } : null;
                    
                        return {
                            id: listing.nft_id,
                            saleId: listing.sale_id,
                            price: listing.price,
                            sellerId: listing.seller_id,
                            listedAt: listing.listed_at,
                            number: listing.number,
                            collectionId: listing.collection_id,
                            ownerId: listing.owner_id,
                            createdAt: listing.created_at,
                            collectionName: listing.collection_name,
                            fullName: `${listing.collection_name} #${listing.number}`,
                            image: listing.image_file_id ? `/m_nft_image/base/${listing.image_file_id}` : '🎴',
                            rarity: rarity,
                            totalSupply: listing.total_supply,
                            soldCount: listing.sold_count,
                            collectionPrice: listing.collection_price || 0,
                            forSale: true,
                            update: listing.update,
                            modelData: modelData,
                            backgroundData: backgroundData,
                            patternData: patternData,
                            rarityPercentage: listing.number && listing.total_supply ? 
                                Math.round((listing.number / listing.total_supply) * 10000) / 100 : 0
                        };
                    });
                
                    socket.emit('nfts_for_sale', {
                        success: true,
                        listings: formattedListings
                    });
                
                
                } catch (error) {
                    console.error('❌ Ошибка получения NFT с фильтрами:', error);
                    socket.emit('nfts_for_sale', {
                        success: false,
                        error: error.message
                    });
                }
            });

            socket.on('buy_nft', () => {
                socket.emit('feature_disabled', { feature: 'transactions' });
            });

            socket.on('remove_nft_from_sale', async (data) => {
                try {
                    const { nftId, userId } = data;

                    // Проверяем, что пользователь владеет NFT И он на продаже
                    const listing = await this.db.get(`
                        SELECT ms.*, mn.owner_id 
                        FROM m_nfts_on_sale ms
                        JOIN m_nfts mn ON ms.nft_id = mn.id
                        WHERE ms.nft_id = ? AND ms.seller_id = ?
                    `, [nftId, userId]);
                    
                    if (!listing) {
                        socket.emit('nft_removed_from_sale', {
                            success: false,
                            error: 'NFT не найден на продаже или вы не владеете им'
                        });
                        return;
                    }

                    // Удаляем из таблицы продаж
                    await this.db.run(
                        'DELETE FROM m_nfts_on_sale WHERE nft_id = ?',
                        [nftId]
                    );
                    socket.emit('nft_removed_from_sale', {
                        success: true,
                        message: 'NFT успешно снят с продажи'
                    });

                    // Отправляем событие обновления маркета всем
                    this.io.emit('market_updated', {
                        timestamp: new Date().toISOString()
                    });

                } catch (error) {
                    console.error('❌ Error removing NFT from sale:', error);
                    socket.emit('nft_removed_from_sale', {
                        success: false,
                        error: error.message
                    });
                }
            });
            
            socket.on('get_global_sales_history', async (data = {}) => {
                try {
                    const limit = data.limit || 50;
                    
                    // Получаем все NFT-трансферы из БД (только продажи)
                    const transfers = await this.db.all(`
                        SELECT 
                            nt.id,
                            nt.transfer_type,
                            nt.amount,
                            nt.from_user_id,
                            nt.to_user_id,
                            nt.timestamp,
                            mn.number as nft_number,
                            mn.collection_id,
                            mn.model,
                            mn.background,
                            mn.pattern,
                            mn.[update],
                            mnc.name as collection_name,
                            mnc.image_file_id as image_file_id,
                            
                            -- Данные модели (если есть)
                            m.id as model_id,
                            m.name as model_name,
                            m.rarity as model_rarity,
                            m.file_name as model_file_name,
                            
                            -- Данные фона (если есть)
                            b.id as background_id,
                            b.back_0,
                            b.back_100,
                            b.name as background_name,
                            b.rarity as background_rarity,
                            
                            -- Данные узора (если есть)
                            p.id as pattern_id,
                            p.name as pattern_name,
                            p.rarity as pattern_rarity,
                            p.file_name as pattern_file_name
                            
                        FROM nft_transfers nt
                        LEFT JOIN m_nfts mn ON nt.nft_id = mn.id
                        LEFT JOIN m_nft_collections mnc ON mn.collection_id = mnc.id
                        LEFT JOIN models m ON mn.model = m.id
                        LEFT JOIN backgrounds b ON mn.background = b.id
                        LEFT JOIN patterns p ON mn.pattern = p.id
                        WHERE nt.transfer_type IN ('purchase', 'sale')
                        ORDER BY nt.timestamp DESC
                        LIMIT ?
                    `, [limit]);
                    
                    // Форматируем данные для фронтенда
                    const formattedTransfers = transfers.map(transfer => {
                        // Добавляем данные улучшенных атрибутов
                        const modelData = transfer.model_id ? {
                            id: transfer.model_id,
                            name: transfer.model_name,
                            rarity: transfer.model_rarity,
                            file_name: transfer.model_file_name
                        } : null;
                    
                        const backgroundData = transfer.background_id ? {
                            id: transfer.background_id,
                            back_0: transfer.back_0,
                            back_100: transfer.back_100,
                            name: transfer.background_name,
                            rarity: transfer.background_rarity
                        } : null;
                    
                        const patternData = transfer.pattern_id ? {
                            id: transfer.pattern_id,
                            name: transfer.pattern_name,
                            rarity: transfer.pattern_rarity,
                            file_name: transfer.pattern_file_name
                        } : null;
                    
                        // Определяем эмодзи для коллекции
                        const getCollectionEmoji = (name) => {
                            if (!name) return '🎴';
                            name = name.toLowerCase();
                            if (name.includes('cap')) return '🧢';
                            if (name.includes('car')) return '🚗';
                            if (name.includes('pencil')) return '✏️';
                            if (name.includes('pepe')) return '🐸';
                            return '🎴';
                        };
                        
                        return {
                            id: transfer.id,
                            type: 'Продажа NFT',
                            amount: transfer.amount,
                            fromUserId: transfer.from_user_id,
                            toUserId: transfer.to_user_id,
                            collectionName: transfer.collection_name,
                            nftNumber: transfer.nft_number,
                            nftFullName: `${transfer.collection_name || 'NFT'} #${transfer.nft_number || '?'}`,
                            emoji: getCollectionEmoji(transfer.collection_name),
                            imageFileId: transfer.image_file_id,
                            createdAt: transfer.timestamp,
                            timestamp: transfer.timestamp,
                            status: 'Успешно',
                            isGlobalSale: true,
                            
                            // ДОБАВЛЯЕМ ДАННЫЕ УЛУЧШЕННЫХ АТРИБУТОВ:
                            collectionId: transfer.collection_id,
                            update: transfer.update || null,
                            model: transfer.model,
                            background: transfer.background,
                            pattern: transfer.pattern,
                            modelData: modelData,
                            backgroundData: backgroundData,
                            patternData: patternData
                        };
                    });
                    
                    socket.emit('global_sales_history', {
                        success: true,
                        transfers: formattedTransfers,
                        count: formattedTransfers.length
                    });
                    
                    
                } catch (error) {
                    console.error('❌ Ошибка загрузки глобальной истории:', error);
                    socket.emit('global_sales_history', {
                        success: false,
                        error: error.message,
                        transfers: []
                    });
                }
            });

            socket.on('get_available_nfts', async (data) => {
                try {
                    let query = `
                        SELECT 
                            mnc.id,
                            mnc.name,
                            mnc.image_file_id,
                            mnc.total_supply,
                            mnc.sold_count,
                            mnc.price,
                            mnc.created_at,
                            (mnc.total_supply - mnc.sold_count) as available
                        FROM m_nft_collections mnc
                        WHERE 1=1
                    `;
                    
                    const params = [];
                    
                    // Фильтр по категории (теперь принимает ID коллекций)
                    if (data.category && data.category.length > 0) {
                        // Проверяем формат - могут быть имена или ID
                        const isNumericIds = data.category.every(id => !isNaN(id));
                        
                        if (isNumericIds) {
                            // Это числовые ID коллекций
                            query += ' AND mnc.id IN (' + data.category.map(() => '?').join(',') + ')';
                            params.push(...data.category);
                        } else {
                            // Это имена категорий (старый формат)
                            const categoryConditions = [];
                            data.category.forEach(category => {
                                categoryConditions.push('mnc.name LIKE ?');
                                params.push(`%${category}%`);
                            });
                            
                            if (categoryConditions.length > 0) {
                                query += ' AND (' + categoryConditions.join(' OR ') + ')';
                            }
                        }
                    }
                
                    // Фильтр по редкости (МНОЖЕСТВЕННЫЙ)
                    if (data.rarity && data.rarity.length > 0) {
                        const rarityConditions = [];
                    
                        data.rarity.forEach(rarity => {
                            switch(rarity) {
                                case 'legendary':
                                    rarityConditions.push('mnc.total_supply <= 50');
                                    break;
                                case 'epic':
                                    rarityConditions.push('(mnc.total_supply > 50 AND mnc.total_supply <= 200)');
                                    break;
                                case 'rare':
                                    rarityConditions.push('(mnc.total_supply > 200 AND mnc.total_supply <= 1000)');
                                    break;
                                case 'common':
                                    rarityConditions.push('mnc.total_supply > 1000');
                                    break;
                            }
                        });
                    
                        if (rarityConditions.length > 0) {
                            query += ' AND (' + rarityConditions.join(' OR ') + ')';
                        }
                    }

                    if (data.sort) {
                        switch(data.sort) {
                            case 'newest':
                                query += ' ORDER BY mnc.created_at DESC';
                                break;
                            case 'oldest':
                                query += ' ORDER BY mnc.created_at ASC';
                                break;
                            case 'price_low':
                                query += ' ORDER BY mnc.price ASC';
                                break;
                            case 'price_high':
                                query += ' ORDER BY mnc.price DESC';
                                break;
                            case 'rarity_high':
                                query += ' ORDER BY mnc.total_supply ASC, mnc.created_at DESC';
                                break;
                            case 'rarity_low':
                                query += ' ORDER BY mnc.total_supply DESC, mnc.created_at DESC';
                                break;
                            case 'collection':
                                query += ' ORDER BY mnc.name ASC, mnc.created_at DESC';
                                break;
                            default:
                                query += ' ORDER BY mnc.created_at DESC';
                        }
                    } else {
                        query += ' ORDER BY mnc.created_at DESC';
                    }
                
                    const collections = await this.db.all(query, params);
                
                    const getRarityBySupply = (totalSupply) => {
                        if (totalSupply <= 50) return 'Легендарный';
                        if (totalSupply <= 200) return 'Эпический';
                        if (totalSupply <= 1000) return 'Редкий';
                        return 'Обычный';
                    };
                
                    const formattedNFTs = collections.map(collection => {
                        const rarity = getRarityBySupply(collection.total_supply);
                        const available = Math.max(0, collection.total_supply - collection.sold_count);
                    
                        return {
                            id: collection.id,
                            collectionId: collection.id,
                            collectionName: collection.name,
                            totalSupply: collection.total_supply,
                            soldCount: collection.sold_count,
                            available: available,
                            price: collection.price || 0,
                            rarity: rarity,
                            fullName: collection.name,
                            // ВАЖНО: Передаем дату создания
                            created_at: collection.created_at, // SQL поле
                            createdAt: collection.created_at,  // JS поле
                            image: collection.image_file_id ? `/m_nft_image/base/${collection.image_file_id}` : '🎴',
                            number: collection.sold_count + 1
                        };
                    });
                
                    socket.emit('available_nfts_list', {
                        success: true,
                        nfts: formattedNFTs
                    });
                
                } catch (error) {
                    console.error('❌ Ошибка получения доступных NFT:', error);
                    socket.emit('available_nfts_list', {
                        success: false,
                        error: error.message || 'Внутренняя ошибка сервера',
                        nfts: []
                    });
                }
            });

            function getRarityBySupply(totalSupply) {
                if (totalSupply <= 50) return 'Легендарный';
                if (totalSupply <= 200) return 'Эпический';
                if (totalSupply <= 1000) return 'Редкий';
                return 'Обычный';
            }

            socket.on('buy_available_nft', () => {
                socket.emit('feature_disabled', { feature: 'transactions' });
            });

            socket.on('upgrade_nft', async (data) => {
                try {
                    const { nftId, userId } = data;
                
                    // 1. Проверяем баланс пользователя
                    const userBalance = await this.db.get(
                        'SELECT stars_balance FROM users WHERE id = ?',
                        [userId]
                    );
                
                    // 2. Проверяем, что пользователь владеет NFT и получаем collection_id
                    const nftCheck = await this.db.get(
                        `SELECT mn.*, mnc.updateble, mnc.id as collection_id 
                         FROM m_nfts mn
                         JOIN m_nft_collections mnc ON mn.collection_id = mnc.id
                         WHERE mn.id = ? AND mn.owner_id = ?`,
                        [nftId, userId]
                    );
                
                    if (!nftCheck) {
                        socket.emit('upgrade_result', {
                            success: false,
                            error: 'NFT не найден или вы не владеете им'
                        });
                        return;
                    }
                
                    // 3. Проверяем, что NFT еще не был улучшен
                    if (nftCheck.update === 1) {
                        socket.emit('upgrade_result', {
                            success: false,
                            error: 'Этот NFT уже был улучшен'
                        });
                        return;
                    }
                
                    // 4. Проверяем, что коллекция позволяет улучшение
                    if (nftCheck.updateble !== 1) {
                        socket.emit('upgrade_result', {
                            success: false,
                            error: 'NFT этой коллекции нельзя улучшить'
                        });
                        return;
                    }
                
                    // === НОВОЕ: Определяем стоимость улучшения ===
                    let upgradeCost = 5; // По умолчанию 5 ⭐
                    if (nftCheck.collection_id === 1) {
                        upgradeCost = 1; // Для коллекции с ID=1 стоимость 1 ⭐
                    }
                
                    // 5. Проверяем баланс с учетом стоимости
                    if (!userBalance || userBalance.stars_balance < upgradeCost) {
                        socket.emit('upgrade_result', {
                            success: false,
                            error: `Недостаточно звезд. Нужно ${upgradeCost} ⭐ для улучшения`
                        });
                        return;
                    }
                
                    // 6. Выбираем случайную модель на основе collection_id
                    const model = await this.getRandomModelByCollection(nftCheck.collection_id);
                
                    // 7. Выбираем фон и узор
                    const [background, pattern] = await Promise.all([
                        this.getRandomBackground(),
                        this.getRandomPattern()
                    ]);
                
                    // 8. Начинаем транзакцию
                    await this.db.run('BEGIN TRANSACTION');
                
                    try {
                        // 9. Списываем звезды (динамическая стоимость)
                        const debit = await this.db.run(
                            'UPDATE users SET stars_balance = stars_balance - ? WHERE id = ? AND stars_balance >= ?',
                            [upgradeCost, userId, upgradeCost]
                        );
                        if (debit.changes !== 1) throw new Error('Недостаточно звезд');
                    
                        // 10. Обновляем NFT с новыми атрибутами
                        const upgraded = await this.db.run(
                            `UPDATE m_nfts 
                             SET model = ?, background = ?, pattern = ?, [update] = 1 
                             WHERE id = ? AND owner_id = ? AND COALESCE([update], 0) = 0`,
                            [model.id, background.id, pattern.id, nftId, userId]
                        );
                        if (upgraded.changes !== 1) throw new Error('NFT уже улучшен или больше не принадлежит вам');
                    
                        await this.db.run('COMMIT');
                    
                        // 11. Получаем обновленный баланс
                        const newBalance = await this.db.get(
                            'SELECT stars_balance FROM users WHERE id = ?',
                            [userId]
                        );
                    
                        // 12. Получаем обновленные данные NFT
                        const updatedNFT = await this.db.get(`
                            SELECT mn.*, mnc.name as collection_name, mnc.image_file_id
                            FROM m_nfts mn
                            LEFT JOIN m_nft_collections mnc ON mn.collection_id = mnc.id
                            WHERE mn.id = ?
                        `, [nftId]);
                        
                        socket.emit('upgrade_result', {
                            success: true,
                            message: 'NFT успешно улучшен',
                            newBalance: newBalance.stars_balance,
                            upgradeCost: upgradeCost, // Добавляем стоимость для информации
                            updatedNFT: {
                                ...updatedNFT,
                                modelName: model.name,
                                backgroundName: background.name,
                                patternName: pattern.name,
                                modelFileName: model.file_name,
                                backgroundFileName: background.file_name,
                                patternFileName: pattern.file_name
                            }
                        });
                    
                        // 13. Отправляем события обновления
                        socket.emit('balance_updated', {
                            userId: userId,
                            newBalance: newBalance.stars_balance,
                            timestamp: new Date().toISOString()
                        });
                    
                        socket.emit('inventory_updated', {
                            userId: userId,
                            timestamp: new Date().toISOString()
                        });
                    
                    } catch (error) {
                        await this.db.run('ROLLBACK');
                        console.error('❌ Ошибка транзакции:', error);
                        throw error;
                    }
                
                } catch (error) {
                    console.error('❌ NFT upgrade error:', error);
                    socket.emit('upgrade_result', {
                        success: false,
                        error: error.message || 'Внутренняя ошибка сервера'
                    });
                }
            });

            socket.on('toggle_pin_nft', async (data) => {
                try {
                    const { nftId, userId } = data;
                    
                    console.log(`📌 Toggling pin for NFT #${nftId} for user ${userId}`);
                    
                    const result = await this.nftService.togglePinNFT(nftId, userId);
                    
                    socket.emit('pin_toggled', result);
                    
                    if (result.success) {
                        console.log(`✅ NFT pin toggled: ${result.action}`);
                        
                        // Обновляем инвентарь пользователя
                        socket.emit('inventory_updated', {
                            userId: userId,
                            timestamp: new Date().toISOString()
                        });
                    }
                    
                } catch (error) {
                    console.error('❌ Error toggling pin:', error);
                    socket.emit('pin_toggled', {
                        success: false,
                        error: error.message
                    });
                }
            });
            
            socket.on('get_user_nfts_with_filters', async (data) => {
                try {
                    const { userId, filters = {} } = data;

                    let query = `
                        SELECT 
                            mn.id,
                            mn.number,
                            mn.collection_id,
                            mn.created_at,
                            mn.model,      
                            mn.background, 
                            mn.pattern,    
                            mn.[update],   
                            mn.pinned,
                            mn.dressed,  
                
                            -- Данные коллекции
                            mnc.name as collection_name,
                            mnc.image_file_id as collection_image,
                            mnc.total_supply as total_supply,
                            mnc.sold_count as sold_count,
                            mnc.price as collection_price,
                            mnc.updateble as updateble,
                
                            -- Данные продажи
                            mnos.id as sale_id,
                            mnos.price as sale_price,
                
                            -- Данные модели (если есть)
                            m.id as model_id,
                            m.name as model_name,
                            m.rarity as model_rarity,
                            m.file_name as model_file_name,
                
                            -- Данные фона (если есть)
                            b.id as background_id,
                            b.back_0,
                            b.back_100,
                            b.name as background_name,
                            b.rarity as background_rarity,
                
                            -- Данные узора (если есть)
                            p.id as pattern_id,
                            p.name as pattern_name,
                            p.rarity as pattern_rarity,
                            p.file_name as pattern_file_name
                
                        FROM m_nfts mn
                        LEFT JOIN m_nft_collections mnc ON mn.collection_id = mnc.id
                        LEFT JOIN m_nfts_on_sale mnos ON mn.id = mnos.nft_id
                        LEFT JOIN models m ON mn.model = m.id
                        LEFT JOIN backgrounds b ON mn.background = b.id
                        LEFT JOIN patterns p ON mn.pattern = p.id
                        WHERE mn.owner_id = ?
                    `;

                    const params = [userId];

                    // ФИЛЬТРАЦИЯ ПО КОЛЛЕКЦИИ (множественный выбор)
                    // ФИЛЬТРАЦИЯ ПО КОЛЛЕКЦИИ - теперь просто числа
                    if (filters.collection && filters.collection.length > 0) {
                        // filters.collection уже массив чисел, никаких преобразований не нужно
                        query += ' AND mnc.id IN (' + filters.collection.map(() => '?').join(',') + ')';
                        params.push(...filters.collection);
                        console.log('📦 Фильтрация по коллекциям ID:', filters.collection);
                    }

                    // Фильтр по моделям
                    if (filters.model && filters.model.length > 0) {
                        const modelIds = filters.model
                            .map(id => parseInt(id))
                            .filter(id => !isNaN(id));

                        if (modelIds.length > 0) {
                            query += ' AND mn.model IN (' + modelIds.map(() => '?').join(',') + ')';
                            params.push(...modelIds);
                        }
                    }
                
                    // Фильтр по узорам (symbol)
                    if (filters.symbol && filters.symbol.length > 0) {
                        const patternIds = filters.symbol
                            .map(id => parseInt(id))
                            .filter(id => !isNaN(id));

                        if (patternIds.length > 0) {
                            query += ' AND mn.pattern IN (' + patternIds.map(() => '?').join(',') + ')';
                            params.push(...patternIds);
                        }
                    }
                
                    // Фильтр по фонам
                    if (filters.background && filters.background.length > 0) {
                        const backgroundIds = filters.background
                            .map(id => parseInt(id))
                            .filter(id => !isNaN(id));

                        if (backgroundIds.length > 0) {
                            query += ' AND mn.background IN (' + backgroundIds.map(() => '?').join(',') + ')';
                            params.push(...backgroundIds);
                        }
                    }

                    // БАЗОВАЯ СОРТИРОВКА ПО ЗАКРЕПЛЕНИЮ
                    let orderBy = `
                        CASE WHEN mn.pinned IS NOT NULL THEN 0 ELSE 1 END,
                        mn.pinned ASC,
                        mn.created_at DESC
                    `;

                    // ПРИМЕНЯЕМ ФИЛЬТРЫ СОРТИРОВКИ
                    if (!filters.sort || filters.sort === 'newest') {
                        // Фильтр "Новые" или фильтр не выбран (по умолчанию) - закрепленные сверху
                        orderBy = `
                            CASE WHEN mn.pinned IS NOT NULL THEN 0 ELSE 1 END,
                            mn.pinned ASC,
                            mn.created_at DESC
                        `;
                    } else {
                        // Для всех других фильтров - сортировка по выбранному критерию
                        switch(filters.sort) {
                            case 'rarity-high':
                                orderBy = `
                                    CASE 
                                        WHEN mnc.total_supply <= 50 THEN 1
                                        WHEN mnc.total_supply <= 200 THEN 2
                                        WHEN mnc.total_supply <= 1000 THEN 3
                                        ELSE 4
                                    END ASC,
                                    mn.created_at DESC
                                `;
                                break;
                            case 'rarity-low':
                                orderBy = `
                                    CASE 
                                        WHEN mnc.total_supply <= 50 THEN 4
                                        WHEN mnc.total_supply <= 200 THEN 3
                                        WHEN mnc.total_supply <= 1000 THEN 2
                                        ELSE 1
                                    END ASC,
                                    mn.created_at DESC
                                `;
                                break;
                            case 'oldest':
                                orderBy = 'mn.created_at ASC';
                                break;
                            case 'number-low':
                                orderBy = 'mn.number ASC';
                                break;
                            case 'number-high':
                                orderBy = 'mn.number DESC';
                                break;
                            case 'collection':
                                orderBy = 'mnc.name ASC, mn.number ASC';
                                break;
                            default:
                                // На всякий случай - если что-то пошло не так
                                orderBy = 'mn.created_at DESC';
                        }
                    }

                    query += ` ORDER BY ${orderBy}`;

                    const nfts = await this.db.all(query, params);

                    const formattedNFTs = nfts.map(nft => {
                        // Формируем данные модели
                        const modelData = nft.model_id ? {
                            id: nft.model_id,
                            name: nft.model_name,
                            rarity: nft.model_rarity,
                            file_name: nft.model_file_name
                        } : null;
                    
                        // Формируем данные фона
                        const backgroundData = nft.background_id ? {
                            id: nft.background_id,
                            back_0: nft.back_0,
                            back_100: nft.back_100,
                            name: nft.background_name,
                            rarity: nft.background_rarity
                        } : null;
                    
                        // Формируем данные узора
                        const patternData = nft.pattern_id ? {
                            id: nft.pattern_id,
                            name: nft.pattern_name,
                            rarity: nft.pattern_rarity,
                            file_name: nft.pattern_file_name
                        } : null;
                    
                        return {
                            id: nft.id,
                            number: nft.number,
                            collectionId: nft.collection_id,
                            collectionName: nft.collection_name,
                            totalSupply: nft.total_supply,
                            soldCount: nft.sold_count,
                            fullName: `${nft.collection_name} #${nft.number}`,
                            image: nft.collection_image ? `/m_nft_image/base/${nft.collection_image}` : '🎴',
                            name: nft.collection_image,
                            rarity: this.nftService.getRarity(nft.total_supply),
                            createdAt: nft.created_at,
                            rarityPercentage: nft.number && nft.total_supply ? 
                                Math.round((nft.number / nft.total_supply) * 10000) / 100 : 0,
                            forSale: !!nft.sale_id,
                            updateble: nft.updateble || 0,
                            update: nft.update || null,
                            model: nft.model,
                            background: nft.background,
                            pattern: nft.pattern,
                            collectionPrice: nft.collection_price || 0,
                            price: nft.sale_id ? nft.sale_price : (nft.collection_price || 0),
                            salePrice: nft.sale_price,
                            pinned: nft.pinned || null,
                            dressed: nft.dressed === 1,
                            modelData: modelData,
                            backgroundData: backgroundData,
                            patternData: patternData
                        };
                    });

                    socket.emit('user_nfts_with_filters', { 
                        success: true, 
                        nfts: formattedNFTs,
                        count: formattedNFTs.length
                    });

                } catch (error) {
                    console.error('❌ Error fetching user NFTs with filters:', error);
                    socket.emit('user_nfts_with_filters', { 
                        success: false, 
                        error: error.message 
                    });
                }
            });

            socket.on('wear_nft', async (data) => {
                try {
                    const { nftId, userId } = data;
                    
                    console.log(`👕 Wear NFT toggle: #${nftId} for user ${userId}`);
                    
                    // Вызываем метод сервиса
                    const result = await this.nftService.toggleWearNFT(nftId, userId);
                    
                    // Отправляем результат клиенту
                    socket.emit('wear_nft_result', result);
                    
                    if (result.success) {
                        console.log(`✅ NFT wear toggled: ${result.action} for #${nftId}`);
                        
                        // Получаем обновленный баланс (на всякий случай)
                        const newBalance = await this.userService.getBalance(userId);
                        
                        // Отправляем событие обновления баланса
                        socket.emit('balance_updated', {
                            userId: userId,
                            newBalance: newBalance,
                            timestamp: new Date().toISOString()
                        });
                        
                        // Отправляем событие обновления инвентаря
                        socket.emit('inventory_updated', {
                            userId: userId,
                            timestamp: new Date().toISOString()
                        });
                        
                        // Если NFT был надет, отправляем отдельное событие
                        if (result.action === 'wear') {
                            socket.emit('nft_worn', {
                                nftId: nftId,
                                userId: userId,
                                timestamp: new Date().toISOString()
                            });
                        }
                        
                        // Если NFT был снят, отправляем отдельное событие
                        if (result.action === 'unwear') {
                            socket.emit('nft_unworn', {
                                nftId: nftId,
                                userId: userId,
                                timestamp: new Date().toISOString()
                            });
                        }
                    }
                    
                } catch (error) {
                    console.error('❌ Error toggling wear:', error);
                    socket.emit('wear_nft_result', {
                        success: false,
                        error: error.message
                    });
                }
            });
            
            socket.on('get_patterns', async () => {
                try {
                    const patterns = await this.db.all(`
                        SELECT id, name, rarity, file_name 
                        FROM patterns 
                        ORDER BY rarity DESC, name ASC
                    `);
                    
                    socket.emit('patterns_list', { 
                        success: true, 
                        patterns 
                    });
                    
                } catch (error) {
                    console.error('❌ Error fetching patterns:', error);
                    socket.emit('patterns_list', { 
                        success: false, 
                        error: error.message,
                        patterns: [] 
                    });
                }
            });
            
            socket.on('get_backgrounds', async () => {
                try {
                    const backgrounds = await this.db.all(`
                        SELECT id, name, back_0, back_100, rarity 
                        FROM backgrounds 
                        ORDER BY rarity DESC, name ASC
                    `);
                    
                    socket.emit('backgrounds_list', { 
                        success: true, 
                        backgrounds 
                    });

                    console.log(`🎨 Отправлено ${backgrounds.length} фонов клиенту`);

                } catch (error) {
                    console.error('❌ Error fetching backgrounds:', error);
                    socket.emit('backgrounds_list', { 
                        success: false, 
                        error: error.message,
                        backgrounds: [] 
                    });
                }
            });
            
            socket.on('get_models', async () => {
                try {
                    const models = await this.db.all(`
                        SELECT 
                            m.id,
                            m.name,
                            m.rarity,
                            m.file_name,
                            m.collection_id,
                            mnc.name as collection_name
                        FROM models m
                        LEFT JOIN m_nft_collections mnc ON m.collection_id = mnc.id
                        ORDER BY mnc.name ASC, m.rarity DESC, m.name ASC
                    `);
                    
                    socket.emit('models_list', { 
                        success: true, 
                        models 
                    });
                    
                    console.log(`📦 Отправлено ${models.length} моделей клиенту`);
                    
                } catch (error) {
                    console.error('❌ Error fetching models:', error);
                    socket.emit('models_list', { 
                        success: false, 
                        error: error.message,
                        models: [] 
                    });
                }
            });
            
            // Добавить обработчик для получения надетого NFT
            socket.on('get_worn_nft', async (userId) => {
                try {
                    const wornNFT = await this.nftService.getUserWornNFT(userId);
                    
                    socket.emit('worn_nft', {
                        success: true,
                        nft: wornNFT
                    });
                    
                } catch (error) {
                    console.error('❌ Error fetching worn NFT:', error);
                    socket.emit('worn_nft', {
                        success: false,
                        error: error.message,
                        nft: null
                    });
                }
            });

            // ========== ОБРАБОТЧИКИ РЕЙТИНГА ==========
            socket.on('get_top_holders', async () => {
                try {
                    // Мгновенно получаем данные из кэша (даже устаревшие)
                    const data = await this.getCachedRating('holders');

                    socket.emit('top_holders_data', {
                        data: data,
                        cached: true,
                        timestamp: Date.now()
                    });

                } catch (error) {
                    console.error('❌ Error fetching top holders:', error);
                    socket.emit('top_holders_data', { data: [], cached: false });
                }
            });

            socket.on('get_top_referrers', async () => {
                try {
                    // Мгновенно получаем данные из кэша (даже устаревшие)
                    const data = await this.getCachedRating('referrals');

                    socket.emit('top_referrers_data', {
                        data: data,
                        cached: true,
                        timestamp: Date.now()
                    });

                } catch (error) {
                    console.error('❌ Error fetching top referrers:', error);
                    socket.emit('top_referrers_data', { data: [], cached: false });
                }
            });

            // слушатели для фоновых обновлений
            socket.on('holders_data_updated', (data) => {
                if (ratingState.currentMode === 'holders') {
                    socket.emit('top_holders_data', data);
                }
            });

            socket.on('referrals_data_updated', (data) => {
                if (ratingState.currentMode === 'referrals') {
                    socket.emit('top_referrers_data', data);
                }
            });

            socket.on('disconnect', () => {
                console.log(`🔌 Client disconnected: ${socket.id}`);
            });
        });
    }

    async getLevelLimits(level) {
        try {
            if (level < 1) level = 1;
            
            const levelData = await this.db.get(`
                SELECT min, max 
                FROM levels 
                WHERE lvl = ?
            `, [level]);
            
            if (levelData) {
                return {
                    min: levelData.min,
                    max: levelData.max
                };
            }
            
            // Если уровень не найден (например, выше максимального)
            const maxLevel = await this.db.get(`
                SELECT lvl, max FROM levels ORDER BY lvl DESC LIMIT 1
            `);
            
            if (maxLevel && level > maxLevel.lvl) {
                return {
                    min: maxLevel.max,
                    max: maxLevel.max
                };
            }
            
            // Возвращаем значения по умолчанию
            return { min: 0, max: 1000 };
            
        } catch (error) {
            console.error('Error getting level limits:', error);
            return { min: 0, max: 1000 };
        }
    }

    async getRandomBackground() {
        const backgrounds = await this.db.all('SELECT * FROM backgrounds ORDER BY rarity DESC');
        return this.weightedRandom(backgrounds, 'rarity');
    }

    async getRandomPattern() {
        const patterns = await this.db.all('SELECT * FROM patterns ORDER BY rarity DESC');
        return this.weightedRandom(patterns, 'rarity');
    }

    async getRandomModelByCollection(collectionId) {
        // Получаем все модели для указанной коллекции
        const models = await this.db.all(
            'SELECT * FROM models WHERE collection_id = ? ORDER BY rarity DESC',
            [collectionId]
        );

        if (models.length === 0) {
            // Если нет моделей для этой коллекции, используем любую модель
            const allModels = await this.db.all('SELECT * FROM models ORDER BY rarity DESC');
            if (allModels.length === 0) {
                throw new Error('Нет доступных моделей');
            }
            return this.weightedRandom(allModels, 'rarity');
        }

        return this.weightedRandom(models, 'rarity');
    }

    weightedRandom(items, rarityKey = 'rarity') {
    if (!items || items.length === 0) return null;
        
        // Суммируем все проценты
        const totalRarity = items.reduce((sum, item) => {
            return sum + (item[rarityKey] || 0);
        }, 0);

        // Генерируем случайное число от 0 до totalRarity
        let random = Math.random() * totalRarity;

        // Выбираем элемент на основе его процента
        for (let i = 0; i < items.length; i++) {
            const rarity = items[i][rarityKey] || 0;
            if (random < rarity) {
                return items[i];
            }
            random -= rarity;
        }

        return items[items.length - 1];
    }

    async getCachedRating(type) {
        const now = Date.now();
        const cache = this.ratingCache[type];

        // 1. Если кэша вообще нет - создаем пустой
        if (!cache.data) {
            cache.data = [];
            cache.timestamp = 0;
        }

        // 2. ВСЕГДА возвращаем текущие данные кэша (мгновенно!)
        const currentData = cache.data;

        // 3. Проверяем, нужно ли обновить кэш в фоне
        const shouldUpdate = !cache.data.length || (now - cache.timestamp) >= this.CACHE_TTL;

        if (shouldUpdate) {
            console.log(`🔄 Фоновое обновление кэша для ${type}`);

            // Запускаем обновление асинхронно
            this.updateRatingCacheAsync(type).catch(error => {
                console.error(`❌ Ошибка фонового обновления ${type}:`, error);
            });
        }

        // 4. Мгновенно возвращаем текущие данные
        return currentData;
    }

    async updateRatingCacheAsync(type) {
        try {
            console.log(`🔄 Загружаем свежие данные для ${type} в фоне`);
            let newData = [];

            if (type === 'holders') {
                newData = await this.db.all(`
                    SELECT 
                        u.id,
                        COUNT(mn.id) as count
                    FROM users u
                    LEFT JOIN m_nfts mn ON u.id = mn.owner_id
                    GROUP BY u.id
                    HAVING count > 0
                    ORDER BY count DESC
                    LIMIT 50
                `);
            } else if (type === 'referrals') {
                newData = await this.db.all(`
                    SELECT 
                        id,
                        referrals_count as count
                    FROM users
                    WHERE referrals_count > 0
                    ORDER BY referrals_count DESC
                    LIMIT 50
                `);
            }

            console.log(`📊 Получено ${newData.length} записей из БД для ${type}`);

            // Обогащаем данными из Telegram кэша (с фильтрацией)
            let enrichedData = [];
            if (global.telegramCache) {
                enrichedData = await global.telegramCache.enrichRatingData(newData, type);
            } else {
                // Если нет кэша, оставляем как есть (но лучше отфильтровать)
                enrichedData = newData.map(item => ({
                    ...item,
                    name: `User ${item.id}`,
                    hasAvatar: false,
                    avatarUrl: null
                }));
            }

            // Обновляем кэш ТОЛЬКО если есть данные
            if (enrichedData.length > 0) {
                this.ratingCache[type] = {
                    data: enrichedData,
                    timestamp: Date.now()
                };

                console.log(`✅ Кэш ${type} обновлен: ${enrichedData.length} записей`);

                // Отправляем обновленные данные всем клиентам
                this.io.emit(`${type}_data_updated`, {
                    data: enrichedData,
                    timestamp: Date.now()
                });
            } else {
                console.log(`⚠️ Нет данных для обновления кэша ${type}`);
            }

        } catch (error) {
            console.error(`❌ Ошибка фонового обновления ${type}:`, error);
        }
    }

    async getNFTTransfersHistory(userId) {
        try {

            const transfers = await this.db.all(`
                SELECT 
                    nt.id,
                    nt.transfer_type,
                    nt.amount,
                    nt.from_user_id,
                    nt.to_user_id,
                    nt.timestamp,
                    mn.number as nft_number,
                    mn.collection_id,
                    mn.model,
                    mn.background,
                    mn.pattern,
                    mn.[update],
                    mnc.name as collection_name,
                    mnc.image_file_id as image_file_id,

                    -- Данные модели (если есть)
                    m.id as model_id,
                    m.name as model_name,
                    m.rarity as model_rarity,
                    m.file_name as model_file_name,

                    -- Данные фона (если есть)
                    b.id as background_id,
                    b.back_0,
                    b.back_100,
                    b.name as background_name,
                    b.rarity as background_rarity,

                    -- Данные узора (если есть)
                    p.id as pattern_id,
                    p.name as pattern_name,
                    p.rarity as pattern_rarity,
                    p.file_name as pattern_file_name

                FROM nft_transfers nt
                LEFT JOIN m_nfts mn ON nt.nft_id = mn.id
                LEFT JOIN m_nft_collections mnc ON mn.collection_id = mnc.id
                LEFT JOIN models m ON mn.model = m.id
                LEFT JOIN backgrounds b ON mn.background = b.id
                LEFT JOIN patterns p ON mn.pattern = p.id
                WHERE nt.from_user_id = ? OR nt.to_user_id = ?
                ORDER BY nt.timestamp DESC
                LIMIT 50
            `, [userId, userId]);
            
            
            // Преобразуем в формат для отображения
            return transfers.map(transfer => {
                const isSender = transfer.from_user_id == userId;
                const isReceiver = transfer.to_user_id == userId;

                let transferType = '';
                let displayAmount = 0;
                let notes = '';

                if (isReceiver) {
                    // Получатель
                    transferType = 'Получение NFT';
                    displayAmount = 0;
                    notes = `Получение NFT: ${transfer.collection_name || 'NFT'} #${transfer.nft_number || '?'}`;
                } else if (isSender) {
                    // Отправитель
                    if (transfer.transfer_type === 'sale' || transfer.transfer_type === 'purchase') {
                        transferType = 'Продажа NFT';
                        displayAmount = Math.round(transfer.amount / 1.1);
                        notes = `Продажа NFT: ${transfer.collection_name || 'NFT'} #${transfer.nft_number || '?'}`;
                    } else {
                        transferType = 'Передача NFT';
                        displayAmount = -5;
                        notes = `Передача NFT: ${transfer.collection_name || 'NFT'} #${transfer.nft_number || '?'}`;
                    }
                }

                // Добавляем данные улучшенных атрибутов
                const modelData = transfer.model_id ? {
                    id: transfer.model_id,
                    name: transfer.model_name,
                    rarity: transfer.model_rarity,
                    file_name: transfer.model_file_name
                } : null;

                const backgroundData = transfer.background_id ? {
                    id: transfer.background_id,
                    back_0: transfer.back_0,
                    back_100: transfer.back_100,
                    name: transfer.background_name,
                    rarity: transfer.background_rarity
                } : null;

                const patternData = transfer.pattern_id ? {
                    id: transfer.pattern_id,
                    name: transfer.pattern_name,
                    rarity: transfer.pattern_rarity,
                    file_name: transfer.pattern_file_name
                } : null;

                return {
                    id: `transfer_${transfer.id}`,
                    type: transferType,
                    amount: Math.abs(displayAmount), 
                    displayAmount: displayAmount, 
                    status: 'Успешно',
                    createdAt: transfer.timestamp,
                    completedAt: transfer.timestamp,
                    notes: notes,
                    isTransfer: true,
                    direction: isSender ? 'outgoing' : 'incoming',
                    isSale: transfer.transfer_type === 'sale' || transfer.transfer_type === 'purchase',
                    collectionName: transfer.collection_name,
                    nftNumber: transfer.nft_number,
                    imageFileId: transfer.image_file_id,
                    fromUserId: transfer.from_user_id,
                    toUserId: transfer.to_user_id,

                    // ДОБАВЛЯЕМ ДАННЫЕ УЛУЧШЕННЫХ АТРИБУТОВ:
                    collectionId: transfer.collection_id,
                    update: transfer.update || null,
                    model: transfer.model,
                    background: transfer.background,
                    pattern: transfer.pattern,
                    modelData: modelData,
                    backgroundData: backgroundData,
                    patternData: patternData
                };
            });
        } catch (error) {
            console.error('❌ Error fetching NFT transfers:', error);
            return [];
        }
    }
    
    async handleTelegramWebhook(data) {
        try {
            const command = data.message?.text?.trim().split(/\s+/, 1)[0] || '';
            if (/^\/start(?:@\w+)?$/i.test(command)) {
                const userId = data.message.from.id;
                const chatId = data.message.chat.id;

                // Отправляем приветственное сообщение с инлайн-кнопкой
                await this.sendWelcomeMessage(chatId);
                return;
            }
            if (data.pre_checkout_query) {
                const query = data.pre_checkout_query;
                try {
                    await fetch(`${this.telegramService.apiUrl}/answerPreCheckoutQuery`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            pre_checkout_query_id: query.id,
                            ok: false,
                            error_message: 'Payments are disabled while this app is in testing.'
                        })
                    });
                } catch (error) {
                    console.error('❌ Error rejecting pre-checkout:', error);
                }
                return;
            }
            
            if (data.message && data.message.successful_payment) {
                console.error('❌ Received a payment update while payments are disabled; it was not credited automatically.');
                return;
            }
            
        } catch (error) {
            console.error('❌ Webhook handling error:', error);
        }
    }

    async sendWelcomeMessage(chatId) {
        try {
            const inlineKeyboard = {
                inline_keyboard: [
                    [{
                        text: '🚀 Открыть Маркет NFT',
                        web_app: { url: 'https://mnft-miniapp.vercel.app/' }
                    }], 
                    [{
                        text: '📢 Channel',
                        url: 'https://t.me/mnft_channel'
                    }]
                ]
            };

            const requestBody = JSON.stringify({
                chat_id: chatId,
                text: '👋 Добро пожаловать в M-NFT Маркет!\n\nЗдесь вы можете покупать, продавать и коллекционировать уникальные NFT.\n\nНажмите кнопку ниже, чтобы открыть маркет:',
                reply_markup: inlineKeyboard,
                parse_mode: 'HTML'
            });

            // Telegram's Bot API can occasionally close outbound connections
            // before sending a response. Retry transient network and 5xx errors
            // so a webhook update doesn't silently lose the /start reply.
            for (let attempt = 1; attempt <= 3; attempt++) {
                try {
                    const response = await fetch(`${this.telegramService.apiUrl}/sendMessage`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: requestBody,
                        signal: AbortSignal.timeout(10000)
                    });
                    const result = await response.json().catch(() => ({}));

                    if (response.ok && result.ok) {
                        console.log('✅ Welcome message sent');
                        return;
                    }

                    const retryAfter = Number(result.parameters?.retry_after || 0);
                    const retryable = response.status >= 500 || response.status === 429;
                    if (!retryable || attempt === 3) {
                        console.error('❌ Telegram rejected welcome message:', response.status, result.description || 'unknown error');
                        return;
                    }
                    await new Promise(resolve => setTimeout(resolve, retryAfter > 0 ? retryAfter * 1000 : attempt * 750));
                } catch (error) {
                    if (attempt === 3) throw error;
                    await new Promise(resolve => setTimeout(resolve, attempt * 750));
                }
            }

        } catch (error) {
            console.error('❌ Error sending welcome message:', error);
        }
    }
    
    startPriceBroadcasting() {
        setInterval(async () => {
            try {
                const rateData = await this.currencyService.getCurrentRate();
                this.io.to('currency_updates').emit('currency_update', {
                    tonPrice: rateData.tonPrice.toFixed(4),
                    timestamp: rateData.timestamp
                });
                console.log(`📢 Broadcasted TON price update to clients: $${rateData.tonPrice.toFixed(4)}`);
            } catch (error) {
                console.log('❌ Error broadcasting price update:', error.message);
            }
        }, 10000);
    }
}
