import { db } from '../lib/firebase.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { telegram_id, email } = req.body || {};
  if (!telegram_id || !email) return res.status(400).json({ error: 'Missing parameters' });

  // 1. Fetch dynamic settings from Firebase (fallback to Vercel env variables if not set)
  const configDoc = await db.collection('settings').doc('config').get();
  const config = configDoc.exists ? configDoc.data() : {};
  const activeBotToken = config.bot_token || process.env.BOT_TOKEN;
  const activeChannelId = config.channel_id || process.env.CHANNEL_ID;
  const minPoints = Number(config.min_withdraw || 50.00);

  const tid = String(telegram_id);
  const userRef = db.collection('users').doc(tid);

  let claimPoints = 0;
  let userData = {};

  try {
    await db.runTransaction(async (t) => {
      const doc = await t.get(userRef);
      if (!doc.exists) throw new Error('User record not found.');

      userData = doc.data();
      claimPoints = Number(userData.balance || 0);

      if (claimPoints < minPoints) {
        throw new Error(`Minimum ${minPoints.toFixed(2)} PTS required to withdraw.`);
      }

      // Reset balance
      t.update(userRef, { balance: 0.00 });

      // Save withdrawal request
      const withdrawRef = db.collection('withdrawals').doc();
      t.set(withdrawRef, {
        telegram_id: tid,
        email: email,
        points: claimPoints,
        status: 'pending',
        created_at: new Date().toISOString()
      });
    });
  } catch (error) {
    return res.status(400).json({ status: 'error', message: error.message });
  }

  // 2. Send notification using the dynamic Bot Token
  if (activeBotToken && activeChannelId) {
    const text = `🎮 *NEW WITHDRAWAL REQUEST*\n\n` +
                 `👤 *User:* ${userData.first_name || 'N/A'} (@${userData.username || 'None'})\n` +
                 `🆔 *Telegram ID:* \`${tid}\`\n` +
                 `📧 *Email:* \`${email}\`\n` +
                 `💰 *Points:* ${claimPoints.toFixed(2)} PTS\n` +
                 `🌐 *Store:* automaticgametopup.iceiy.com\n` +
                 `⏳ *Status:* Pending Admin Review`;

    try {
      await fetch(`https://api.telegram.org/bot${activeBotToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: activeChannelId, text, parse_mode: 'Markdown' })
      });
    } catch (err) {
      console.error('Telegram notification error:', err);
    }
  }

  return res.status(200).json({ status: 'success', points: claimPoints });
}