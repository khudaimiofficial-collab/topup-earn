import { getBotConfig } from '../lib/firebase.js';

export default async function handler(req, res) {
  const { botToken } = await getBotConfig();
  if (!botToken) {
    return res.status(404).send('Bot token not configured');
  }

  try {
    // 1. Get Bot ID from Telegram
    const meRes = await fetch(`https://api.telegram.org/bot${botToken}/getMe`);
    const meData = await meRes.json();
    if (!meData.ok) return res.status(404).send('Bot not found');

    // 2. Fetch Bot's Profile Picture
    const photosRes = await fetch(`https://api.telegram.org/bot${botToken}/getUserProfilePhotos?user_id=${meData.result.id}&limit=1`);
    const photosData = await photosRes.json();

    // If no picture is set in BotFather, return fallback glowing diamond SVG
    if (!photosData.ok || !photosData.result?.photos?.length) {
      res.setHeader('Content-Type', 'image/svg+xml');
      return res.status(200).send(`
        <svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
          <rect width="100" height="100" fill="#0f172a"/>
          <circle cx="50" cy="50" r="45" fill="#1e293b" stroke="#38bdf8" stroke-width="3"/>
          <text x="50%" y="56%" dominant-baseline="middle" text-anchor="middle" font-size="44">💎</text>
        </svg>
      `);
    }

    // 3. Get the photo file path
    const photoSizes = photosData.result.photos[0];
    const fileId = photoSizes[photoSizes.length - 1].file_id; // Largest resolution

    const fileRes = await fetch(`https://api.telegram.org/bot${botToken}/getFile?file_id=${fileId}`);
    const fileData = await fileRes.json();
    if (!fileData.ok) return res.status(404).send('File not found');

    // 4. Download and stream the photo (Hiding the BOT_TOKEN from the browser)
    const filePath = fileData.result.file_path;
    const imgRes = await fetch(`https://api.telegram.org/file/bot${botToken}/${filePath}`);
    const imgBuffer = await imgRes.arrayBuffer();

    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=86400'); // Cache for 24 hours
    return res.status(200).send(Buffer.from(imgBuffer));
  } catch (err) {
    console.error('Avatar error:', err);
    return res.status(500).send('Error loading avatar');
  }
}
