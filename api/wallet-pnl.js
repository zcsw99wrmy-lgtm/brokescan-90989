// api/wallet-pnl.js
// Прокси к SolScan API: считает PnL кошелька за 24h / 7d / 30d
// Использование: /api/wallet-pnl?address=<SOL_WALLET_ADDRESS>

const SOLSCAN_BASE = 'https://pro-api.solscan.io/v2.0';

const PERIODS = {
  '24h': 24 * 60 * 60,
  '7d': 7 * 24 * 60 * 60,
  '30d': 30 * 24 * 60 * 60,
};

// простой in-memory кэш (живёт пока жив serverless instance, TTL 5 мин)
const cache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000;

async function solscanFetch(path, apiKey) {
  const r = await fetch(`${SOLSCAN_BASE}${path}`, {
    headers: { 'token': apiKey },
  });
  if (r.status === 404) return null;
  if (!r.ok) {
    throw new Error(`SolScan ${path} -> ${r.status}`);
  }
  return r.json();
}

async function getSolPriceUsd(apiKey) {
  try {
    const data = await solscanFetch('/market/token/So11111111111111111111111111111111111111112', apiKey);
    return data?.data?.priceUsdt || data?.data?.price || 0;
  } catch {
    return 0;
  }
}

// Берём баланс SOL кошелька на текущий момент
async function getCurrentBalance(address, apiKey) {
  const data = await solscanFetch(`/account/detail?address=${address}`, apiKey);
  if (!data) return 0;
  const lamports = data?.data?.lamports ?? 0;
  return lamports / 1e9;
}

async function getActivities(address, apiKey, sinceUnix) {
  let page = 1;
  const pageSize = 40;
  let all = [];
  for (let i = 0; i < 10; i++) {
    const data = await solscanFetch(
      `/account/transfer?address=${address}&page=${page}&page_size=${pageSize}&sort_by=block_time&sort_order=desc`,
      apiKey
    );
    if (!data) break;
    const items = data?.data || [];
    if (!items.length) break;
    all = all.concat(items);
    const oldest = items[items.length - 1];
    if (oldest?.block_time && oldest.block_time < sinceUnix) break;
    page++;
  }
  return all.filter((tx) => tx.block_time && tx.block_time >= sinceUnix);
}

// Считаем чистый PnL за период: (входящие - исходящие) в SOL, переведённые в USD
// Это приблизительный PnL (без учёта изменения цены токенов в портфеле),
// но игнорирует депозиты/выводы как "не-PnL" нельзя точно отличить -
// поэтому считаем net flow * текущая цена SOL как approx PnL.
function calcNetFlowSol(activities, address) {
  let net = 0;
  for (const tx of activities) {
    const amountSol = (tx.amount || 0) / 1e9;
    if (!amountSol) continue;
    if (tx.to_address?.toLowerCase() === address.toLowerCase()) {
      net += amountSol;
    } else if (tx.from_address?.toLowerCase() === address.toLowerCase()) {
      net -= amountSol;
    }
  }
  return net;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  const address = (req.query.address || '').toString().trim();
  const API_KEY = process.env.SOLSCAN_API_KEY;

  if (!address) {
    return res.status(400).json({ error: 'missing_address' });
  }
  // Validate SOL address format (base58, 32-44 chars)
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) {
    return res.status(400).json({ error: 'invalid_address' });
  }
  if (!API_KEY) {
    return res.status(500).json({ error: 'missing_api_key', hint: 'Set SOLSCAN_API_KEY in environment variables' });
  }

  const cacheKey = address;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return res.status(200).json(cached.data);
  }

  try {
    const now = Math.floor(Date.now() / 1000);
    const solPrice = await getSolPriceUsd(API_KEY);

    const result = { address, solPriceUsd: solPrice, pnl: {} };

    for (const [label, seconds] of Object.entries(PERIODS)) {
      const since = now - seconds;
      const activities = await getActivities(address, API_KEY, since);
      const netSol = calcNetFlowSol(activities, address);
      const netUsd = netSol * solPrice;
      result.pnl[label] = {
        sol: Number(netSol.toFixed(4)),
        usd: Number(netUsd.toFixed(2)),
        txCount: activities.length,
      };
    }

    cache.set(cacheKey, { ts: Date.now(), data: result });
    return res.status(200).json(result);
  } catch (e) {
    console.error('[wallet-pnl] error:', e);
    return res.status(502).json({ error: 'proxy_failed', message: String(e), stack: e?.stack });
  }
}
