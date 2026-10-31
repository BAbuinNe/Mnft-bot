import fs from 'fs';
import { promises as fsPromises } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class TelegramCacheService {
    constructor(telegramClient, db) { 
        this.telegramClient = telegramClient;
        this.db = db; 
        this.fs = fsPromises;
        this.cache = {
            users: new Map(), 
            avatars: new Map()
        };
        
        // Директория для кэша аватарок - фиксируем путь относительно корня проекта
        this.avatarsDir = path.join(__dirname, '../client/avatars');
        this.ensureDirectoryExists(this.avatarsDir);
        
        // Также создаем ссылку в папке сервера для обратной совместимости
        const serverAvatarsDir = path.join(__dirname, '../avatars');
        this.ensureDirectoryExists(serverAvatarsDir);
        
        // Загружаем кэш из файлов при старте
        this.loadCacheFromDisk();
        
        console.log('📦 Telegram кэш сервис инициализирован');
        console.log(`📁 Папка для аватарок: ${this.avatarsDir}`);
    }

    ensureDirectoryExists(dir) {
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
            console.log(`📁 Создана директория: ${dir}`);
        }
    }

    loadCacheFromDisk() {
        try {
            // Загружаем кэш пользователей если есть
            const cacheFile = path.join(__dirname, '../user-cache.json');
            if (fs.existsSync(cacheFile)) {
                const data = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
                Object.entries(data).forEach(([id, info]) => {
                    this.cache.users.set(id, info);
                });
                console.log(`📁 Загружено ${this.cache.users.size} пользователей из кэша`);
            }
        } catch (error) {
            console.error('❌ Ошибка загрузки кэша:', error);
        }
    }

    saveCacheToDisk() {
        try {
            const cacheFile = path.join(__dirname, '../user-cache.json');
            const data = Object.fromEntries(this.cache.users);
            fs.writeFileSync(cacheFile, JSON.stringify(data, null, 2));
        } catch (error) {
            console.error('❌ Ошибка сохранения кэша:', error);
        }
    }

    async getUserInfo(userId) {
        // Проверяем кэш
        if (this.cache.users.has(userId)) {
            return this.cache.users.get(userId);
        }

        // Запрашиваем из Telegram
        try {
            const userInfo = await this.telegramClient.refreshUserContact(userId);

            if (userInfo) {
                // Сохраняем в кэш
                this.cache.users.set(userId, {
                    id: userInfo.id,
                    firstName: userInfo.firstName || '',
                    lastName: userInfo.lastName || '',
                    username: userInfo.username || '',
                    hasPhoto: userInfo.hasPhoto || false
                });
                successCount++;

                // Скачиваем аватар, если есть фото
                if (userInfo.hasPhoto) {
                    await this.downloadUserAvatarAsync(userId);
                    avatarCount++;
                }

                console.log(`✅ Пользователь ${userId} записан в кэш${userInfo.hasPhoto ? ' (с аватаром)' : ''}`);
            }
        } catch (error) {
            console.error(`❌ Ошибка получения пользователя ${userId}:`, error);
        }
        
        return null;
    }

    async downloadUserAvatarAsync(userId) {
        try {
            const avatarPath = path.join(this.avatarsDir, `${userId}.jpg`);
            const buffer = await this.telegramClient.getUserAvatar(userId, avatarPath);
            
            if (buffer) {
                this.cache.avatars.set(userId, buffer);
                console.log(`✅ Аватар пользователя ${userId} сохранен`);
                
                // Также копируем в папку сервера для обратной совместимости
                const serverAvatarPath = path.join(__dirname, '../avatars', `${userId}.jpg`);
                fs.copyFileSync(avatarPath, serverAvatarPath);
            }
        } catch (error) {
            console.error(`❌ Ошибка скачивания аватара ${userId}:`, error);
        }
    }

    async getUserAvatar(userId) {
        // Проверяем кэш в памяти
        if (this.cache.avatars.has(userId)) {
            return this.cache.avatars.get(userId);
        }

        // Проверяем файл на диске в основной папке
        const avatarPath = path.join(this.avatarsDir, `${userId}.jpg`);
        if (fs.existsSync(avatarPath)) {
            const buffer = fs.readFileSync(avatarPath);
            this.cache.avatars.set(userId, buffer);
            return buffer;
        }
        
        // Проверяем в папке сервера
        const serverAvatarPath = path.join(__dirname, '../avatars', `${userId}.jpg`);
        if (fs.existsSync(serverAvatarPath)) {
            const buffer = fs.readFileSync(serverAvatarPath);
            this.cache.avatars.set(userId, buffer);
            // Копируем в основную папку
            fs.copyFileSync(serverAvatarPath, avatarPath);
            return buffer;
        }

        // Запрашиваем из Telegram
        try {
            const buffer = await this.telegramClient.getUserAvatar(userId, avatarPath);
            if (buffer) {
                this.cache.avatars.set(userId, buffer);
                
                // Копируем в папку сервера
                const serverAvatarPath = path.join(__dirname, '../avatars', `${userId}.jpg`);
                fs.copyFileSync(avatarPath, serverAvatarPath);
                
                return buffer;
            }
        } catch (error) {
            console.error(`❌ Ошибка получения аватара ${userId}:`, error);
        }
        
        return null;
    }

    async getUsersInfo(userIds) {
        const results = {};
        const uncachedIds = [];
    
        // Собираем кэшированные и некэшированные ID
        for (const id of userIds) {
            const idStr = id.toString();
            if (this.cache.users.has(idStr)) {
                results[idStr] = this.cache.users.get(idStr);
            } else {
                uncachedIds.push(idStr);
            }
        }
    
        // Запрашиваем некэшированных
        if (uncachedIds.length > 0) {
            console.log(`🔄 Запрашиваем ${uncachedIds.length} новых пользователей из Telegram`);
            
            for (const id of uncachedIds) {
                try {
                    console.log(`👤 Запрашиваем данные пользователя ${id}...`);
                    const info = await this.telegramClient.getUserInfo(id);
                    
                    if (info) {
                        // Сохраняем в кэш ТОЛЬКО если получили данные
                        this.cache.users.set(id, info);
                        results[id] = info;
                        
                        // Скачиваем аватар в фоне, если есть фото
                        if (info.hasPhoto) {
                            this.downloadUserAvatarAsync(id).catch(err => 
                                console.log(`⚠️ Не удалось скачать аватар для ${id}:`, err.message)
                            );
                        }
                        
                        console.log(`✅ Данные пользователя ${id} получены`);
                    } else {
                        console.log(`❌ Не удалось получить данные пользователя ${id}`);
                    }
                } catch (error) {
                    console.error(`❌ Ошибка получения пользователя ${id}:`, error.message);
                }
                
                // Задержка между запросами
                await new Promise(resolve => setTimeout(resolve, 300));
            }
            
            // Сохраняем кэш на диск
            this.saveCacheToDisk();
        }
    
        return results;
    }

    async enrichRatingData(ratingData, type) {
        if (!ratingData || ratingData.length === 0) {
            return [];
        }
        
        const userIds = ratingData.map(item => item.id);
        console.log(`🔄 Обогащаем данными ${userIds.length} пользователей для ${type}`);
        
        // Получаем информацию о пользователях
        const usersInfo = await this.getUsersInfo(userIds);
        
        // ВАЖНО: Получаем информацию о надетых NFT ДЛЯ ЛЮБОГО ТИПА РЕЙТИНГА
        const wornNFTs = await this.getWornNFTsForUsers(userIds);
        
        const enriched = [];
        
        for (const item of ratingData) {
            const userInfo = usersInfo[item.id];
            
            if (!userInfo) {
                console.log(`⚠️ Пропускаем пользователя ${item.id} - нет данных`);
                continue;
            }
            
            // Получаем надетый NFT для этого пользователя (всегда, для любого типа)
            const wornNFT = wornNFTs[item.id];
            
            enriched.push({
                id: item.id,
                count: item.count,
                firstName: userInfo.firstName || '',
                lastName: userInfo.lastName || '',
                username: userInfo.username || '',
                hasAvatar: userInfo.hasPhoto || false,
                avatarUrl: userInfo.hasPhoto ? `/avatars/${item.id}.jpg` : null,
                wornNFT: wornNFT || null // Добавляем для ВСЕХ пользователей
            });
        }
        
        console.log(`✅ После фильтрации осталось ${enriched.length} пользователей из ${ratingData.length}`);
        console.log(`📊 Из них с надетым NFT: ${enriched.filter(u => u.wornNFT).length}`);
        
        return enriched;
    }

    async getWornNFTsForUsers(userIds) {
        try {
            if (!global.socketModule || !global.socketModule.db) {
                return {};
            }

            const db = global.socketModule.db;
            const placeholders = userIds.map(() => '?').join(',');

            // Получаем все надетые NFT для указанных пользователей
            const nfts = await db.all(`
                SELECT 
                    mn.id,
                    mn.owner_id,
                    mn.number,
                    mn.collection_id,
                    mn.model,
                    mn.background,
                    mn.pattern,
                    mn.[update],
                    mnc.name as collection_name,
                    mnc.image_file_id as collection_image,
                    m.file_name as model_file_name,
                    b.back_0,
                    b.back_100,
                    p.file_name as pattern_file_name
                FROM m_nfts mn
                LEFT JOIN m_nft_collections mnc ON mn.collection_id = mnc.id
                LEFT JOIN models m ON mn.model = m.id
                LEFT JOIN backgrounds b ON mn.background = b.id
                LEFT JOIN patterns p ON mn.pattern = p.id
                WHERE mn.dressed = 1 AND mn.owner_id IN (${placeholders})
            `, userIds);
            
            // Преобразуем в объект для быстрого доступа по owner_id
            const result = {};
            for (const nft of nfts) {
                result[nft.owner_id] = {
                    id: nft.id,
                    number: nft.number,
                    collectionId: nft.collection_id,
                    collectionName: nft.collection_name,
                    collectionImage: nft.collection_image,
                    update: nft.update,
                    model: nft.model,
                    background: nft.background,
                    pattern: nft.pattern,
                    modelFileName: nft.model_file_name,
                    back_0: nft.back_0,
                    back_100: nft.back_100,
                    patternFileName: nft.pattern_file_name,
                    // Формируем путь к изображению
                    imageUrl: nft.update === 1 && nft.model_file_name 
                        ? `/m_nft_image/${nft.collection_name}/${nft.model_file_name}.PNG`
                        : nft.collection_image 
                            ? `/m_nft_image/base/${nft.collection_image}`
                            : null
                };
            }

            return result;

        } catch (error) {
            console.error('❌ Ошибка получения надетых NFT:', error);
            return {};
        }
    }

    async refreshAllUsersCache() {
        console.log('🔄 Начинаем полное обновление кэша (очистка всего, запись только топ-20)...');
        
        try {
            // Проверяем наличие db
            if (!this.db) {
                throw new Error('База данных не инициализирована в TelegramCacheService');
            }

            // 1. ПОЛНОСТЬЮ ОЧИЩАЕМ ВЕСЬ КЭШ
            console.log('🧹 Полная очистка кэша...');

            // Очищаем кэш в памяти
            const oldUsersCount = this.cache.users.size;
            const oldAvatarsCount = this.cache.avatars.size;

            this.cache.users.clear();
            this.cache.avatars.clear();

            console.log(`   - Удалено из памяти: ${oldUsersCount} пользователей, ${oldAvatarsCount} аватаров`);

            // Удаляем все файлы аватарок из обеих папок
            await this.clearAllAvatars();

            // Удаляем файл кэша пользователей
            await this.deleteUserCacheFile();

            console.log('✅ Весь кэш полностью очищен');

            // 2. ПОЛУЧАЕМ ТОП-20 ПОЛЬЗОВАТЕЛЕЙ

            // Топ-20 по количеству NFT (холдеры)
            const topHolders = await this.db.all(`
                SELECT 
                    u.id,
                    COUNT(mn.id) as count
                FROM users u
                LEFT JOIN m_nfts mn ON u.id = mn.owner_id
                GROUP BY u.id
                HAVING count > 0
                ORDER BY count DESC
                LIMIT 20
            `);
            
            console.log(`📊 Найдено ${topHolders.length} топ-холдеров`);
            
            // Топ-20 по количеству рефералов
            const topReferrers = await this.db.all(`
                SELECT 
                    id,
                    referrals_count as count
                FROM users
                WHERE referrals_count > 0
                ORDER BY referrals_count DESC
                LIMIT 20
            `);
            
            console.log(`📊 Найдено ${topReferrers.length} топ-рефереров`);
            
            // 3. ОБЪЕДИНЯЕМ ID ПОЛЬЗОВАТЕЛЕЙ ИЗ ОБОИХ ТОПОВ
            const userIdsToUpdate = new Set();
            
            topHolders.forEach(user => userIdsToUpdate.add(user.id.toString()));
            topReferrers.forEach(user => userIdsToUpdate.add(user.id.toString()));
            
            const userIdsArray = Array.from(userIdsToUpdate);
            console.log(`🔄 Будет записано в кэш ${userIdsArray.length} уникальных пользователей из топ-20`);
            
            // Если нет пользователей для обновления
            if (userIdsArray.length === 0) {
                console.log('⚠️ Нет пользователей в топах для записи в кэш');

                // Сохраняем пустой кэш на диск
                this.saveCacheToDisk();

                return { 
                    success: true, 
                    total: 0, 
                    updated: 0, 
                    message: 'Нет пользователей в топах' 
                };
            }

            // 4. ЗАПИСЫВАЕМ В КЭШ ТОЛЬКО ТОП-ПОЛЬЗОВАТЕЛЕЙ
            let successCount = 0;
            let avatarCount = 0;
            let errorCount = 0;
                    
            for (let i = 0; i < userIdsArray.length; i++) {
                const userId = userIdsArray[i];
                
                try {
                    console.log(`🔄 [${i+1}/${userIdsArray.length}] Записываем в кэш пользователя ${userId}...`);
                    
                    // 🔥 ИСПОЛЬЗУЕМ НОВЫЙ МЕТОД ДЛЯ ОБНОВЛЕНИЯ КОНТАКТА
                    const userInfo = await this.telegramClient.refreshUserContact(userId);
                    
                    if (userInfo) {
                        // Сохраняем в кэш (ТОЛЬКО нужные поля)
                        this.cache.users.set(userId, {
                            id: userInfo.id,
                            firstName: userInfo.firstName || '',
                            lastName: userInfo.lastName || '',
                            username: userInfo.username || '',
                            hasPhoto: userInfo.hasPhoto || false
                        });
                        successCount++;
                        
                        // Скачиваем аватар, если есть фото
                        if (userInfo.hasPhoto) {
                            await this.downloadUserAvatarAsync(userId);
                            avatarCount++;
                        }
                        
                        console.log(`✅ Пользователь ${userId} записан в кэш${userInfo.hasPhoto ? ' (с аватаром)' : ''}`);
                    } else {
                        errorCount++;
                        console.log(`⚠️ Не удалось получить данные для пользователя ${userId}`);
                    }
                    
                    // Небольшая задержка, чтобы не флудить Telegram API
                    await new Promise(resolve => setTimeout(resolve, 500));
                    
                } catch (error) {
                    errorCount++;
                    console.error(`❌ Ошибка получения данных пользователя ${userId}:`, error.message);
                }
            }

            // 5. Сохраняем обновленный кэш на диск (ТОЛЬКО с топ-пользователями)
            this.saveCacheToDisk();

            console.log(`✅ Запись кэша топ-пользователей завершена:`);
            console.log(`   - Всего пользователей в топах: ${userIdsArray.length}`);
            console.log(`   - Успешно записано в кэш: ${successCount}`);
            console.log(`   - Ошибок: ${errorCount}`);
            console.log(`   - Скачано аватарок: ${avatarCount}`);
            console.log(`   - Текущий размер кэша: ${this.cache.users.size} пользователей`);

            // 6. Обновляем кэш рейтингов в SocketModule (если доступен)
            if (global.socketModule) {
                // Принудительно обновляем кэш холдеров
                await global.socketModule.updateRatingCacheAsync('holders');
                // Принудительно обновляем кэш рефереров
                await global.socketModule.updateRatingCacheAsync('referrals');
                console.log('📊 Кэш рейтингов в SocketModule обновлен');
            }

            return { 
                success: true, 
                total: userIdsArray.length, 
                updated: successCount, 
                errors: errorCount,
                avatars: avatarCount,
                cacheSize: this.cache.users.size
            };

        } catch (error) {
            console.error('❌ Ошибка при обновлении кэша:', error);
            return { success: false, error: error.message };
        }
    }
    
    async clearAllAvatars() {
        try {
            let deletedCount = 0;

            // Очищаем основную папку с аватарками
            if (fs.existsSync(this.avatarsDir)) {
                const files = await fs.promises.readdir(this.avatarsDir);

                for (const file of files) {
                    if (file.endsWith('.jpg')) {
                        await fs.promises.unlink(path.join(this.avatarsDir, file));
                        deletedCount++;
                    }
                }
            }

            // Очищаем папку сервера
            const serverAvatarsDir = path.join(__dirname, '../avatars');
            if (fs.existsSync(serverAvatarsDir)) {
                const serverFiles = await fs.promises.readdir(serverAvatarsDir);
                for (const file of serverFiles) {
                    if (file.endsWith('.jpg')) {
                        await fs.promises.unlink(path.join(serverAvatarsDir, file));
                        deletedCount++;
                    }
                }
            }

            console.log(`🧹 Удалено ${deletedCount} файлов аватарок`);

        } catch (error) {
            console.error('❌ Ошибка при очистке всех аватарок:', error);
        }
    }
    
    async deleteUserCacheFile() {
        try {
            const cacheFile = path.join(__dirname, '../user-cache.json');
            if (fs.existsSync(cacheFile)) {
                await fs.promises.unlink(cacheFile);
                console.log('🗑️ Удален файл user-cache.json');
            }
        } catch (error) {
            console.error('❌ Ошибка при удалении файла кэша:', error);
        }
    }

    async cacheUser(userId, userData) {
        this.cache.users.set(userId, userData);
        this.saveCacheToDisk(); // Сохраняем сразу
        
        // Если есть фото, скачиваем аватар
        if (userData.hasPhoto) {
            this.downloadUserAvatarAsync(userId).catch(console.error);
        }
    }

    getAvatarUrl(userId) {
        const avatarPath = path.join(this.avatarsDir, `${userId}.jpg`);
        return fs.existsSync(avatarPath) ? `/avatars/${userId}.jpg` : null;
    }
}