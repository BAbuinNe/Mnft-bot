export class CurrencyService {
    constructor(redisClient) {
        this.redis = redisClient;
    }

    async getTonPrice() {
        try {
            const response = await fetch('https://api.binance.com/api/v3/ticker/price?symbol=TONUSDT');
            const data = await response.json();
            const price = parseFloat(data.price);
            
            if (price > 0) {
                await this.redis.set('ton_price', price.toString());
                return price;
            }
        } catch (e) {
            console.log(`❌ Failed to fetch TON price:`, e.message);
        }
        
        const cached = await this.redis.get('ton_price');
        return cached ? parseFloat(cached) : 2.5;
    }

    async getCurrentRate() {
        const tonPrice = await this.getTonPrice();
        
        return {
            tonPrice: tonPrice,
            timestamp: new Date().toISOString()
        };
    }

    startPriceUpdates() {
        // Обновляем цену TON каждые 5 минут
        setInterval(() => this.getTonPrice(), 300000);
    }
}