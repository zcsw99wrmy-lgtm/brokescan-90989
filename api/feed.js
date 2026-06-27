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

    // since передаёт клиент — отдаём только новее этого момента
    // Если since не передан — отдаём последние 30 минут (как было)
    const sinceParam = req.query.since ? parseInt(req.query.since, 10) : null;

    const tweets = all.filter(t => {
      if (!t.fetched_at) return false;
      if ((now - t.fetched_at) > MAX_AGE_MS) return false;
      if (sinceParam) return t.fetched_at > sinceParam;
      return true; // первый визит — все твиты за 30 минут
    });

    return res.status(200).json({ tweets, serverTime: now });
  }

  res.status(405).json({ error: 'Method not allowed' });
}
