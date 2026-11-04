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
import { timingSafeEqual } from 'node:crypto';
// Импорт модулей
import { openDatabase } from './database.js';
import { SocketModule } from './modules/socket/socket.module.js';
import { NFTService } from './modules/nft/nft.service.js';
import { WebhookSetup } from './modules/telegram/webhook.setup.js';
import { TelegramClientService } from './telegram-client.service.js';
import { TelegramCacheService } from './telegram-cache.service.js';

const app = express();
const server = createServer(app);
const port = process.env.PORT || 3000;
const publicAppUrl = process.env.VERCEL
    ? 'https://mnft-bot-backend.vercel.app'
    : process.env.APP_URL;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

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

const db = await openDatabase();

let socketModuleInstance = null;
let telegramClient = null;
let telegramCache = null; 

async function initializeTelegramClient() {
    try {
        // Vercel functions cannot perform Telegram's interactive phone/code login.
        // Bot API features can run without MTProto; enable it only with an injected session.
        if (process.env.VERCEL && !process.env.TELEGRAM_SESSION_STRING) {
            console.log('ℹ️ MTProto client disabled: TELEGRAM_SESSION_STRING is not configured');
            return null;
        }

        const apiId = process.env.TELEGRAM_API_ID;
        const apiHash = process.env.TELEGRAM_API_HASH;
        
        if (!apiId || !apiHash) {
            throw new Error('TELEGRAM_API_ID and TELEGRAM_API_HASH are required for MTProto');
        }

        console.log('🤖 Инициализация Telegram клиента...');
        telegramClient = new TelegramClientService(apiId, apiHash);
        await telegramClient.init();
        
        // Initialize the user cache only when MTProto is available.
        telegramCache = new TelegramCacheService(telegramClient, db);
        
        // Делаем клиент и кэш доступными глобально
        global.telegramClient = telegramClient;
        global.telegramCache = telegramCache;
        
        return telegramClient;
    } catch (error) {
        console.error('❌ Ошибка инициализации Telegram клиента:', error);
        throw error;
    }
}

async function setupDailyCacheRefresh() {
    if (process.env.VERCEL) return;
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
    
    // The webhook is configured once on the production alias. Do not reset it
    // on every Vercel serverless cold start.
    if (!process.env.VERCEL) await setupTelegramWebhook();
    await setupDailyCacheRefresh();
    console.log('✅ All modules initialized successfully');
  } catch (error) {
    console.error('❌ Module initialization failed:', error);
    throw error;
  }
}

async function setupTelegramWebhook() {
    try {
        const webhookUrl = `${publicAppUrl}/webhook/telegram`;
        if (process.env.VERCEL && !process.env.TELEGRAM_WEBHOOK_SECRET) {
            throw new Error('TELEGRAM_WEBHOOK_SECRET is required on Vercel');
        }
        const webhookSetup = new WebhookSetup(
            process.env.TELEGRAM_BOT_TOKEN,
            webhookUrl,
            process.env.TELEGRAM_WEBHOOK_SECRET
        );
        const result = await webhookSetup.setupWebhook();
        console.log(result ? '✅ Webhook установлен' : '❌ Webhook error');
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
    telegramClient: !!telegramClient,
    storage: process.env.TURSO_DATABASE_URL ? 'persistent' : 'temporary-memory'
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
    const configuredSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
    const receivedSecret = req.get('x-telegram-bot-api-secret-token') || '';
    const expected = Buffer.from(configuredSecret || '');
    const received = Buffer.from(receivedSecret);
    if (configuredSecret && (expected.length !== received.length || !timingSafeEqual(expected, received))) {
        return res.status(401).json({ ok: false });
    }
    if (process.env.VERCEL && !configuredSecret) {
        return res.status(503).json({ ok: false });
    }

    // Telegram can execute a Bot API method directly from the webhook response.
    // Use that for /start so the welcome reply does not depend on Vercel's
    // outbound connection to api.telegram.org.
    const messageText = req.body?.message?.text?.trim() || '';
    const command = messageText.split(/\s+/, 1)[0] || '';
    const message = req.body?.message;
    if (/^\/start(?:@\w+)?$/i.test(command) && message?.chat?.id) {
        console.log('📨 /start reply returned to Telegram as a webhook method');
        return res.status(200).json({
            method: 'sendMessage',
            chat_id: message.chat.id,
            text: '👋 Добро пожаловать в M-NFT Маркет!\n\nЗдесь вы можете покупать, продавать и коллекционировать уникальные NFT.\n\nНажмите кнопку ниже, чтобы открыть маркет:',
            reply_markup: {
                inline_keyboard: [[{
                    text: '🚀 Открыть Маркет NFT',
                    web_app: { url: 'https://mnft-miniapp.vercel.app/' }
                }], [{
                    text: '📢 Channel',
                    url: 'https://t.me/mnft_channel'
                }]]
            },
            parse_mode: 'HTML'
        });
    }

    try {
        console.log('📱 Telegram webhook received');
        
        // ВАЖНО: Немедленно отвечаем Telegram
        res.status(200).json({ ok: true });
        
        // Обрабатываем вебхук асинхронно
        if (socketModuleInstance && socketModuleInstance.handleTelegramWebhook) {
            const handleWebhook = () => socketModuleInstance.handleTelegramWebhook(req.body);
            if (db.withContext) await db.withContext(handleWebhook);
            else await handleWebhook();
        } else {
            console.error('❌ SocketModule not initialized or missing handleTelegramWebhook method');
        }
        
    } catch (error) {
        console.error('Webhook error:', error);
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
  await db.close?.();
  server.close(() => {
    process.exit(0);
  });
});

// Vercel serves the exported HTTP server as a Function. Local development
// keeps the traditional listener and initializes integrations after binding.
if (process.env.VERCEL) {
  await initializeModules();
} else {
  server.listen(port, () => {
    console.log(`🚀 Server running on port ${port}`);
    initializeModules().catch((error) => console.error('Initialization failed:', error));
  });
}

export default server;

