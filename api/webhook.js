import { db, FieldValue, getBotConfig, sendTelegramMessage } from '../lib/firebase.js';

export default async function handler(req, res) {
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

  // Handle /start and /start <referrer_id>
  if (text.startsWith('/start')) {
    const { botToken, minWithdraw } = await getBotConfig();

    if (!botToken) {
      return res.status(200).send('OK');
    }

    // 1. EXTRACT REFERRER ID (e.g. from "/start 8960497898")
    const parts = text.split(' ');
    const referrerId = (parts.length > 1 && parts[1].trim()) ? parts[1].trim() : null;

    // 2. REGISTER USER & ATTACH REFERRAL
    if (chatId) {
      const tid = String(chatId);
      const userRef = db.collection('users').doc(tid);
      const doc = await userRef.get();

      if (!doc.exists) {
        let validReferrer = null;

        // Check if referrer exists and is not self-referral
        if (referrerId && referrerId !== tid) {
          const refDoc = await db.collection('users').doc(referrerId).get();
          if (refDoc.exists) {
            validReferrer = referrerId;

            // Increment referrer's invited count
            await db.collection('users').doc(referrerId).update({
              invited_count: FieldValue.increment(1)
            });

            // Send instant celebration message to the referrer
            await sendTelegramMessage(
              referrerId,
              `🎉 <b>New Referral!</b> <b>${user?.first_name || 'A friend'}</b> joined using your invite link!\n\n` +
              `💰 You will earn <b>10% commission (+1.00 PTS)</b> every time they watch an ad!`
            );
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
          welcome_sent: true,
          created_at: new Date().toISOString()
        });
      }
    }

    // 3. SEND WELCOME BANNER & LAUNCH BUTTON
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
      `🌐 Direct account balance top-up to <b>automaticgametopup.iceiy.com</b>!\n\n` +
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
