// topup-earn-main/api/gram-service.js
import { TonClient, WalletContractV4, internal, toNano, Address, comment } from "@ton/ton";
import { mnemonicToPrivateKey } from "@ton/crypto";
import admin from "firebase-admin";

// Initialize Firebase Admin SDK
if (!admin.apps.length) {
  try {
    if (process.env.FIREBASE_SERVICE_ACCOUNT) {
      admin.initializeApp({
        credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT))
      });
    } else {
      admin.initializeApp({
        credential: admin.credential.applicationDefault()
      });
    }
  } catch (e) {
    console.error("Firebase init error in gram-service:", e);
  }
}

const db = admin.firestore();

// 1. Helper to retrieve Hot Wallet Mnemonic & API Key dynamically from Admin Settings
async function getWalletCredentials() {
  try {
    const configDoc = await db.collection("app_config").doc("main").get();
    const config = configDoc.exists ? configDoc.data() : {};

    return {
      mnemonic: (config.hot_wallet_mnemonic || process.env.HOT_WALLET_MNEMONIC || "").trim(),
      apiKey: (config.toncenter_api_key || process.env.TONCENTER_API_KEY || "").trim(),
      rpcEndpoint: "https://toncenter.com/api/v2/jsonRPC"
    };
  } catch (err) {
    console.error("Error reading wallet credentials from Firestore:", err);
    return {
      mnemonic: (process.env.HOT_WALLET_MNEMONIC || "").trim(),
      apiKey: (process.env.TONCENTER_API_KEY || "").trim(),
      rpcEndpoint: "https://toncenter.com/api/v2/jsonRPC"
    };
  }
}

// 2. Core Blockchain Transfer Logic
export async function executeGramTransfer(recipientAddress, gramAmount) {
  const { mnemonic, apiKey, rpcEndpoint } = await getWalletCredentials();

  if (!mnemonic) {
    throw new Error("Hot Wallet 24-word secret phrase is not configured. Please set it in Admin Settings!");
  }

  const words = mnemonic.split(/\s+/);
  if (words.length !== 24 && words.length !== 12) {
    throw new Error("Invalid mnemonic phrase format. Must be 12 or 24 words.");
  }

  // A. Initialize TonClient
  const client = new TonClient({
    endpoint: rpcEndpoint,
    apiKey: apiKey || undefined,
  });

  // B. Derive KeyPair from Mnemonic
  const keyPair = await mnemonicToPrivateKey(words);

  // C. Open Tonkeeper Standard V4R2 Wallet
  const wallet = WalletContractV4.create({
    workchain: 0,
    publicKey: keyPair.publicKey,
  });

  const contract = client.open(wallet);
  const seqno = await contract.getSeqno();

  // D. Validate Destination Gram Wallet Address
  const toAddress = Address.parse(recipientAddress);

  // E. Build Direct Transfer (1 GRAM = 10^9 nanoGram)
  const transferAmountNano = toNano(gramAmount.toString());

  await contract.sendTransfer({
    seqno: seqno,
    secretKey: keyPair.secretKey,
    messages: [
      internal({
        to: toAddress,
        value: transferAmountNano,
        bounce: false,
        body: comment("Free Gram Token Payout"),
      }),
    ],
  });

  return {
    success: true,
    sender: wallet.address.toString({ bounceable: false }),
    recipient: recipientAddress,
    amount: gramAmount,
    seqno: seqno,
    timestamp: new Date().toISOString()
  };
}

// 3. Vercel Serverless Function Handler
export default async function handler(req, res) {
  // Only accept POST requests
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed. Use POST." });
  }

  const { recipient_address, gram_amount, secret_key } = req.body;

  // Optional: Simple security check if calling this endpoint directly via HTTP
  const adminSecret = process.env.ADMIN_SECRET_KEY;
  if (adminSecret && secret_key !== adminSecret) {
    return res.status(401).json({ error: "Unauthorized access to Gram Service." });
  }

  const amount = parseFloat(gram_amount);

  if (!recipient_address || isNaN(amount) || amount <= 0) {
    return res.status(400).json({
      error: "Invalid parameters. Provide 'recipient_address' and a valid 'gram_amount'."
    });
  }

  try {
    const result = await executeGramTransfer(recipient_address.trim(), amount);
    return res.status(200).json({
      status: "success",
      message: `Successfully broadcasted ${amount} GRAM transfer to blockchain.`,
      data: result
    });
  } catch (error) {
    console.error("Blockchain execution failure:", error);
    return res.status(500).json({
      status: "error",
      message: error.message || "Failed to dispatch Gram transaction."
    });
  }
}
