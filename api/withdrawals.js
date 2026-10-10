// /api/withdrawals.js
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
    console.error("Firebase init error in withdrawals:", e);
  }
}

const db = admin.firestore();
const ADMIN_SECRET = process.env.ADMIN_SECRET_KEY || "";

function isAuthorized(req) {
  if (!ADMIN_SECRET) return true;
  return req.headers["x-admin-secret"] === ADMIN_SECRET;
}

// ============================================================
// LOG CHANNEL NOTIFICATION
// ============================================================
async function notifyLogChannel(record) {
  try {
    const cfgDoc = await db.collection("app_config").doc("main").get();
    const cfg = cfgDoc.exists ? cfgDoc.data() : {};
    const token = (process.env.TELEGRAM_BOT_TOKEN || cfg.bot_token || "").trim();
    const channel = (cfg.log_channel || "@pheizu_wallet").trim();

    if (!token) return;

    const shortTx = record.tx_id ? `${record.tx_id.slice(0, 10)}...${record.tx_id.slice(-8)}` : "N/A";
    const shortAddr = record.wallet_address
      ? `${record.wallet_address.slice(0, 6)}...${record.wallet_address.slice(-6)}`
      : "-";

    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: channel,
        text:
          `🚀 *Withdrawal ${String(record.status || "success").toUpperCase()}*\n\n` +
          `👤 User: \`${record.telegram_id}\`\n` +
          `💎 Amount: \`${record.gram_amount} GRAM\` (${record.points} PTS)\n` +
          `💳 To: \`${shortAddr}\`\n` +
          `🔗 Tx: \`${shortTx}\`\n` +
          `⏰ ${new Date().toISOString()}`,
        parse_mode: "Markdown"
      })
    }).catch(() => {});
  } catch (e) {
    console.warn("Log channel notify error:", e.message);
  }
}

export default async function handler(req, res) {
  // ============================================================
  // GET — list withdrawals
  // ============================================================
  if (req.method === "GET") {
    if (!isAuthorized(req)) {
      return res.status(401).json({ status: "error", message: "Unauthorized" });
    }

    try {
      const snap = await db.collection("withdrawals")
        .orderBy("created_at", "desc")
        .limit(200)
        .get();

      const withdrawals = snap.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));

      return res.status(200).json({ status: "success", withdrawals });
    } catch (e) {
      console.error("withdrawals GET error:", e);
      return res.status(500).json({ status: "error", message: e.message, withdrawals: [] });
    }
  }

  // ============================================================
  // POST — create or update
  // ============================================================
  if (req.method === "POST") {
    const body = req.body || {};
    const action = body.action;

    // ---------- UPDATE STATUS (admin approve/reject) ----------
    if (action === "update_status") {
      if (!isAuthorized(req)) return res.status(401).json({ status: "error", message: "Unauthorized" });

      const txId = String(body.tx_id || "").trim();
      const newStatus = String(body.status || "").trim().toLowerCase();

      if (!txId || !newStatus) {
        return res.status(400).json({ status: "error", message: "tx_id and status required" });
      }

      try {
        await db.collection("withdrawals").doc(txId).set({
          status: newStatus,
          updated_at: new Date().toISOString()
        }, { merge: true });

        // Notify log channel
        const doc = await db.collection("withdrawals").doc(txId).get();
        if (doc.exists) await notifyLogChannel(doc.data());

        return res.status(200).json({ status: "success" });
      } catch (e) {
        return res.status(500).json({ status: "error", message: e.message });
      }
    }

    // ---------- DELETE ----------
    if (action === "delete") {
      if (!isAuthorized(req)) return res.status(401).json({ status: "error", message: "Unauthorized" });

      const txId = String(body.tx_id || "").trim();
      if (!txId) return res.status(400).json({ status: "error", message: "tx_id required" });

      try {
        await db.collection("withdrawals").doc(txId).delete();
        return res.status(200).json({ status: "success" });
      } catch (e) {
        return res.status(500).json({ status: "error", message: e.message });
      }
    }

    // ---------- CREATE (from mini app) ----------
    // Detected by presence of tx_id + wallet_address + telegram_id
    if (body.tx_id && body.wallet_address && body.telegram_id) {
      try {
        const record = {
          tx_id: String(body.tx_id),
          telegram_id: String(body.telegram_id),
          first_name: body.first_name || "User",
          points: Number(body.points || 0),
          fee_deducted: Number(body.fee_deducted || 0),
          gram_amount: Number(body.gram_amount || 0),
          wallet_address: String(body.wallet_address),
          status: String(body.status || "success").toLowerCase(),
          created_at: body.created_at || new Date().toISOString()
        };

        await db.collection("withdrawals").doc(record.tx_id).set(record);

        // Fire off log channel
        await notifyLogChannel(record);

        // Deduct balance from user (defensive — mini app also does this)
        if (record.points > 0) {
          await db.collection("users").doc(record.telegram_id).update({
            balance: admin.firestore.FieldValue.increment(-record.points)
          }).catch(() => {});
        }

        return res.status(200).json({ status: "success", tx_id: record.tx_id });
      } catch (e) {
        console.error("Withdrawal create error:", e);
        return res.status(500).json({ status: "error", message: e.message });
      }
    }

    return res.status(400).json({ status: "error", message: "Unknown action or missing fields" });
  }

  return res.status(405).json({ status: "error", message: "Method not allowed" });
}
