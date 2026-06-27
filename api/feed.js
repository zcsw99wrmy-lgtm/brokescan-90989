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
    const tweets = all.filter(t => !t.fetched_at || (now - t.fetched_at) < MAX_AGE_MS);
    return res.status(200).json({ tweets });
  }
  res.status(405).json({ error: 'Method not allowed' });
}
