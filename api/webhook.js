// topup-earn-main/api/webhook.js
import admin from "firebase-admin";

// Initialize Firebase Admin SDK
if (!admin.apps.length) {
  try {
    if (process.env.FIREBASE_SERVICE_ACCOUNT) {
      admin.initializeApp({
        credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT))
      });
    } else {
      admin.initializeApp({
        credential: admin.credential.applicationDefault()
      });
    }
  } catch (e) {
    console.error("Firebase init error in webhook.js:", e);
  }
}

const db = admin.firestore();

// Production Domain for WebApp Launch
const WEBAPP_URL = "https://pheizubot.vercel.app";

export default async function handler(req, res) {
  // Telegram sends updates via POST
  if (req.method !== "POST") {
    return res.status(200).send("Telegram Webhook for @pheizu_wallet is active.");
  }

  const update = req.body;
  if (!update || !update.message) {
    return res.status(200).send("OK");
  }

  const message = update.message;
  const chatId = message.chat.id;
  const text = message.text || "";
  const fromUser = message.from || {};

  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) {
    console.error("Missing TELEGRAM_BOT_TOKEN environment variable!");
    return res.status(200).send("OK");
  }

  // Intercept the /start command
  if (text.startsWith("/start")) {
    const parts = text.split(" ");
    const referrerId = parts.length > 1 ? parts[1].trim() : null;

    try {
      const todayStr = new Date().toISOString().slice(0, 10);
      const userRef = db.collection("users").doc(String(fromUser.id));
      const userDoc = await userRef.get();

      // 1. Register new user in Firestore if they don't exist
      if (!userDoc.exists) {
        await userRef.set({
          telegram_id: String(fromUser.id),
          first_name: fromUser.first_name || "Friend",
          username: fromUser.username || "",
          balance: 0.0,
          ads_watched: 0,
          today_ads_watched: 0,
          last_ad_date: todayStr,
          invited_count: 0,
          referral_earnings: 0.0,
          referrer_id: referrerId && referrerId !== String(fromUser.id) ? referrerId : null,
          channel_joined: true,
          created_at: new Date().toISOString()
        });

        // If referred by someone, increment referrer's count
        if (referrerId && referrerId !== String(fromUser.id)) {
          const refUserRef = db.collection("users").doc(String(referrerId));
          await refUserRef.update({
            invited_count: admin.firestore.FieldValue.increment(1)
          }).catch(() => {});
        }
      }

      // 2. Build Welcome Message with inline WebApp button
      const welcomeText = 
        `👋 *Welcome to Free Gram Token, ${fromUser.first_name || "Friend"}!*\n\n` +
        `💎 *Earn Gram Tokens* easily by watching short sponsored ads.\n\n` +
        `⚡ *Instant On-Chain Withdrawals*\n` +
        `🎁 *+10 PTS* per ad watched\n` +
        `👥 *10% Lifetime Bonus* on all friends you invite\n\n` +
        `👇 Tap the button below to launch the app and start earning:`;

      const payload = {
        chat_id: chatId,
        text: welcomeText,
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: "🚀 Open Free Gram App",
                web_app: { url: WEBAPP_URL }
              }
            ],
            [
              {
                text: "📢 Official Channel",
                url: "https://t.me/KhudaimiOfficialStore"
              }
            ]
          ]
        }
      };

      await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

    } catch (err) {
      console.error("Error processing /start in webhook.js:", err);
    }
  }

  // Always return 200 OK so Telegram doesn't retry delivery
  return res.status(200).send("OK");
}
