import { CurrencyService } from './currency.service.js';

export class CurrencyModule {
    constructor(io, redisClient) {
        this.io = io;
        this.service = new CurrencyService(redisClient);
        console.log('⭐ Currency service ready');
    }
    
    setupSocketHandlers() {
        this.io.on('connection', (socket) => {
            console.log(`🔌 Client connected: ${socket.id}`);

            socket.on('get_currency_rate', async () => {
                const rateData = await this.service.getCurrentRate();
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

            socket.on('disconnect', () => {
                console.log(`🔌 Client disconnected: ${socket.id}`);
            });
        });
    }

    startPriceBroadcasting() {
        setInterval(async () => {
            try {
                const rateData = await this.service.getCurrentRate();
                this.io.to('currency_updates').emit('currency_update', {
                    tonPrice: rateData.tonPrice.toFixed(4),
                    timestamp: rateData.timestamp
                });
                console.log(`📢 Broadcasted TON price update to clients: $${rateData.tonPrice.toFixed(4)}`);
            } catch (error) {
                console.log('❌ Error broadcasting price update:', error.message);
            }
        }, 10000); // Каждые 10 секунд
    }
}