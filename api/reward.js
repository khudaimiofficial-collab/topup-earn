import { db, FieldValue } from '../lib/firebase.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { telegram_id, first_name, username } = req.body || {};
  if (!telegram_id) return res.status(400).json({ error: 'Missing telegram_id' });

  const userRef = db.collection('users').doc(String(telegram_id));

  // Atomic increment safely adds 10 PTS and 1 ad count
  await userRef.set({
    telegram_id: String(telegram_id),
    first_name: first_name || '',
    username: username || '',
    balance: FieldValue.increment(10.00),
    ads_watched: FieldValue.increment(1)
  }, { merge: true });

  const updatedDoc = await userRef.get();
  const data = updatedDoc.data();

  return res.status(200).json({
    status: 'success',
    balance: Number(data.balance),
    ads_watched: Number(data.ads_watched)
  });
}