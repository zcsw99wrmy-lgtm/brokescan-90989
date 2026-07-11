// api/admin/leaderboard-keep-only.js
//
// Служебный эндпоинт: оставляет в лидерборде только одного участника
// (по handle), остальных удаляет из Blob-хранилища. Нужен, чтобы
// протестировать отправку SOL на "чистом" лидерборде без лишних записей.
//
// Защищён заголовком x-admin-secret (значение — ADMIN_SECRET из env).
//
// Использование:
//   curl -X POST https://<ваш-домен>/api/admin/leaderboard-keep-only \
//     -H "x-admin-secret: <ADMIN_SECRET>" \
//     -H "Content-Type: application/json" \
//     -d '{"handle":"nikkanewmethod"}'
//
// ⚠️ Путь импорта ниже предполагает, что этот файл лежит в api/admin/,
// а исходный обработчик лидерборда — в api/leaderboard.js.
// Если у вас другая структура папок — поправьте относительный путь.
import { readLb, writeLb } from '../leaderboard.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const secret = req.headers['x-admin-secret'];
  if (!process.env.ADMIN_SECRET || secret !== process.env.ADMIN_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { handle } = req.body || {};
    if (!handle) {
      return res.status(400).json({ error: 'handle required' });
    }

    const lb = await readLb();

    if (!lb[handle]) {
      return res.status(404).json({
        error: 'handle not found in leaderboard',
        available: Object.keys(lb),
      });
    }

    const removedHandles = Object.keys(lb).filter((h) => h !== handle);
    const kept = { [handle]: lb[handle] };

    await writeLb(kept);

    return res.status(200).json({
      ok: true,
      kept: handle,
      removedCount: removedHandles.length,
      removedHandles,
    });
  } catch (e) {
    console.error('leaderboard-keep-only error:', e.message, e.stack);
    return res.status(500).json({ error: 'internal_error', message: String(e.message || e) });
  }
}
