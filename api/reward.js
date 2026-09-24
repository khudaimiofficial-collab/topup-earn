import { db, FieldValue, getBotConfig, sendTelegramMessage } from '../lib/firebase.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { telegram_id, first_name, username } = req.body || {};
  if (!telegram_id) return res.status(400).json({ error: 'Missing telegram_id' });

  const tid = String(telegram_id);
  const userRef = db.collection('users').doc(tid);

  // 1. Credit the user +10.00 PTS
  await userRef.set({
    telegram_id: tid,
    first_name: first_name || '',
    username: username || '',
    balance: FieldValue.increment(10.00),
    ads_watched: FieldValue.increment(1)
  }, { merge: true });

  const updatedDoc = await userRef.get();
  const data = updatedDoc.data();
  const newBalance = Number(data.balance);

  // 2. 10% REFERRAL COMMISSION: Credit +1.00 PTS to the person who invited them
  if (data.referred_by) {
    const commission = 1.00; // 10% of 10.00 PTS

    await db.collection('users').doc(data.referred_by).update({
      balance: FieldValue.increment(commission),
      referral_earnings: FieldValue.increment(commission)
    });

    // Notify the referrer of their passive earnings
    await sendTelegramMessage(
      data.referred_by,
      `🎁 <b>Referral Commission!</b> You earned <b>+1.00 PTS</b> (10%) because your invited friend watched an ad!`
    );
  }

  const { minWithdraw } = await getBotConfig();

  const earnHtml = `⚡ <b>Reward Credited!</b> ⚡\n\n` +
    `🎉 You earned <b>+10.00 PTS</b>!\n` +
    `💰 <b>Total Balance:</b> <code>${newBalance.toFixed(2)} PTS</code>\n` +
    `🎯 Reach ${minWithdraw.toFixed(2)} PTS to withdraw on <b>automaticgametopup.iceiy.com</b>!`;

  await sendTelegramMessage(tid, earnHtml);

  return res.status(200).json({
    status: 'success',
    balance: newBalance,
    ads_watched: Number(data.ads_watched),
    min_withdraw: minWithdraw
  });
}
