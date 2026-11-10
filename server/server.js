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
import { createPayments, telegramMethod, verifyInitData } from './payments.js';
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
  url: process.env.REDIS_URL,
  socket: { connectTimeout: 3000, reconnectStrategy: retries => retries > 2 ? false : 200 }
});
const subClient = pubClient.duplicate();

// Socket.IO настройка
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});
io.use((socket, next) => {
    const userId = verifyInitData(socket.handshake.auth?.initData, process.env.TELEGRAM_BOT_TOKEN);
    if (!userId) return next(new Error('Telegram authentication required'));
    socket.data.telegramUserId = userId;
    next();
});

const db = await openDatabase();
const payments = createPayments({ db, botToken: process.env.TELEGRAM_BOT_TOKEN });
const paymentsReady = Boolean(process.env.ENABLE_STAR_PAYMENTS === 'true' &&
    process.env.TURSO_DATABASE_URL && process.env.TURSO_AUTH_TOKEN &&
    process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_WEBHOOK_SECRET);

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
  let redisReady = false;
  if (process.env.REDIS_URL && process.env.TELEGRAM_BOT_TOKEN &&
      (!process.env.VERCEL || process.env.VERCEL_ENV === 'production')) {
    try {
      await pubClient.connect();
      await subClient.connect();
      io.adapter(createAdapter(pubClient, subClient));
      redisReady = true;
    } catch (error) {
      console.error('Redis unavailable; HTTP routes remain active:', error.message);
    }
  }
  try { await initializeTelegramClient(); }
  catch (error) { console.error('MTProto unavailable; HTTP routes remain active:', error.message); }
  if (redisReady && process.env.TELEGRAM_BOT_TOKEN) {
    try { socketModuleInstance = new SocketModule(io, pubClient, db); }
    catch (error) { console.error('Socket module unavailable:', error.message); }
  }
  // Production webhook was installed once with /start and pre_checkout_query enabled.
  // Repeating setWebhook for every cold start hits Telegram's rate limit.
  if (!process.env.VERCEL || process.env.CONFIGURE_TELEGRAM_WEBHOOK === 'true') await setupTelegramWebhook();
  await setupDailyCacheRefresh();
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

function paymentUser(req, res) {
    if (!paymentsReady) { res.status(503).json({ success: false, error: 'Payments are not configured' }); return null; }
    const userId = verifyInitData(req.get('x-telegram-init-data'), process.env.TELEGRAM_BOT_TOKEN);
    if (!userId) { res.status(401).json({ success: false, error: 'Open the Mini App in Telegram' }); return null; }
    return userId;
}

app.post('/api/payments/invoice', async (req, res) => {
    const userId = paymentUser(req, res);
    if (!userId) return;
    try {
        const { invoiceUrl, invoiceId } = await payments.createInvoice(userId, req.body?.amount);
        res.json({ success: true, invoiceUrl, invoiceId });
    } catch (error) {
        const badAmount = error instanceof RangeError;
        console.error('Invoice error:', error.message);
        res.status(badAmount ? 400 : 502).json({ success: false, error: badAmount ? error.message : 'Invoice could not be created' });
    }
});

app.get('/api/payments/balance', async (req, res) => {
    const userId = paymentUser(req, res);
    if (!userId) return;
    try {
        const user = await db.get('SELECT stars_balance FROM users WHERE id = ?', [userId]);
        res.json({ success: true, balance: Number(user?.stars_balance || 0) });
    } catch (error) {
        console.error('Balance error:', error.message);
        res.status(500).json({ success: false, error: 'Balance unavailable' });
    }
});

app.get('/api/payments/invoice/:id', async (req, res) => {
    const userId = paymentUser(req, res);
    if (!userId) return;
    try {
        const invoice = await db.get('SELECT status, amount FROM star_invoices WHERE id = ? AND user_id = ?',
            [req.params.id, userId]);
        if (!invoice) return res.status(404).json({ success: false });
        const user = await db.get('SELECT stars_balance FROM users WHERE id = ?', [userId]);
        res.json({ success: true, status: invoice.status, balance: Number(user?.stars_balance || 0) });
    } catch (error) {
        console.error('Invoice status error:', error.message);
        res.status(500).json({ success: false, error: 'Invoice status unavailable' });
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

    if (req.body?.pre_checkout_query || req.body?.message?.successful_payment) {
        if (!paymentsReady) {
            if (req.body.pre_checkout_query && process.env.TELEGRAM_BOT_TOKEN) {
                try { await telegramMethod(process.env.TELEGRAM_BOT_TOKEN, 'answerPreCheckoutQuery', {
                    pre_checkout_query_id: req.body.pre_checkout_query.id,
                    ok: false, error_message: 'Оплата временно недоступна'
                }); }
                catch (error) { console.error('Pre-checkout rejection failed:', error.message); return res.status(500).json({ ok: false }); }
            }
            return res.status(req.body.pre_checkout_query ? 200 : 503).json({ ok: Boolean(req.body.pre_checkout_query) });
        }
        try {
            if (req.body.pre_checkout_query) await payments.answerPreCheckout(req.body.pre_checkout_query);
            else await payments.creditPayment(req.body.message);
            return res.status(200).json({ ok: true });
        } catch (error) {
            console.error('Payment webhook failed:', error.message);
            return res.status(500).json({ ok: false });
        }
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

    if (/^\/(?:paysupport|support)(?:@\w+)?$/i.test(command) && message?.chat?.id) {
        return res.status(200).json({ method: 'sendMessage', chat_id: message.chat.id,
            text: 'По вопросам оплаты и возврата Stars обратитесь в канал: https://t.me/mnft_channel' });
    }
    if (/^\/terms(?:@\w+)?$/i.test(command) && message?.chat?.id) {
        return res.status(200).json({ method: 'sendMessage', chat_id: message.chat.id,
            text: 'M-NFT: Stars пополняют баланс внутри приложения. Покупки цифровых предметов и действия с балансом доступны только внутри Mini App. Проверяйте сумму перед оплатой. По вопросам платежей и возвратов: https://t.me/mnft_channel' });
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
  
  if (pubClient.isOpen) await pubClient.quit();
  if (subClient.isOpen) await subClient.quit();
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
