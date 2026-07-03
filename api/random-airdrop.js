// api/admin/random-airdrop.js
import { runRandomAirdrop } from '../_lib/airdrop-service.js';

// Простая защита: секретный токен в заголовке или переменных окружения.
// Установите ADMIN_AIRDROP_TOKEN в Vercel → Settings → Environment Variables.
const ADMIN_TOKEN = process.env.ADMIN_AIRDROP_TOKEN;

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Защита от посторонних вызовов
  const auth = req.headers['x-admin-token'];
  if (!ADMIN_TOKEN || auth !== ADMIN_TOKEN) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  try {
    const { poolSize = 50, amountSol = 0.5 } = req.body || {};
    const result = await runRandomAirdrop({ poolSize, amountSol });

    if (!result.ok) {
      return res.status(400).json(result);
    }

    console.log(`[airdrop] sent ${result.amountSol} SOL -> @${result.handle} (${result.wallet}), tx=${result.signature}`);
    return res.status(200).json(result);
  } catch (e) {
    console.error('random-airdrop handler error:', e.message, e.stack);
    return res.status(500).json({ error: 'internal_error', message: String(e.message || e) });
  }
}
