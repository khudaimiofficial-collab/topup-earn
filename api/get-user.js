import { db, FieldValue, getBotConfig, sendTelegramMessage } from '../lib/firebase.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { telegram_id, first_name, username, referrer_id } = req.body || {};
  if (!telegram_id) return res.status(400).json({ error: 'Missing telegram_id' });

  const tid = String(telegram_id);
  const userRef = db.collection('users').doc(tid);
  const doc = await userRef.get();

  const { botToken, minWithdraw } = await getBotConfig();

  // 1. Always fetch LIVE Bot Title from Telegram
  let botName = 'AdBoost Earning';
  if (botToken) {
    try {
      const meRes = await fetch(`https://api.telegram.org/bot${botToken}/getMe`);
      const meData = await meRes.json();
      if (meData.ok && meData.result?.first_name) {
        botName = meData.result.first_name;
      }
    } catch (e) {
      console.error('getMe error:', e);
    }
  }

  let userData = {};

  if (!doc.exists) {
    // Check if user was invited by someone
    let validReferrer = null;
    if (referrer_id && String(referrer_id) !== tid) {
      const refDoc = await db.collection('users').doc(String(referrer_id)).get();
      if (refDoc.exists) {
        validReferrer = String(referrer_id);
        // Increment referrer's invited count
        await db.collection('users').doc(validReferrer).update({
          invited_count: FieldValue.increment(1)
        });
        // Notify referrer
        await sendTelegramMessage(validReferrer, `🎉 <b>New Referral!</b> A friend just joined using your invite link! You will earn <b>10% commission</b> on all their points!`);
      }
    }

    userData = {
      telegram_id: tid,
      first_name: first_name || '',
      username: username || '',
      balance: 0.00,
      ads_watched: 0,
      invited_count: 0,
      referral_earnings: 0.00,
      referred_by: validReferrer,
      welcome_sent: false,
      created_at: new Date().toISOString()
    };
    await userRef.set(userData);
  } else {
    userData = doc.data();
  }

  // Welcome message on first launch
  if (!userData.welcome_sent) {
    const welcomeHtml = `👋 <b>Welcome to ${botName}, ${first_name || 'Gamer'}!</b>\n\n` +
      `🎮 You have successfully launched the app!\n\n` +
      `💎 <b>How to Earn:</b>\n` +
      `• Watch sponsored ads to receive <b>+10.00 PTS</b> per ad.\n` +
      `• Invite friends and earn <b>10% lifetime commission</b>!\n` +
      `• Reach <b>${minWithdraw.toFixed(2)} PTS</b> to redeem game credits.\n\n` +
      `Tap the bottom menu button anytime to open the app!`;

    const sent = await sendTelegramMessage(tid, welcomeHtml);
    if (sent) await userRef.update({ welcome_sent: true });
  }

  return res.status(200).json({
    status: 'success',
    balance: Number(userData.balance || 0),
    ads_watched: Number(userData.ads_watched || 0),
    invited_count: Number(userData.invited_count || 0),
    referral_earnings: Number(userData.referral_earnings || 0),
    min_withdraw: minWithdraw,
    bot_name: botName
  });
}
