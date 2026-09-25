import admin from 'firebase-admin';

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

// Helper: Send Telegram Message
async function sendTelegram(botToken, chatId, text) {
  if (!botToken || !chatId) return;
  try {
    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: text,
        parse_mode: 'HTML'
      })
    });
  } catch (err) {
    console.error('Telegram notification error:', err);
  }
}

// Helper: Fetch App Configuration & Bot Token
async function getAppSettings() {
  try {
    const doc = await db.collection('settings').doc('config').get();
    return doc.exists ? doc.data() : {};
  } catch (err) {
    console.error('Error fetching settings:', err);
    return {};
  }
}

// ==========================================
// MAIN API HANDLER
// ==========================================
export default async function handler(req, res) {
  // CORS Configuration
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // ==========================================
  // 1. GET USER'S WITHDRAWAL HISTORY
  // ==========================================
  if (req.method === 'GET') {
    const { telegram_id } = req.query;

    if (!telegram_id) {
      return res.status(400).json({ error: 'Missing telegram_id parameter' });
    }

    try {
      const snap = await db.collection('withdrawals')
        .where('telegram_id', '==', String(telegram_id))
        .get();

      // In-memory sort by date descending (prevents Firestore composite index requirements)
      const history = snap.docs
        .map(doc => ({ id: doc.id, ...doc.data() }))
        .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));

      return res.status(200).json({ history });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // ==========================================
  // 2. SUBMIT CUSTOM AMOUNT WITHDRAWAL
  // ==========================================
  if (req.method === 'POST') {
    const { telegram_id, email, amount } = req.body;
    const withdrawAmount = Number(amount);

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!email || !emailRegex.test(email)) {
      return res.status(400).json({ status: 'error', message: 'Please provide a valid registered email address.' });
    }

    if (!telegram_id || isNaN(withdrawAmount) || withdrawAmount <= 0) {
      return res.status(400).json({ status: 'error', message: 'Invalid withdrawal amount or Telegram ID.' });
    }

    // Fetch minimum points threshold configured in admin settings
    const settings = await getAppSettings();
    const minWithdraw = Number(settings.min_withdraw || 50);

    if (withdrawAmount < minWithdraw) {
      return res.status(400).json({
        status: 'error',
        message: `Minimum required withdrawal is ${minWithdraw.toFixed(2)} PTS. Please enter ${minWithdraw.toFixed(2)} or above.`
      });
    }

    try {
      let createdWithdrawal = null;

      // Run atomic database transaction to prevent double spending
      await db.runTransaction(async (t) => {
        const userRef = db.collection('users').doc(String(telegram_id));
        const userDoc = await t.get(userRef);

        if (!userDoc.exists) {
          throw new Error('User account not found.');
        }

        const userData = userDoc.data();
        const currentBal = Number(userData.balance || 0);

        if (currentBal < withdrawAmount) {
          throw new Error(`Insufficient points balance. You only have ${currentBal.toFixed(2)} PTS.`);
        }

        // Deduct custom requested points from balance
        t.update(userRef, { balance: currentBal - withdrawAmount });

        // Create pending withdrawal record
        const withdrawRef = db.collection('withdrawals').doc();
        createdWithdrawal = {
          id: withdrawRef.id,
          telegram_id: String(telegram_id),
          email: email.trim(),
          points: withdrawAmount,
          status: 'pending',
          created_at: new Date().toISOString()
        };

        t.set(withdrawRef, createdWithdrawal);
      });

      // Send Telegram Notifications (User & Log Channel)
      const botToken = settings.bot_token || process.env.BOT_TOKEN;
      const channelId = settings.channel_id;

      if (botToken && createdWithdrawal) {
        // Direct Alert to User via Bot
        const userMsg = `⏳ <b>Withdrawal Request Submitted</b>\n\n` +
          `💰 <b>Amount:</b> ${withdrawAmount.toFixed(2)} PTS\n` +
          `📧 <b>Destination Account:</b> <code>${email}</code>\n` +
          `📌 <b>Status:</b> Pending Admin Approval\n\n` +
          `Your payout is being reviewed. You will receive a message here when it is approved!`;
        sendTelegram(botToken, createdWithdrawal.telegram_id, userMsg);

        // Alert to Official Log Channel
        if (channelId) {
          const logMsg = `💳 <b>NEW WITHDRAWAL REQUEST (PENDING)</b>\n\n` +
            `👤 <b>User:</b> <code>${createdWithdrawal.telegram_id}</code>\n` +
            `📧 <b>Email:</b> <code>${createdWithdrawal.email}</code>\n` +
            `💰 <b>Points:</b> ${withdrawAmount.toFixed(2)} PTS\n` +
            `⏰ <b>Date:</b> ${new Date().toLocaleString()}`;
          sendTelegram(botToken, channelId, logMsg);
        }
      }

      return res.status(200).json({ status: 'success', points: withdrawAmount });
    } catch (err) {
      return res.status(400).json({ status: 'error', message: err.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
