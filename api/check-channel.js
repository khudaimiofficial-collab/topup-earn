import { db, FieldValue, getBotConfig, sendTelegramMessage, checkChannelMember } from '../lib/firebase.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { telegram_id, first_name } = req.body || {};
  if (!telegram_id) {
    return res.status(400).json({ error: 'Missing telegram_id' });
  }

  const tid = String(telegram_id);
  const { channelId } = await getBotConfig();

  // 1. Call Telegram API to check membership
  const isMember = await checkChannelMember(tid);

  if (!isMember) {
    return res.status(200).json({
      joined: false,
      channel_id: channelId,
      message: `You have not joined ${channelId} yet.`
    });
  }

  // 2. If user IS a member, check & verify their referral
  const userRef = db.collection('users').doc(tid);
  const doc = await userRef.get();

  if (doc.exists) {
    const userData = doc.data();

    if (userData.referred_by && !userData.referral_verified) {
      // Mark verified
      await userRef.update({ referral_verified: true });

      // Increment referrer's invited count by 1
      await db.collection('users').doc(userData.referred_by).update({
        invited_count: FieldValue.increment(1)
      });

      // Notify the person who invited them
      await sendTelegramMessage(
        userData.referred_by,
        `🎉 <b>Referral Verified!</b> <b>${first_name || 'A friend'}</b> joined the channel and opened the app!\n\n` +
        `💰 You will now earn <b>10% commission (+1.00 PTS)</b> on every ad they watch!`
      );
    }
  }

  return res.status(200).json({
    joined: true,
    channel_id: channelId,
    message: 'Membership verified successfully!'
  });
}
