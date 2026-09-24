import crypto from 'crypto';
import { db, FieldValue, sendTelegramMessage } from '../lib/firebase.js';

const ADMIN_TELEGRAM_ID = '8960497898';

export default async function handler(req, res) {
  // 1. PUBLIC ACTION: Send OTP
  if (req.method === 'POST' && req.body?.action === 'send_otp') {
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = Date.now() + 5 * 60 * 1000;

    await db.collection('settings').doc('admin_auth').set({
      otp,
      expires_at: expiresAt
    }, { merge: true });

    const message = `🔐 <b>Admin Login OTP</b>\n\n` +
                    `Your one-time login code is: <code>${otp}</code>\n\n` +
                    `⏳ Valid for 5 minutes. Do not share this code.`;

    const sent = await sendTelegramMessage(ADMIN_TELEGRAM_ID, message);

    if (sent) {
      return res.status(200).json({ success: true, message: 'OTP sent to your Telegram account!' });
    } else {
      return res.status(500).json({ error: 'Failed to send OTP. Ensure you started @AdBoostEarningBot.' });
    }
  }

  // 2. PUBLIC ACTION: Verify OTP
  if (req.method === 'POST' && req.body?.action === 'verify_otp') {
    const { otp } = req.body;
    const doc = await db.collection('settings').doc('admin_auth').get();

    if (!doc.exists) {
      return res.status(400).json({ error: 'No OTP requested. Please click Send OTP.' });
    }

    const data = doc.data();

    if (!data.otp || data.otp !== String(otp).trim()) {
      return res.status(400).json({ error: 'Incorrect OTP code.' });
    }

    if (Date.now() > data.expires_at) {
      return res.status(400).json({ error: 'OTP has expired. Please request a new one.' });
    }

    const sessionToken = crypto.randomBytes(32).toString('hex');

    await db.collection('settings').doc('admin_auth').set({
      session_token: sessionToken,
      otp: null,
      expires_at: null,
      authenticated_at: new Date().toISOString()
    }, { merge: true });

    return res.status(200).json({ success: true, session_token: sessionToken });
  }

  // ============================================================
  // AUTHENTICATION CHECK
  // ============================================================
  const clientToken = req.headers['x-admin-token'];
  const clientSecret = req.headers['x-admin-secret'];

  let isAuthorized = false;

  if (clientToken) {
    const authDoc = await db.collection('settings').doc('admin_auth').get();
    if (authDoc.exists && authDoc.data().session_token === clientToken) {
      isAuthorized = true;
    }
  }

  if (!isAuthorized && clientSecret && clientSecret === process.env.ADMIN_PASSWORD) {
    isAuthorized = true;
  }

  if (!isAuthorized) {
    return res.status(401).json({ error: 'Unauthorized. Please log in.' });
  }

  // ============================================================
  // PROTECTED GET REQUESTS
  // ============================================================
  if (req.method === 'GET') {
    const type = req.query.type;

    // Load Settings
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

    // Load Users
    if (type === 'users') {
      const searchQuery = (req.query.search || '').trim().toLowerCase();
      const snapshot = await db.collection('users').limit(150).get();
      let users = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

      if (searchQuery) {
        users = users.filter(u => 
          (u.telegram_id && u.telegram_id.toLowerCase().includes(searchQuery)) ||
          (u.username && u.username.toLowerCase().includes(searchQuery)) ||
          (u.first_name && u.first_name.toLowerCase().includes(searchQuery))
        );
      }

      users.sort((a, b) => Number(b.balance || 0) - Number(a.balance || 0));
      return res.status(200).json({ users });
    }

    // Default: Load Withdrawals
    const snapshot = await db.collection('withdrawals').orderBy('created_at', 'desc').limit(50).get();
    const list = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    return res.status(200).json({ withdrawals: list });
  }

  // ============================================================
  // PROTECTED POST REQUESTS
  // ============================================================
  if (req.method === 'POST') {
    const { action } = req.body || {};

    // 1. ADD NEW USER
    if (action === 'add_user') {
      const { telegram_id, first_name, username, balance } = req.body;
      if (!telegram_id) {
        return res.status(400).json({ error: 'Telegram ID is required' });
      }

      const tid = String(telegram_id).trim();
      const userRef = db.collection('users').doc(tid);
      const existing = await userRef.get();

      if (existing.exists) {
        return res.status(400).json({ error: 'User with this Telegram ID already exists' });
      }

      await userRef.set({
        telegram_id: tid,
        first_name: first_name || 'User',
        username: username ? username.replace('@', '').trim() : '',
        balance: Number(balance) || 0.00,
        ads_watched: 0,
        invited_count: 0,
        referral_earnings: 0.00,
        referred_by: null,
        referral_verified: true,
        welcome_sent: true,
        created_at: new Date().toISOString()
      });

      return res.status(200).json({ success: true, message: 'User added successfully!' });
    }

    // 2. DELETE USER
    if (action === 'delete_user') {
      const { telegram_id } = req.body;
      if (!telegram_id) return res.status(400).json({ error: 'Telegram ID is required' });

      const tid = String(telegram_id).trim();
      await db.collection('users').doc(tid).delete();

      return res.status(200).json({ success: true, message: 'User deleted permanently!' });
    }

    // 3. EDIT USER BALANCE
    if (action === 'edit_balance') {
      const { telegram_id, new_balance } = req.body;
      if (!telegram_id || isNaN(new_balance)) {
        return res.status(400).json({ error: 'Valid user ID and balance required' });
      }

      const bal = Number(new_balance);
      await db.collection('users').doc(String(telegram_id)).update({ balance: bal });

      await sendTelegramMessage(
        String(telegram_id),
        `⚠️ <b>Account Balance Updated</b>\n\nYour points balance was modified by the admin to <b>${bal.toFixed(2)} PTS</b>.`
      );

      return res.status(200).json({ success: true, message: 'Balance updated successfully!' });
    }

    // 4. TOGGLE BAN
    if (action === 'toggle_ban') {
      const { telegram_id } = req.body;
      const userRef = db.collection('users').doc(String(telegram_id));
      const doc = await userRef.get();

      if (!doc.exists) return res.status(404).json({ error: 'User not found' });

      const currentBan = Boolean(doc.data().is_banned);
      const newBan = !currentBan;

      await userRef.update({ is_banned: newBan });

      if (newBan) {
        await sendTelegramMessage(String(telegram_id), `🚫 <b>Account Suspended</b>\n\nYour account has been banned by the administrator.`);
      } else {
        await sendTelegramMessage(String(telegram_id), `🟢 <b>Account Restored</b>\n\nYour ban has been lifted by the administrator.`);
      }

      return res.status(200).json({ success: true, is_banned: newBan });
    }

    // 5. ACTIVATE WEBHOOK
    if (action === 'set_webhook') {
      const configDoc = await db.collection('settings').doc('config').get();
      const botToken = configDoc.exists ? configDoc.data().bot_token : process.env.BOT_TOKEN;

      if (!botToken) return res.status(400).json({ error: 'Please save Bot Token first!' });

      const host = req.headers.host;
      const protocol = req.headers['x-forwarded-proto'] || 'https';
      const webhookUrl = `${protocol}://${host}/api/webhook`;

      try {
        const tgRes = await fetch(`https://api.telegram.org/bot${botToken}/setWebhook?url=${encodeURIComponent(webhookUrl)}`);
        const tgData = await tgRes.json();
        if (tgData.ok) {
          return res.status(200).json({ success: true, message: 'Webhook activated successfully!' });
        } else {
          return res.status(400).json({ error: tgData.description });
        }
      } catch (err) {
        return res.status(500).json({ error: 'Failed to contact Telegram API' });
      }
    }

    // 6. SAVE SETTINGS
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

      return res.status(200).json({ success: true, message: 'Settings saved!' });
    }

    // 7. APPROVE OR REJECT WITHDRAWAL
    const { id } = req.body;
    const withdrawDoc = await db.collection('withdrawals').doc(id).get();
    if (!withdrawDoc.exists) return res.status(404).json({ error: 'Withdrawal not found' });

    const requestData = withdrawDoc.data();
    const status = action === 'approve' ? 'approved' : 'rejected';

    await db.collection('withdrawals').doc(id).update({ status });

    const configDoc = await db.collection('settings').doc('config').get();
    const channelId = (configDoc.exists && configDoc.data().channel_id)
      ? configDoc.data().channel_id
      : (process.env.CHANNEL_ID || '@KhudaimiOfficialStore');

    if (action === 'approve') {
      const approveText = `✅ <b>WITHDRAWAL APPROVED!</b> ✅\n\n` +
        `🎉 Your withdrawal of <b>${Number(requestData.points).toFixed(2)} PTS</b> for <code>${requestData.email}</code> has been approved!\n\n` +
        `🌐 Credits have been added on <b>automaticgametopup.iceiy.com</b>.`;
      await sendTelegramMessage(requestData.telegram_id, approveText);

      const emailParts = requestData.email.split('@');
      const maskedEmail = emailParts[0].length > 2 
        ? `${emailParts[0].slice(0, 2)}***@${emailParts[1]}` 
        : requestData.email;

      const channelProofText = `🎉 <b>WITHDRAWAL PAID & APPROVED!</b> 🎉\n\n` +
        `👤 <b>User ID:</b> <code>${requestData.telegram_id}</code>\n` +
        `💰 <b>Amount:</b> <b>${Number(requestData.points).toFixed(2)} PTS</b>\n` +
        `📧 <b>Account:</b> <code>${maskedEmail}</code>\n` +
        `🌐 <b>Store:</b> automaticgametopup.iceiy.com\n` +
        `⚡ <b>Status:</b> 🟢 Successfully Credited\n\n` +
        `🚀 Play and earn free top-ups on @AdBoostEarningBot!`;

      await sendTelegramMessage(channelId, channelProofText);
    } else if (action === 'reject') {
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
