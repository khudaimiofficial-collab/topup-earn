import admin from 'firebase-admin';
import crypto from 'crypto';

// Initialize Firebase Admin SDK
if (!admin.apps.length) {
  const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT
    ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
    : null;

  if (serviceAccount) {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
  } else {
    admin.initializeApp();
  }
}

const db = admin.firestore();
const MASTER_ADMIN_ID = '8960497898';

// ==========================================
// HELPER FUNCTIONS
// ==========================================

// Get App Settings / Bot Token from Firestore
async function getAppSettings() {
  const doc = await db.collection('settings').doc('config').get();
  return doc.exists ? doc.data() : {};
}

// Verify Session Token from request headers
async function verifyAdminSession(token) {
  if (!token) return false;
  try {
    const sessionDoc = await db.collection('admin_sessions').doc(token).get();
    if (!sessionDoc.exists) return false;
    const data = sessionDoc.data();
    if (Date.now() > data.expires_at) return false;
    return true;
  } catch (err) {
    return false;
  }
}

// ==========================================
// MAIN API HANDLER
// ==========================================
export default async function handler(req, res) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-token');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // ==========================================
  // 1. PUBLIC ADMIN AUTHENTICATION (OTP)
  // ==========================================
  if (req.method === 'POST') {
    const { action } = req.body;

    // A. SEND OTP TO TELEGRAM
    if (action === 'send_otp') {
      try {
        const settings = await getAppSettings();
        const botToken = settings.bot_token || process.env.BOT_TOKEN;

        if (!botToken) {
          return res.status(400).json({ success: false, error: 'Telegram Bot Token not configured in settings.' });
        }

        // Generate 6-digit OTP
        const otp = Math.floor(100000 + Math.random() * 900000).toString();

        // Save OTP to Firestore with 5-minute expiry
        await db.collection('admin_auth').doc('latest_otp').set({
          otp: otp,
          expires_at: Date.now() + 5 * 60 * 1000
        });

        // Send OTP to Telegram Master Admin
        const text = `🔐 *Admin Control Panel Verification*\n\nYour 6-Digit OTP is:\n👉 \`${otp}\`\n\nValid for 5 minutes. Do not share this code.`;
        const tgRes = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: MASTER_ADMIN_ID,
            text: text,
            parse_mode: 'Markdown'
          })
        });

        const tgData = await tgRes.json();
        if (!tgData.ok) {
          return res.status(400).json({ success: false, error: 'Telegram Error: ' + tgData.description });
        }

        return res.status(200).json({ success: true, message: 'OTP sent to your Telegram account!' });
      } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
      }
    }

    // B. VERIFY OTP & CREATE SESSION
    if (action === 'verify_otp') {
      const { otp } = req.body;
      try {
        const otpDoc = await db.collection('admin_auth').doc('latest_otp').get();
        if (!otpDoc.exists) {
          return res.status(400).json({ success: false, error: 'OTP expired or not requested.' });
        }

        const data = otpDoc.data();
        if (Date.now() > data.expires_at) {
          return res.status(400).json({ success: false, error: 'OTP has expired. Request a new one.' });
        }

        if (String(data.otp).trim() !== String(otp).trim()) {
          return res.status(400).json({ success: false, error: 'Invalid OTP code.' });
        }

        // Delete used OTP
        await db.collection('admin_auth').doc('latest_otp').delete();

        // Generate 7-day session token
        const sessionToken = crypto.randomBytes(32).toString('hex');
        await db.collection('admin_sessions').doc(sessionToken).set({
          created_at: Date.now(),
          expires_at: Date.now() + 7 * 24 * 60 * 60 * 1000
        });

        return res.status(200).json({ success: true, session_token: sessionToken });
      } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
      }
    }
  }

  // ==========================================
  // 2. PROTECTED ADMIN AUTH CHECK
  // ==========================================
  const token = req.headers['x-admin-token'];
  const isValidAdmin = await verifyAdminSession(token);

  if (!isValidAdmin) {
    return res.status(401).json({ error: 'Unauthorized: Invalid or expired admin session' });
  }

  // ==========================================
  // 3. GET REQUESTS (DATA RETRIEVAL)
  // ==========================================
  if (req.method === 'GET') {
    const { type } = req.query;

    try {
      // 1. App Settings
      if (type === 'settings') {
        const settings = await getAppSettings();
        return res.status(200).json(settings);
      }

      // 2. User Management List
      if (type === 'users') {
        const snap = await db.collection('users').limit(300).get();
        const users = snap.docs.map(doc => ({
          telegram_id: doc.id,
          ...doc.data()
        }));
        return res.status(200).json({ users });
      }

      // 3. Top-Up Products & Orders List
      if (type === 'products') {
        const prodSnap = await db.collection('products').orderBy('price', 'asc').get();
        const products = prodSnap.docs.map(d => ({ id: d.id, ...d.data() }));

        const orderSnap = await db.collection('product_orders').orderBy('created_at', 'desc').limit(150).get();
        const orders = orderSnap.docs.map(d => ({ id: d.id, ...d.data() }));

        return res.status(200).json({ products, orders });
      }

      // 4. Default: Withdrawals List
      const snap = await db.collection('withdrawals').orderBy('created_at', 'desc').limit(200).get();
      const withdrawals = snap.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      return res.status(200).json({ withdrawals });

    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // ==========================================
  // 4. POST REQUESTS (MANAGEMENT ACTIONS)
  // ==========================================
  if (req.method === 'POST') {
    const { action } = req.body;

    try {
      // ------------------------------------------
      // PRODUCTS & ORDERS ACTIONS
      // ------------------------------------------
      if (action === 'add_product') {
        const { title, category, price, input_label, icon } = req.body;
        await db.collection('products').add({
          title: title || 'Game Top-Up',
          category: category || 'Top-Up',
          price: Number(price) || 0,
          input_label: input_label || 'Player ID',
          icon: icon || '💎',
          created_at: new Date().toISOString()
        });
        return res.status(200).json({ success: true });
      }

      if (action === 'delete_product') {
        await db.collection('products').doc(req.body.product_id).delete();
        return res.status(200).json({ success: true });
      }

      if (action === 'update_order_status') {
        const { order_id, order_action } = req.body;
        const orderRef = db.collection('product_orders').doc(order_id);
        const orderDoc = await orderRef.get();

        if (!orderDoc.exists) return res.status(404).json({ error: 'Order not found' });
        const orderData = orderDoc.data();

        if (order_action === 'complete') {
          await orderRef.update({ status: 'completed' });
        } else if (order_action === 'reject') {
          // Refund points back to user
          const userRef = db.collection('users').doc(String(orderData.telegram_id));
          const userDoc = await userRef.get();
          if (userDoc.exists) {
            const currentBal = Number(userDoc.data().balance || 0);
            await userRef.update({ balance: currentBal + Number(orderData.price_paid || 0) });
          }
          await orderRef.update({ status: 'rejected' });
        }
        return res.status(200).json({ success: true });
      }

      // ------------------------------------------
      // WITHDRAWAL ACTIONS
      // ------------------------------------------
      if (req.body.id && (req.body.action === 'approve' || req.body.action === 'reject')) {
        const { id, action } = req.body;
        const withdrawRef = db.collection('withdrawals').doc(id);
        const withdrawDoc = await withdrawRef.get();

        if (!withdrawDoc.exists) return res.status(404).json({ error: 'Request not found' });
        const withdrawData = withdrawDoc.data();

        if (action === 'approve') {
          await withdrawRef.update({ status: 'approved' });
        } else if (action === 'reject') {
          // Refund points to user balance
          const userRef = db.collection('users').doc(String(withdrawData.telegram_id));
          const userDoc = await userRef.get();
          if (userDoc.exists) {
            const currentBal = Number(userDoc.data().balance || 0);
            await userRef.update({ balance: currentBal + Number(withdrawData.points || 0) });
          }
          await withdrawRef.update({ status: 'rejected' });
        }
        return res.status(200).json({ success: true });
      }

      // ------------------------------------------
      // USER MANAGEMENT ACTIONS
      // ------------------------------------------
      if (action === 'add_user') {
        const { telegram_id, first_name, username, balance } = req.body;
        await db.collection('users').doc(String(telegram_id)).set({
          first_name: first_name || 'Gamer',
          username: username || '',
          balance: Number(balance) || 0,
          ads_watched: 0,
          invited_count: 0,
          is_banned: false,
          created_at: new Date().toISOString()
        }, { merge: true });
        return res.status(200).json({ success: true });
      }

      if (action === 'delete_user') {
        await db.collection('users').doc(String(req.body.telegram_id)).delete();
        return res.status(200).json({ success: true });
      }

      if (action === 'edit_balance') {
        await db.collection('users').doc(String(req.body.telegram_id)).update({
          balance: Number(req.body.new_balance)
        });
        return res.status(200).json({ success: true });
      }

      if (action === 'toggle_ban') {
        const userRef = db.collection('users').doc(String(req.body.telegram_id));
        const userDoc = await userRef.get();
        if (userDoc.exists) {
          const currentBan = Boolean(userDoc.data().is_banned);
          await userRef.update({ is_banned: !currentBan });
        }
        return res.status(200).json({ success: true });
      }

      // ------------------------------------------
      // SETTINGS & WEBHOOK ACTIONS
      // ------------------------------------------
      if (action === 'save_settings') {
        const { bot_token, channel_id, min_withdraw, website_url, banner_url } = req.body;
        await db.collection('settings').doc('config').set({
          bot_token: bot_token || '',
          channel_id: channel_id || '',
          min_withdraw: Number(min_withdraw) || 50,
          website_url: website_url || '',
          banner_url: banner_url || ''
        }, { merge: true });
        return res.status(200).json({ success: true });
      }

      if (action === 'set_webhook') {
        const settings = await getAppSettings();
        const botToken = settings.bot_token || process.env.BOT_TOKEN;
        const host = req.headers['x-forwarded-host'] || req.headers.host;
        const proto = req.headers['x-forwarded-proto'] || 'https';
        const webhookUrl = `${proto}://${host}/api/webhook`;

        const tgRes = await fetch(`https://api.telegram.org/bot${botToken}/setWebhook?url=${webhookUrl}`);
        const tgData = await tgRes.json();

        if (tgData.ok) {
          return res.status(200).json({ success: true, message: `Webhook connected to: ${webhookUrl}` });
        } else {
          return res.status(400).json({ success: false, error: tgData.description });
        }
      }

      return res.status(400).json({ error: 'Unknown action specified' });

    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
