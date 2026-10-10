// /api/bot-info.js
// Bulletproof combined endpoint — never throws, always returns valid JSON.
//   GET /api/bot-info           → JSON { id, name, username, photo_url, subtitle }
//   GET /api/bot-info?avatar=1  → streams the bot avatar image

// ---------- Optional Firebase (for overrides only) ----------
let db = null;
async function initFirebase() {
  if (db) return db;
  try {
    const admin = (await import("firebase-admin")).default;
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
    return db;
  } catch (e) {
    console.warn("Firebase unavailable in bot-info:", e.message);
    return null;
  }
}

// ---------- In-memory avatar cache ----------
let cachedAvatarPath = null;
let cachedAvatarTime = 0;
const AVATAR_TTL_MS = 6 * 60 * 60 * 1000;

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
    console.warn("Avatar fetch note:", e.message);
  }
  cachedAvatarPath = "";
  cachedAvatarTime = now;
  return "";
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Access-Control-Allow-Origin", "*");

  const BOT_TOKEN = (process.env.TELEGRAM_BOT_TOKEN || "").trim();

  // ---------- Optional overrides (safe — never blocks) ----------
  let overrideName = "";
  let overrideSubtitle = "";
  try {
    const firestore = await initFirebase();
    if (firestore) {
      const cfg = await firestore.collection("app_config").doc("main").get();
      if (cfg.exists) {
        overrideName = cfg.data().bot_display_name || "";
        overrideSubtitle = cfg.data().bot_subtitle || "";
      }
    }
  } catch (e) {
    // ignored — overrides are optional
  }

  // ---------- No token ----------
  if (!BOT_TOKEN) {
    console.error("❌ TELEGRAM_BOT_TOKEN is missing on Vercel.");
    if (req.query.avatar === "1") return res.status(404).end();
    return res.status(200).json({
      id: 0,
      name: overrideName || "",
      username: "",
      photo_url: "",
      subtitle: overrideSubtitle || "",
      error: "TELEGRAM_BOT_TOKEN missing"
    });
  }

  // ---------- Fetch bot identity ----------
  let botId = 0;
  let botName = "";
  let botUsername = "";
  try {
    const meRes = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getMe`);
    const me = await meRes.json();
    if (!me.ok) {
      console.error("getMe failed:", me.description);
      if (req.query.avatar === "1") return res.status(404).end();
      return res.status(200).json({
        id: 0,
        name: overrideName || "",
        username: "",
        photo_url: "",
        subtitle: overrideSubtitle || "",
        error: me.description || "getMe failed"
      });
    }
    botId = me.result.id;
    botName = overrideName || me.result.first_name || "";
    botUsername = me.result.username || "";
  } catch (e) {
    console.error("getMe network error:", e.message);
    if (req.query.avatar === "1") return res.status(404).end();
    return res.status(200).json({
      id: 0,
      name: overrideName || "",
      username: "",
      photo_url: "",
      subtitle: overrideSubtitle || "",
      error: e.message
    });
  }

  // ---------- Avatar ----------
  const avatarPath = await getBotAvatarPath(BOT_TOKEN, botId);

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

  const photo_url = avatarPath ? `/api/bot-info?avatar=1` : "";

  return res.status(200).json({
    id: botId,
    name: botName,
    username: botUsername,
    photo_url,
    subtitle: overrideSubtitle || ""
  });
}
