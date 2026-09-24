import admin from 'firebase-admin';

// Initialize Firebase Admin SDK
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT))
  });
}
const db = admin.firestore();

// Exact App Base URL
const APP_URL = 'https://pheizubot.vercel.app';

export default async function handler(req, res) {
  // Only accept POST requests from Telegram
  if (req.method !== 'POST') {
    return res.status(200).send('Webhook active');
  }

  const update = req.body;
  if (!update || !update.message) {
    return res.status(200).send('No message payload');
  }

  const { chat, text } = update.message;
  const chatId = chat.id;

  // Handle /start command
  if (text && text.startsWith('/start')) {
    try {
      // 1. Fetch live settings configured from your Admin Panel
      const settingsDoc = await db.collection('app_settings').doc('general').get();
      const settings = settingsDoc.exists ? settingsDoc.data() : {};

      const botToken = settings.bot_token || process.env.TELEGRAM_BOT_TOKEN;
      const bannerUrl = (settings.banner_url || '').trim();

      // Check if user joined with a referral code (e.g., /start 123456789)
      const parts = text.split(' ');
      const startParam = parts.length > 1 ? parts[1].trim() : null;

      // 2. Fetch live Bot Name from Telegram for dynamic {title}
      let botTitle = 'Pheizu Top-Up';
      try {
        const botInfoRes = await fetch(`https://api.telegram.org/bot${botToken}/getMe`);
        const botInfo = await botInfoRes.json();
        if (botInfo.ok && botInfo.result?.first_name) {
          botTitle = botInfo.result.first_name;
        }
      } catch (e) {
        console.warn('Could not fetch bot title:', e);
      }

      // 3. Mini App URL with optional referral parameter
      const miniAppUrl = startParam 
        ? `${APP_URL}/index.html?startapp=${startParam}` 
        : `${APP_URL}/index.html`;

      // 4. Welcome message text with {title}
      const captionText = 
`👋 Welcome to *${botTitle}*!

🎮 Earn free points by watching ads and inviting friends to claim instant top-up credits.

⚡ Instant • Automated • 100% Free Credits`;

      // 5. Button to Launch Mini App directly inside Telegram
      const replyMarkup = {
        inline_keyboard: [
          [
            {
              text: "🚀 Launch Mini App",
              web_app: { url: miniAppUrl }
            }
          ]
        ]
      };

      // 6. Send Banner Photo if configured, fallback to text if URL fails
      let photoSent = false;
      if (bannerUrl && bannerUrl.startsWith('http')) {
        const photoRes = await fetch(`https://api.telegram.org/bot${botToken}/sendPhoto`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            photo: bannerUrl,
            caption: captionText,
            parse_mode: 'Markdown',
            reply_markup: replyMarkup
          })
        });

        const photoData = await photoRes.json();
        if (photoData.ok) {
          photoSent = true;
        } else {
          console.warn('Telegram sendPhoto failed:', photoData.description);
        }
      }

      // Fallback: Send normal message if banner URL failed or is empty
      if (!photoSent) {
        await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text: captionText,
            parse_mode: 'Markdown',
            reply_markup: replyMarkup
          })
        });
      }

    } catch (err) {
      console.error('Error handling /start:', err);
    }
  }

  return res.status(200).json({ ok: true });
}
