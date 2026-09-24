import admin from 'firebase-admin';

// Initialize Firebase Admin SDK if it hasn't been initialized already
if (!admin.apps.length) {
  // Read the entire JSON credentials from your Vercel Environment Variable
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

// Export Firestore database instance and FieldValue helper for atomic increments
export const db = admin.firestore();
export const FieldValue = admin.firestore.FieldValue;
