// telegram-client.service.js
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const { TelegramClient } = require("telegram");
const { StringSession } = require("telegram/sessions");
import fs from 'fs';
import readline from 'readline';
import path from 'path';
import { fileURLToPath } from 'url';
import { Api } from "telegram"; // Добавляем Api для прямых запросов

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class TelegramClientService {
    constructor(apiId, apiHash, sessionPath = null) {
        this.apiId = apiId;
        this.apiHash = apiHash;
        this.sessionPath = sessionPath || path.join(__dirname, '../session.txt');
        this.client = null;
        this.isConnected = false;
    }

    async init() {
        let sessionString = process.env.TELEGRAM_SESSION_STRING || '';
        if (sessionString) {
            console.log('🔐 Using injected Telegram session');
        } else if (fs.existsSync(this.sessionPath)) {
            sessionString = fs.readFileSync(this.sessionPath, 'utf8');
            console.log('📁 Найдена сохраненная сессия');
        } else {
            console.log('🆕 Сохраненная сессия не найдена, потребуется вход');
        }

        this.client = new TelegramClient(
            new StringSession(sessionString),
            parseInt(this.apiId),
            this.apiHash,
            {
                connectionRetries: 5,
                useWSS: true,
            }
        );

        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });

        const question = (query) => new Promise(resolve => rl.question(query, resolve));

        try {
            console.log('🔄 Подключение к Telegram...');

            if (process.env.VERCEL) {
                await this.client.connect();
                if (!await this.client.checkAuthorization()) {
                    throw new Error('TELEGRAM_SESSION_STRING is invalid or unauthorized');
                }
                this.isConnected = true;
                return true;
            }
            
            await this.client.start({
                phoneNumber: async () => {
                    const phone = await question('📱 Введите номер телефона (с кодом страны, например +79001234567): ');
                    return phone;
                },
                password: async () => {
                    const password = await question('🔑 Введите пароль 2FA (если есть, иначе нажмите Enter): ');
                    return password;
                },
                phoneCode: async () => {
                    const code = await question('📨 Введите код из Telegram: ');
                    return code;
                },
                onError: (err) => {
                    console.error('❌ Ошибка авторизации:', err);
                    throw err;
                }
            });

            rl.close();

            console.log('✅ Успешный вход в Telegram!');
            
            const savedSession = this.client.session.save();
            fs.writeFileSync(this.sessionPath, savedSession);
            console.log(`💾 Сессия сохранена в ${this.sessionPath}`);
            
            this.isConnected = true;
            return true;

        } catch (error) {
            rl.close();
            console.error('❌ Ошибка при инициализации Telegram клиента:', error);
            throw error;
        }
    }

    /**
     * УНИВЕРСАЛЬНЫЙ МЕТОД ПОЛУЧЕНИЯ ПОЛЬЗОВАТЕЛЯ
     * Работает с любым пользователем, даже не в контактах
     */
    async getUserInfo(userId) {
        if (!this.client || !this.isConnected) {
            throw new Error('Telegram клиент не инициализирован');
        }

        try {
            // Пробуем разные способы получения пользователя
            let user = null;
            
            // Способ 1: Прямой поиск по ID через ResolveUsername
            // GramJS автоматически использует ResolveUsernameRequest при вызове getEntity
            try {
                user = await this.client.getEntity(userId);
                console.log(`✅ Пользователь ${userId} найден через getEntity`);
            } catch (e) {
                console.log(`⚠️ getEntity не сработал для ${userId}, пробуем другие методы...`);
            }

            // Способ 2: Если не сработало, пробуем через поиск по username (если ID похож на username)
            if (!user && typeof userId === 'string' && !/^\d+$/.test(userId)) {
                try {
                    const resolved = await this.client.invoke(
                        new Api.contacts.ResolveUsername({
                            username: userId
                        })
                    );
                    if (resolved.users && resolved.users.length > 0) {
                        user = resolved.users[0];
                        console.log(`✅ Пользователь ${userId} найден через ResolveUsername`);
                    }
                } catch (e) {
                    console.log(`⚠️ ResolveUsername не сработал для ${userId}`);
                }
            }

            // Способ 3: Прямой запрос пользователя по ID с правильным форматом
            if (!user && /^\d+$/.test(userId.toString())) {
                try {
                    // Создаем InputPeerUser с правильными параметрами
                    // GramJS сам подставит access_hash из кэша, если он есть
                    const inputPeer = new Api.InputPeerUser({
                        userId: parseInt(userId),
                        accessHash: 0n // GramJS заменит на правильный hash из кэша
                    });
                    
                    const result = await this.client.invoke(
                        new Api.users.GetUsers({
                            id: [inputPeer]
                        })
                    );
                    
                    if (result && result.length > 0) {
                        user = result[0];
                        console.log(`✅ Пользователь ${userId} найден через прямой запрос`);
                    }
                } catch (e) {
                    console.log(`⚠️ Прямой запрос не сработал для ${userId}:`, e.message);
                }
            }

            if (!user) {
                throw new Error(`Не удалось найти пользователя ${userId} ни одним из способов`);
            }

            // Форматируем результат
            return {
                id: user.id.toString(),
                firstName: user.firstName || '',
                lastName: user.lastName || '',
                username: user.username || '',
                phone: user.phone || '',
                hasPhoto: !!user.photo,
                // Дополнительная информация
                isBot: user.bot || false,
                isPremium: user.premium || false,
                isVerified: user.verified || false,
                accessHash: user.accessHash?.toString() || null
            };

        } catch (error) {
            console.error(`❌ Ошибка получения информации о пользователе ${userId}:`, error);
            return null;
        }
    }

    /**
     * Поиск пользователя по username (всегда работает, даже если не в контактах)
     */
    async getUserByUsername(username) {
        try {
            // Убираем @ если есть
            const cleanUsername = username.replace('@', '');
            
            const result = await this.client.invoke(
                new Api.contacts.ResolveUsername({
                    username: cleanUsername
                })
            );
            
            if (result.users && result.users.length > 0) {
                const user = result.users[0];
                return {
                    id: user.id.toString(),
                    firstName: user.firstName || '',
                    lastName: user.lastName || '',
                    username: user.username || '',
                    hasPhoto: !!user.photo
                };
            }
            return null;
        } catch (error) {
            console.error(`❌ Ошибка поиска пользователя по username ${username}:`, error);
            return null;
        }
    }

    async getUserAvatar(userId, savePath = null) {
        if (!this.client || !this.isConnected) {
            throw new Error('Telegram клиент не инициализирован');
        }

        try {
            // Сначала получаем пользователя, чтобы убедиться, что он доступен
            const user = await this.getUserInfo(userId);
            if (!user || !user.hasPhoto) {
                console.log(`👤 У пользователя ${userId} нет фото профиля`);
                return null;
            }

            console.log(`🔄 Скачиваем аватар пользователя ${userId}...`);

            // Пробуем скачать фото профиля
            try {
                const buffer = await this.client.downloadProfilePhoto(userId, {
                    isBig: false, // Берем маленькое фото для экономии
                    thumb: 0 // Берем первое (основное) фото
                });

                if (buffer && savePath) {
                    // Сохраняем в файл
                    fs.writeFileSync(savePath, buffer);
                    console.log(`✅ Аватар пользователя ${userId} сохранен в ${savePath}`);

                    // Также создаем уменьшенную копию для оптимизации (опционально)
                    // Можно добавить ресайз изображения здесь
                }

                return buffer;
            } catch (downloadError) {
                console.log(`⚠️ Не удалось скачать фото ${userId}, пробуем альтернативный метод...`);

                // Альтернативный метод: ищем через getUserPhotos
                const userPhotos = await this.client.getUserPhotos(userId, {
                    limit: 1
                });

                if (userPhotos && userPhotos.photos && userPhotos.photos.length > 0) {
                    const photo = userPhotos.photos[0];
                    const buffer = await this.client.downloadMedia(photo, {
                        isBig: false
                    });

                    if (buffer && savePath) {
                        fs.writeFileSync(savePath, buffer);
                        console.log(`✅ Аватар пользователя ${userId} сохранен (метод 2)`);
                        return buffer;
                    }
                }

                return null;
            }
        } catch (error) {
            console.error(`❌ Ошибка получения аватара пользователя ${userId}:`, error.message);
            return null;
        }
    }

    // Добавляем метод для получения фото пользователя через getUserPhotos
    async getUserPhotos(userId, limit = 1) {
        try {
            const result = await this.client.invoke(
                new Api.photos.GetUserPhotos({
                    userId: userId,
                    limit: limit
                })
            );
            return result;
        } catch (error) {
            console.error(`❌ Ошибка получения фото пользователя ${userId}:`, error);
            return null;
        }
    }

    async addUserToContacts(userId, firstName, lastName) {
        try {
            // Сначала получаем сущность пользователя
            const user = await this.getUserInfo(userId);
            if (!user) return false;

            // Добавляем в контакты
            await this.client.invoke(
                new Api.contacts.AddContact({
                    id: userId,
                    firstName: firstName || user.firstName || `User_${userId}`,
                    lastName: lastName || user.lastName || '',
                    phone: '',
                    addPhonePrivacyException: false
                })
            );

            return true;
        } catch (error) {
            if (error.errorMessage?.includes('FLOOD_WAIT')) {
                console.log(`⏳ Flood wait, пропускаем ${userId}`);
            } else {
                console.log(`⚠️ Ошибка добавления ${userId} в контакты:`, error.message);
            }
            return false;
        }
    }

    async refreshUserContact(userId) {
        try {
            console.log(`🔄 Обновляем контакт пользователя ${userId}...`);
            
            // Шаг 1: Находим пользователя в текущих контактах и запоминаем username
            let username = null;
            
            const contacts = await this.client.invoke(
                new Api.contacts.GetContacts({
                    hash: 0
                })
            );
            
            const currentContact = contacts.users?.find(u => u.id.toString() === userId.toString());
            
            if (currentContact) {
                username = currentContact.username;
                console.log(`📇 Найден в контактах: @${username || 'нет username'}`);
            } else {
                console.log(`❌ Пользователь ${userId} не найден в контактах`);
                return null;
            }
            
            // Шаг 2: Если есть username, удаляем контакт
            if (username) {
                console.log(`🗑️ Удаляем контакт ${userId}...`);
                
                await this.client.invoke(
                    new Api.contacts.DeleteContacts({
                        id: [userId]
                    })
                );
                
                // Небольшая пауза после удаления
                await new Promise(resolve => setTimeout(resolve, 500));
                
                // Шаг 3: Ищем пользователя по сохраненному username
                console.log(`🔍 Ищем пользователя по username: @${username}`);
                
                const resolved = await this.client.invoke(
                    new Api.contacts.ResolveUsername({
                        username: username
                    })
                );
                
                if (resolved.users && resolved.users.length > 0) {
                    const userInfo = resolved.users[0];
                    
                    // Шаг 4: Добавляем в контакты с актуальными данными
                    console.log(`📇 Добавляем в контакты: ${userInfo.firstName || ''} ${userInfo.lastName || ''}`);
                    
                    await this.client.invoke(
                        new Api.contacts.AddContact({
                            id: userInfo.id,
                            firstName: userInfo.firstName || `User_${userId}`,
                            lastName: userInfo.lastName || '',
                            phone: '',
                            addPhonePrivacyException: false
                        })
                    );
                    
                    console.log(`✅ Контакт ${userId} успешно обновлен`);
                    
                    return {
                        id: userInfo.id.toString(),
                        firstName: userInfo.firstName || '',
                        lastName: userInfo.lastName || '',
                        username: userInfo.username || '',
                        hasPhoto: !!userInfo.photo
                    };
                } else {
                    console.log(`❌ Не удалось найти пользователя по username @${username}`);
                    return null;
                }
            } else {
                console.log(`ℹ️ У пользователя ${userId} нет username, контакт не обновляется`);
                return null;
            }
            
        } catch (error) {
            console.error(`❌ Ошибка обновления контакта ${userId}:`, error.message);
            return null;
        }
    }

    async getUsersInfo(userIds) {
        const results = {};
        for (const userId of userIds) {
            results[userId] = await this.getUserInfo(userId);
            // Небольшая задержка чтобы не флудить API
            await new Promise(resolve => setTimeout(resolve, 200));
        }
        return results;
    }

    async disconnect() {
        if (this.client) {
            await this.client.disconnect();
            this.isConnected = false;
            console.log('🔌 Telegram клиент отключен');
        }
    }
}

