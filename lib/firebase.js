import admin from 'firebase-admin';

// Initialize Firebase Admin SDK if not already active
if (!admin.apps.length) {
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

export const db = admin.firestore();
export const FieldValue = admin.firestore.FieldValue;

// Helper to retrieve active configuration (Bot Token, Channel, Limits)
export async function getBotConfig() {
  const doc = await db.collection('settings').doc('config').get();
  const data = doc.exists ? doc.data() : {};
  return {
    botToken: data.bot_token || process.env.BOT_TOKEN,
    channelId: data.channel_id || process.env.CHANNEL_ID || '@KhudaimiOfficialStore',
    minWithdraw: Number(data.min_withdraw || 50.00)
  };
}

// Helper to send messages directly from the bot
export async function sendTelegramMessage(chatId, htmlText) {
  const { botToken } = await getBotConfig();
  if (!botToken || !chatId) return false;

  try {
    const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: htmlText,
        parse_mode: 'HTML'
      })
    });
    const result = await res.json();
    return result.ok;
  } catch (err) {
    console.error('Failed to send Telegram message:', err);
    return false;
  }
}

// Helper to query Telegram's getChatMember API for channel verification
export async function checkChannelMember(userId) {
  const { botToken, channelId } = await getBotConfig();
  if (!botToken || !channelId || !userId) return false;

  try {
    const res = await fetch(`https://api.telegram.org/bot${botToken}/getChatMember?chat_id=${encodeURIComponent(channelId)}&user_id=${userId}`);
    const data = await res.json();
    if (data.ok && data.result) {
      const status = data.result.status;
      // Telegram statuses indicating the user is in the channel
      return ['creator', 'administrator', 'member', 'restricted'].includes(status);
    }
    return false;
  } catch (err) {
    console.error('checkChannelMember error:', err);
    return false;
  }
}
