// /api/webhook.js
import admin from "firebase-admin";

let db = null;
try {
  if (!admin.apps.length) {
    if (process.env.FIREBASE_SERVICE_ACCOUNT) {
      admin.initializeApp({
        credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT))
      });
    } else {
      admin.initializeApp({ credential: admin.credential.applicationDefault() });
    }
  }
  db = admin.firestore();
  console.log("✅ Firebase ready");
} catch (e) {
  console.warn("⚠️ Firebase init note:", e.message);
}

const WEBAPP_URL = "https://pheizubot.vercel.app";
const DEFAULT_LOG_CHANNEL = "@pheizu_wallet";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(200).send("✅ Webhook is online and ready!");
  }

  const body = req.body || {};
  console.log("📩 Action:", body.action || "telegram_update");

  // ============================================================
  // SAVE ADMIN CONFIG — now saves ALL keys including wallet
  // ============================================================
  if (body.action === "save_admin_config") {
    if (!db) {
      return res.status(500).json({ status: "error", message: "Firestore not initialized" });
    }

    try {
      const payload = {
        updated_at: new Date().toISOString()
      };

      if (body.bot_token !== undefined)      payload.bot_token = String(body.bot_token).trim();
      if (body.log_channel !== undefined)    payload.log_channel = String(body.log_channel).trim();
      if (body.withdraw_fee !== undefined)   payload.withdraw_fee = Number(body.withdraw_fee);
      if (body.min_withdraw !== undefined)   payload.min_withdraw = Number(body.min_withdraw);
      if (body.wallet_address !== undefined) payload.wallet_address = String(body.wallet_address).trim();
      if (body.mnemonic !== undefined)       payload.hot_wallet_mnemonic = String(body.mnemonic).trim();
      if (body.api_key !== undefined)        payload.toncenter_api_key = String(body.api_key).trim();

      await db.collection("app_config").doc("main").set(payload, { merge: true });

      console.log("✅ Config saved to app_config/main");
      return res.status(200).json({ status: "success", message: "Config saved to cloud database!" });
    } catch (err) {
      console.error("❌ Save error:", err);
      return res.status(500).json({ status: "error", message: err.message });
    }
  }

  // ============================================================
  // GET CONFIG — mini app reads fee, min withdraw, banned list
  // ============================================================
  if (body.action === "get_config") {
    const cfg = { withdraw_fee: 0.005, min_withdraw: 5000, wallet_address: "", banned_users: [] };
    try {
      if (db) {
        const doc = await db.collection("app_config").doc("main").get();
        if (doc.exists) {
          const d = doc.data();
          cfg.withdraw_fee = Number(d.withdraw_fee ?? 0.005);
          cfg.min_withdraw = Number(d.min_withdraw ?? 5000);
          cfg.wallet_address = d.wallet_address || "";
        }
        const banned = await db.collection("banned_users").get();
        cfg.banned_users = banned.docs.map(x => x.id);
      }
    } catch (e) {
      console.warn("Config read note:", e.message);
    }
    return res.status(200).json(cfg);
  }

  // ============================================================
  // BAN / UNBAN
  // ============================================================
  if (body.action === "ban_user") {
    if (!db) return res.status(500).json({ status: "error", message: "DB missing" });

    const tid = String(body.telegram_id || "").trim();
    if (!tid) return res.status(400).json({ status: "error", message: "telegram_id required" });

    try {
      if (body.is_banned) {
        await db.collection("banned_users").doc(tid).set({
          telegram_id: tid,
          banned_at: new Date().toISOString()
        });
      } else {
        await db.collection("banned_users").doc(tid).delete().catch(() => {});
      }
      return res.status(200).json({ status: "success", is_banned: Boolean(body.is_banned) });
    } catch (e) {
      return res.status(500).json({ status: "error", message: e.message });
    }
  }

  // ============================================================
  // TELEGRAM UPDATES
  // ============================================================
  const message = body.message;
  if (!message) {
    return res.status(200).send("OK");
  }

  const chatId = message.chat.id;
  const text = (message.text || "").trim();
  const fromUser = message.from || {};

  let botToken = (process.env.TELEGRAM_BOT_TOKEN || "").trim();

  if (!botToken && db) {
    try {
      const cfgDoc = await db.collection("app_config").doc("main").get();
      if (cfgDoc.exists && cfgDoc.data()?.bot_token) {
        botToken = cfgDoc.data().bot_token.trim();
      }
    } catch (e) {
      console.warn("Bot token read note:", e.message);
    }
  }

  if (!botToken) {
    console.error("❌ Bot Token missing.");
    return res.status(200).send("OK");
  }

  if (text.startsWith("/start")) {
    const parts = text.split(" ");
    const referrerId = parts.length > 1 ? parts[1].trim() : null;

    const welcomeText =
      `👋 *Welcome, ${fromUser.first_name || "Friend"}!*\n\n` +
      `💎 *Earn Gram Tokens* by watching short sponsored ads.\n\n` +
      `⚡ *Instant On-Chain Withdrawals*\n` +
      `🎁 *+10 PTS* per ad\n` +
      `👥 *10% Lifetime Bonus* per invite\n\n` +
      `👇 Tap below to launch:`;

    try {
      const tgRes = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text: welcomeText,
          parse_mode: "Markdown",
          reply_markup: {
            inline_keyboard: [
              [{ text: "🚀 Open App", web_app: { url: WEBAPP_URL } }],
              [{ text: "📢 Official Channel", url: "https://t.me/KhudaimiOfficialStore" }]
            ]
          }
        })
      });
      const tgData = await tgRes.json();
      console.log("📤 Telegram response:", tgData.ok ? "OK" : tgData.description);
    } catch (err) {
      console.error("❌ Send error:", err.message);
    }

    // Register user
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
            await db.collection("users").doc(String(referrerId)).update({
              invited_count: admin.firestore.FieldValue.increment(1)
            }).catch(() => {});
          }
        }
      } catch (dbErr) {
        console.warn("Register note:", dbErr.message);
      }
    }
  }

  return res.status(200).send("OK");
}
