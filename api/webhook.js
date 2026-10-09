// topup-earn-main/api/webhook.js
import admin from "firebase-admin";

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
const WEBAPP_URL = "https://pheizubot.vercel.app";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(200).send("✅ Webhook is online and ready!");
  }

  const update = req.body;
  if (!update || !update.message) {
    return res.status(200).send("OK");
  }

  const message = update.message;
  const chatId = message.chat.id;
  const text = (message.text || "").trim();
  const fromUser = message.from || {};

  // Loaded securely from environment variables (hidden from public code)
  const botToken = process.env.TELEGRAM_BOT_TOKEN;

  if (!botToken) {
    console.error("TELEGRAM_BOT_TOKEN is missing in Vercel Environment Variables!");
    return res.status(200).send("OK");
  }

  if (text.startsWith("/start")) {
    const parts = text.split(" ");
    const referrerId = parts.length > 1 ? parts[1].trim() : null;

    // Send Welcome Message & Button
    const welcomeText = 
      `👋 *Welcome to Free Gram Token, ${fromUser.first_name || "Friend"}!*\n\n` +
      `💎 *Earn Gram Tokens* easily by watching short sponsored ads.\n\n` +
      `⚡ *Instant On-Chain Withdrawals*\n` +
      `🎁 *+10 PTS* per ad watched\n` +
      `👥 *10% Lifetime Bonus* on all friends you invite\n\n` +
      `👇 Tap the button below to launch the app:`;

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

    try {
      const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const result = await response.json();
      console.log("Telegram sendMessage response:", result);
    } catch (err) {
      console.error("Error dispatching Telegram message:", err);
    }

    // Register user in background Firestore if db is available
    if (db) {
      try {
        const todayStr = new Date().toISOString().slice(0, 10);
        const userRef = db.collection("users").doc(String(fromUser.id));
        const userDoc = await userRef.get();

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

          if (referrerId && referrerId !== String(fromUser.id)) {
            const refUserRef = db.collection("users").doc(String(referrerId));
            await refUserRef.update({
              invited_count: admin.firestore.FieldValue.increment(1)
            }).catch(() => {});
          }
        }
      } catch (dbErr) {
        console.error("Firestore user registration note:", dbErr);
      }
    }
  }

  return res.status(200).send("OK");
}
