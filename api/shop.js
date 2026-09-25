import admin from 'firebase-admin';

if (!admin.apps.length) {
  const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT
    ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
    : null;
  if (serviceAccount) {
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  } else {
    admin.initializeApp();
  }
}
const db = admin.firestore();

// Helper to send Telegram message
async function sendTelegram(botToken, chatId, text) {
  if (!botToken || !chatId) return;
  try {
    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' })
    });
  } catch (err) {
    console.error('Telegram notification error:', err);
  }
}

export default async function handler(req, res) {
  const action = req.query.action || req.body?.action;

  // 1. GET ALL PRODUCTS
  if (req.method === 'GET' && action === 'get_products') {
    try {
      const snap = await db.collection('products').get();
      const products = snap.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })).sort((a, b) => Number(a.price || 0) - Number(b.price || 0));
      return res.status(200).json({ products });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // 2. GET USER'S ORDER HISTORY (No composite index required)
  if (req.method === 'GET' && action === 'my_orders') {
    const telegram_id = String(req.query.telegram_id);
    try {
      const snap = await db.collection('product_orders')
        .where('telegram_id', '==', telegram_id)
        .get();

      // In-memory sort by date desc
      const orders = snap.docs
        .map(doc => ({ id: doc.id, ...doc.data() }))
        .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));

      return res.status(200).json({ orders });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // 3. PURCHASE / PLACE ORDER
  if (req.method === 'POST' && action === 'buy_product') {
    const { product_id, telegram_id, player_info } = req.body;

    if (!player_info || !product_id || !telegram_id) {
      return res.status(400).json({ success: false, error: 'Missing required parameters' });
    }

    try {
      let orderDetails = null;

      await db.runTransaction(async (t) => {
        const userRef = db.collection('users').doc(String(telegram_id));
        const prodRef = db.collection('products').doc(product_id);

        const userDoc = await t.get(userRef);
        const prodDoc = await t.get(prodRef);

        if (!userDoc.exists) throw new Error('User not found');
        if (!prodDoc.exists) throw new Error('Product not found');

        const userData = userDoc.data();
        const prodData = prodDoc.data();

        const userBalance = Number(userData.balance || 0);
        const price = Number(prodData.price);

        if (userBalance < price) {
          throw new Error('Insufficient points balance');
        }

        // Deduct user balance
        t.update(userRef, { balance: userBalance - price });

        // Create pending order
        const orderRef = db.collection('product_orders').doc();
        orderDetails = {
          id: orderRef.id,
          telegram_id: String(telegram_id),
          product_id: product_id,
          product_title: prodData.title,
          price_paid: price,
          player_info: player_info,
          status: 'pending',
          created_at: new Date().toISOString()
        };
        t.set(orderRef, orderDetails);
      });

      // Send Instant Notifications
      const settingsDoc = await db.collection('settings').doc('config').get();
      const settings = settingsDoc.exists ? settingsDoc.data() : {};
      const botToken = settings.bot_token || process.env.BOT_TOKEN;
      const channelId = settings.channel_id;

      if (botToken && orderDetails) {
        // Notification to User
        const userMsg = `⏳ <b>Order Received (Pending Approval)</b>\n\n` +
          `📦 <b>Product:</b> ${orderDetails.product_title}\n` +
          `🎮 <b>Account:</b> <code>${orderDetails.player_info}</code>\n` +
          `💰 <b>Points Deducted:</b> ${orderDetails.price_paid} PTS\n\n` +
          `Your order has been sent to the admin. You will receive a message here when it is approved!`;
        sendTelegram(botToken, orderDetails.telegram_id, userMsg);

        // Notification to Log Channel
        if (channelId) {
          const logMsg = `🛒 <b>NEW TOP-UP ORDER (PENDING)</b>\n\n` +
            `👤 <b>User:</b> <code>${orderDetails.telegram_id}</code>\n` +
            `🛍️ <b>Package:</b> ${orderDetails.product_title}\n` +
            `🎮 <b>Player UID:</b> <code>${orderDetails.player_info}</code>\n` +
            `💰 <b>Cost:</b> ${orderDetails.price_paid} PTS\n` +
            `⏰ <b>Date:</b> ${new Date().toLocaleString()}`;
          sendTelegram(botToken, channelId, logMsg);
        }
      }

      return res.status(200).json({ success: true });
    } catch (err) {
      return res.status(400).json({ success: false, error: err.message });
    }
  }

  return res.status(404).json({ error: 'Endpoint not found' });
}
