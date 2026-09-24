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
    const config = (await getBotConfig()) || {};
    const botToken = config.botToken || config.bot_token;
    const channelId = config.channelId || config.channel_id || '@KhudaimiOfficialStore';
    const minWithdraw = Number(config.minWithdraw || config.min_withdraw || 50);
    
    // 1. DYNAMIC BANNER FROM ADMIN SETTINGS
    const bannerUrl = (config.bannerUrl || config.banner_url || '').trim() || 
      'https://images.unsplash.com/photo-1542751371-adc38448a05e?w=800&q=80';

    if (!botToken) {
      return res.status(200).send('OK');
    }

    // 2. EXTRACT REFERRER ID (e.g. from "/start 8960497898")
    const parts = text.split(' ');
    const referrerId = (parts.length > 1 && parts[1].trim()) ? parts[1].trim() : null;

    // 3. REGISTER USER (Keep unverified until app launch + channel join)
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
          referral_verified: false,
          welcome_sent: true,
          created_at: new Date().toISOString()
        });
      }
    }

    // 4. GET LIVE BOT NAME FOR {title}
    let botTitle = "Free Top-Up & Game Credits";
    try {
      const getMeRes = await fetch(`https://api.telegram.org/bot${botToken}/getMe`);
      const getMe = await getMeRes.json();
      if (getMe.ok && getMe.result?.first_name) {
        botTitle = getMe.result.first_name;
      }
    } catch (e) {
      console.warn("Could not fetch bot name:", e);
    }

    // 5. MINI APP URL (WITH REFERRAL CODE IF PRESENT)
    const appBaseUrl = 'https://pheizubot.vercel.app';
    const webAppUrl = referrerId 
      ? `${appBaseUrl}/index.html?startapp=${referrerId}` 
      : `${appBaseUrl}/index.html`;

    // 6. WELCOME CAPTION WITH DYNAMIC {title}
    const caption = `👋 <b>Welcome to ${botTitle}!</b>\n\n` +
      `⛏️ <b>Earn Free Game Credits & Top-Up:</b>\n` +
      `⚡ Watch video ads to earn <b>+10.00 PTS</b> each.\n` +
      `👥 Invite friends to earn <b>10% lifetime commission</b>!\n` +
      `🎯 Minimum withdrawal: <b>${minWithdraw.toFixed(2)} PTS</b>.\n` +
      `📢 <i>Make sure to join ${channelId} to activate your account!</i>\n\n` +
      `Click below to launch the Mini App:`;

    // 7. BUTTON REPLACED: ONLY "Launch Mini App"
    const replyMarkup = {
      inline_keyboard: [
        [
          {
            text: '🚀 Launch Mini App',
            web_app: { url: webAppUrl }
          }
        ]
      ]
    };

    const payload = {
      chat_id: chatId,
      photo: bannerUrl,
      caption: caption,
      parse_mode: 'HTML',
      reply_markup: replyMarkup
    };

    try {
      const photoRes = await fetch(`https://api.telegram.org/bot${botToken}/sendPhoto`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const photoData = await photoRes.json();

      // Fallback: If banner photo URL fails or is rejected by Telegram, send message without failing
      if (!photoData.ok) {
        await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text: caption,
            parse_mode: 'HTML',
            reply_markup: replyMarkup
          })
        });
      }
    } catch (err) {
      console.error('Error sending start message:', err);
    }
  }

  return res.status(200).send('OK');
}
