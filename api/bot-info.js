// /api/bot-info.js
// Combined endpoint — reads bot token from Vercel env OR Firestore (admin panel)
//   GET /api/bot-info           → JSON { id, name, username, photo_url, subtitle }
//   GET /api/bot-info?avatar=1  → streams the bot avatar image

let adminMod = null;
let db = null;

async function initFirebase() {
  if (db) return db;
  try {
    adminMod = (await import("firebase-admin")).default;
    if (!adminMod.apps.length) {
      if (process.env.FIREBASE_SERVICE_ACCOUNT) {
        adminMod.initializeApp({
          credential: adminMod.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT))
        });
      } else {
        adminMod.initializeApp({ credential: adminMod.credential.applicationDefault() });
      }
    }
    db = adminMod.firestore();
    return db;
  } catch (e) {
    console.warn("Firebase unavailable in bot-info:", e.message);
    return null;
  }
}

// ---------- Fetch token: env var first, then Firestore ----------
async function getBotToken() {
  const envToken = (process.env.TELEGRAM_BOT_TOKEN || "").trim();
  if (envToken) return { token: envToken, source: "env" };

  try {
    const firestore = await initFirebase();
    if (firestore) {
      const cfg = await firestore.collection("app_config").doc("main").get();
      if (cfg.exists) {
        const t = (cfg.data().bot_token || "").trim();
        if (t) return { token: t, source: "firestore" };
      }
    }
  } catch (e) {
    console.warn("Firestore token read failed:", e.message);
  }
  return { token: "", source: "none" };
}

// ---------- Avatar file_path cache ----------
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

  // ---------- Resolve token ----------
  const { token: BOT_TOKEN, source } = await getBotToken();
  console.log(`[bot-info] token source: ${source}`);

  // ---------- Optional overrides ----------
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
  } catch (e) {}

  // ---------- No token at all ----------
  if (!BOT_TOKEN) {
    if (req.query.avatar === "1") return res.status(404).end();
    return res.status(200).json({
      id: 0,
      name: overrideName || "",
      username: "",
      photo_url: "",
      subtitle: overrideSubtitle || "",
      error: "No bot token found. Save it in Admin Settings or set TELEGRAM_BOT_TOKEN env."
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
    subtitle: overrideSubtitle || "",
    token_source: source
  });
}
