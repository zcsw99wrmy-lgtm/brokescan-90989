export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');
  try {
    const r = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd&t=' + Date.now());
    const data = await r.json();
    res.status(200).json({ price: data?.solana?.usd || null });
  } catch(e) {
    res.status(502).json({ error: String(e) });
  }
}
