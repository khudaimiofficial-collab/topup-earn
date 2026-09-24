import { db, getBotConfig, sendTelegramMessage } from '../lib/firebase.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { telegram_id, first_name, username } = req.body || {};
  if (!telegram_id) return res.status(400).json({ error: 'Missing telegram_id' });

  const tid = String(telegram_id);
  const userRef = db.collection('users').doc(tid);
  const doc = await userRef.get();

  // Fetch current minimum withdrawal from admin settings
  const { minWithdraw } = await getBotConfig();

  let userData = {};

  if (!doc.exists) {
    userData = {
      telegram_id: tid,
      first_name: first_name || '',
      username: username || '',
      balance: 0.00,
      ads_watched: 0,
      welcome_sent: false,
      created_at: new Date().toISOString()
    };
    await userRef.set(userData);
  } else {
    userData = doc.data();
  }

  // 📩 Send Welcome / Start message if never sent before
  if (!userData.welcome_sent) {
    const welcomeHtml = `👋 <b>Welcome to Free Top-Up & Game Credits, ${first_name || 'Gamer'}!</b>\n\n` +
      `🎮 You have successfully launched the app!\n\n` +
      `💎 <b>How to Earn:</b>\n` +
      `• Watch sponsored ads to receive <b>+10.00 PTS</b> per ad.\n` +
      `• Reach <b>${minWithdraw.toFixed(2)} PTS</b> to redeem game credits.\n` +
      `• Rewards are delivered directly to your account on <b>automaticgametopup.iceiy.com</b>!\n\n` +
      `Tap the bottom menu button anytime to open the app!`;

    const sent = await sendTelegramMessage(tid, welcomeHtml);
    if (sent) {
      await userRef.update({ welcome_sent: true });
    }
  }

  return res.status(200).json({
    status: 'success',
    balance: Number(userData.balance || 0),
    ads_watched: Number(userData.ads_watched || 0),
    min_withdraw: minWithdraw
  });
}
