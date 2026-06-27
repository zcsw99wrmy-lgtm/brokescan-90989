import { put, list, get } from '@vercel/blob';

const FEED_KEY   = 'brokescan-feed.json';
const MAX_AGE_MS = 30 * 60 * 1000;

async function readFeed() {
  try {
    const { blobs } = await list({ prefix: FEED_KEY });
    if (!blobs.length) return [];
    const result = await get(blobs[0].pathname, { access: 'private' });
    if (!result || !result.stream) return [];
    const text = await new Response(result.stream).text();
    return JSON.parse(text);
  } catch { return []; }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'GET') {
    const now = Date.now();
    const all = await readFeed();

    // Клиент передаёт ?since=<timestamp> — дата последнего полученного твита
    // Если since не передан (первый визит) — отдаём только последние 60 секунд
    // чтобы новый юзер не получил кучу старых твитов
    const sinceParam = req.query.since ? parseInt(req.query.since, 10) : null;
    const cutoff = sinceParam
      ? sinceParam           // клиент знает с какого момента хочет
      : now - 60 * 1000;    // новый юзер — только последняя минута

    const tweets = all.filter(t => {
      if (!t.fetched_at) return false;
      if ((now - t.fetched_at) > MAX_AGE_MS) return false; // старше 30 мин — выкидываем
      return t.fetched_at > cutoff;                         // только новее cutoff
    });

    return res.status(200).json({ tweets, serverTime: now });
  }

  res.status(405).json({ error: 'Method not allowed' });
}
