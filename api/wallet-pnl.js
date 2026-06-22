// api/wallet-pnl.js
// Прокси через Chainstack Solana RPC: считает PnL кошелька за 24h / 7d / 30d

const RPC_URL = process.env.CHAINSTACK_RPC_URL || 'https://solana-mainnet.core.chainstack.com/359d1cb3664c9a13820bc52c23040bec';

const PERIODS = {
  '24h': 24 * 60 * 60,
  '7d':  7 * 24 * 60 * 60,
  '30d': 30 * 24 * 60 * 60,
};

// простой in-memory кэш (живёт пока жив serverless instance, TTL 5 мин)
const cache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000;

async function rpc(method, params = []) {
  const r = await fetch(RPC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  if (!r.ok) throw new Error(`RPC ${method} -> ${r.status}`);
  const json = await r.json();
  if (json.error) throw new Error(`RPC error: ${JSON.stringify(json.error)}`);
  return json.result;
}

// Цена SOL через CoinGecko (публичный эндпоинт, без ключа)
async function getSolPriceUsd() {
  try {
    const r = await fetch(
      'https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd',
      { headers: { 'Accept': 'application/json' } }
    );
    const json = await r.json();
    return json?.solana?.usd || 0;
  } catch {
    return 0;
  }
}

// Текущий баланс SOL в lamports -> SOL
async function getCurrentBalance(address) {
  const result = await rpc('getBalance', [address]);
  return (result?.value ?? 0) / 1e9;
}

// Подписи транзакций кошелька (до limit штук, начиная с самой новой)
async function getSignatures(address, limit = 1000) {
  return await rpc('getSignaturesForAddress', [
    address,
    { limit },
  ]);
}

// Полные данные транзакций батчами
async function getTransactions(signatures) {
  const BATCH = 10;
  const txs = [];
  for (let i = 0; i < signatures.length; i += BATCH) {
    const batch = signatures.slice(i, i + BATCH);
    const results = await Promise.all(
      batch.map(({ signature }) =>
        rpc('getTransaction', [
          signature,
          { encoding: 'json', maxSupportedTransactionVersion: 0 },
        ])
      )
    );
    txs.push(...results.filter(Boolean));
  }
  return txs;
}

// Считаем net flow SOL по транзакциям для данного адреса
function calcNetFlowSol(txs, address) {
  let net = 0;
  for (const tx of txs) {
    if (!tx?.meta || tx.meta.err !== null) continue; // пропускаем failed

    const accounts = tx.transaction?.message?.accountKeys || [];
    const idx = accounts.findIndex(
      (k) => (typeof k === 'string' ? k : k?.pubkey) === address
    );
    if (idx === -1) continue;

    const pre  = tx.meta.preBalances?.[idx]  ?? 0;
    const post = tx.meta.postBalances?.[idx] ?? 0;
    net += (post - pre) / 1e9;
  }
  return net;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  const address = (req.query.address || '').toString().trim();

  if (!address) {
    return res.status(400).json({ error: 'missing_address' });
  }
  // Validate SOL address format (base58, 32-44 chars)
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) {
    return res.status(400).json({ error: 'invalid_address' });
  }

  const cached = cache.get(address);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return res.status(200).json(cached.data);
  }

  try {
    const now = Math.floor(Date.now() / 1000);
    const oldestPeriod = now - PERIODS['30d'];

    const [solPrice, allSigs] = await Promise.all([
      getSolPriceUsd(),
      getSignatures(address, 1000),
    ]);

    // Фильтруем только подписи в нужном диапазоне (30d макс)
    const relevantSigs = allSigs.filter(
      (s) => s.blockTime && s.blockTime >= oldestPeriod
    );

    // Грузим транзакции один раз для всех периодов
    const txs = await getTransactions(relevantSigs);

    // Мапим blockTime обратно к транзакциям
    const txsWithTime = txs.map((tx, i) => ({
      ...tx,
      _blockTime: relevantSigs[i]?.blockTime ?? tx.blockTime ?? 0,
    }));

    const result = { address, solPriceUsd: solPrice, pnl: {} };

    for (const [label, seconds] of Object.entries(PERIODS)) {
      const since = now - seconds;
      const periodTxs = txsWithTime.filter((tx) => tx._blockTime >= since);
      const netSol = calcNetFlowSol(periodTxs, address);
      const netUsd = netSol * solPrice;
      result.pnl[label] = {
        sol:     Number(netSol.toFixed(4)),
        usd:     Number(netUsd.toFixed(2)),
        txCount: periodTxs.length,
      };
    }

    cache.set(address, { ts: Date.now(), data: result });
    return res.status(200).json(result);
  } catch (e) {
    console.error('[wallet-pnl] error:', e);
    return res.status(502).json({ error: 'proxy_failed', message: String(e), stack: e?.stack });
  }
}
