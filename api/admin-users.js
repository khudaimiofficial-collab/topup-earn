// /api/admin-users.js
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
    console.error("Firebase init error in admin-users:", e);
  }
}

const db = admin.firestore();
const ADMIN_SECRET = process.env.ADMIN_SECRET_KEY || "";

// Simple auth check — admin panel should send this in the future.
// For now, if ADMIN_SECRET_KEY is set, require it in header "x-admin-secret".
function isAuthorized(req) {
  if (!ADMIN_SECRET) return true; // no secret configured → allow (dev mode)
  return req.headers["x-admin-secret"] === ADMIN_SECRET;
}

export default async function handler(req, res) {
  if (!isAuthorized(req)) {
    return res.status(401).json({ status: "error", message: "Unauthorized" });
  }

  // ============================================================
  // GET — list all users
  // ============================================================
  if (req.method === "GET") {
    try {
      const snap = await db.collection("users")
        .orderBy("created_at", "desc")
        .limit(500)
        .get();

      const users = snap.docs.map(doc => {
        const d = doc.data();
        return {
          telegram_id: String(d.telegram_id || doc.id),
          first_name: d.first_name || "Friend",
          username: d.username || "",
          balance: Number(d.balance || 0),
          ads_watched: Number(d.ads_watched || 0),
          today_ads: Number(d.today_ads_watched || 0),
          invited_count: Number(d.invited_count || 0),
          referral_bonus: Number(d.referral_earnings || 0),
          referrer_id: d.referrer_id || null,
          created_at: d.created_at || null
        };
      });

      return res.status(200).json({ status: "success", users });
    } catch (e) {
      console.error("admin-users GET error:", e);
      return res.status(500).json({ status: "error", message: e.message });
    }
  }

  // ============================================================
  // POST — create, delete, factory_reset
  // ============================================================
  if (req.method === "POST") {
    const body = req.body || {};
    const action = body.action;

    // ---------- CREATE ----------
    if (action === "create") {
      const tid = String(body.telegram_id || "").trim();
      if (!tid) return res.status(400).json({ status: "error", message: "telegram_id required" });

      try {
        const userRef = db.collection("users").doc(tid);
        const existing = await userRef.get();
        if (existing.exists) {
          return res.status(409).json({ status: "error", message: "User already exists" });
        }

        const todayStr = new Date().toISOString().slice(0, 10);
        await userRef.set({
          telegram_id: tid,
          first_name: body.first_name || "Member",
          username: body.username || "",
          balance: Number(body.balance || 0),
          ads_watched: 0,
          today_ads_watched: 0,
          last_ad_date: todayStr,
          invited_count: 0,
          referral_earnings: 0,
          referrer_id: null,
          channel_joined: true,
          created_at: new Date().toISOString()
        });

        return res.status(200).json({ status: "success" });
      } catch (e) {
        return res.status(500).json({ status: "error", message: e.message });
      }
    }

    // ---------- DELETE ----------
    if (action === "delete") {
      const tid = String(body.telegram_id || "").trim();
      if (!tid) return res.status(400).json({ status: "error", message: "telegram_id required" });

      try {
        await db.collection("users").doc(tid).delete();
        await db.collection("banned_users").doc(tid).delete().catch(() => {});
        return res.status(200).json({ status: "success" });
      } catch (e) {
        return res.status(500).json({ status: "error", message: e.message });
      }
    }

    // ---------- FACTORY RESET ----------
    if (action === "factory_reset") {
      try {
        const collections = ["users", "withdrawals", "banned_users"];

        for (const coll of collections) {
          const snap = await db.collection(coll).get();
          const batches = [];

          let batch = db.batch();
          let count = 0;

          snap.docs.forEach(doc => {
            batch.delete(doc.ref);
            count++;
            if (count === 450) {
              batches.push(batch.commit());
              batch = db.batch();
              count = 0;
            }
          });

          if (count > 0) batches.push(batch.commit());
          await Promise.all(batches);

          console.log(`✅ Wiped ${snap.size} docs from ${coll}`);
        }

        // Note: app_config/main is intentionally preserved so the bot token survives.
        return res.status(200).json({ status: "success", message: "All users wiped." });
      } catch (e) {
        console.error("Factory reset error:", e);
        return res.status(500).json({ status: "error", message: e.message });
      }
    }

    // ---------- STATS (optional) ----------
    if (action === "stats") {
      try {
        const usersSnap = await db.collection("users").get();
        let totalBalance = 0;
        let totalInvites = 0;

        usersSnap.docs.forEach(d => {
          const u = d.data();
          totalBalance += Number(u.balance || 0);
          totalInvites += Number(u.invited_count || 0);
        });

        return res.status(200).json({
          status: "success",
          total_users: usersSnap.size,
          total_balance_pts: totalBalance,
          total_invites: totalInvites
        });
      } catch (e) {
        return res.status(500).json({ status: "error", message: e.message });
      }
    }

    return res.status(400).json({ status: "error", message: "Unknown action" });
  }

  return res.status(405).json({ status: "error", message: "Method not allowed" });
}
