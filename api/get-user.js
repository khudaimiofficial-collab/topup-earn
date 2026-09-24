import { db, FieldValue, getBotConfig, sendTelegramMessage, checkChannelMember } from '../lib/firebase.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { telegram_id, first_name, username, referrer_id } = req.body || {};
  if (!telegram_id) return res.status(400).json({ error: 'Missing telegram_id' });

  const tid = String(telegram_id);
  const userRef = db.collection('users').doc(tid);
  const doc = await userRef.get();

  const { botToken, channelId, minWithdraw } = await getBotConfig();

  // 1. Fetch live bot title from Telegram
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

  let userData = doc.exists ? doc.data() : null;

  // 2. Set up user if first time
  if (!userData) {
    let validReferrer = null;
    if (referrer_id && String(referrer_id) !== tid) {
      const refDoc = await db.collection('users').doc(String(referrer_id)).get();
      if (refDoc.exists) validReferrer = String(referrer_id);
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
      referral_verified: false,
      welcome_sent: false,
      created_at: new Date().toISOString()
    };
    await userRef.set(userData);
  } else if (!userData.referred_by && referrer_id && String(referrer_id) !== tid) {
    // Attach referrer if user entered directly through Mini App referral link
    const refDoc = await db.collection('users').doc(String(referrer_id)).get();
    if (refDoc.exists) {
      userData.referred_by = String(referrer_id);
      await userRef.update({ referred_by: userData.referred_by });
    }
  }

  // 3. CHECK CHANNEL MEMBERSHIP
  const isChannelJoined = await checkChannelMember(tid);

  // 4. VERIFY REFERRAL (User launched app + User joined the channel)
  if (isChannelJoined && userData.referred_by && !userData.referral_verified) {
    userData.referral_verified = true;
    await userRef.update({ referral_verified: true });

    // Increment referrer's verified invite counter
    await db.collection('users').doc(userData.referred_by).update({
      invited_count: FieldValue.increment(1)
    });

    // Notify the referrer of the successful verification
    await sendTelegramMessage(
      userData.referred_by,
      `🎉 <b>Referral Verified!</b> <b>${first_name || 'A friend'}</b> joined the channel and opened the app!\n\n` +
      `💰 You will now earn <b>10% commission (+1.00 PTS)</b> on every ad they watch!`
    );
  }

  return res.status(200).json({
    status: 'success',
    balance: Number(userData.balance || 0),
    ads_watched: Number(userData.ads_watched || 0),
    invited_count: Number(userData.invited_count || 0),
    referral_earnings: Number(userData.referral_earnings || 0),
    channel_joined: isChannelJoined,
    channel_id: channelId,
    min_withdraw: minWithdraw,
    bot_name: botName
  });
}
