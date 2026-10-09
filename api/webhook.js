// topup-earn-main/api/webhook.js

const WEBAPP_URL = "https://pheizubot.vercel.app";

export default async function handler(req, res) {
  // If visited directly in browser
  if (req.method !== "POST") {
    return res.status(200).send("✅ Webhook is online and ready!");
  }

  const update = req.body;
  if (!update || !update.message) {
    return res.status(200).send("OK");
  }

  const message = update.message;
  const chatId = message.chat.id;
  const text = (message.text || "").trim();
  const fromUser = message.from || {};

  // PASTE YOUR FULL BOT TOKEN FROM YOUR SCREENSHOT HERE
  const botToken = process.env.TELEGRAM_BOT_TOKEN || "8815063188:AAGk6jh3ZVbU---ZHT3VOnh8Fz-_ATMOGUQ"; 

  if (text.startsWith("/start")) {
    const welcomeText = 
      `👋 *Welcome to Free Gram Token, ${fromUser.first_name || "Friend"}!*\n\n` +
      `💎 *Earn Gram Tokens* easily by watching short sponsored ads.\n\n` +
      `⚡ *Instant On-Chain Withdrawals*\n` +
      `🎁 *+10 PTS* per ad watched\n` +
      `👥 *10% Lifetime Bonus* on all friends you invite\n\n` +
      `👇 Tap the button below to launch the app and start earning:`;

    const payload = {
      chat_id: chatId,
      text: welcomeText,
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: "🚀 Open Free Gram App",
              web_app: { url: WEBAPP_URL }
            }
          ],
          [
            {
              text: "📢 Official Channel",
              url: "https://t.me/KhudaimiOfficialStore"
            }
          ]
        ]
      }
    };

    try {
      const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      
      const result = await response.json();
      console.log("Telegram sendMessage result:", result);
    } catch (err) {
      console.error("Error sending Telegram message:", err);
    }
  }

  return res.status(200).send("OK");
}
