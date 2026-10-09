// topup-earn-main/api/webhook.js
import admin from "firebase-admin";

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
  console.warn("Firebase init note:", e.message);
}

const WEBAPP_URL = "https://pheizubot.vercel.app";

export default async function handler(req, res) {
  // If visited in browser
  if (req.method !== "POST") {
    return res.status(200).send("✅ Webhook is online and ready!");
  }

  const body = req.body || {};

  // 1. RECEIVE & SAVE BOT TOKEN FROM ADMIN PANEL (No extra files needed!)
  if (body.action === "save_admin_config") {
    if (db && body.bot_token) {
      try {
        await db.collection("app_config").doc("main").set({
          bot_token: String(body.bot_token).trim(),
          log_channel: String(body.log_channel || "@pheizu_wallet").trim(),
          withdraw_fee: Number(body.withdraw_fee || 0.002),
          updated_at: new Date().toISOString()
        }, { merge: true });
        return res.status(200).json({ status: "success", message: "Token saved to cloud database!" });
      } catch (err) {
        return res.status(500).json({ status: "error", message: err.message });
      }
    }
    return res.status(200).json({ status: "ok" });
  }

  // 2. INCOMING TELEGRAM UPDATES
  const message = body.message;
  if (!message) {
    return res.status(200).send("OK");
  }

  const chatId = message.chat.id;
  const text = (message.text || "").trim();
  const fromUser = message.from || {};

  // Get Bot Token: Checks Environment Variable first, then Cloud Database
  let botToken = (process.env.TELEGRAM_BOT_TOKEN || "").trim();

  if (!botToken && db) {
    try {
      const cfgDoc = await db.collection("app_config").doc("main").get();
      if (cfgDoc.exists && cfgDoc.data()?.bot_token) {
        botToken = cfgDoc.data().bot_token.trim();
      }
    } catch (e) {
      console.warn("Error reading bot token from DB:", e);
    }
  }

  if (!botToken) {
    console.error("❌ Bot Token is missing! Save it in Admin Settings or Vercel Environment.");
    return res.status(200).send("OK");
  }

  // User sends /start
  if (text.startsWith("/start")) {
    const parts = text.split(" ");
    const referrerId = parts.length > 1 ? parts[1].trim() : null;

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
      const tgRes = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const tgData = await tgRes.json();
      console.log("Telegram sendMessage response:", tgData);
    } catch (err) {
      console.error("Error sending Telegram message:", err);
    }

    // Save user to Firestore in background
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
        console.warn("Firestore registration note:", dbErr);
      }
    }
  }

  return res.status(200).send("OK");
}
