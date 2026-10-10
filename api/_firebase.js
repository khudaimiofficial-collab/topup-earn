// /api/_firebase.js
import admin from "firebase-admin";

if (!admin.apps.length) {
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

export const db = admin.firestore();
export const FieldValue = admin.firestore.FieldValue;

export async function getBotConfig() {
  const doc = await db.collection("app_config").doc("main").get();
  const data = doc.exists ? doc.data() : {};
  return {
    botToken: (data.bot_token || process.env.TELEGRAM_BOT_TOKEN || "").trim(),
    channelId: data.log_channel || "@KhudaimiOfficialStore",
    minWithdraw: Number(data.min_withdraw || 5000),
    withdrawFee: Number(data.withdraw_fee || 0.005),
    walletAddress: data.wallet_address || "",
  };
}

export async function sendTelegramMessage(chatId, htmlText) {
  const { botToken } = await getBotConfig();
  if (!botToken || !chatId) return false;

  try {
    const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: htmlText,
        parse_mode: "HTML"
      })
    });
    const result = await res.json();
    return result.ok;
  } catch (err) {
    console.error("Telegram send error:", err);
    return false;
  }
}

export async function checkChannelMember(userId) {
  const { botToken, channelId } = await getBotConfig();
  if (!botToken || !channelId || !userId) return false;

  try {
    const res = await fetch(
      `https://api.telegram.org/bot${botToken}/getChatMember?chat_id=${encodeURIComponent(channelId)}&user_id=${userId}`
    );
    const data = await res.json();
    if (data.ok && data.result) {
      return ["creator", "administrator", "member", "restricted"].includes(data.result.status);
    }
    return false;
  } catch (err) {
    console.error("checkChannelMember error:", err);
    return false;
  }
}
