// api/cron-airdrop.js
//
// Вызывается автоматически Vercel Cron (см. vercel.json, schedule "*/5 * * * *").
// Vercel сам добавляет заголовок Authorization: Bearer <CRON_SECRET>,
// если переменная CRON_SECRET задана в env проекта — мы просто сверяем её.
// Секрет нигде не светится в коде/URL, в отличие от /api/fetch-tweets.
import { runRandomAirdrop } from './airdrop-service.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  const authHeader = req.headers['authorization'];
  const expected = `Bearer ${process.env.CRON_SECRET}`;
  if (!process.env.CRON_SECRET || authHeader !== expected) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  try {
    // Сумма берётся из AIRDROP_AMOUNT_SOL (env), с фолбэком на 0.5 SOL,
    // если переменная вдруг не задана.
    const amountSol = parseFloat(process.env.AIRDROP_AMOUNT_SOL || '0.5');
    const result = await runRandomAirdrop({ amountSol });

    if (!result.ok) {
      console.log('[cron-airdrop] no eligible recipient or send failed:', result);
      return res.status(200).json(result); // 200, чтобы Vercel не считал это сбоем крона
    }

    console.log(`[cron-airdrop] sent ${result.amountSol} SOL -> @${result.handle} (${result.wallet}), tx=${result.signature}`);
    return res.status(200).json(result);
  } catch (e) {
    console.error('cron-airdrop handler error:', e.message, e.stack);
    return res.status(500).json({ error: 'internal_error', message: String(e.message || e) });
  }
}
