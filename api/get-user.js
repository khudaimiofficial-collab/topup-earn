import { db, sendTelegramMessage } from '../lib/firebase.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { telegram_id, first_name, username } = req.body || {};
  if (!telegram_id) return res.status(400).json({ error: 'Missing telegram_id' });

  const tid = String(telegram_id);
  const userRef = db.collection('users').doc(tid);
  const doc = await userRef.get();

  if (!doc.exists) {
    const newUser = {
      telegram_id: tid,
      first_name: first_name || '',
      username: username || '',
      balance: 0.00,
      ads_watched: 0,
      welcome_sent: true,
      created_at: new Date().toISOString()
    };
    await userRef.set(newUser);

    // 📩 Send Welcome / Start Message to User
    const welcomeText = `👋 *Welcome to Free Top-Up & Game Credits, ${first_name || 'Gamer'}!*\n\n` +
      `🎮 You have successfully launched the app!\n\n` +
      `💎 *How to Earn:*\n` +
      `• Watch sponsored ads to earn *+10.00 PTS* each.\n` +
      `• Reach *50.00 PTS* to request a game credit top-up.\n` +
      `• Your withdrawal will be credited to *automaticgametopup.iceiy.com*!\n\n` +
      `Tap the bottom menu button anytime to open the app and start earning!`;

    await sendTelegramMessage(tid, welcomeText);

    return res.status(200).json({ status: 'success', balance: 0.00, ads_watched: 0 });
  }

  const userData = doc.data();
  return res.status(200).json({
    status: 'success',
    balance: Number(userData.balance || 0),
    ads_watched: Number(userData.ads_watched || 0)
  });
}
