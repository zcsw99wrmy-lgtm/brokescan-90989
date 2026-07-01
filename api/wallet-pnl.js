// api/wallet-pnl.js
// Возвращает текущий баланс SOL кошелька

const RPC_ENDPOINTS = [
  process.env.CHAINSTACK_RPC_URL,
  'https://api.mainnet-beta.solana.com',
  'https://solana-api.projectserum.com',
].filter(Boolean);

const cache = new Map();
const CACHE_TTL_MS = 2 * 60 * 1000; // 2 минуты
const RPC_TIMEOUT_MS = 4000;        // не ждём один RPC дольше 4 секунд

// Один запрос к конкретному RPC-эндпоинту с жёстким таймаутом
async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function rpcOne(url, method, params) {
  const r = await fetchWithTimeout(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  }, RPC_TIMEOUT_MS);

  if (!r.ok) throw new Error(`RPC ${r.status} (${url})`);
  const json = await r.json();
  if (json.error) throw new Error(`RPC error: ${JSON.stringify(json.error)} (${url})`);
  return json.result;
}

// Опрашиваем все эндпоинты ПАРАЛЛЕЛЬНО, берём первый успешный ответ.
// Если все упали/протаймаутили — бросаем последнюю ошибку.
async function rpc(method, params = []) {
  if (!RPC_ENDPOINTS.length) throw new Error('no_rpc_endpoints_configured');

  const attempts = RPC_ENDPOINTS.map(url => rpcOne(url, method, params));

  try {
    return await Promise.any(attempts);
  } catch (aggErr) {
    const reasons = (aggErr.errors || []).map(e => e.message).join(' | ');
    throw new Error(`all_rpc_failed: ${reasons || aggErr.message}`);
  }
}

async function getSolPriceUsd() {
  try {
    const r = await fetchWithTimeout(
      'https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd',
      {},
      3000
    );
    const json = await r.json();
    return json?.solana?.usd || 150;
  } catch {
    return 150;
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  const address = (req.query.address || '').toString().trim();
  if (!address) return res.status(400).json({ error: 'missing_address' });
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) {
    return res.status(400).json({ error: 'invalid_address' });
  }

  const cached = cache.get(address);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return res.status(200).json(cached.data);
  }

  try {
    const [balanceResult, solPrice] = await Promise.all([
      rpc('getBalance', [address]),
      getSolPriceUsd(),
    ]);

    const balanceSol = (balanceResult?.value ?? 0) / 1e9;
    const balanceUsd = balanceSol * solPrice;

    const result = {
      address,
      solPriceUsd: solPrice,
      balanceSol: Number(balanceSol.toFixed(4)),
      balanceUsd: Number(balanceUsd.toFixed(2)),
    };

    cache.set(address, { ts: Date.now(), data: result });
    return res.status(200).json(result);
  } catch (e) {
    console.error('wallet-pnl error:', e.message);
    return res.status(502).json({ error: 'proxy_failed', message: String(e.message || e) });
  }
}
