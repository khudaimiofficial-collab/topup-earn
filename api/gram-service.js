// /api/gram-service.js
import { TonClient, WalletContractV4, internal, toNano, Address, comment } from "@ton/ton";
import { mnemonicToPrivateKey } from "@ton/crypto";
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
    console.error("Firebase init error in gram-service:", e);
  }
}

const db = admin.firestore();

async function getWalletCredentials() {
  try {
    const doc = await db.collection("app_config").doc("main").get();
    const config = doc.exists ? doc.data() : {};

    return {
      mnemonic: (config.hot_wallet_mnemonic || process.env.HOT_WALLET_MNEMONIC || "").trim(),
      apiKey: (config.toncenter_api_key || process.env.TONCENTER_API_KEY || "").trim(),
      rpcEndpoint: "https://toncenter.com/api/v2/jsonRPC"
    };
  } catch (err) {
    console.error("Wallet creds read error:", err.message);
    return {
      mnemonic: (process.env.HOT_WALLET_MNEMONIC || "").trim(),
      apiKey: (process.env.TONCENTER_API_KEY || "").trim(),
      rpcEndpoint: "https://toncenter.com/api/v2/jsonRPC"
    };
  }
}

export async function executeGramTransfer(recipientAddress, gramAmount) {
  const { mnemonic, apiKey, rpcEndpoint } = await getWalletCredentials();

  if (!mnemonic) {
    throw new Error("Hot Wallet mnemonic not configured. Save it in Admin Settings.");
  }

  const words = mnemonic.split(/\s+/);
  if (words.length !== 24 && words.length !== 12) {
    throw new Error("Invalid mnemonic. Must be 12 or 24 words.");
  }

  const client = new TonClient({ endpoint: rpcEndpoint, apiKey: apiKey || undefined });
  const keyPair = await mnemonicToPrivateKey(words);
  const wallet = WalletContractV4.create({
    workchain: 0,
    publicKey: keyPair.publicKey,
  });

  const contract = client.open(wallet);
  const seqno = await contract.getSeqno();
  const toAddress = Address.parse(recipientAddress);
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
    seqno,
    timestamp: new Date().toISOString()
  };
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed. Use POST." });
  }

  const { recipient_address, gram_amount, secret_key } = req.body || {};

  const adminSecret = process.env.ADMIN_SECRET_KEY;
  if (adminSecret && secret_key !== adminSecret) {
    return res.status(401).json({ error: "Unauthorized." });
  }

  const amount = parseFloat(gram_amount);
  if (!recipient_address || isNaN(amount) || amount <= 0) {
    return res.status(400).json({ error: "Invalid parameters." });
  }

  try {
    const result = await executeGramTransfer(recipient_address.trim(), amount);
    return res.status(200).json({
      status: "success",
      message: `Sent ${amount} GRAM`,
      data: result
    });
  } catch (error) {
    console.error("Blockchain error:", error);
    return res.status(500).json({
      status: "error",
      message: error.message || "Failed to send Gram."
    });
  }
}
