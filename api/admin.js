import { db, FieldValue, sendTelegramMessage } from '../lib/firebase.js';

export default async function handler(req, res) {
  const adminSecret = req.headers['x-admin-secret'];
  if (adminSecret !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // Handle GET (Settings or Withdrawals list)
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

    const snapshot = await db.collection('withdrawals').orderBy('created_at', 'desc').limit(50).get();
    const list = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    return res.status(200).json({ withdrawals: list });
  }

  // Handle POST (Approve/Reject or Save Settings)
  if (req.method === 'POST') {
    const { action } = req.body || {};

    // 1. Save Settings
    if (action === 'save_settings') {
      const { bot_token, channel_id, min_withdraw } = req.body;
      await db.collection('settings').doc('config').set({
        bot_token: bot_token || '',
        channel_id: channel_id || '',
        min_withdraw: Number(min_withdraw) || 50.00,
        updated_at: new Date().toISOString()
      }, { merge: true });

      return res.status(200).json({ success: true, message: 'Settings saved!' });
    }

    // 2. Approve or Reject Withdrawal
    const { id } = req.body;
    const withdrawDoc = await db.collection('withdrawals').doc(id).get();
    if (!withdrawDoc.exists) {
      return res.status(404).json({ error: 'Withdrawal not found' });
    }

    const requestData = withdrawDoc.data();
    const status = action === 'approve' ? 'approved' : 'rejected';

    // Update status in Firestore
    await db.collection('withdrawals').doc(id).update({ status });

    if (action === 'approve') {
      // 📩 Send Approval message to User
      const approveText = `✅ *WITHDRAWAL APPROVED!* ✅\n\n` +
        `🎉 Great news! Your withdrawal request has been approved by the admin.\n\n` +
        `💰 *Points Claimed:* ${Number(requestData.points).toFixed(2)} PTS\n` +
        `📧 *Account Email:* \`${requestData.email}\`\n` +
        `🌐 *Store:* automaticgametopup.iceiy.com\n\n` +
        `Your website credits have been added! Thank you for playing.`;

      await sendTelegramMessage(requestData.telegram_id, approveText);

    } else if (action === 'reject') {
      // Refund points back to user balance if rejected
      await db.collection('users').doc(requestData.telegram_id).update({
        balance: FieldValue.increment(Number(requestData.points))
      });

      // 📩 Send Rejection & Refund message to User
      const rejectText = `❌ *WITHDRAWAL REJECTED* ❌\n\n` +
        `Your withdrawal request of *${Number(requestData.points).toFixed(2)} PTS* for email \`${requestData.email}\` was declined.\n\n` +
        `🔄 *Your points have been refunded back to your balance!* Please check that your email exists on automaticgametopup.iceiy.com and try again.`;

      await sendTelegramMessage(requestData.telegram_id, rejectText);
    }

    return res.status(200).json({ success: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
