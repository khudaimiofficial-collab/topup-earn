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

// Referral commission rate: 10% of the +10 PTS ad reward = +1.00 PTS
const REFERRAL_BONUS_PER_AD = 1.00;

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed. Use POST." });
  }

  const {
    telegram_id,
    first_name,
    username,
    referrer_id,
    add_points,
    set_balance,
    is_ad_reward,
    is_referral_bonus
  } = req.body || {};

  if (!telegram_id) {
    return res.status(400).json({ error: "telegram_id is required" });
  }

  try {
    const todayStr = new Date().toISOString().slice(0, 10);
    const userRef = db.collection("users").doc(String(telegram_id));
    const userDoc = await userRef.get();

    let userData;

    // ============================================================
    // NEW USER
    // ============================================================
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

      // Increment referrer's invited_count when a new user joins via their link
      if (referrer_id && String(referrer_id) !== String(telegram_id)) {
        await db.collection("users").doc(String(referrer_id)).update({
          invited_count: admin.firestore.FieldValue.increment(1)
        }).catch(() => {});
      }
    } else {
      userData = userDoc.data();

      // ============================================================
      // ADMIN BALANCE OVERRIDE (no counter side-effects)
      // ============================================================
      if (typeof set_balance === "number" && !isNaN(set_balance)) {
        await userRef.update({ balance: set_balance });
        userData.balance = set_balance;
      }

      // ============================================================
      // POINT DELTA (ad reward, withdrawal, referral bonus)
      // ============================================================
      if (typeof add_points === "number" && add_points !== 0 && typeof set_balance !== "number") {
        const updates = {
          balance: admin.firestore.FieldValue.increment(add_points)
        };

        // Only increment ad counters when the caller explicitly says this is an ad reward
        if (add_points > 0 && is_ad_reward === true) {
          updates.ads_watched = admin.firestore.FieldValue.increment(1);
          updates.today_ads_watched = admin.firestore.FieldValue.increment(1);
          updates.last_ad_date = todayStr;
        }

        // If caller explicitly says this is a referral bonus
        if (add_points > 0 && is_referral_bonus === true) {
          updates.referral_earnings = admin.firestore.FieldValue.increment(add_points);
        }

        await userRef.update(updates);
        userData.balance = Number(userData.balance || 0) + add_points;

        if (is_ad_reward) {
          userData.ads_watched = Number(userData.ads_watched || 0) + 1;
          userData.today_ads_watched = Number(userData.today_ads_watched || 0) + 1;
        }

        // ============================================================
        // ⚡ INSTANT REFERRAL BONUS
        // When the user just watched an ad, credit their referrer +1.00 PTS
        // in the SAME request, so the referrer's balance updates immediately.
        // ============================================================
        if (is_ad_reward === true && userData.referrer_id) {
          const refId = String(userData.referrer_id);
          if (refId !== String(telegram_id)) {
            try {
              await db.collection("users").doc(refId).update({
                balance: admin.firestore.FieldValue.increment(REFERRAL_BONUS_PER_AD),
                referral_earnings: admin.firestore.FieldValue.increment(REFERRAL_BONUS_PER_AD)
              });
              console.log(`💸 Credited referrer ${refId} +${REFERRAL_BONUS_PER_AD} PTS`);
            } catch (refErr) {
              console.warn("Referral credit note:", refErr.message);
            }
          }
        }
      }

      // Midnight reset for today's counter
      if (userData.last_ad_date !== todayStr) {
        await userRef.update({ today_ads_watched: 0, last_ad_date: todayStr });
        userData.today_ads_watched = 0;
      }
    }

    // ============================================================
    // BAN CHECK
    // ============================================================
    const banDoc = await db.collection("banned_users").doc(String(telegram_id)).get();
    if (banDoc.exists) {
      return res.status(200).json({ status: "banned", is_banned: true });
    }

    // ============================================================
    // REFERRAL LIST
    // ============================================================
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

      invitedUsers = Array.from(merged.values()).map(d => ({
        id: d.telegram_id,
        name: d.first_name || "Telegram User",
        username: d.username ? d.username.replace('@', '') : "",
        earned: Number(d.referral_earnings || 0).toFixed(2)
      }));
    } catch (fErr) {
      console.warn("Friends query error:", fErr.message);
    }

    const calculatedInvitedCount = Math.max(invitedUsers.length, Number(userData.invited_count || 0));

    return res.status(200).json({
      status: "success",
      balance: Number(userData.balance || 0),
      ads_watched: Number(userData.ads_watched || 0),
      today_ads_watched: Number(userData.today_ads_watched || 0),
      invited_count: calculatedInvitedCount,
      referral_earnings: Number(userData.referral_earnings || 0),
      channel_joined: userData.channel_joined !== false,
      invited_users: invitedUsers
    });

  } catch (err) {
    console.error("Database user error:", err);
    return res.status(500).json({ status: "error", message: err.message });
  }
}
