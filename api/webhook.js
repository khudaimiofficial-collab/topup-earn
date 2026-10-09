// topup-earn-main/api/webhook.js
import admin from "firebase-admin";

// Safe Firebase Admin Init
let db = null;
try {
  if (!admin.apps.length) {
    if (process.env.FIREBASE_SERVICE_ACCOUNT) {
      admin.initializeApp({
        credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT))
      });
    } else {
      admin.initializeApp({
        credential: admin.credential.applicationDefault()
      });
    }
  }
  db = admin.firestore();
} catch (e) {
  console.warn("Firebase init failed or missing credentials:", e.message);
}

const WEBAPP_URL = "https://pheizubot.vercel.app";

export default async function handler(req, res) {
  // Telegram requires POST
  if (req.method !== "POST") {
    return res.status(200).send("Telegram Webhook is online.");
  }

  const update = req.body;
  if (!update || !update.message) {
    return res.status(200).send("OK");
  }

  const message = update.message;
  const chatId = message.chat.id;
  const text = message.text || "";
  const fromUser = message.from || {};

  // Get Bot Token from environment
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) {
    console.error("TELEGRAM_BOT_TOKEN is missing in Vercel Environment Variables!");
    return res.status(200).send("OK");
  }

  // Handle /start command
  if (text.startsWith("/start")) {
    const parts = text.split(" ");
    const referrerId = parts.length > 1 ? parts[1].trim() : null;

    // 1. DISPATCH WELCOME MESSAGE FIRST (Guaranteed Delivery)
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

    try {
      const tgRes = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const tgData = await tgRes.json();
      if (!tgData.ok) {
        console.error("Telegram API Error:", tgData.description);
      }
    } catch (sendErr) {
      console.error("Failed to send Telegram message:", sendErr);
    }

    // 2. SAVE USER TO DATABASE IN BACKGROUND (Won't block message delivery if it fails)
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
        console.error("Firestore background registration error:", dbErr);
      }
    }
  }

  // Always respond with 200 to acknowledge receipt to Telegram
  return res.status(200).send("OK");
}
