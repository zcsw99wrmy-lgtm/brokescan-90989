// api/wallet-pnl.js
// Считает PnL кошелька за 24h / 7d / 30d через публичный Solana RPC

const RPC_ENDPOINTS = [
  'https://api.mainnet-beta.solana.com',
  'https://solana-api.projectserum.com',
  process.env.CHAINSTACK_RPC_URL,
].filter(Boolean);

const PERIODS = { '24h': 86400, '7d': 604800, '30d': 2592000 };
const cache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000;

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

async function getSignatures(address, limit = 50) {
  return await rpc('getSignaturesForAddress', [address, { limit }]);
}

async function getTransactions(signatures) {
  const BATCH = 5;
  const txs = [];
  for (let i = 0; i < signatures.length; i += BATCH) {
    const batch = signatures.slice(i, i + BATCH);
    const results = await Promise.all(
      batch.map(({ signature }) =>
        rpc('getTransaction', [signature, { encoding: 'json', maxSupportedTransactionVersion: 0 }])
      )
    );
    txs.push(...results.filter(Boolean));
    if (i + BATCH < signatures.length) await new Promise(r => setTimeout(r, 200));
  }
  return txs;
}

function calcNetFlowSol(txs, address) {
  let net = 0;
  for (const tx of txs) {
    if (!tx?.meta || tx.meta.err !== null) continue;
    const accounts = tx.transaction?.message?.accountKeys || [];
    const idx = accounts.findIndex(k => (typeof k === 'string' ? k : k?.pubkey) === address);
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
  if (!address) return res.status(400).json({ error: 'missing_address' });
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) return res.status(400).json({ error: 'invalid_address' });

  const cached = cache.get(address);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) return res.status(200).json(cached.data);

  try {
    const now = Math.floor(Date.now() / 1000);
    const oldestPeriod = now - PERIODS['30d'];

    const [solPrice, allSigs] = await Promise.all([getSolPriceUsd(), getSignatures(address, 1000)]);
    const relevantSigs = allSigs.filter(s => s.blockTime && s.blockTime >= oldestPeriod);
    const txs = await getTransactions(relevantSigs);

    const txsWithTime = txs.map((tx, i) => ({ ...tx, _blockTime: relevantSigs[i]?.blockTime ?? 0 }));

    const result = { address, solPriceUsd: solPrice, pnl: {} };
    for (const [label, seconds] of Object.entries(PERIODS)) {
      const since = now - seconds;
      const periodTxs = txsWithTime.filter(tx => tx._blockTime >= since);
      const netSol = calcNetFlowSol(periodTxs, address);
      result.pnl[label] = {
        sol: Number(netSol.toFixed(4)),
        usd: Number((netSol * solPrice).toFixed(2)),
        txCount: periodTxs.length,
      };
    }

    cache.set(address, { ts: Date.now(), data: result });
    return res.status(200).json(result);
  } catch (e) {
    return res.status(502).json({ error: 'proxy_failed', message: String(e) });
  }
}
