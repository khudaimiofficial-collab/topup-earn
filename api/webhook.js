import admin from 'firebase-admin';

// Initialize Firebase Admin if not already initialized
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT))
  });
}
const db = admin.firestore();

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(200).send('Webhook is active');
  }

  const update = req.body;
  if (!update || !update.message) {
    return res.status(200).send('No message');
  }

  const { chat, from, text } = update.message;
  const chatId = chat.id;

  // Only handle /start commands
  if (text && text.startsWith('/start')) {
    try {
      // 1. Fetch current settings from Firestore
      const settingsDoc = await db.collection('app_settings').doc('general').get();
      const settings = settingsDoc.exists ? settingsDoc.data() : {};

      const botToken = settings.bot_token || process.env.TELEGRAM_BOT_TOKEN;
      const websiteUrl = settings.website_url || 'https://automaticgametopup.iceiy.com';
      const bannerUrl = settings.banner_url || 'https://images.unsplash.com/photo-1542751371-adc38448a05e?w=800&q=80';
      
      // Determine the Mini App URL (Your Vercel deployment URL or production domain)
      const miniAppUrl = process.env.APP_URL || `https://${req.headers.host}`;

      // Extract referral if present (e.g. /start 123456789)
      const parts = text.split(' ');
      const startParam = parts.length > 1 ? parts[1].trim() : null;

      // 2. Fetch Bot Info to get the actual Bot Name ({title})
      let botTitle = "Free Top-Up Bot";
      try {
        const getMeRes = await fetch(`https://api.telegram.org/bot${botToken}/getMe`);
        const getMeData = await getMeRes.json();
        if (getMeData.ok && getMeData.result?.first_name) {
          botTitle = getMeData.result.first_name;
        }
      } catch (err) {
        console.warn("Could not fetch bot name, using default:", err);
      }

      // Append referral code to WebApp URL if invited by a friend
      const webAppUrlWithParam = startParam 
        ? `${miniAppUrl}/index.html?startapp=${startParam}` 
        : `${miniAppUrl}/index.html`;

      // 3. Caption text with dynamic {title}
      const captionText = 
`👋 Welcome to *${botTitle}*!

🎮 Earn free points by watching ads and invite friends to earn top-up credits.

⚡ Fast, verified, and automated credits for your favorite games!`;

      // 4. Inline Keyboard with "Launch Mini App" (web_app)
      const replyMarkup = {
        inline_keyboard: [
          [
            {
              text: "🚀 Launch Mini App",
              web_app: { url: webAppUrlWithParam }
            }
          ],
          [
            {
              text: "🛒 Visit Top-Up Store",
              url: websiteUrl
            }
          ]
        ]
      };

      // 5. Send with Banner (sendPhoto). Fallback to sendMessage if image fails
      let sentSuccessfully = false;

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
          sentSuccessfully = true;
        } else {
          console.warn("sendPhoto error from Telegram:", photoData);
        }
      }

      // Fallback: If banner image URL is invalid or blocked by Telegram, send regular text
      if (!sentSuccessfully) {
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

    } catch (error) {
      console.error("Error processing /start:", error);
    }
  }

  return res.status(200).json({ ok: true });
          }
