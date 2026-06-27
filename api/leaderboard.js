import { put, list } from '@vercel/blob';

const LB_KEY = 'brokescan-leaderboard.json';

async function readLb() {
  try {
    const { blobs } = await list({ prefix: LB_KEY });
    if (!blobs.length) return {};
    const r = await fetch(blobs[0].downloadUrl);
    if (!r.ok) return {};
    return await r.json();
  } catch { return {}; }
}

async function writeLb(data) {
  await put(LB_KEY, JSON.stringify(data), {
    access: 'public', addRandomSuffix: false, contentType: 'application/json',
  });
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'GET') {
    const lb = await readLb();
    return res.status(200).json({ leaderboard: lb });
  }

  if (req.method === 'POST') {
    const entry = req.body;
    if (!entry?.handle) return res.status(400).json({ error: 'handle required' });
    const lb = await readLb();
    const ex = lb[entry.handle];
    lb[entry.handle] = {
      name:       entry.name   || ex?.name   || entry.handle,
      handle:     entry.handle,
      avatar:     entry.avatar || ex?.avatar || '',
      wallet:     entry.wallet || ex?.wallet || null,
      tweetCount: (ex?.tweetCount || 0) + 1,
      daily:      entry.daily   ?? ex?.daily  ?? null,
      weekly:     entry.weekly  ?? ex?.weekly ?? null,
      monthly:    entry.monthly ?? ex?.monthly ?? null,
      firstSeen:  ex?.firstSeen || Date.now(),
      lastSeen:   Date.now(),
    };
    await writeLb(lb);
    return res.status(200).json({ ok: true });
  }

  res.status(405).json({ error: 'Method not allowed' });
}
