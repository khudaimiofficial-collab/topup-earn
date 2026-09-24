import { db, FieldValue, getBotConfig, sendTelegramMessage } from '../lib/firebase.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { telegram_id, first_name, username, referrer_id } = req.body || {};
  if (!telegram_id) return res.status(400).json({ error: 'Missing telegram_id' });

  const tid = String(telegram_id);
  const userRef = db.collection('users').doc(tid);
  const doc = await userRef.get();

  const { botToken, minWithdraw } = await getBotConfig();

  // Always fetch live bot title from Telegram
  let botName = 'AdBoost Earning';
  if (botToken) {
    try {
      const meRes = await fetch(`https://api.telegram.org/bot${botToken}/getMe`);
      const meData = await meRes.json();
      if (meData.ok && meData.result?.first_name) {
        botName = meData.result.first_name;
      }
    } catch (e) {}
  }

  let userData = doc.exists ? doc.data() : null;

  // Handle new or un-referred user joining through a referral link
  if ((!doc.exists || !userData.referred_by) && referrer_id && String(referrer_id) !== tid) {
    const refDoc = await db.collection('users').doc(String(referrer_id)).get();
    if (refDoc.exists) {
      const validRef = String(referrer_id);

      if (!doc.exists) {
        userData = {
          telegram_id: tid,
          first_name: first_name || '',
          username: username || '',
          balance: 0.00,
          ads_watched: 0,
          invited_count: 0,
          referral_earnings: 0.00,
          referred_by: validRef,
          welcome_sent: false,
          created_at: new Date().toISOString()
        };
        await userRef.set(userData);
      } else {
        await userRef.update({ referred_by: validRef });
        userData.referred_by = validRef;
      }

      // Increment referrer count
      await db.collection('users').doc(validRef).update({
        invited_count: FieldValue.increment(1)
      });

      // Notify referrer
      await sendTelegramMessage(
        validRef,
        `🎉 <b>New Referral!</b> <b>${first_name || 'A friend'}</b> joined using your invite link!\n\n` +
        `💰 You will earn <b>10% commission (+1.00 PTS)</b> every time they watch an ad!`
      );
    }
  }

  // Create standard user if doesn't exist
  if (!doc.exists && !userData) {
    userData = {
      telegram_id: tid,
      first_name: first_name || '',
      username: username || '',
      balance: 0.00,
      ads_watched: 0,
      invited_count: 0,
      referral_earnings: 0.00,
      referred_by: null,
      welcome_sent: false,
      created_at: new Date().toISOString()
    };
    await userRef.set(userData);
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
