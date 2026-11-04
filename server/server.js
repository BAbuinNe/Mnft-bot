import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const dotenv = require('dotenv');
dotenv.config();

const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const redis = require('redis');
const { createAdapter } = require('@socket.io/redis-adapter');
const cors = require('cors');
import cron from 'node-cron';
import path from 'path'; 
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url); 
const __dirname = path.dirname(__filename); 

// Импорт модулей
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import { SocketModule } from './modules/socket/socket.module.js';
import { NFTService } from './modules/nft/nft.service.js';
import { WebhookSetup } from './modules/telegram/webhook.setup.js';
import { TelegramClientService } from './telegram-client.service.js';
import { TelegramCacheService } from './telegram-cache.service.js';

const app = express();
const server = createServer(app);
const port = process.env.PORT;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Статические файлы
app.use(express.static('../client'));
app.use('/avatars', express.static(path.join(__dirname, '../client/avatars')));
app.use('/m_nft_image', express.static(path.join(__dirname, '../client/m_nft_image')));

// Redis клиенты
const pubClient = redis.createClient({ 
  url: process.env.REDIS_URL
});
const subClient = pubClient.duplicate();

// Socket.IO настройка
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const db = await open({
    filename: '../db/mark.db',
    driver: sqlite3.Database
});

let socketModuleInstance = null;
let telegramClient = null;
let telegramCache = null; 

async function initializeTelegramClient() {
    try {
        const apiId = process.env.TELEGRAM_API_ID;
        const apiHash = process.env.TELEGRAM_API_HASH;
        
        if (!apiId || !apiHash) {
            console.error('❌ TELEGRAM_API_ID и TELEGRAM_API_HASH должны быть указаны в .env');
            console.log('Получите их на https://my.telegram.org/apps');
            process.exit(1);
        }

        console.log('🤖 Инициализация Telegram клиента...');
        telegramClient = new TelegramClientService(apiId, apiHash);
        await telegramClient.init();
        
        // ИНИЦИАЛИЗИРУЕМ КЭШ СЕРВИС С ПЕРЕДАЧЕЙ db
        telegramCache = new TelegramCacheService(telegramClient, db); 
        
        // Делаем клиент и кэш доступными глобально
        global.telegramClient = telegramClient;
        global.telegramCache = telegramCache;
        
        return telegramClient;
    } catch (error) {
        console.error('❌ Ошибка инициализации Telegram клиента:', error);
        process.exit(1);
    }
}

async function setupDailyCacheRefresh() {
    try {
        cron.schedule('43 12 * * *', async () => {
            console.log('🔄 Запуск ежедневного обновления кэша пользователей...');
            
            if (global.telegramCache) {
                try {
                    await global.telegramCache.refreshAllUsersCache();
                    console.log('✅ Ежедневное обновление кэша завершено');
                } catch (error) {
                    console.error('❌ Ошибка при ежедневном обновлении кэша:', error);
                }
            } else {
                console.error('❌ TelegramCache не инициализирован');
            }
        }, {
            timezone: "Europe/Moscow" 
        });
        
        console.log('⏰ Планировщик ежедневного обновления кэша запущен (03:00)');
    } catch (error) {
        console.error('❌ Ошибка при настройке планировщика:', error);
    }
}

async function initializeModules() {
  try {
    // Подключаем Redis
    await pubClient.connect();
    await subClient.connect();
    io.adapter(createAdapter(pubClient, subClient));

    // Инициализируем Telegram клиент
    await initializeTelegramClient();

    // Инициализируем единый модуль сокетов
    const socketModule = new SocketModule(io, pubClient, db);
    socketModuleInstance = socketModule;
    
    await setupTelegramWebhook();
    await setupDailyCacheRefresh();
    console.log('✅ All modules initialized successfully');
  } catch (error) {
    console.error('❌ Module initialization failed:', error);
    process.exit(1);
  }
}

async function setupTelegramWebhook() {
    try {
        const webhookUrl = `${process.env.APP_URL}/webhook/telegram`;
        
        const response = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/setWebhook`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                url: webhookUrl,
                drop_pending_updates: true,
                allowed_updates: ['pre_checkout_query', 'message']
            })
        });
        
        const data = await response.json();
        console.log(data.ok ? '✅ Webhook установлен' : '❌ Webhook error:', data);
    } catch (error) {
        console.error('Webhook setup error:', error);
    }
}

// API Routes
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    modules: ['currency'],
    connections: io.engine.clientsCount,
    telegramClient: !!telegramClient
  });
});

app.get('/api/collections', async (req, res) => {
    try {
        const collections = await db.all(`
            SELECT id, name, image_file_id, total_supply, sold_count
            FROM m_nft_collections
            ORDER BY created_at DESC
        `);
        
        res.json({ success: true, collections });
    } catch (error) {
        console.error('Error fetching collections:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/webhook/telegram', async (req, res) => {
    try {
        const message = req.body?.message;
        const messageText = message?.text?.trim() || '';
        const command = messageText.split(/\s+/, 1)[0] || '';

        if (/^\/start(?:@\w+)?$/i.test(command) && message?.chat?.id) {
            return res.status(200).json({
                method: 'sendMessage',
                chat_id: message.chat.id,
                text: '👋 Добро пожаловать в M-NFT Маркет!\n\nЗдесь вы можете покупать, продавать и коллекционировать уникальные NFT.\n\nВыберите действие:',
                reply_markup: {
                    inline_keyboard: [[{
                        text: '🚀 Открыть Маркет NFT',
                        web_app: { url: 'https://mnft-miniapp.vercel.app/' }
                    }], [{
                        text: '📢 Channel',
                        url: 'https://t.me/mnft_channel'
                    }]]
                }
            });
        }

        console.log('📱 Telegram webhook received');
        res.status(200).json({ ok: true });
        if (socketModuleInstance && socketModuleInstance.handleTelegramWebhook) {
            socketModuleInstance.handleTelegramWebhook(req.body);
        } else {
            console.error('❌ SocketModule not initialized or missing handleTelegramWebhook method');
        }
    } catch (error) {
        console.error('Webhook error:', error);
        if (!res.headersSent) res.status(500).json({ ok: false });
    }
});

// Эндпоинт для ручной установки вебхука
app.post('/setup-webhook', async (req, res) => {
    try {
        const webhookSetup = new WebhookSetup(
            process.env.TELEGRAM_BOT_TOKEN,
            `${process.env.APP_URL}/webhook/telegram`
        );
        
        const result = await webhookSetup.setupWebhook();
        
        res.json({ 
            success: result, 
            message: result ? 'Webhook установлен' : 'Ошибка установки webhook' 
        });
        
    } catch (error) {
        console.error('Setup webhook error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Эндпоинт для тестирования получения данных пользователя
app.get('/api/user/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        
        if (!telegramClient) {
            return res.status(503).json({ 
                success: false, 
                error: 'Telegram клиент не инициализирован' 
            });
        }
        
        const userInfo = await telegramClient.getUserInfo(userId);
        
        if (userInfo) {
            res.json({ success: true, user: userInfo });
        } else {
            res.status(404).json({ success: false, error: 'Пользователь не найден' });
        }
    } catch (error) {
        console.error('Error fetching user:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down gracefully');
  
  if (telegramClient) {
      await telegramClient.disconnect();
  }
  
  await pubClient.quit();
  await subClient.quit();
  server.close(() => {
    process.exit(0);
  });
});

// Запуск сервера
server.listen(port, () => {
  console.log(`🚀 Server running on port ${port}`);
  initializeModules();
});