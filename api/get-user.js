import { db } from '../lib/firebase.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { telegram_id, first_name, username } = req.body || {};
  if (!telegram_id) return res.status(400).json({ error: 'Missing telegram_id' });

  const userRef = db.collection('users').doc(String(telegram_id));
  const doc = await userRef.get();

  if (!doc.exists) {
    const newUser = {
      telegram_id: String(telegram_id),
      first_name: first_name || '',
      username: username || '',
      balance: 0.00,
      ads_watched: 0,
      created_at: new Date().toISOString()
    };
    await userRef.set(newUser);
    return res.status(200).json({ status: 'success', balance: 0.00, ads_watched: 0 });
  }

  const userData = doc.data();
  return res.status(200).json({
    status: 'success',
    balance: Number(userData.balance || 0),
    ads_watched: Number(userData.ads_watched || 0)
  });
}