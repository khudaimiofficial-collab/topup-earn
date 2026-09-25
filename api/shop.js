import admin from 'firebase-admin';

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT))
  });
}
const db = admin.firestore();

export default async function handler(req, res) {
  const { action } = req.query.action ? req.query : req.body;

  // 1. GET ALL TOP-UP PRODUCTS
  if (req.method === 'GET' && action === 'get_products') {
    try {
      const snap = await db.collection('products').orderBy('price', 'asc').get();
      const products = snap.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      return res.status(200).json({ products });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // 2. GET USER'S ORDER HISTORY
  if (req.method === 'GET' && action === 'my_orders') {
    const telegram_id = String(req.query.telegram_id);
    try {
      const snap = await db.collection('product_orders')
        .where('telegram_id', '==', telegram_id)
        .orderBy('created_at', 'desc')
        .get();

      const orders = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      return res.status(200).json({ orders });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // 3. PURCHASE / ORDER PRODUCT
  if (req.method === 'POST' && req.body.action === 'buy_product') {
    const { product_id, telegram_id, player_info } = req.body;

    if (!player_info || !product_id || !telegram_id) {
      return res.status(400).json({ success: false, error: 'Missing required parameters' });
    }

    try {
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

        // Create pending order for admin
        const orderRef = db.collection('product_orders').doc();
        t.set(orderRef, {
          telegram_id: String(telegram_id),
          product_id: product_id,
          product_title: prodData.title,
          price_paid: price,
          player_info: player_info,
          status: 'pending',
          created_at: new Date().toISOString()
        });
      });

      return res.status(200).json({ success: true });
    } catch (err) {
      return res.status(400).json({ success: false, error: err.message });
    }
  }

  return res.status(404).json({ error: 'Endpoint not found' });
}
