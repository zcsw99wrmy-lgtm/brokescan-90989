// api/treasury-check.js
//
// Диагнотрстика: показывает публичный адрес кошелька-раздатчика (полученный
// из TREASURY_PRIVATE_KEY) и его текущий баланс в SOL. Приватный ключ
// нигде не возвращается. Защищено тем же ADMIN_AIRDROP_TOKEN.
import { Connection, Keypair, LAMPORTS_PER_SOL } from '@solana/web3.js';
import bs58 from 'bs58';

const ADMIN_TOKEN = process.env.ADMIN_AIRDROP_TOKEN;
const RPC_URL = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'x-admin-token');

  if (req.method === 'OPTIONS') return res.status(204).end();

  const auth = req.headers['x-admin-token'];
  if (!ADMIN_TOKEN || auth !== ADMIN_TOKEN) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  try {
    const secret = process.env.TREASURY_PRIVATE_KEY;
    if (!secret) {
      return res.status(400).json({ error: 'TREASURY_PRIVATE_KEY не задан' });
    }

    let keypair;
    try {
      keypair = Keypair.fromSecretKey(bs58.decode(secret));
    } catch (e) {
      return res.status(400).json({
        error: 'Не удалось декодировать TREASURY_PRIVATE_KEY как base58 secret key',
        details: e.message,
      });
    }

    const connection = new Connection(RPC_URL, 'confirmed');
    const lamports = await connection.getBalance(keypair.publicKey);

    return res.status(200).json({
      rpcUrl: RPC_URL,
      publicAddress: keypair.publicKey.toBase58(),
      balanceSol: lamports / LAMPORTS_PER_SOL,
      balanceLamports: lamports,
    });
  } catch (e) {
    return res.status(500).json({ error: 'internal_error', message: e.message });
  }
}
