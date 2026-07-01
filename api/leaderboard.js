import { put, list } from '@vercel/blob';

const LB_KEY     = 'brokescan-leaderboard.json';
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 дней

async function readLb() {
  try {
    const { blobs } = await list({ prefix: LB_KEY });
    if (!blobs.length) return {};
    const r = await fetch(blobs[0].downloadUrl);
    if (!r.ok) return {};
    const data = await r.json();
    return (data && typeof data === 'object' && !Array.isArray(data)) ? data : {};
  } catch (e) {
    console.error('readLb error:', e.message);
    return {};
  }
}

async function writeLb(data) {
  await put(LB_KEY, JSON.stringify(data), {
    access: 'public',
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: 'application/json',
  });
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  try {
    if (req.method === 'GET') {
      const lb = await readLb();
      const now = Date.now();

      // Отфильтровываем протухшие записи, попутно отсеивая любые "битые"
      // (не-объекты / null), чтобы одна плохая запись не роняла весь эндпоинт.
      const filtered = Object.fromEntries(
        Object.entries(lb).filter(([, v]) => {
          if (!v || typeof v !== 'object') return false;
          return !v.firstSeen || (now - v.firstSeen) < MAX_AGE_MS;
        })
      );

      return res.status(200).json({ leaderboard: filtered });
    }

    if (req.method === 'POST') {
      const entry = req.body;
      if (!entry?.handle) return res.status(400).json({ error: 'handle required' });

      const lb = await readLb();
      const ex = lb[entry.handle];
      const exSafe = (ex && typeof ex === 'object') ? ex : {};

      lb[entry.handle] = {
        name:       entry.name   || exSafe.name   || entry.handle,
        handle:     entry.handle,
        avatar:     entry.avatar || exSafe.avatar || '',
        wallet:     entry.wallet || exSafe.wallet || null,
        tweetCount: (exSafe.tweetCount || 0) + 1,
        daily:      entry.daily   ?? exSafe.daily  ?? null,
        weekly:     entry.weekly  ?? exSafe.weekly ?? null,
        monthly:    entry.monthly ?? exSafe.monthly ?? null,
        firstSeen:  exSafe.firstSeen || Date.now(),
        lastSeen:   Date.now(),
      };

      await writeLb(lb);
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    console.error('leaderboard handler error:', e.message, e.stack);
    return res.status(500).json({ error: 'internal_error', message: String(e.message || e) });
  }
}
