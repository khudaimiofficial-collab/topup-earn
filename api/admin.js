import { db } from '../lib/firebase.js';

export default async function handler(req, res) {
  const adminSecret = req.headers['x-admin-secret'];
  if (adminSecret !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // 1. GET Requests: Load withdrawals or load settings
  if (req.method === 'GET') {
    const type = req.query.type;

    if (type === 'settings') {
      const doc = await db.collection('settings').doc('config').get();
      return res.status(200).json(doc.exists ? doc.data() : {
        bot_token: process.env.BOT_TOKEN || '',
        channel_id: process.env.CHANNEL_ID || '@KhudaimiOfficialStore',
        min_withdraw: 50.00
      });
    }

    // Default: fetch withdrawals
    const snapshot = await db.collection('withdrawals').orderBy('created_at', 'desc').limit(50).get();
    const list = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    return res.status(200).json({ withdrawals: list });
  }

  // 2. POST Requests: Approve/Reject or Save Settings
  if (req.method === 'POST') {
    const { action } = req.body || {};

    if (action === 'save_settings') {
      const { bot_token, channel_id, min_withdraw } = req.body;
      await db.collection('settings').doc('config').set({
        bot_token: bot_token || '',
        channel_id: channel_id || '',
        min_withdraw: Number(min_withdraw) || 50.00,
        updated_at: new Date().toISOString()
      }, { merge: true });

      return res.status(200).json({ success: true, message: 'Settings saved successfully!' });
    }

    // Default: Handle withdrawal approval/rejection
    const { id } = req.body;
    const status = action === 'approve' ? 'approved' : 'rejected';
    await db.collection('withdrawals').doc(id).update({ status });
    return res.status(200).json({ success: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}