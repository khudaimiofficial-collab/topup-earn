// /api/bot-info.js
// Combined endpoint:
//   GET /api/bot-info             → JSON { id, name, username, photo_url, subtitle }
//   GET /api/bot-info?avatar=1    → streams the bot avatar image (JPEG)

import admin from "firebase-admin";

if (!admin.apps.length) {
  try {
    if (process.env.FIREBASE_SERVICE_ACCOUNT) {
      admin.initializeApp({
        credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT))
      });
    } else {
      admin.initializeApp({ credential: admin.credential.applicationDefault() });
    }
  } catch (e) {
    console.error("Firebase init error in bot-info:", e);
  }
}

const db = admin.firestore();

// ---------- In-memory cache for the bot avatar file_path ----------
let cachedAvatarPath = null;
let cachedAvatarTime = 0;
const AVATAR_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

async function getBotAvatarPath(BOT_TOKEN, botId) {
  const now = Date.now();
  if (cachedAvatarPath !== null && now - cachedAvatarTime < AVATAR_TTL_MS) {
    return cachedAvatarPath;
  }

  try {
    const pRes = await fetch(
      `https://api.telegram.org/bot${BOT_TOKEN}/getUserProfilePhotos?user_id=${botId}&limit=1`
    );
    const pData = await pRes.json();

    if (pData.ok && pData.result.total_count > 0) {
      const fileId = pData.result.photos[0][0].file_id;
      const fRes = await fetch(
        `https://api.telegram.org/bot${BOT_TOKEN}/getFile?file_id=${fileId}`
      );
      const fData = await fRes.json();
      if (fData.ok && fData.result.file_path) {
        cachedAvatarPath = fData.result.file_path;
        cachedAvatarTime = now;
        return cachedAvatarPath;
      }
    }
  } catch (e) {
    console.warn("Bot avatar fetch note:", e.message);
  }

  cachedAvatarPath = "";
  cachedAvatarTime = now;
  return "";
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Access-Control-Allow-Origin", "*");

  const BOT_TOKEN = (process.env.TELEGRAM_BOT_TOKEN || "").trim();

  // ---------- Load optional overrides from Firestore ----------
  let overrideName = "";
  let overrideSubtitle = "";
  try {
    const cfg = await db.collection("app_config").doc("main").get();
    if (cfg.exists) {
      const d = cfg.data();
      overrideName = d.bot_display_name || "";
      overrideSubtitle = d.bot_subtitle || "";
    }
  } catch (e) {
    // Firebase read failure — continue with Telegram-only identity
  }

  // ---------- No token → return empty JSON / 404 for avatar ----------
  if (!BOT_TOKEN) {
    if (req.query.avatar === "1") return res.status(404).end();
    return res.status(200).json({
      id: 0,
      name: overrideName || "",
      username: "",
      photo_url: "",
      subtitle: overrideSubtitle || ""
    });
  }

  // ---------- Fetch bot identity from Telegram ----------
  let botId = 0;
  let botName = "";
  let botUsername = "";
  try {
    const meRes = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getMe`);
    const me = await meRes.json();

    if (!me.ok) {
      if (req.query.avatar === "1") return res.status(404).end();
      return res.status(200).json({
        id: 0,
        name: overrideName || "",
        username: "",
        photo_url: "",
        subtitle: overrideSubtitle || ""
      });
    }

    botId = me.result.id;
    botName = overrideName || me.result.first_name || "";
    botUsername = me.result.username || "";
  } catch (e) {
    console.error("bot-info getMe error:", e.message);
    if (req.query.avatar === "1") return res.status(404).end();
    return res.status(200).json({
      id: 0,
      name: overrideName || "",
      username: "",
      photo_url: "",
      subtitle: overrideSubtitle || ""
    });
  }

  // ---------- Resolve the avatar file path ----------
  const avatarPath = await getBotAvatarPath(BOT_TOKEN, botId);

  // ---------- Stream the actual image if requested ----------
  if (req.query.avatar === "1") {
    if (!avatarPath) return res.status(404).end();

    try {
      const img = await fetch(
        `https://api.telegram.org/file/bot${BOT_TOKEN}/${avatarPath}`
      );
      if (!img.ok) return res.status(404).end();

      res.setHeader("Content-Type", "image/jpeg");
      res.setHeader("Cache-Control", "public, max-age=86400");
      const buf = Buffer.from(await img.arrayBuffer());
      return res.status(200).send(buf);
    } catch (e) {
      return res.status(404).end();
    }
  }

  // ---------- Otherwise, return the JSON ----------
  const photo_url = avatarPath ? `/api/bot-info?avatar=1` : "";

  return res.status(200).json({
    id: botId,
    name: botName,
    username: botUsername,
    photo_url,
    subtitle: overrideSubtitle || ""
  });
}
