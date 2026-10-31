import fetch from 'node-fetch';

export class WebhookSetup {
    constructor(botToken, webhookUrl) {
        this.botToken = botToken;
        this.webhookUrl = webhookUrl;
        this.apiUrl = `https://api.telegram.org/bot${botToken}`;
    }

    async setupWebhook() {
        try {
            const response = await fetch(`${this.apiUrl}/setWebhook`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    url: this.webhookUrl,
                    drop_pending_updates: true,
                    allowed_updates: [
                        'pre_checkout_query',
                        'message'
                    ]
                })
            });

            const data = await response.json();
            
            if (data.ok) {
                console.log('✅ Webhook установлен:', this.webhookUrl);
                return true;
            } else {
                console.error('❌ Webhook setup error:', data);
                return false;
            }
        } catch (error) {
            console.error('❌ Error setting webhook:', error);
            return false;
        }
    }

    async deleteWebhook() {
        try {
            const response = await fetch(`${this.apiUrl}/deleteWebhook`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' }
            });

            const data = await response.json();
            console.log('Webhook удален:', data);
            return data.ok;
        } catch (error) {
            console.error('Error deleting webhook:', error);
            return false;
        }
    }

    async getWebhookInfo() {
        try {
            const response = await fetch(`${this.apiUrl}/getWebhookInfo`);
            const data = await response.json();
            console.log('Webhook информация:', data);
            return data;
        } catch (error) {
            console.error('Error getting webhook info:', error);
            return null;
        }
    }
}