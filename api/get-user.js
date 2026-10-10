// /api/get-user.js
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
    console.error("Firebase init error in get-user:", e);
  }
}

const db = admin.firestore();

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed. Use POST." });
  }

  const { telegram_id, first_name, username, referrer_id, add_points, set_balance } = req.body || {};
  if (!telegram_id) {
    return res.status(400).json({ error: "telegram_id is required" });
  }

  const botToken = (process.env.TELEGRAM_BOT_TOKEN || "").trim();
  let photo_url = null;
  let bot_name = "";
  let bot_username = "";
  let bot_photo_url = "";

  async function fetchTelegramPhoto(userId) {
    if (!botToken || !userId) return null;
    try {
      const pRes = await fetch(
        `https://api.telegram.org/bot${botToken}/getUserProfilePhotos?user_id=${userId}&limit=1`
      );
      const pData = await pRes.json();
      if (pData.ok && pData.result.total_count > 0) {
        const fileId = pData.result.photos[0][0].file_id;
        const fRes = await fetch(`https://api.telegram.org/bot${botToken}/getFile?file_id=${fileId}`);
        const fData = await fRes.json();
        if (fData.ok && fData.result.file_path) {
          // Proxy through our own endpoint so bot token never leaks
          return `/api/bot-avatar?path=${encodeURIComponent(fData.result.file_path)}`;
        }
      }
    } catch (e) {
      console.warn("Photo fetch error:", e.message);
    }
    return null;
  }

  // Fetch bot info + user photo
  if (botToken) {
    try {
      const botRes = await fetch(`https://api.telegram.org/bot${botToken}/getMe`);
      const botData = await botRes.json();
      if (botData.ok) {
        bot_name = botData.result.first_name || "";
        bot_username = botData.result.username || "";
        bot_photo_url = `/api/bot-avatar?bot=1`;
      }
      photo_url = await fetchTelegramPhoto(telegram_id);
    } catch (err) {
      console.error("Telegram API fetch error:", err.message);
    }
  }

  try {
    const todayStr = new Date().toISOString().slice(0, 10);
    const userRef = db.collection("users").doc(String(telegram_id));
    const userDoc = await userRef.get();

    let userData;

    if (!userDoc.exists) {
      userData = {
        telegram_id: String(telegram_id),
        first_name: first_name || "Friend",
        username: username || "",
        balance: 0.0,
        ads_watched: 0,
        today_ads_watched: 0,
        last_ad_date: todayStr,
        invited_count: 0,
        referral_earnings: 0.0,
        referrer_id: referrer_id ? String(referrer_id) : null,
        channel_joined: true,
        created_at: new Date().toISOString()
      };
      await userRef.set(userData);

      if (referrer_id && String(referrer_id) !== String(telegram_id)) {
        await db.collection("users").doc(String(referrer_id)).update({
          invited_count: admin.firestore.FieldValue.increment(1)
        }).catch(() => {});
      }
    } else {
      userData = userDoc.data();

      // Apply explicit balance edits (admin) — no counter side-effects
      if (typeof set_balance === "number" && !isNaN(set_balance)) {
        await userRef.update({ balance: set_balance });
        userData.balance = set_balance;
      }

      // Apply point delta (ad reward, withdrawal, referral) — with proper counter tracking
      if (typeof add_points === "number" && add_points !== 0 && typeof set_balance !== "number") {
        const updates = {
          balance: admin.firestore.FieldValue.increment(add_points)
        };

        // Only treat as an "ad watch" if we're crediting exactly the ad reward and the caller flagged it
        if (add_points > 0 && req.body.is_ad_reward === true) {
          updates.ads_watched = admin.firestore.FieldValue.increment(1);
          updates.today_ads_watched = admin.firestore.FieldValue.increment(1);
          updates.last_ad_date = todayStr;
        }

        // Crediting a referral commission
        if (add_points > 0 && req.body.is_referral_bonus === true) {
          updates.referral_earnings = admin.firestore.FieldValue.increment(add_points);
        }

        await userRef.update(updates);
        userData.balance = Number(userData.balance || 0) + add_points;
        if (req.body.is_ad_reward) {
          userData.ads_watched = Number(userData.ads_watched || 0) + 1;
          userData.today_ads_watched = Number(userData.today_ads_watched || 0) + 1;
        }
      }

      // Midnight reset for today's counter
      if (userData.last_ad_date !== todayStr) {
        await userRef.update({ today_ads_watched: 0, last_ad_date: todayStr });
        userData.today_ads_watched = 0;
      }
    }

    // Ban check
    const banDoc = await db.collection("banned_users").doc(String(telegram_id)).get();
    if (banDoc.exists) {
      return res.status(200).json({ status: "banned", is_banned: true });
    }

    // Referral list
    let invitedUsers = [];
    try {
      const snapString = await db.collection("users")
        .where("referrer_id", "==", String(telegram_id))
        .limit(25).get();

      const snapNum = await db.collection("users")
        .where("referrer_id", "==", Number(telegram_id))
        .limit(25).get();

      const merged = new Map();
      [...snapString.docs, ...snapNum.docs].forEach(d => merged.set(d.id, d.data()));

      invitedUsers = await Promise.all(
        Array.from(merged.values()).map(async (d) => {
          let uPhoto = null;
          if (d.telegram_id) {
            uPhoto = await fetchTelegramPhoto(d.telegram_id);
          }
          return {
            id: d.telegram_id,
            name: d.first_name || "Telegram User",
            username: d.username ? d.username.replace('@', '') : "",
            photo_url: uPhoto,
            earned: Number(d.referral_earnings || 0).toFixed(2)
          };
        })
      );
    } catch (fErr) {
      console.warn("Friends query error:", fErr.message);
    }

    const calculatedInvitedCount = Math.max(invitedUsers.length, Number(userData.invited_count || 0));
    const calculatedEarnings = Number(userData.referral_earnings || 0);

    return res.status(200).json({
      status: "success",
      balance: Number(userData.balance || 0),
      ads_watched: Number(userData.ads_watched || 0),
      today_ads_watched: Number(userData.today_ads_watched || 0),
      invited_count: calculatedInvitedCount,
      referral_earnings: calculatedEarnings,
      channel_joined: userData.channel_joined !== false,
      bot_name: bot_name,
      bot_username: bot_username,
      bot_photo_url: bot_photo_url,
      photo_url: photo_url,
      invited_users: invitedUsers
    });

  } catch (err) {
    console.error("Database user error:", err);
    return res.status(500).json({ status: "error", message: err.message });
  }
}
