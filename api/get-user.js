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
    console.error("Firebase init error:", e);
  }
}
const db = admin.firestore();

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { telegram_id, first_name, username, referrer_id } = req.body;
  if (!telegram_id) {
    return res.status(400).json({ error: "telegram_id is required" });
  }

  const botToken = process.env.TELEGRAM_BOT_TOKEN || "";
  let photo_url = null;
  let bot_name = "Gram Rewards";

  // 1. Fetch User Profile Photo & Bot Name directly from Telegram Bot API
  if (botToken) {
    try {
      // Get Bot Info
      const botRes = await fetch(`https://api.telegram.org/bot${botToken}/getMe`);
      const botData = await botRes.json();
      if (botData.ok && botData.result.first_name) {
        bot_name = botData.result.first_name;
      }

      // Get User Profile Photo
      const photoRes = await fetch(
        `https://api.telegram.org/bot${botToken}/getUserProfilePhotos?user_id=${telegram_id}&limit=1`
      );
      const photoData = await photoRes.json();

      if (photoData.ok && photoData.result.total_count > 0) {
        const fileId = photoData.result.photos[0][0].file_id;
        const fileRes = await fetch(`https://api.telegram.org/bot${botToken}/getFile?file_id=${fileId}`);
        const fileData = await fileRes.json();
        if (fileData.ok && fileData.result.file_path) {
          photo_url = `https://api.telegram.org/file/bot${botToken}/${fileData.result.file_path}`;
        }
      }
    } catch (err) {
      console.error("Telegram API fetch error:", err);
    }
  }

  // 2. Fetch or create user in Firestore with Daily Reset logic
  try {
    const todayStr = new Date().toISOString().slice(0, 10); // "YYYY-MM-DD"
    const userRef = db.collection("users").doc(String(telegram_id));
    const userDoc = await userRef.get();

    let userData;
    if (!userDoc.exists) {
      userData = {
        telegram_id: String(telegram_id),
        first_name: first_name || "User",
        username: username || "",
        balance: 0.0,
        ads_watched: 0,
        today_ads_watched: 0,
        last_ad_date: todayStr,
        invited_count: 0,
        referral_earnings: 0.0,
        referrer_id: referrer_id || null,
        channel_joined: true,
        created_at: new Date().toISOString()
      };
      await userRef.set(userData);

      // Increment referrer's invited count if valid
      if (referrer_id && String(referrer_id) !== String(telegram_id)) {
        const refUser = db.collection("users").doc(String(referrer_id));
        await refUser.update({
          invited_count: admin.firestore.FieldValue.increment(1)
        }).catch(() => {});
      }
    } else {
      userData = userDoc.data();

      // Check if day changed since last view/ad
      if (userData.last_ad_date !== todayStr) {
        await userRef.update({
          today_ads_watched: 0,
          last_ad_date: todayStr
        });
        userData.today_ads_watched = 0;
      }
    }

    return res.status(200).json({
      status: "success",
      balance: Number(userData.balance || 0),
      ads_watched: Number(userData.ads_watched || 0),
      today_ads_watched: Number(userData.today_ads_watched || 0),
      invited_count: Number(userData.invited_count || 0),
      referral_earnings: Number(userData.referral_earnings || 0),
      channel_joined: userData.channel_joined !== false,
      bot_name: bot_name,
      photo_url: photo_url
    });
  } catch (err) {
    console.error("Database user error:", err);
    return res.status(500).json({ status: "error", message: err.message });
  }
}
