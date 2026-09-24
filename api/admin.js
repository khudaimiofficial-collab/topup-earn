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
        min_withdraw: 50.00,
        website_url: 'https://automaticgametopup.iceiy.com',
        banner_url: 'https://images.unsplash.com/photo-1542751371-adc38448a05e?w=800&q=80'
      });
    }

    const snapshot = await db.collection('withdrawals').orderBy('created_at', 'desc').limit(50).get();
    const list = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    return res.status(200).json({ withdrawals: list });
  }

  // Handle POST
  if (req.method === 'POST') {
    const { action } = req.body || {};

    // 1. Activate Telegram Webhook Server-Side
    if (action === 'set_webhook') {
      const configDoc = await db.collection('settings').doc('config').get();
      const botToken = configDoc.exists ? configDoc.data().bot_token : process.env.BOT_TOKEN;

      if (!botToken) {
        return res.status(400).json({ error: 'Please save your Bot Token first!' });
      }

      const host = req.headers.host;
      const protocol = req.headers['x-forwarded-proto'] || 'https';
      const webhookUrl = `${protocol}://${host}/api/webhook`;

      try {
        const tgRes = await fetch(`https://api.telegram.org/bot${botToken}/setWebhook?url=${encodeURIComponent(webhookUrl)}`);
        const tgData = await tgRes.json();

        if (tgData.ok) {
          return res.status(200).json({ success: true, message: 'Webhook activated successfully! /start will now reply instantly.' });
        } else {
          return res.status(400).json({ error: tgData.description || 'Telegram rejected webhook' });
        }
      } catch (err) {
        return res.status(500).json({ error: 'Failed to contact Telegram API' });
      }
    }

    // 2. Save App Configuration
    if (action === 'save_settings') {
      const { bot_token, channel_id, min_withdraw, website_url, banner_url } = req.body;
      await db.collection('settings').doc('config').set({
        bot_token: bot_token || '',
        channel_id: channel_id || '',
        min_withdraw: Number(min_withdraw) || 50.00,
        website_url: website_url || 'https://automaticgametopup.iceiy.com',
        banner_url: banner_url || 'https://images.unsplash.com/photo-1542751371-adc38448a05e?w=800&q=80',
        updated_at: new Date().toISOString()
      }, { merge: true });

      return res.status(200).json({ success: true, message: 'Settings saved successfully!' });
    }

    // 3. Approve or Reject Withdrawal
    const { id } = req.body;
    const withdrawDoc = await db.collection('withdrawals').doc(id).get();
    if (!withdrawDoc.exists) {
      return res.status(404).json({ error: 'Withdrawal not found' });
    }

    const requestData = withdrawDoc.data();
    const status = action === 'approve' ? 'approved' : 'rejected';

    await db.collection('withdrawals').doc(id).update({ status });

    if (action === 'approve') {
      const approveText = `✅ <b>WITHDRAWAL APPROVED!</b> ✅\n\n` +
        `🎉 Your withdrawal of <b>${Number(requestData.points).toFixed(2)} PTS</b> for <code>${requestData.email}</code> has been approved!\n\n` +
        `🌐 Credits have been added on <b>automaticgametopup.iceiy.com</b>.`;
      await sendTelegramMessage(requestData.telegram_id, approveText);
    } else if (action === 'reject') {
      // Refund points
      await db.collection('users').doc(requestData.telegram_id).update({
        balance: FieldValue.increment(Number(requestData.points))
      });

      const rejectText = `❌ <b>WITHDRAWAL REJECTED</b> ❌\n\n` +
        `Your withdrawal request of <b>${Number(requestData.points).toFixed(2)} PTS</b> for <code>${requestData.email}</code> was declined.\n\n` +
        `🔄 <b>Your points have been refunded to your balance!</b>`;
      await sendTelegramMessage(requestData.telegram_id, rejectText);
    }

    return res.status(200).json({ success: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
