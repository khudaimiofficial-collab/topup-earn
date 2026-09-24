import { db, getBotConfig } from '../lib/firebase.js';

export default async function handler(req, res) {
  // Always return 200 OK fast so Telegram doesn't queue duplicate calls
  if (req.method !== 'POST') {
    return res.status(200).send('OK');
  }

  const update = req.body;
  const message = update?.message;

  if (!message || !message.text) {
    return res.status(200).send('OK');
  }

  const chatId = message.chat?.id;
  const text = message.text.trim();
  const user = message.from;

  // Triggers whenever user sends /start or /start <referrer_id>
  if (text.startsWith('/start')) {
    const { botToken, channelId, minWithdraw } = await getBotConfig();

    if (!botToken) {
      return res.status(200).send('OK');
    }

    // 1. EXTRACT REFERRER ID (e.g. from "/start 8960497898")
    const parts = text.split(' ');
    const referrerId = (parts.length > 1 && parts[1].trim()) ? parts[1].trim() : null;

    // 2. REGISTER USER (Keep unverified until app launch + channel join)
    if (chatId) {
      const tid = String(chatId);
      const userRef = db.collection('users').doc(tid);
      const doc = await userRef.get();

      if (!doc.exists) {
        let validReferrer = null;

        // Verify referrer exists and is not self-referral
        if (referrerId && referrerId !== tid) {
          const refDoc = await db.collection('users').doc(referrerId).get();
          if (refDoc.exists) {
            validReferrer = referrerId;
          }
        }

        await userRef.set({
          telegram_id: tid,
          first_name: user?.first_name || '',
          username: user?.username || '',
          balance: 0.00,
          ads_watched: 0,
          invited_count: 0,
          referral_earnings: 0.00,
          referred_by: validReferrer,
          referral_verified: false, // Must open app & join channel to activate!
          welcome_sent: true,
          created_at: new Date().toISOString()
        });
      }
    }

    // 3. SEND WELCOME BANNER & LAUNCH BUTTONS
    const protocol = req.headers['x-forwarded-proto'] || 'https';
    const host = req.headers.host;
    const webAppUrl = `${protocol}://${host}`;
    const websiteStoreUrl = 'https://automaticgametopup.iceiy.com';
    const bannerUrl = 'https://images.unsplash.com/photo-1542751371-adc38448a05e?w=800&q=80';

    const caption = `👋 <b>Welcome to Free Top-Up & Game Credits!</b>\n\n` +
      `⛏️ <b>Earn Free Game Credits & Top-Up:</b>\n` +
      `⚡ Watch video ads to earn <b>+10.00 PTS</b> each.\n` +
      `👥 Invite friends to earn <b>10% lifetime commission</b>!\n` +
      `🎯 Minimum withdrawal: <b>${minWithdraw.toFixed(2)} PTS</b>.\n` +
      `📢 <i>Make sure to join ${channelId} to activate your account!</i>\n\n` +
      `Click below to launch the Mini App or visit our website:`;

    const payload = {
      chat_id: chatId,
      photo: bannerUrl,
      caption: caption,
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: '🚀 Launch Top-Up App',
              web_app: { url: webAppUrl }
            }
          ],
          [
            {
              text: '🌐 Visit Top-Up Website',
              url: websiteStoreUrl
            }
          ]
        ]
      }
    };

    try {
      await fetch(`https://api.telegram.org/bot${botToken}/sendPhoto`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
    } catch (err) {
      console.error('Error sending start message:', err);
    }
  }

  return res.status(200).send('OK');
}
