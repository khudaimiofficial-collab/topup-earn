import admin from 'firebase-admin';

if (!admin.apps.length) {
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

export const db = admin.firestore();
export const FieldValue = admin.firestore.FieldValue;

// Helper to get active bot token and config from Admin Settings
export async function getBotConfig() {
  const doc = await db.collection('settings').doc('config').get();
  const data = doc.exists ? doc.data() : {};
  return {
    botToken: data.bot_token || process.env.BOT_TOKEN,
    channelId: data.channel_id || process.env.CHANNEL_ID,
    minWithdraw: Number(data.min_withdraw || 50.00)
  };
}

// Helper function to send Telegram messages reliably using HTML
export async function sendTelegramMessage(chatId, htmlText) {
  const { botToken } = await getBotConfig();
  if (!botToken || !chatId) {
    console.error('Cannot send message: Missing Bot Token or Chat ID');
    return false;
  }

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
    if (!result.ok) {
      console.error('Telegram Send Error:', result.description);
      return false;
    }
    return true;
  } catch (err) {
    console.error('Failed to send Telegram message:', err);
    return false;
  }
}
