import { db, FieldValue, sendTelegramMessage } from '../lib/firebase.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { telegram_id, first_name, username } = req.body || {};
  if (!telegram_id) return res.status(400).json({ error: 'Missing telegram_id' });

  const tid = String(telegram_id);
  const userRef = db.collection('users').doc(tid);

  // Increment points and ad count atomically
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

  // 📩 Send Point Earned Message directly to User
  const earnText = `⚡ *Reward Credited!* ⚡\n\n` +
    `🎉 You watched an ad and received *+10.00 PTS*!\n` +
    `💰 *Current Balance:* \`${newBalance.toFixed(2)} PTS\`\n` +
    `🎯 Reach 50 PTS to withdraw to *automaticgametopup.iceiy.com*!`;

  await sendTelegramMessage(tid, earnText);

  return res.status(200).json({
    status: 'success',
    balance: newBalance,
    ads_watched: Number(data.ads_watched)
  });
}
