import admin from 'firebase-admin';

if (!admin.apps.length) {
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

export const db = admin.firestore();
export const FieldValue = admin.firestore.FieldValue;

// Helper to get active bot token from Admin Settings (or fallback to Vercel env)
export async function getBotToken() {
  const doc = await db.collection('settings').doc('config').get();
  return (doc.exists && doc.data().bot_token) ? doc.data().bot_token : process.env.BOT_TOKEN;
}

// Helper function to send Telegram Bot messages directly to users
export async function sendTelegramMessage(chatId, text) {
  const botToken = await getBotToken();
  if (!botToken || !chatId) return;

  try {
    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: text,
        parse_mode: 'Markdown'
      })
    });
  } catch (err) {
    console.error('Failed to send Telegram message:', err);
  }
}
