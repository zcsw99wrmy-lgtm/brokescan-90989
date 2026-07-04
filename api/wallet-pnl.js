// api/wallet-pnl.js
// Возвращает текущий баланс SOL кошелька

const RPC_ENDPOINTS = [
  'https://api.mainnet-beta.solana.com',
  'https://solana-api.projectserum.com',
  process.env.CHAINSTACK_RPC_URL,
].filter(Boolean);

const cache = new Map();
const CACHE_TTL_MS = 2 * 60 * 1000; // 2 минуты

async function rpc(method, params = []) {
  let lastErr;
  for (const url of RPC_ENDPOINTS) {
    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      });
      if (!r.ok) { lastErr = new Error(`RPC ${r.status}`); continue; }
      const json = await r.json();
      if (json.error) { lastErr = new Error(`RPC error: ${JSON.stringify(json.error)}`); continue; }
      return json.result;
    } catch (e) { lastErr = e; }
  }
  throw lastErr;
}

async function getSolPriceUsd() {
  try {
    const r = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd');
    const json = await r.json();
    return json?.solana?.usd || 150;
  } catch { return 150; }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  const address = (req.query.address || '').toString().trim();
  if (!address) return res.status(400).json({ error: 'missing_address' });
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) return res.status(400).json({ error: 'invalid_address' });

  const cached = cache.get(address);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) return res.status(200).json(cached.data);

  try {
    const [balanceLamports, solPrice] = await Promise.all([
      rpc('getBalance', [address]),
      getSolPriceUsd(),
    ]);

    const balanceSol = (balanceLamports ?? 0) / 1e9;
    const balanceUsd = balanceSol * solPrice;

    const result = {
      address,
      solPriceUsd: solPrice,
      balance: {
        sol: Number(balanceSol.toFixed(4)),
        usd: Number(balanceUsd.toFixed(2)),
      },
      // Плоские поля — их ждёт фронтенд в _applyPnl() (index.html)
      balanceSol: Number(balanceSol.toFixed(4)),
      balanceUsd: Number(balanceUsd.toFixed(2)),
      // Для совместимости с клиентом
      pnl: {
        '24h': { sol: Number(balanceSol.toFixed(4)), usd: Number(balanceUsd.toFixed(2)), txCount: 0 },
        '7d':  { sol: Number(balanceSol.toFixed(4)), usd: Number(balanceUsd.toFixed(2)), txCount: 0 },
        '30d': { sol: Number(balanceSol.toFixed(4)), usd: Number(balanceUsd.toFixed(2)), txCount: 0 },
      },
    };

    cache.set(address, { ts: Date.now(), data: result });
    return res.status(200).json(result);
  } catch (e) {
    return res.status(502).json({ error: 'proxy_failed', message: String(e) });
  }
}
