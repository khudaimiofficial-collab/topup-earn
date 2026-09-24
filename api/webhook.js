import { db, getBotConfig } from '../lib/firebase.js';

export default async function handler(req, res) {
  // Always return 200 OK fast so Telegram doesn't retry
  if (req.method !== 'POST') {
    return res.status(200).send('OK');
  }

  const update = req.body;
  const message = update?.message;

  if (!message || !message.text) {
    return res.status(200).send('OK');
  }

  const chatId = message.chat?.id;
  const text = message.text.trim();
  const user = message.from;

  // Triggers INSTANTLY every single time user sends /start
  if (text.startsWith('/start')) {
    const { botToken, minWithdraw } = await getBotConfig();

    if (!botToken) {
      return res.status(200).send('OK');
    }

    // Register user in database if first time
    if (chatId) {
      const userRef = db.collection('users').doc(String(chatId));
      const doc = await userRef.get();
      if (!doc.exists) {
        await userRef.set({
          telegram_id: String(chatId),
          first_name: user?.first_name || '',
          username: user?.username || '',
          balance: 0.00,
          ads_watched: 0,
          created_at: new Date().toISOString()
        });
      }
    }

    // Determine domain & links
    const protocol = req.headers['x-forwarded-proto'] || 'https';
    const host = req.headers.host;
    const webAppUrl = `${protocol}://${host}`;

    // Your official top-up website link
    const websiteStoreUrl = 'https://automaticgametopup.iceiy.com';

    // Banner image URL
    const bannerUrl = 'https://images.unsplash.com/photo-1542751371-adc38448a05e?w=800&q=80';

    const caption = `👋 <b>Welcome to Free Top-Up & Game Credits!</b>\n\n` +
      `⛏️ <b>Earn Free Game Credits & Top-Up:</b>\n` +
      `⚡ Watch video ads to earn <b>+10.00 PTS</b> each.\n` +
      `🎯 Minimum withdrawal: <b>${minWithdraw.toFixed(2)} PTS</b>.\n` +
      `🌐 Direct account balance top-up to <b>automaticgametopup.iceiy.com</b>!\n\n` +
      `Click below to launch the Mini App or visit our website:`;

    // Photo + Caption + 2 Direct Buttons
    const payload = {
      chat_id: chatId,
      photo: bannerUrl,
      caption: caption,
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: '🚀 Launch Top-Up App',
              web_app: { url: webAppUrl } // Opens Mini App directly inside Telegram
            }
          ],
          [
            {
              text: '🌐 Visit Top-Up Website',
              url: websiteStoreUrl // Opens automaticgametopup.iceiy.com directly
            }
          ]
        ]
      }
    };

    try {
      await fetch(`https://api.telegram.org/bot${botToken}/sendPhoto`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
    } catch (err) {
      console.error('Error sending start message:', err);
    }
  }

  return res.status(200).send('OK');
}
